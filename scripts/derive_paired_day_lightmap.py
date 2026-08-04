#!/usr/bin/env python3

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


MAGENTA = np.array([1.0, 0.0, 1.0], dtype=np.float32)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Align paired Hunyuan daylight renders and derive an additive RGB light contribution map."
    )
    parser.add_argument("--off", required=True)
    parser.add_argument("--on", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--support-out")
    parser.add_argument("--composite-out")
    parser.add_argument("--report")
    parser.add_argument("--seed-delta", type=float, default=0.10)
    parser.add_argument("--support-delta", type=float, default=0.012)
    parser.add_argument("--growth", type=int, default=22)
    parser.add_argument("--seed-max-off-luma", type=float, default=0.50)
    parser.add_argument("--seed-min-on-luma", type=float, default=0.62)
    parser.add_argument("--max-seed-component-span", type=int, default=180)
    parser.add_argument("--minimum-seed-fill", type=float, default=0.14)
    parser.add_argument("--minimum-seed-area", type=int, default=200)
    parser.add_argument("--tint", help="Optional #RRGGBB light color; preserves derived intensity.")
    return parser.parse_args()


def subject_mask(image):
    # Hunyuan usually preserves the requested pink chroma family but may add a
    # low-frequency background gradient. Treat that family as background
    # without requiring exact #FF00FF pixels. This stays portable across macOS
    # and Linux and deliberately does not depend on Apple Vision segmentation.
    red = image[:, :, 0]
    green = image[:, :, 1]
    blue = image[:, :, 2]
    chroma_background = (
        (red > 0.72)
        & (blue > 0.58)
        & ((np.minimum(red, blue) - green) > 0.22)
    )
    return ~chroma_background


def robust_affine(source, target, mask):
    coefficients = []
    for channel in range(3):
        x = source[:, :, channel][mask]
        y = target[:, :, channel][mask]
        keep = np.ones(x.shape, dtype=bool)
        slope = 1.0
        intercept = 0.0
        for _ in range(4):
            design = np.stack([x[keep], np.ones(int(keep.sum()), dtype=np.float32)], axis=1)
            slope, intercept = np.linalg.lstsq(design, y[keep], rcond=None)[0]
            residual = np.abs(y - (slope * x + intercept))
            cutoff = np.percentile(residual[keep], 85)
            keep = residual <= max(cutoff, 1.0 / 255.0)
        coefficients.append((float(slope), float(intercept)))
    return coefficients


def apply_affine(image, coefficients):
    output = np.empty_like(image)
    for channel, (slope, intercept) in enumerate(coefficients):
        output[:, :, channel] = image[:, :, channel] * slope + intercept
    return output


def edge_magnitude(grayscale):
    horizontal = ndimage.sobel(grayscale, axis=1, mode="nearest")
    vertical = ndimage.sobel(grayscale, axis=0, mode="nearest")
    magnitude = np.hypot(horizontal, vertical)
    maximum = float(magnitude.max())
    return magnitude / maximum if maximum > 0 else magnitude


def rgb_to_gray(image):
    return (
        image[:, :, 0] * 0.2126
        + image[:, :, 1] * 0.7152
        + image[:, :, 2] * 0.0722
    )


def keep_window_like_seed_components(mask, max_span, minimum_fill, minimum_area):
    labels, count = ndimage.label(mask)
    kept = np.zeros_like(mask)
    for label_id in range(1, count + 1):
        component = labels == label_id
        rows, columns = np.where(component)
        if not len(rows):
            continue
        height = int(rows.max() - rows.min() + 1)
        width = int(columns.max() - columns.min() + 1)
        fill = float(component.sum() / (height * width))
        aspect = max(width / max(height, 1), height / max(width, 1))
        if component.sum() >= minimum_area and max(width, height) <= max_span and aspect <= 6.0 and fill >= minimum_fill:
            kept |= component
    return kept


def center_scale(image, scale, order=1):
    center = (np.array(image.shape[:2], dtype=np.float32) - 1.0) * 0.5
    inverse = 1.0 / scale
    matrix = np.array([[inverse, 0.0], [0.0, inverse]], dtype=np.float32)
    offset = center * (1.0 - inverse)
    return ndimage.affine_transform(
        image,
        matrix,
        offset=offset,
        output_shape=image.shape[:2],
        order=order,
        mode="constant",
        cval=0.0,
        prefilter=order > 1,
    )


def phase_shift(reference, moving):
    reference_fft = np.fft.fft2(reference)
    moving_fft = np.fft.fft2(moving)
    cross_power = reference_fft * np.conj(moving_fft)
    cross_power /= np.maximum(np.abs(cross_power), 1e-8)
    correlation = np.abs(np.fft.ifft2(cross_power))
    peak = np.array(np.unravel_index(np.argmax(correlation), correlation.shape), dtype=np.float32)
    shape = np.array(reference.shape, dtype=np.float32)
    peak[peak > shape * 0.5] -= shape[peak > shape * 0.5]
    return peak


def estimate_similarity(off, on, size=256):
    off_small = np.asarray(
        Image.fromarray(np.round(off * 255.0).astype(np.uint8), "RGB").resize(
            (size, size), Image.Resampling.BILINEAR
        ),
        dtype=np.float32,
    ) / 255.0
    on_small = np.asarray(
        Image.fromarray(np.round(on * 255.0).astype(np.uint8), "RGB").resize(
            (size, size), Image.Resampling.BILINEAR
        ),
        dtype=np.float32,
    ) / 255.0
    off_small_mask = subject_mask(off_small)
    on_small_mask = subject_mask(on_small)
    reference = edge_magnitude(rgb_to_gray(off_small) * off_small_mask)
    moving = edge_magnitude(rgb_to_gray(on_small) * on_small_mask)
    best = None
    for scale in np.linspace(0.94, 1.06, 25):
        scaled = center_scale(moving, float(scale))
        shift = phase_shift(reference, scaled)
        aligned = ndimage.shift(scaled, shift, order=1, mode="constant", cval=0.0)
        denominator = np.linalg.norm(reference) * np.linalg.norm(aligned)
        score = float(np.sum(reference * aligned) / denominator) if denominator else -1.0
        if best is None or score > best["score"]:
            best = {
                "scale": float(scale),
                "shift": shift,
                "score": score,
                "downsampleSize": size,
            }
    return best


def align_image(image, scale, shift, output_shape, order=1):
    center = (np.array(output_shape[:2], dtype=np.float32) - 1.0) * 0.5
    inverse = 1.0 / scale
    matrix = np.array([[inverse, 0.0], [0.0, inverse]], dtype=np.float32)
    offset = center * (1.0 - inverse) - np.asarray(shift, dtype=np.float32) * inverse
    if image.ndim == 2:
        return ndimage.affine_transform(
            image,
            matrix,
            offset=offset,
            output_shape=output_shape[:2],
            order=order,
            mode="constant",
            cval=0.0,
            prefilter=order > 1,
        )
    return np.stack([
        ndimage.affine_transform(
            image[:, :, channel],
            matrix,
            offset=offset,
            output_shape=output_shape[:2],
            order=order,
            mode="nearest",
            prefilter=order > 1,
        )
        for channel in range(image.shape[2])
    ], axis=2)


def main():
    args = parse_args()
    off = np.asarray(Image.open(args.off).convert("RGB"), dtype=np.float32) / 255.0
    on = np.asarray(Image.open(args.on).convert("RGB"), dtype=np.float32) / 255.0
    if off.shape != on.shape:
        raise ValueError(f"Day pair dimensions differ: {off.shape} vs {on.shape}")

    off_mask = subject_mask(off)
    on_mask = subject_mask(on)
    transform = estimate_similarity(off, on)
    full_scale = transform["scale"]
    full_shift = transform["shift"] * (off.shape[0] / transform["downsampleSize"])
    aligned_on = align_image(on, full_scale, full_shift, off.shape, order=1).astype(np.float32)
    aligned_on_mask = align_image(
        on_mask.astype(np.float32),
        full_scale,
        full_shift,
        off.shape,
        order=0,
    ) > 0.5
    valid = off_mask & aligned_on_mask

    warm_on = (
        (aligned_on[:, :, 0] - aligned_on[:, :, 2] > 0.18)
        & (aligned_on[:, :, 1] - aligned_on[:, :, 2] > 0.08)
        & (aligned_on[:, :, 0] > 0.55)
    )
    fit_mask = valid & ~ndimage.binary_dilation(warm_on, iterations=18)
    coefficients = robust_affine(off, aligned_on, fit_mask)
    expected_on = apply_affine(off, coefficients)
    residual = aligned_on - expected_on
    positive = np.clip(residual, 0.0, 1.0)
    brightness_delta = positive.mean(axis=2)
    warmth_delta = (positive[:, :, 0] + positive[:, :, 1]) * 0.5 - positive[:, :, 2]
    off_luma = rgb_to_gray(off)
    on_luma = rgb_to_gray(aligned_on)

    seeds = (
        valid
        & (brightness_delta > args.seed_delta)
        & (warmth_delta > 0.025)
        & warm_on
        & (off_luma < args.seed_max_off_luma)
        & (on_luma > args.seed_min_on_luma)
    )
    seeds = keep_window_like_seed_components(
        seeds,
        args.max_seed_component_span,
        args.minimum_seed_fill,
        args.minimum_seed_area,
    )
    neighborhood = ndimage.binary_dilation(seeds, iterations=args.growth)
    support = (
        valid
        & neighborhood
        & (brightness_delta > args.support_delta)
        & (warmth_delta > 0.0)
    )
    labels, count = ndimage.label(support)
    kept = np.zeros_like(support)
    for label_id in range(1, count + 1):
        component = labels == label_id
        if component.sum() >= 40 and np.any(component & seeds):
            kept |= component

    contribution = np.zeros_like(positive)
    if args.tint:
        value = args.tint.removeprefix("#")
        if len(value) != 6:
            raise ValueError("--tint must use #RRGGBB")
        tint = np.array(
            [int(value[index:index + 2], 16) for index in (0, 2, 4)],
            dtype=np.float32,
        ) / 255.0
        intensity = np.clip(brightness_delta / max(args.seed_delta, 1e-6), 0.0, 1.0)
        contribution[kept] = intensity[kept, None] * tint
    else:
        contribution[kept] = positive[kept]
    lightmap = np.zeros((*off.shape[:2], 4), dtype=np.uint8)
    lightmap[:, :, :3] = np.round(contribution * 255.0).astype(np.uint8)
    lightmap[:, :, 3] = 255
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(lightmap, "RGBA").save(args.out)

    if args.composite_out:
        composited = 1.0 - (1.0 - off) * (1.0 - contribution)
        composited[~off_mask] = MAGENTA
        Image.fromarray(np.round(np.clip(composited, 0.0, 1.0) * 255.0).astype(np.uint8), "RGB").save(args.composite_out)

    if args.support_out:
        support_image = np.zeros((*off.shape[:2], 4), dtype=np.uint8)
        support_image[:, :, 3] = 255
        support_image[kept] = (240, 191, 103, 255)
        Image.fromarray(support_image, "RGBA").save(args.support_out)

    report = {
        "off": str(Path(args.off).resolve()),
        "on": str(Path(args.on).resolve()),
        "out": str(Path(args.out).resolve()),
        "supportOut": str(Path(args.support_out).resolve()) if args.support_out else None,
        "compositeOut": str(Path(args.composite_out).resolve()) if args.composite_out else None,
        "subjectMaskIoUAfterAlignment": float(
            (off_mask & aligned_on_mask).sum() / (off_mask | aligned_on_mask).sum()
        ),
        "affineColorFit": [
            {"channel": channel, "slope": slope, "intercept": intercept}
            for channel, (slope, intercept) in zip("RGB", coefficients)
        ],
        "registration": {
            "scale": full_scale,
            "shiftX": float(full_shift[1]),
            "shiftY": float(full_shift[0]),
            "edgeCorrelation": transform["score"],
            "downsampleSize": transform["downsampleSize"],
        },
        "seedPixels": int(seeds.sum()),
        "supportPixels": int(kept.sum()),
        "parameters": {
            "seedDelta": args.seed_delta,
            "supportDelta": args.support_delta,
            "growth": args.growth,
            "seedMaxOffLuma": args.seed_max_off_luma,
            "seedMinOnLuma": args.seed_min_on_luma,
            "maxSeedComponentSpan": args.max_seed_component_span,
            "minimumSeedFill": args.minimum_seed_fill,
            "minimumSeedArea": args.minimum_seed_area,
            "tint": args.tint,
        },
    }
    if args.report:
        Path(args.report).write_text(f"{json.dumps(report, indent=2)}\n")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
