#!/usr/bin/env python3
import argparse
from pathlib import Path

from PIL import Image


parser = argparse.ArgumentParser(description="Create a flat RGB image used as an image-edit target.")
parser.add_argument("--out", required=True)
parser.add_argument("--size", default="1024x1024")
parser.add_argument("--color", default="#000000")
args = parser.parse_args()
width, height = (int(value) for value in args.size.lower().split("x", 1))
output = Path(args.out)
output.parent.mkdir(parents=True, exist_ok=True)
Image.new("RGB", (width, height), args.color).save(output)
print(output)
