from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert an image-model semantic light pass into an alpha-clipped emissive map.")
    parser.add_argument("--semantic", required=True)
    parser.add_argument("--mask", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--manifest", required=True)
    args = parser.parse_args()

    mask = Image.open(args.mask).convert("RGBA")
    semantic = Image.open(args.semantic).convert("RGB").resize(mask.size, Image.Resampling.LANCZOS)
    colors = np.asarray(semantic, dtype=np.uint8)
    alpha = np.asarray(mask.getchannel("A"), dtype=np.uint8)
    brightness = colors.max(axis=2)
    visible = (brightness > 36) & (alpha > 24)
    output = np.zeros((*colors.shape[:2], 4), dtype=np.uint8)
    output[:, :, :3] = colors
    output[:, :, 3] = np.where(visible, alpha, 0)
    Image.fromarray(output, "RGBA").save(args.out)

    manifest_path = Path(args.manifest)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["maps"]["emissive"] = Path(args.out).name
    manifest["maps"]["emissiveSemanticSource"] = Path(args.semantic).name
    manifest["emissiveProvider"] = "image-model-semantic-map"
    manifest["emissiveNote"] = "Semantic image-model map resized to RGB dimensions and clipped by the original building alpha mask."
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
