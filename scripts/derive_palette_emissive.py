#!/usr/bin/env python3
import argparse
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image


def parse_args():
    parser = argparse.ArgumentParser(description="Derive a deterministic MAGTOPIA emissive map from constrained RGB palette colors.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--minimum-component", type=int, default=40)
    return parser.parse_args()


def keep_large_components(mask, minimum_area):
    height, width = mask.shape
    visited = np.zeros((height, width), dtype=bool)
    kept = np.zeros((height, width), dtype=bool)
    for y in range(height):
        for x in range(width):
            if visited[y, x] or not mask[y, x]:
                continue
            visited[y, x] = True
            queue = deque([(x, y)])
            component = []
            while queue:
                current_x, current_y = queue.popleft()
                component.append((current_x, current_y))
                for next_x, next_y in ((current_x - 1, current_y), (current_x + 1, current_y), (current_x, current_y - 1), (current_x, current_y + 1)):
                    if not (0 <= next_x < width and 0 <= next_y < height):
                        continue
                    if visited[next_y, next_x] or not mask[next_y, next_x]:
                        continue
                    visited[next_y, next_x] = True
                    queue.append((next_x, next_y))
            if len(component) >= minimum_area:
                for component_x, component_y in component:
                    kept[component_y, component_x] = True
    return kept


def main():
    args = parse_args()
    source = np.asarray(Image.open(args.input).convert("RGB"), dtype=np.uint8)
    red = source[:, :, 0].astype(np.int16)
    green = source[:, :, 1].astype(np.int16)
    blue = source[:, :, 2].astype(np.int16)

    warm_candidates = (red > 240) & (green > 145) & (blue < 90) & ((red - blue) > 145)
    teal_candidates = (red < 110) & (green > 115) & (blue > 100) & ((green - red) > 45)
    warm = keep_large_components(warm_candidates, args.minimum_component)
    teal = keep_large_components(teal_candidates, args.minimum_component)

    output = np.zeros((source.shape[0], source.shape[1], 4), dtype=np.uint8)
    output[warm] = (240, 191, 103, 255)
    output[teal] = (109, 188, 178, 255)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(output, "RGBA").save(args.out)
    print(f"warm_pixels={int(warm.sum())} teal_pixels={int(teal.sum())}")


if __name__ == "__main__":
    main()
