#!/usr/bin/env python3
"""Prepare a transparent asset render as a centered neutral-background 3D input."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image


def prepare_input(source: Path, output: Path, subject_fill: float = 0.82) -> dict:
    image = Image.open(source).convert("RGBA")
    alpha = image.getchannel("A")
    bounds = alpha.getbbox()
    if bounds is None:
        raise ValueError(f"{source} has no visible pixels")

    subject = image.crop(bounds)
    canvas_size = math.ceil(max(subject.size) / subject_fill)
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (127, 127, 127, 255))
    offset = ((canvas_size - subject.width) // 2, (canvas_size - subject.height) // 2)
    canvas.alpha_composite(subject, offset)
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(output, "PNG", optimize=True)
    return {
        "source": str(source),
        "output": str(output),
        "sourceBounds": list(bounds),
        "subjectSize": list(subject.size),
        "outputSize": [canvas_size, canvas_size],
        "subjectFill": subject_fill,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--subject-fill", type=float, default=0.82)
    args = parser.parse_args()
    print(prepare_input(args.source, args.out, args.subject_fill))


if __name__ == "__main__":
    main()
