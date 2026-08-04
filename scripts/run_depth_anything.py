from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from transformers import AutoImageProcessor, AutoModelForDepthEstimation

from depth_distribution_fit import calibrate_asset_depth, encode_depth_preview, load_guide_for_asset


DEFAULT_MODEL = "depth-anything/Depth-Anything-V2-Small-hf"


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Depth Anything and derive a normal map.")
    parser.add_argument("--input", required=True, help="RGBA/RGB input image.")
    parser.add_argument("--out-dir", required=True, help="Output directory.")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Hugging Face depth-estimation model id.")
    parser.add_argument("--background", default="#f5eef8", help="Flat RGB background for alpha compositing.")
    parser.add_argument("--normal-strength", type=float, default=9.0, help="Depth gradient scale for normal output.")
    parser.add_argument("--linear-guide-fit", action="store_true", help="Fit raw relative depth to the guideplate visible-depth distribution with one global linear mapping.")
    parser.add_argument("--guide", help="Guideplate JSON used by --linear-guide-fit. Defaults to the pack guide beside asset.json.")
    args = parser.parse_args()

    input_path = Path(args.input)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    rgba = Image.open(input_path).convert("RGBA")
    alpha = np.asarray(rgba.getchannel("A"), dtype=np.float32) / 255.0
    composited = composite_on_background(rgba, args.background)

    device = pick_device()
    processor = AutoImageProcessor.from_pretrained(args.model)
    model = AutoModelForDepthEstimation.from_pretrained(args.model).to(device)
    model.eval()

    inputs = processor(images=composited, return_tensors="pt")
    inputs = {key: value.to(device) for key, value in inputs.items()}

    with torch.no_grad():
      outputs = model(**inputs)
      depth = outputs.predicted_depth
      depth = F.interpolate(
          depth.unsqueeze(1),
          size=(rgba.height, rgba.width),
          mode="bicubic",
          align_corners=False,
      ).squeeze()

    raw_depth = depth.detach().float().cpu().numpy()
    depth_array = normalize_depth(raw_depth, alpha)
    depth_image = to_depth_image(depth_array, alpha)
    normal_image = to_normal_image(depth_array, alpha, args.normal_strength)

    depth_path = out_dir / "depth-anything.png"
    normal_path = out_dir / "normal-depth-anything.png"
    composite_path = out_dir / "depthanything-input-composited.png"
    metadata_path = out_dir / "depth-anything.json"

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
            composited_input=composite_path.name,
        )
    else:
        depth_image.save(depth_path)
        normal_image.save(normal_path)
        metadata = {
            "model": args.model,
            "input": input_path.name,
            "compositedInput": composite_path.name,
            "depth": depth_path.name,
            "normal": normal_path.name,
            "normalStrength": args.normal_strength,
            "device": device,
            "note": "Normal map is derived from the Depth Anything depth map via finite differences.",
        }
    composited.save(composite_path)
    metadata_path.write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def pick_device() -> str:
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def composite_on_background(image: Image.Image, color: str) -> Image.Image:
    rgb = parse_hex_color(color)
    background = Image.new("RGBA", image.size, rgb + (255,))
    return Image.alpha_composite(background, image).convert("RGB")


def parse_hex_color(value: str) -> tuple[int, int, int]:
    text = value.strip().lstrip("#")
    if len(text) != 6:
        raise ValueError(f"Expected #rrggbb color, got {value!r}")
    return tuple(int(text[index : index + 2], 16) for index in (0, 2, 4))


