#!/usr/bin/env python3

import argparse
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image


def parse_args():
    parser = argparse.ArgumentParser(
        description="Derive an emissive map from paired Hunyuan night-off and night-on renders."
    )
    parser.add_argument("--off", required=True)
    parser.add_argument("--on", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--minimum-component", type=int, default=200)
    parser.add_argument("--brightness-delta", type=float, default=125.0)
    parser.add_argument("--warmth-delta", type=float, default=25.0)
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
                for next_x, next_y in (
                    (current_x - 1, current_y),
                    (current_x + 1, current_y),
                    (current_x, current_y - 1),
                    (current_x, current_y + 1),
                ):
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
    off = np.asarray(Image.open(args.off).convert("RGB"), dtype=np.float32)
    on = np.asarray(Image.open(args.on).convert("RGB"), dtype=np.float32)
    if off.shape != on.shape:
        raise ValueError(f"Night pair dimensions differ: {off.shape} vs {on.shape}")

    delta = on - off
    brightness_delta = delta.mean(axis=2)
    warmth_delta = (delta[:, :, 0] + delta[:, :, 1]) * 0.5 - delta[:, :, 2]
    candidates = (
        (brightness_delta > args.brightness_delta)
        & (warmth_delta > args.warmth_delta)
        & (delta[:, :, 0] > 0)
        & (delta[:, :, 1] > 0)
    )
    emissive = keep_large_components(candidates, args.minimum_component)

    output = np.zeros((off.shape[0], off.shape[1], 4), dtype=np.uint8)
    output[:, :, 3] = 255
    output[emissive] = (240, 191, 103, 255)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(output, "RGBA").save(args.out)
    print(
        f"candidate_pixels={int(candidates.sum())} "
        f"emissive_pixels={int(emissive.sum())}"
    )


if __name__ == "__main__":
    main()
