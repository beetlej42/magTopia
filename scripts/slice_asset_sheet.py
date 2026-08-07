from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image


KEY = (255, 0, 255)


def main() -> None:
    parser = argparse.ArgumentParser(description="Split a chroma-key MAGTOPIA contact sheet into independent assets.")
    parser.add_argument("--input", required=True, help="Source contact-sheet PNG.")
    parser.add_argument("--out-dir", required=True, help="Directory for independent asset folders.")
    parser.add_argument("--columns", required=True, type=int)
    parser.add_argument("--rows", required=True, type=int)
    parser.add_argument("--assets", required=True, help="JSON array with id, footprint, archetype, and optional nightProfile.")
    parser.add_argument("--guide", help="Guideplate JSON. Defaults to guide-4x4x4.json beside the output asset folders when present.")
    args = parser.parse_args()

    entries = json.loads(args.assets)
    if len(entries) != args.columns * args.rows:
        raise ValueError("Asset metadata count must equal columns × rows")

    source_path = Path(args.input)
    sheet = Image.open(source_path).convert("RGBA")
    boxes = cell_boxes(sheet, args.columns, args.rows)
    root = Path(args.out_dir)
    root.mkdir(parents=True, exist_ok=True)
    guide_path = Path(args.guide) if args.guide else root / "guide-4x4x4.json"
    guide = json.loads(guide_path.read_text(encoding="utf-8")) if guide_path.exists() else None

    for entry, box in zip(entries, boxes, strict=True):
        folder = root / entry["id"]
        folder.mkdir(parents=True, exist_ok=True)
        source = sheet.crop(box)
        source.save(folder / "source-magenta.png")
        rgba, mask, emissive = derive_maps(source)
        rgba.save(folder / "rgb.png")
        mask.save(folder / "mask.png")
        emissive.save(folder / "emissive.png")
        manifest = {
            "assetId": entry["id"],
            "archetype": entry["archetype"],
            "footprint": entry["footprint"],
            "dimensions": entry.get("dimensions"),
            "sourceSheet": source_path.name,
            "sheetCell": {"column": entry["column"], "row": entry["row"]},
            "camera": {"yaw": 45, "elevation": 55, "projection": "orthographic"},
            "maps": {
                "source": "source-magenta.png",
                "rgb": "rgb.png",
                "mask": "mask.png",
                "emissive": "emissive.png",
                "depth": "depth-anything.png",
                "normal": "normal-depth-anything.png",
            },
            "nightProfile": entry.get("nightProfile", "residential"),
            "emissiveNote": "Exact-UV fallback derived from warm/teal/violet pixels; replace with image-model semantic emission map when a higher-fidelity night pass is requested.",
        }
        if guide:
            manifest["baseAnchorContract"] = guide["baseAnchorContract"]
            manifest["baseAnchorsUv"] = guide["baseAnchorsUv"]
            manifest["baseAnchorSource"] = "guideplate"
        (folder / "asset.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def cell_boxes(sheet: Image.Image, columns: int, rows: int) -> list[tuple[int, int, int, int]]:
    width, height = sheet.size
    x_edges = split_edges(width, columns, lambda x: white_fraction_column(sheet, x))
    y_edges = split_edges(height, rows, lambda y: white_fraction_row(sheet, y))
    return [(x_edges[x], y_edges[y], x_edges[x + 1], y_edges[y + 1]) for y in range(rows) for x in range(columns)]


def split_edges(length: int, count: int, fraction_at) -> list[int]:
    edges = [0]
    for divider in range(1, count):
        center = round(length * divider / count)
        radius = max(4, length // (count * 10))
        candidates = range(max(1, center - radius), min(length - 1, center + radius + 1))
        seam = max(candidates, key=fraction_at)
        # A white separator is intentionally thrown away; magenta-only sheets keep the centered split.
        edges.append(seam if fraction_at(seam) > 0.85 else center)
    edges.append(length)
    return edges


def white_fraction_column(image: Image.Image, x: int) -> float:
    pixels = image.load()
    return sum(is_white(pixels[x, y]) for y in range(image.height)) / image.height


def white_fraction_row(image: Image.Image, y: int) -> float:
    pixels = image.load()
    return sum(is_white(pixels[x, y]) for x in range(image.width)) / image.width


def is_white(pixel: tuple[int, int, int, int]) -> bool:
    r, g, b, _ = pixel
    return r > 240 and g > 240 and b > 240


def derive_maps(source: Image.Image) -> tuple[Image.Image, Image.Image, Image.Image]:
    rgba = source.copy()
    mask = Image.new("L", source.size, 0)
    emission = Image.new("RGBA", source.size, (0, 0, 0, 0))
    pixels = rgba.load()
    mask_pixels = mask.load()
    emission_pixels = emission.load()
    for y in range(source.height):
        for x in range(source.width):
            r, g, b, _ = pixels[x, y]
            distance = ((r - KEY[0]) ** 2 + (g - KEY[1]) ** 2 + (b - KEY[2]) ** 2) ** 0.5
            alpha = 0 if distance < 110 or is_white((r, g, b, 255)) else min(255, round((distance - 110) / 90 * 255))
            pixels[x, y] = (r, g, b, alpha)
            mask_pixels[x, y] = alpha
            if alpha < 180:
                continue
            warm = r > 155 and g > 95 and b < 135 and r + g > b * 3
            teal = g > r * 1.08 and g > b * 1.05 and g > 90
            violet = b > g * 1.12 and r > g * 1.05 and b > 100
            if warm:
                emission_pixels[x, y] = (240, 191, 103, 178)
            elif teal:
                emission_pixels[x, y] = (109, 188, 178, 110)
            elif violet:
                emission_pixels[x, y] = (128, 104, 183, 105)
    return rgba, mask, emission


if __name__ == "__main__":
    main()
