from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import json
import numpy as np
from PIL import Image


DEFAULT_QUANTILE_LOW = 0.02
DEFAULT_QUANTILE_HIGH = 0.98
DEFAULT_QUANTILE_COUNT = 97
FIT_SURFACES = ("all", "walls-ground")


@dataclass(frozen=True)
class LinearDepthFit:
    slope: float
    intercept: float
    direction: int
    rmse: float
    r_squared: float
    quantile_low: float
    quantile_high: float
    quantile_count: int
    raw_range: tuple[float, float]
    guide_range: tuple[float, float]
    calibrated_range: tuple[float, float]
    anchor_covariance: float

    def as_dict(self) -> dict[str, Any]:
        return {
            "kind": "global-linear-quantile-fit-v1",
            "formula": "viewDepth = slope * rawDepth + intercept",
            "slope": self.slope,
            "intercept": self.intercept,
            "direction": self.direction,
            "rmse": self.rmse,
            "rSquared": self.r_squared,
            "quantiles": {
                "low": self.quantile_low,
                "high": self.quantile_high,
                "count": self.quantile_count,
            },
            "ranges": {
                "raw": list(self.raw_range),
                "guide": list(self.guide_range),
                "calibrated": list(self.calibrated_range),
            },
            "anchorDirectionCovariance": self.anchor_covariance,
        }


@dataclass(frozen=True)
class CalibratedDepthResult:
    guide_depth: np.ndarray
    guide_mask: np.ndarray
    calibrated_depth: np.ndarray
    fit: LinearDepthFit
    raw_anchor_samples: dict[str, float]
    expected_anchor_depths: dict[str, float]


def calibrate_asset_depth(
    raw_depth: np.ndarray,
    alpha: np.ndarray,
    asset: dict[str, Any],
    guide: dict[str, Any],
    fit_surfaces: str = "all",
) -> CalibratedDepthResult:
    if fit_surfaces not in FIT_SURFACES:
        raise ValueError(f"Unknown fit surface selection: {fit_surfaces}")
    anchors = asset.get("baseAnchorsUv") or guide["baseAnchorsUv"]
    guide_depth, guide_mask = render_guide_view_depth(raw_depth.shape, guide, anchors, fit_surfaces=fit_surfaces)
    raw_mask = np.asarray(alpha) > 0.05
    raw_fit_mask = raw_mask if fit_surfaces == "all" else raw_mask & guide_mask
    raw_anchor_samples = sample_supported_values(raw_depth, raw_mask, anchors)
    expected = expected_base_anchor_depths(guide)
    keys = ("left", "near", "right")
    fit = fit_linear_depth_distribution(
        raw_depth,
        raw_fit_mask,
        guide_depth,
        guide_mask,
        raw_anchor_values=np.asarray([raw_anchor_samples[key] for key in keys]),
        expected_anchor_depths=np.asarray([expected[key] for key in keys]),
    )
    calibrated = (fit.slope * raw_depth.astype(np.float64) + fit.intercept).astype(np.float32)
    calibrated = np.where(raw_mask, calibrated, np.nan).astype(np.float32)
    return CalibratedDepthResult(
        guide_depth=guide_depth,
        guide_mask=guide_mask,
        calibrated_depth=calibrated,
        fit=fit,
        raw_anchor_samples=raw_anchor_samples,
        expected_anchor_depths=expected,
    )


def load_guide_for_asset(asset_path: Path, explicit_guide: Path | None = None) -> tuple[dict[str, Any], Path]:
    if explicit_guide is not None:
        guide_path = explicit_guide
    else:
        candidates = [
            asset_path.parent.parent / "guide-4x4x4.json",
            asset_path.parent / "guide-4x4x4.json",
        ]
        guide_path = next((candidate for candidate in candidates if candidate.exists()), None)
        if guide_path is None:
            raise FileNotFoundError(f"No guideplate JSON found for {asset_path}")
    return json.loads(guide_path.read_text(encoding="utf-8")), guide_path


