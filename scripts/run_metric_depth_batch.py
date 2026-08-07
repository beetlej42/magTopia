from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from transformers import AutoImageProcessor, AutoModelForDepthEstimation

from depth_distribution_fit import encode_depth_preview, expected_base_anchor_depths, load_guide_for_asset, sample_supported_values
from run_depth_anything import composite_on_background, pick_device, to_normal_image


DEFAULT_MODEL = "depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf"
VARIANT = "metric-indoor-small"


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Depth Anything V2 Indoor Small metric model on existing MAGTOPIA assets.")
    parser.add_argument("inputs", nargs="+", help="RGBA rgb.png asset paths.")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--background", default="#f5eef8")
    parser.add_argument("--normal-strength", type=float, default=9.0)
    args = parser.parse_args()

    device = pick_device()
    processor = AutoImageProcessor.from_pretrained(args.model)
    model = AutoModelForDepthEstimation.from_pretrained(args.model).to(device)
    model.eval()

    for input_text in args.inputs:
        input_path = Path(input_text)
        asset_dir = input_path.parent
        manifest_path = asset_dir / "asset.json"
        asset = json.loads(manifest_path.read_text(encoding="utf-8"))
        guide, guide_path = load_guide_for_asset(manifest_path)
        rgba = Image.open(input_path).convert("RGBA")
        alpha = np.asarray(rgba.getchannel("A"), dtype=np.float32) / 255.0
        visible = alpha > 0.05
        composited = composite_on_background(rgba, args.background)

        inputs = processor(images=composited, return_tensors="pt")
        inputs = {key: value.to(device) for key, value in inputs.items()}
        with torch.no_grad():
            predicted = model(**inputs).predicted_depth
            predicted = F.interpolate(
                predicted.unsqueeze(1),
                size=(rgba.height, rgba.width),
                mode="bicubic",
                align_corners=False,
            ).squeeze()
        metric_distance = predicted.detach().float().cpu().numpy().astype(np.float32)

        anchors = asset.get("baseAnchorsUv") or guide["baseAnchorsUv"]
        distance_anchors = sample_supported_values(metric_distance, visible, anchors)
        expected_anchors = expected_base_anchor_depths(guide)
        keys = ("left", "near", "right")
        offsets = [expected_anchors[key] + distance_anchors[key] for key in keys if np.isfinite(distance_anchors[key])]
        view_offset = float(np.median(offsets))
        view_depth = np.where(visible, view_offset - metric_distance, np.nan).astype(np.float32)
        minimum = float(np.nanmin(view_depth))
        maximum = float(np.nanmax(view_depth))

        raw_name = f"depth-{VARIANT}-meters.npy"
        depth_float_name = f"depth-{VARIANT}-view.npy"
        depth_name = f"depth-{VARIANT}.png"
        normal_name = f"normal-{VARIANT}.png"
        metadata_name = f"depth-{VARIANT}.json"
        np.save(asset_dir / raw_name, np.where(visible, metric_distance, np.nan).astype(np.float32))
        np.save(asset_dir / depth_float_name, view_depth)
        encode_depth_preview(view_depth, alpha, minimum, maximum).save(asset_dir / depth_name)
        normalized = np.nan_to_num((view_depth - minimum) / max(maximum - minimum, 1e-8), nan=0.0).astype(np.float32)
        to_normal_image(normalized, alpha, args.normal_strength).save(asset_dir / normal_name)

        anchor_residuals = {
            key: float((view_offset - distance_anchors[key]) - expected_anchors[key])
            for key in keys
            if np.isfinite(distance_anchors[key])
        }
        metadata = {
            "model": args.model,
            "input": input_path.name,
            "device": device,
            "depthEstimationType": "metric",
            "trainingDomain": "indoor-hypersim",
            "metricDistance": raw_name,
            "viewDepth": depth_float_name,
            "depth": depth_name,
            "normal": normal_name,
            "conversion": {
                "formula": "viewDepth = viewOffset - metricDistanceMeters",
                "viewOffset": view_offset,
                "scale": 1.0,
                "alignment": "single global translation from median base-anchor residual",
                "anchorResiduals": anchor_residuals,
            },
            "encoding": {
                "file": depth_name,
                "minimumViewDepth": minimum,
                "maximumViewDepth": maximum,
                "bits": 8,
                "clamped": False,
            },
            "guide": str(guide_path),
            "note": "Metric distance is preserved at unit scale. Only one global view-axis translation is applied; no linear rescaling or spatial correction is used.",
        }
        (asset_dir / metadata_name).write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

        variants = asset.setdefault("depthFitVariants", {})
        variants[VARIANT] = {
            "depth": depth_name,
            "normal": normal_name,
            "metadata": metadata_name,
            "depthEncoding": {"kind": "metric-depth-view-translation-v1", "bits": 8, "minimumViewDepth": minimum, "maximumViewDepth": maximum},
            "conversion": metadata["conversion"],
        }
        manifest_path.write_text(json.dumps(asset, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({
            "assetId": asset.get("assetId"),
            "model": args.model,
            "metricRangeMeters": [float(np.nanmin(metric_distance[visible])), float(np.nanmax(metric_distance[visible]))],
            "viewOffset": view_offset,
            "viewDepthRange": [minimum, maximum],
            "anchorResiduals": anchor_residuals,
        }))


if __name__ == "__main__":
    main()
