from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from transformers import AutoImageProcessor, AutoModelForDepthEstimation

from run_depth_anything import DEFAULT_MODEL, composite_on_background, normalize_depth, pick_device, save_linear_guide_fit, to_depth_image, to_normal_image


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Depth Anything once for a batch of MagicTown asset RGB maps.")
    parser.add_argument("inputs", nargs="+", help="Paths to RGBA rgb.png assets.")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--background", default="#f5eef8")
    parser.add_argument("--normal-strength", type=float, default=9.0)
    parser.add_argument("--linear-guide-fit", action="store_true", help="Fit every raw depth map to its guideplate visible-depth distribution with one global linear mapping.")
    parser.add_argument("--guide", help="Guideplate JSON shared by the batch. Defaults to the guide beside each asset folder.")
    args = parser.parse_args()

    device = pick_device()
    processor = AutoImageProcessor.from_pretrained(args.model)
    model = AutoModelForDepthEstimation.from_pretrained(args.model).to(device)
    model.eval()
    for text_path in args.inputs:
        input_path = Path(text_path)
        rgba = Image.open(input_path).convert("RGBA")
        alpha = np.asarray(rgba.getchannel("A"), dtype=np.float32) / 255.0
        composite = composite_on_background(rgba, args.background)
        inputs = processor(images=composite, return_tensors="pt")
        inputs = {key: value.to(device) for key, value in inputs.items()}
        with torch.no_grad():
            depth = model(**inputs).predicted_depth
            depth = F.interpolate(depth.unsqueeze(1), size=(rgba.height, rgba.width), mode="bicubic", align_corners=False).squeeze()
        raw_depth = depth.detach().float().cpu().numpy()
        depth_array = normalize_depth(raw_depth, alpha)
        out_dir = input_path.parent
        if args.linear_guide_fit:
            metadata = save_linear_guide_fit(
                raw_depth=raw_depth,
                alpha=alpha,
                input_path=input_path,
                out_dir=out_dir,
                model_name=args.model,
                device=device,
                normal_strength=args.normal_strength,
                guide_path=Path(args.guide) if args.guide else None,
            )
        else:
            to_depth_image(depth_array, alpha).save(out_dir / "depth-anything.png")
            to_normal_image(depth_array, alpha, args.normal_strength).save(out_dir / "normal-depth-anything.png")
            metadata = {"model": args.model, "input": input_path.name, "depth": "depth-anything.png", "normal": "normal-depth-anything.png", "normalStrength": args.normal_strength, "device": device, "note": "Batch-generated relative depth and normal maps."}
            manifest_path = out_dir / "asset.json"
            if manifest_path.exists():
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                manifest["maps"]["depth"] = "depth-anything.png"
                manifest["maps"]["normal"] = "normal-depth-anything.png"
                manifest["depthProvider"] = "depth-anything-v2-small-relative"
                manifest.pop("depthUpgradeCommand", None)
                manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (out_dir / "depth-anything.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
