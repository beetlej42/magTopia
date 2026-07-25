from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def main() -> None:
    for text_path in sys.argv[1:]:
        rgb_path = Path(text_path)
        rgba = Image.open(rgb_path).convert("RGBA")
        alpha = np.asarray(rgba.getchannel("A"), dtype=np.float32) / 255.0
        rgb = np.asarray(rgba.convert("RGB"), dtype=np.uint8)
        height, width = alpha.shape
        vertical = 1.0 - np.arange(height, dtype=np.float32)[:, None] / max(1, height - 1)
        depth = (0.12 + 0.78 * vertical) * alpha
        depth = np.where(alpha > 0.05, depth, 0.0)
        padded = np.pad(depth, ((1, 1), (1, 1)), mode="edge")
        dx = (padded[1:-1, 2:] - padded[1:-1, :-2]) * 8.0
        dy = (padded[2:, 1:-1] - padded[:-2, 1:-1]) * 8.0
        nz = np.ones_like(depth)
        length = np.sqrt(dx * dx + dy * dy + nz * nz)
        normal = np.dstack([(((-dx / length) * 0.5 + 0.5) * 255).astype(np.uint8), (((dy / length) * 0.5 + 0.5) * 255).astype(np.uint8), (((nz / length) * 0.5 + 0.5) * 255).astype(np.uint8), (alpha * 255).astype(np.uint8)])
        depth_rgba = np.dstack([(depth * 255).astype(np.uint8)] * 3 + [(alpha * 255).astype(np.uint8)])
        Image.fromarray(depth_rgba, "RGBA").save(rgb_path.parent / "depth-fallback.png")
        Image.fromarray(normal, "RGBA").save(rgb_path.parent / "normal-fallback.png")
        r, g, b = (rgb[:, :, channel] for channel in range(3))
        visible = alpha > 0.7
        warm = visible & (r > 185) & (g > 130) & (b < 120)
        teal = visible & (r < 150) & (g > 145) & (b > 130)
        violet = visible & (r > 150) & (g < 135) & (b > 150)
        emission = np.zeros((height, width, 4), dtype=np.uint8)
        emission[warm] = (240, 191, 103, 190)
        emission[teal] = (109, 188, 178, 135)
        emission[violet] = (128, 104, 183, 125)
        Image.fromarray(emission, "RGBA").save(rgb_path.parent / "emissive.png")
        manifest_path = rgb_path.parent / "asset.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["maps"]["depth"] = "depth-fallback.png"
        manifest["maps"]["normal"] = "normal-fallback.png"
        manifest["depthProvider"] = "local-alpha-height-fallback"
        pack = rgb_path.parent.parent.name
        manifest["depthUpgradeCommand"] = f"python scripts/run_depth_anything_batch.py public/generated/{pack}/*/rgb.png"
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
