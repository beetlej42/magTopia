from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image


KEY_COLOR = (255, 0, 255, 255)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Uniformly align an isometric asset to target parcel anchors without changing its proportions."
    )
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--source-anchors", required=True)
    parser.add_argument("--target-anchors", required=True)
    parser.add_argument("--background", choices=("magenta", "transparent"), default="magenta")
    parser.add_argument("--report")
    args = parser.parse_args()

    source_anchors = json.loads(args.source_anchors)
    target_anchors = json.loads(args.target_anchors)
    image = Image.open(args.input).convert("RGBA")
    width, height = image.size

    source_span = source_anchors["right"][0] - source_anchors["left"][0]
    target_span = target_anchors["right"][0] - target_anchors["left"][0]
    if source_span <= 0 or target_span <= 0:
        raise ValueError("left and right anchors must define a positive horizontal span")

    scale = target_span / source_span
    source_near = uv_to_pixel(source_anchors["near"], width, height)
    target_near = uv_to_pixel(target_anchors["near"], width, height)
    translate_x = target_near[0] - scale * source_near[0]
    translate_y = target_near[1] - scale * source_near[1]
    inverse = (
        1.0 / scale,
        0.0,
        -translate_x / scale,
        0.0,
        1.0 / scale,
        -translate_y / scale,
    )

    transformed = image.transform(
        image.size,
        Image.Transform.AFFINE,
        inverse,
        resample=Image.Resampling.BICUBIC,
        fillcolor=(0, 0, 0, 0),
    )
    if args.background == "magenta":
        output = Image.new("RGBA", image.size, KEY_COLOR)
        output.alpha_composite(transformed)
    else:
        output = transformed

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output.save(output_path)

    if args.report:
        Path(args.report).write_text(
            json.dumps(
                {
                    "kind": "uniform-parcel-anchor-normalization-v1",
                    "scale": scale,
                    "translationPixels": {"x": translate_x, "y": translate_y},
                    "sourceAnchorsUv": source_anchors,
                    "targetAnchorsUv": target_anchors,
                    "preservesAspectRatio": True,
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )


def uv_to_pixel(point: list[float], width: int, height: int) -> tuple[float, float]:
    return point[0] * (width - 1), (1.0 - point[1]) * (height - 1)


if __name__ == "__main__":
    main()
