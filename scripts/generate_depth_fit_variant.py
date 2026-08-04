from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

from depth_distribution_fit import calibrate_asset_depth, encode_depth_preview, load_guide_for_asset


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate an alternate global linear depth fit from an existing Depth Anything raw map.")
    parser.add_argument("asset_dirs", nargs="+", help="Asset folders containing asset.json, rgb.png, and depth-anything-raw.npy.")
    parser.add_argument("--fit-surfaces", choices=("all", "walls-ground"), default="walls-ground")
    parser.add_argument("--normal-strength", type=float, default=9.0)
    args = parser.parse_args()

    variant = args.fit_surfaces
    for text_dir in args.asset_dirs:
        asset_dir = Path(text_dir)
        manifest_path = asset_dir / "asset.json"
        asset = json.loads(manifest_path.read_text(encoding="utf-8"))
        guide, guide_path = load_guide_for_asset(manifest_path)
        raw_depth = np.load(asset_dir / "depth-anything-raw.npy").astype(np.float32)
        alpha = np.asarray(Image.open(asset_dir / "rgb.png").convert("RGBA").getchannel("A"), dtype=np.float32) / 255.0
        result = calibrate_asset_depth(raw_depth, alpha, asset, guide, fit_surfaces=variant)

        suffix = variant
        guide_float = f"depth-guide-{suffix}.npy"
        guide_preview = f"depth-guide-{suffix}.png"
        calibrated_float = f"depth-anything-linear-{suffix}.npy"
        calibrated_preview = f"depth-anything-linear-{suffix}.png"
        normal_preview = f"normal-depth-anything-linear-{suffix}.png"
        metadata_name = f"depth-anything-{suffix}.json"
        minimum, maximum = result.fit.calibrated_range
        guide_minimum, guide_maximum = result.fit.guide_range

        np.save(asset_dir / guide_float, result.guide_depth.astype(np.float32))
        np.save(asset_dir / calibrated_float, result.calibrated_depth.astype(np.float32))
        encode_depth_preview(result.guide_depth, result.guide_mask.astype(np.float32), guide_minimum, guide_maximum).save(asset_dir / guide_preview)
        encode_depth_preview(result.calibrated_depth, alpha, minimum, maximum).save(asset_dir / calibrated_preview)
        normalized = np.clip((result.calibrated_depth - minimum) / max(maximum - minimum, 1e-8), 0.0, 1.0)
        normalized = np.nan_to_num(normalized, nan=0.0).astype(np.float32)
        normal_image(normalized, alpha, args.normal_strength).save(asset_dir / normal_preview)

        calibration = result.fit.as_dict()
        calibration["fitSurfaces"] = variant
        calibration["encoding"] = {
            "file": calibrated_preview,
            "minimumViewDepth": minimum,
            "maximumViewDepth": maximum,
            "bits": 8,
            "clamped": False,
        }
        metadata = {
            "input": "depth-anything-raw.npy",
            "guide": str(guide_path),
            "fitSurfaces": variant,
            "guideDepth": guide_float,
            "guideDepthPreview": guide_preview,
            "depth": calibrated_preview,
            "calibratedDepth": calibrated_float,
            "normal": normal_preview,
            "normalStrength": args.normal_strength,
            "calibration": calibration,
            "note": "The global linear fit samples only the guide-visible ground and vertical walls; the resulting mapping is applied unchanged to the full asset depth map.",
        }
        (asset_dir / metadata_name).write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

        variants = asset.setdefault("depthFitVariants", {})
        variants[variant] = {
            "depth": calibrated_preview,
            "normal": normal_preview,
            "metadata": metadata_name,
            "calibration": calibration,
        }
        manifest_path.write_text(json.dumps(asset, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"assetId": asset.get("assetId"), "fitSurfaces": variant, "slope": result.fit.slope, "intercept": result.fit.intercept, "rSquared": result.fit.r_squared, "encoding": calibration["encoding"]}))


def normal_image(depth: np.ndarray, alpha: np.ndarray, strength: float) -> Image.Image:
    padded = np.pad(depth, 1, mode="edge")
    dx = (padded[1:-1, 2:] - padded[1:-1, :-2]) * strength
    dy = (padded[2:, 1:-1] - padded[:-2, 1:-1]) * strength
    nz = np.ones_like(depth)
    length = np.sqrt(dx * dx + dy * dy + nz * nz)
    nx = -dx / np.maximum(length, 1e-6)
    ny = dy / np.maximum(length, 1e-6)
    nz = nz / np.maximum(length, 1e-6)
    rgba = np.dstack([
        (nx * 0.5 + 0.5) * 255.0,
        (ny * 0.5 + 0.5) * 255.0,
        (nz * 0.5 + 0.5) * 255.0,
        np.where(alpha > 0.03, 255, 0),
    ])
    return Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA")


if __name__ == "__main__":
    main()