def normalize_depth(depth: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    visible = alpha > 0.05
    if not np.any(visible):
        return np.zeros_like(depth, dtype=np.float32)

    values = depth[visible]
    low = np.percentile(values, 1)
    high = np.percentile(values, 99)
    if high <= low:
        high = float(values.max())
        low = float(values.min())
    normalized = (depth - low) / max(high - low, 1e-6)
    normalized = np.clip(normalized, 0.0, 1.0)

    # Depth Anything returns relative depth. Keep the object masked and bias the
    # visible sprite away from pure black so relief meshes retain a base volume.
    normalized = 0.1 + normalized * 0.9
    normalized *= alpha
    return normalized.astype(np.float32)


def to_depth_image(depth: np.ndarray, alpha: np.ndarray) -> Image.Image:
    value = np.clip(depth * 255.0, 0, 255).astype(np.uint8)
    a = np.clip(alpha * 255.0, 0, 255).astype(np.uint8)
    rgba = np.dstack([value, value, value, a])
    return Image.fromarray(rgba, "RGBA")


def to_normal_image(depth: np.ndarray, alpha: np.ndarray, strength: float) -> Image.Image:
    padded = np.pad(depth, ((1, 1), (1, 1)), mode="edge")
    dx = (padded[1:-1, 2:] - padded[1:-1, :-2]) * strength
    dy = (padded[2:, 1:-1] - padded[:-2, 1:-1]) * strength
    nz = np.ones_like(depth)
    length = np.sqrt(dx * dx + dy * dy + nz * nz)
    nx = -dx / np.maximum(length, 1e-6)
    ny = dy / np.maximum(length, 1e-6)
    nz = nz / np.maximum(length, 1e-6)

    r = ((nx * 0.5 + 0.5) * 255.0).astype(np.uint8)
    g = ((ny * 0.5 + 0.5) * 255.0).astype(np.uint8)
    b = ((nz * 0.5 + 0.5) * 255.0).astype(np.uint8)
    a = np.where(alpha > 0.03, 255, 0).astype(np.uint8)
    return Image.fromarray(np.dstack([r, g, b, a]), "RGBA")


def save_linear_guide_fit(
    *,
    raw_depth: np.ndarray,
    alpha: np.ndarray,
    input_path: Path,
    out_dir: Path,
    model_name: str,
    device: str,
    normal_strength: float,
    guide_path: Path | None = None,
    composited_input: str | None = None,
) -> dict[str, object]:
    manifest_path = out_dir / "asset.json"
    asset = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    guide, resolved_guide_path = load_guide_for_asset(manifest_path, guide_path)
    result = calibrate_asset_depth(raw_depth, alpha, asset, guide)
    guide_minimum, guide_maximum = result.fit.guide_range
    minimum, maximum = result.fit.calibrated_range
    normalized = np.clip((result.calibrated_depth - minimum) / max(maximum - minimum, 1e-8), 0.0, 1.0)
    normalized = np.nan_to_num(normalized, nan=0.0).astype(np.float32)

    raw_name = "depth-anything-raw.npy"
    guide_float_name = "depth-guide.npy"
    guide_preview_name = "depth-guide.png"
    calibrated_float_name = "depth-anything-linear.npy"
    calibrated_preview_name = "depth-anything-linear.png"
    calibrated_normal_name = "normal-depth-anything-linear.png"
    np.save(out_dir / raw_name, raw_depth.astype(np.float32))
    np.save(out_dir / guide_float_name, result.guide_depth.astype(np.float32))
    np.save(out_dir / calibrated_float_name, result.calibrated_depth.astype(np.float32))
    encode_depth_preview(result.guide_depth, result.guide_mask.astype(np.float32), guide_minimum, guide_maximum).save(out_dir / guide_preview_name)
    encode_depth_preview(result.calibrated_depth, alpha, minimum, maximum).save(out_dir / calibrated_preview_name)
    to_normal_image(normalized, alpha, normal_strength).save(out_dir / calibrated_normal_name)

    fit_metadata = result.fit.as_dict()
    fit_metadata["encoding"] = {
        "file": calibrated_preview_name,
        "minimumViewDepth": minimum,
        "maximumViewDepth": maximum,
        "bits": 8,
        "clamped": False,
    }
    fit_metadata["rawAnchorSamples"] = finite_json_values(result.raw_anchor_samples)
    fit_metadata["expectedAnchorDepths"] = finite_json_values(result.expected_anchor_depths)
    metadata: dict[str, object] = {
        "model": model_name,
        "input": input_path.name,
        "rawDepth": raw_name,
        "guide": str(resolved_guide_path),
        "guideDepth": guide_float_name,
        "guideDepthPreview": guide_preview_name,
        "depth": calibrated_preview_name,
        "calibratedDepth": calibrated_float_name,
        "normal": calibrated_normal_name,
        "normalStrength": normal_strength,
        "device": device,
        "calibration": fit_metadata,
        "note": "Raw relative depth is converted to guideplate view depth by one global linear quantile fit; no spatial residual is applied.",
    }
    if composited_input:
        metadata["compositedInput"] = composited_input

    if manifest_path.exists():
        maps = asset.setdefault("maps", {})
        maps["depthRawFloat"] = raw_name
        maps["guideDepthFloat"] = guide_float_name
        maps["guideDepthPreview"] = guide_preview_name
        maps["depth"] = calibrated_preview_name
        maps["depthCalibratedFloat"] = calibrated_float_name
        maps["normal"] = calibrated_normal_name
        maps["depthMetadata"] = "depth-anything.json"
        asset["depthProvider"] = "depth-anything-relative-global-linear-guide-fit"
        asset["depthCalibration"] = fit_metadata
        asset.pop("depthUpgradeCommand", None)
        manifest_path.write_text(json.dumps(asset, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return metadata


def finite_json_values(values: dict[str, float]) -> dict[str, float | None]:
    return {key: float(value) if np.isfinite(value) else None for key, value in values.items()}


if __name__ == "__main__":
    main()
