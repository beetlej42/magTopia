from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw


CAMERA = {"yaw": 45, "elevation": 55, "roll": 0, "projection": "orthographic"}
KEY = "#ff00ff"


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate an isometric hard-envelope guideplate for image-model building production.")
    parser.add_argument("--dimensions", required=True, help="World-unit length×width×height, for example 4x8x8.2.")
    parser.add_argument("--out", required=True, help="Guideplate PNG output path.")
    parser.add_argument("--entrance", default="south", choices=("north", "east", "south", "west"))
    parser.add_argument("--grid-unit", type=float, default=4.0)
    parser.add_argument("--size", type=int, default=1024)
    args = parser.parse_args()

    length, width, height = parse_dimensions(args.dimensions)
    image, base_anchors_uv = draw_guideplate(length, width, height, args.entrance, args.grid_unit, args.size)
    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output)
    output.with_suffix(".json").write_text(json.dumps({
        "kind": "magic-town-parcel-guideplate",
        "dimensions": {"length": length, "width": width, "height": height, "unit": "world"},
        "gridUnit": args.grid_unit,
        "camera": CAMERA,
        "entrance": args.entrance,
        "safeMargin": 0.32,
        "baseAnchorContract": "guideplate-visible-triangle-v1",
        "baseAnchorsUv": base_anchors_uv,
        "keyColor": KEY,
        "instruction": "The dark base is immutable. Replace only the translucent blue envelope with one building that remains fully inside its outline."
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def parse_dimensions(value: str) -> tuple[float, float, float]:
    parts = value.lower().replace("×", "x").split("x")
    if len(parts) != 3:
        raise ValueError("dimensions must be lengthxwidthxheight, for example 4x8x8.2")
    dimensions = tuple(float(part) for part in parts)
    if any(number <= 0 for number in dimensions):
        raise ValueError("All dimensions must be positive")
    return dimensions


def draw_guideplate(length: float, width: float, height: float, entrance: str, grid_unit: float, size: int) -> tuple[Image.Image, dict[str, list[float]]]:
    pad = size * 0.09
    def raw_point(x: float, y: float, z: float) -> tuple[float, float]:
        return ((x - z) * 0.78, -(x + z) * 0.36 - y * 0.82)

    # Include one world unit outside the parcel so the entrance arrow and the
    # full dark base are never clipped at the canvas boundary.
    bounds = [raw_point(x, y, z) for x in (-length / 2 - 1, length / 2 + 1) for y in (0, height) for z in (-width / 2 - 1, width / 2 + 1)]
    min_x, max_x = min(point[0] for point in bounds), max(point[0] for point in bounds)
    min_y, max_y = min(point[1] for point in bounds), max(point[1] for point in bounds)
    scale = min((size - pad * 2) / (max_x - min_x), (size - pad * 2) / (max_y - min_y))
    center_x = size / 2 - (min_x + max_x) * scale / 2
    center_y = size / 2 - (min_y + max_y) * scale / 2

    def point(x: float, y: float, z: float) -> tuple[float, float]:
        raw_x, raw_y = raw_point(x, y, z)
        return (center_x + raw_x * scale, center_y + raw_y * scale)

    image = Image.new("RGBA", (size, size), KEY)
    draw = ImageDraw.Draw(image, "RGBA")
    corners = [(-length / 2, 0, -width / 2), (length / 2, 0, -width / 2), (length / 2, 0, width / 2), (-length / 2, 0, width / 2)]
    base = [point(*corner) for corner in corners]
    draw.polygon(base, fill="#4c5964", outline="#27313a", width=max(2, round(scale * 0.025)))

    for x in grid_lines(length, grid_unit):
        draw.line([point(x, 0.01, -width / 2), point(x, 0.01, width / 2)], fill="#9aa9b2", width=max(1, round(scale * 0.012)))
    for z in grid_lines(width, grid_unit):
        draw.line([point(-length / 2, 0.01, z), point(length / 2, 0.01, z)], fill="#9aa9b2", width=max(1, round(scale * 0.012)))

    margin = min(0.32, length * 0.18, width * 0.18)
    safe_corners = [(-length / 2 + margin, 0.02, -width / 2 + margin), (length / 2 - margin, 0.02, -width / 2 + margin), (length / 2 - margin, 0.02, width / 2 - margin), (-length / 2 + margin, 0.02, width / 2 - margin)]
    safe_base = [point(*corner) for corner in safe_corners]
    draw.line(safe_base + [safe_base[0]], fill="#f5c96a", width=max(2, round(scale * 0.022)), joint="curve")

    bottom = safe_corners
    top = [(x, height, z) for x, _, z in safe_corners]
    front_face = [point(*bottom[index]) for index in (2, 3)] + [point(*top[index]) for index in (3, 2)]
    side_face = [point(*bottom[index]) for index in (1, 2)] + [point(*top[index]) for index in (2, 1)]
    roof_face = [point(*corner) for corner in top]
    draw.polygon(front_face, fill=(101, 135, 177, 78))
    draw.polygon(side_face, fill=(76, 110, 154, 92))
    draw.polygon(roof_face, fill=(141, 176, 212, 86))
    envelope_edges = [[point(*bottom[index]), point(*top[index])] for index in range(4)]
    envelope_edges += [[point(*top[index]), point(*top[(index + 1) % 4])] for index in range(4)]
    for edge in envelope_edges:
        draw.line(edge, fill="#c5ddf4", width=max(2, round(scale * 0.02)))

    start, end = entrance_arrow(entrance, length, width)
    draw.line([point(*start), point(*end)], fill="#f5c96a", width=max(2, round(scale * 0.035)))
    arrow_head(draw, point(*start), point(*end), max(7, round(scale * 0.12)), "#f5c96a")
    def uv(index: int) -> list[float]:
        x, y = base[index]
        return [x / size, 1 - y / size]

    return image, {
        "left": uv(3),
        "near": uv(0),
        "right": uv(1)
    }


def grid_lines(span: float, unit: float) -> list[float]:
    count = round(span / unit)
    return [-span / 2 + index * unit for index in range(1, count)]


def entrance_arrow(entrance: str, length: float, width: float) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
    offsets = {"north": (0, 0, -1), "east": (1, 0, 0), "south": (0, 0, 1), "west": (-1, 0, 0)}
    dx, _, dz = offsets[entrance]
    edge_x = dx * length / 2
    edge_z = dz * width / 2
    return (edge_x + dx * 0.8, 0.08, edge_z + dz * 0.8), (edge_x, 0.08, edge_z)


def arrow_head(draw: ImageDraw.ImageDraw, start: tuple[float, float], end: tuple[float, float], size: float, color: str) -> None:
    dx, dy = end[0] - start[0], end[1] - start[1]
    length = max((dx * dx + dy * dy) ** 0.5, 1)
    nx, ny = dx / length, dy / length
    left = (end[0] - nx * size - ny * size * 0.5, end[1] - ny * size + nx * size * 0.5)
    right = (end[0] - nx * size + ny * size * 0.5, end[1] - ny * size - nx * size * 0.5)
    draw.polygon([end, left, right], fill=color)


if __name__ == "__main__":
    main()