def camera_basis(camera: dict[str, Any]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    yaw = np.deg2rad(float(camera.get("yaw", 45)))
    elevation = np.deg2rad(float(camera.get("elevation", 55)))
    sin_yaw, cos_yaw = np.sin(yaw), np.cos(yaw)
    sin_elevation, cos_elevation = np.sin(elevation), np.cos(elevation)
    right = np.array([cos_yaw, 0.0, -sin_yaw], dtype=np.float64)
    up = np.array(
        [-sin_elevation * sin_yaw, cos_elevation, -sin_elevation * cos_yaw],
        dtype=np.float64,
    )
    view = np.array(
        [cos_elevation * sin_yaw, sin_elevation, cos_elevation * cos_yaw],
        dtype=np.float64,
    )
    return right, up, view


def render_guide_view_depth(
    shape: tuple[int, int],
    guide: dict[str, Any],
    base_anchors_uv: dict[str, list[float]] | None = None,
    fit_surfaces: str = "all",
) -> tuple[np.ndarray, np.ndarray]:
    """Rasterize the visible parcel base and hard envelope into camera view depth.

    Source UVs are converted through the same three-anchor affine contract used by
    the runtime. Rays are orthographic in that canonical screen space. The visible
    value is the largest view-axis coordinate, matching a camera on +view.
    """

    if fit_surfaces not in FIT_SURFACES:
        raise ValueError(f"Unknown fit surface selection: {fit_surfaces}")
    height_px, width_px = shape
    dimensions = guide["dimensions"]
    length = float(dimensions["length"])
    width = float(dimensions["width"])
    building_height = float(dimensions["height"])
    margin = min(
        float(guide.get("safeMargin", 0.32)),
        length * 0.18,
        width * 0.18,
    )
    right, up, view = camera_basis(guide.get("camera", {}))
    anchors = base_anchors_uv or guide["baseAnchorsUv"]
    source = np.asarray([anchors[key] for key in ("left", "near", "right")], dtype=np.float64)
    local = np.asarray(
        [
            [-length / 2, 0.0, width / 2],
            [length / 2, 0.0, width / 2],
            [length / 2, 0.0, -width / 2],
        ],
        dtype=np.float64,
    )
    target = np.stack([local @ right, local @ up], axis=1)

    y_indices, x_indices = np.indices((height_px, width_px), dtype=np.float64)
    uv = np.stack(
        [
            (x_indices + 0.5) / width_px,
            1.0 - (y_indices + 0.5) / height_px,
        ],
        axis=-1,
    )
    screen = map_triangle_points(uv, source, target)
    ray_origin = screen[..., 0, None] * right + screen[..., 1, None] * up

    safe_bounds = np.asarray(
        [
            [-length / 2 + margin, length / 2 - margin],
            [0.02, building_height],
            [-width / 2 + margin, width / 2 - margin],
        ],
        dtype=np.float64,
    )
    box_near, box_valid = intersect_orthographic_box(ray_origin, view, safe_bounds)
    ground_depth, ground_valid = intersect_ground_parcel(ray_origin, view, length, width)

    box_point = ray_origin + box_near[..., None] * view
    top_hit = box_valid & np.isclose(box_point[..., 1], building_height, atol=1e-5)
    box_wins = box_valid & (~ground_valid | (box_near >= ground_depth))
    ground_wins = ground_valid & (~box_valid | (ground_depth > box_near))
    visible = box_wins | ground_wins
    if fit_surfaces == "walls-ground":
        visible &= ~top_hit
    depth = np.full((height_px, width_px), np.nan, dtype=np.float32)
    candidates = np.stack(
        [
            np.where(box_valid, box_near, -np.inf),
            np.where(ground_valid, ground_depth, -np.inf),
        ],
        axis=0,
    )
    depth[visible] = np.max(candidates, axis=0)[visible].astype(np.float32)
    return depth, visible


def map_triangle_points(points: np.ndarray, source: np.ndarray, target: np.ndarray) -> np.ndarray:
    matrix = np.array(
        [
            [source[0, 0], source[1, 0], source[2, 0]],
            [source[0, 1], source[1, 1], source[2, 1]],
            [1.0, 1.0, 1.0],
        ],
        dtype=np.float64,
    )
    determinant = float(np.linalg.det(matrix))
    if abs(determinant) < 1e-12:
        raise ValueError("Guideplate base anchors must form a non-degenerate triangle")
    inverse = np.linalg.inv(matrix)
    homogeneous = np.concatenate([points, np.ones((*points.shape[:-1], 1))], axis=-1)
    weights = homogeneous @ inverse.T
    return weights @ target


def intersect_orthographic_box(
    ray_origin: np.ndarray,
    view: np.ndarray,
    bounds: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    low = np.full(ray_origin.shape[:-1], -np.inf, dtype=np.float64)
    high = np.full(ray_origin.shape[:-1], np.inf, dtype=np.float64)
    valid = np.ones(ray_origin.shape[:-1], dtype=bool)
    for axis in range(3):
        component = float(view[axis])
        origin = ray_origin[..., axis]
        minimum, maximum = bounds[axis]
        if abs(component) < 1e-12:
            valid &= (origin >= minimum) & (origin <= maximum)
            continue
        first = (minimum - origin) / component
        second = (maximum - origin) / component
        low = np.maximum(low, np.minimum(first, second))
        high = np.minimum(high, np.maximum(first, second))
    valid &= low <= high
    return high, valid


def intersect_ground_parcel(
    ray_origin: np.ndarray,
    view: np.ndarray,
    length: float,
    width: float,
) -> tuple[np.ndarray, np.ndarray]:
    if abs(float(view[1])) < 1e-12:
        return np.zeros(ray_origin.shape[:-1], dtype=np.float64), np.zeros(ray_origin.shape[:-1], dtype=bool)
    depth = -ray_origin[..., 1] / view[1]
    point = ray_origin + depth[..., None] * view
    valid = (
        (point[..., 0] >= -length / 2)
        & (point[..., 0] <= length / 2)
        & (point[..., 2] >= -width / 2)
        & (point[..., 2] <= width / 2)
    )
    return depth, valid


def fit_linear_depth_distribution(
    raw_depth: np.ndarray,
    raw_mask: np.ndarray,
    guide_depth: np.ndarray,
    guide_mask: np.ndarray,
    raw_anchor_values: np.ndarray | None = None,
    expected_anchor_depths: np.ndarray | None = None,
    quantile_low: float = DEFAULT_QUANTILE_LOW,
    quantile_high: float = DEFAULT_QUANTILE_HIGH,
    quantile_count: int = DEFAULT_QUANTILE_COUNT,
) -> LinearDepthFit:
    raw_values = finite_masked_values(raw_depth, raw_mask)
    guide_values = finite_masked_values(guide_depth, guide_mask)
    if raw_values.size < 3 or guide_values.size < 3:
        raise ValueError("Depth distribution fitting needs at least three valid values in each distribution")

    anchor_covariance = 0.0
    direction = 1
    if raw_anchor_values is not None and expected_anchor_depths is not None:
        raw_anchors = np.asarray(raw_anchor_values, dtype=np.float64)
        expected_anchors = np.asarray(expected_anchor_depths, dtype=np.float64)
        finite = np.isfinite(raw_anchors) & np.isfinite(expected_anchors)
        if np.count_nonzero(finite) >= 2:
            raw_centered = raw_anchors[finite] - np.mean(raw_anchors[finite])
            expected_centered = expected_anchors[finite] - np.mean(expected_anchors[finite])
            anchor_covariance = float(np.dot(raw_centered, expected_centered))
            direction = 1 if anchor_covariance >= 0 else -1

    quantiles = np.linspace(quantile_low, quantile_high, quantile_count, dtype=np.float64)
    oriented_raw = direction * raw_values.astype(np.float64)
    raw_quantiles = np.quantile(oriented_raw, quantiles)
    guide_quantiles = np.quantile(guide_values.astype(np.float64), quantiles)
    design = np.stack([raw_quantiles, np.ones_like(raw_quantiles)], axis=1)
    oriented_slope, intercept = np.linalg.lstsq(design, guide_quantiles, rcond=None)[0]
    slope = float(oriented_slope * direction)
    intercept = float(intercept)
    predicted_quantiles = slope * np.quantile(raw_values.astype(np.float64), quantiles) + intercept
    # Negative mappings reverse ranks, so compare in ascending calibrated order.
    predicted_quantiles = np.sort(predicted_quantiles)
    residual = predicted_quantiles - guide_quantiles
    rmse = float(np.sqrt(np.mean(residual * residual)))
    total = float(np.sum((guide_quantiles - np.mean(guide_quantiles)) ** 2))
    r_squared = 1.0 - float(np.sum(residual * residual)) / max(total, 1e-12)
    calibrated_values = slope * raw_values.astype(np.float64) + intercept

    return LinearDepthFit(
        slope=slope,
        intercept=intercept,
        direction=direction,
        rmse=rmse,
        r_squared=r_squared,
        quantile_low=quantile_low,
        quantile_high=quantile_high,
        quantile_count=quantile_count,
        raw_range=(float(np.min(raw_values)), float(np.max(raw_values))),
        guide_range=(float(np.min(guide_values)), float(np.max(guide_values))),
        calibrated_range=(float(np.min(calibrated_values)), float(np.max(calibrated_values))),
        anchor_covariance=anchor_covariance,
    )


def finite_masked_values(values: np.ndarray, mask: np.ndarray) -> np.ndarray:
    valid = np.asarray(mask, dtype=bool) & np.isfinite(values)
    return np.asarray(values)[valid]


def sample_supported_values(
    values: np.ndarray,
    mask: np.ndarray,
    anchors_uv: dict[str, list[float]],
    radius: int = 4,
) -> dict[str, float]:
    height, width = values.shape
    samples: dict[str, float] = {}
    for key, uv in anchors_uv.items():
        center_x = int(np.clip(round(float(uv[0]) * (width - 1)), 0, width - 1))
        center_y = int(np.clip(round((1.0 - float(uv[1])) * (height - 1)), 0, height - 1))
        y0, y1 = max(0, center_y - radius), min(height, center_y + radius + 1)
        x0, x1 = max(0, center_x - radius), min(width, center_x + radius + 1)
        local_values = values[y0:y1, x0:x1]
        local_mask = np.asarray(mask[y0:y1, x0:x1], dtype=bool) & np.isfinite(local_values)
        samples[key] = float(np.median(local_values[local_mask])) if np.any(local_mask) else float("nan")
    return samples


def expected_base_anchor_depths(guide: dict[str, Any]) -> dict[str, float]:
    dimensions = guide["dimensions"]
    length = float(dimensions["length"])
    width = float(dimensions["width"])
    _, _, view = camera_basis(guide.get("camera", {}))
    points = {
        "left": np.array([-length / 2, 0.0, width / 2]),
        "near": np.array([length / 2, 0.0, width / 2]),
        "right": np.array([length / 2, 0.0, -width / 2]),
    }
    return {key: float(point @ view) for key, point in points.items()}


def encode_depth_preview(
    depth: np.ndarray,
    alpha: np.ndarray,
    minimum: float,
    maximum: float,
) -> Image.Image:
    scale = max(maximum - minimum, 1e-8)
    normalized = np.clip((depth - minimum) / scale, 0.0, 1.0)
    normalized = np.nan_to_num(normalized, nan=0.0)
    value = np.clip(normalized * 255.0, 0, 255).astype(np.uint8)
    encoded_alpha = np.clip(alpha * 255.0, 0, 255).astype(np.uint8)
    return Image.fromarray(np.dstack([value, value, value, encoded_alpha]), "RGBA")
