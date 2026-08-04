from __future__ import annotations

import unittest

import numpy as np

from depth_distribution_fit import (
    expected_base_anchor_depths,
    fit_linear_depth_distribution,
    render_guide_view_depth,
)


GUIDE = {
    "dimensions": {"length": 4.0, "width": 4.0, "height": 4.0},
    "safeMargin": 0.32,
    "camera": {"yaw": 45, "elevation": 55, "projection": "orthographic"},
    "baseAnchorsUv": {
        "left": [0.22666666666666663, 0.35632478632478637],
        "near": [0.5, 0.2301709401709402],
        "right": [0.7733333333333334, 0.35632478632478637],
    },
}


class DepthDistributionFitTests(unittest.TestCase):
    def test_guide_depth_contains_finite_visible_surfaces(self) -> None:
        depth, mask = render_guide_view_depth((128, 128), GUIDE)
        self.assertGreater(np.count_nonzero(mask), 100)
        self.assertTrue(np.all(np.isfinite(depth[mask])))
        self.assertGreater(float(np.max(depth[mask])), float(np.min(depth[mask])))

    def test_walls_ground_fit_excludes_visible_top_surface(self) -> None:
        all_depth, all_mask = render_guide_view_depth((128, 128), GUIDE)
        structural_depth, structural_mask = render_guide_view_depth((128, 128), GUIDE, fit_surfaces="walls-ground")
        self.assertGreater(np.count_nonzero(structural_mask), 100)
        self.assertLess(np.count_nonzero(structural_mask), np.count_nonzero(all_mask))
        self.assertTrue(np.all(np.isfinite(structural_depth[structural_mask])))
        self.assertTrue(np.all(structural_mask <= all_mask))

    def test_quantile_fit_recovers_positive_linear_mapping(self) -> None:
        guide_depth, guide_mask = render_guide_view_depth((96, 96), GUIDE)
        raw_depth = (guide_depth - 1.75) / 2.5
        fit = fit_linear_depth_distribution(raw_depth, guide_mask, guide_depth, guide_mask)
        self.assertAlmostEqual(fit.slope, 2.5, places=5)
        self.assertAlmostEqual(fit.intercept, 1.75, places=5)
        self.assertLess(fit.rmse, 1e-5)

    def test_anchor_direction_allows_negative_linear_mapping(self) -> None:
        guide_depth, guide_mask = render_guide_view_depth((96, 96), GUIDE)
        raw_depth = (3.0 - guide_depth) / 1.8
        expected = expected_base_anchor_depths(GUIDE)
        expected_values = np.array([expected[key] for key in ("left", "near", "right")])
        raw_anchor_values = (3.0 - expected_values) / 1.8
        fit = fit_linear_depth_distribution(
            raw_depth,
            guide_mask,
            guide_depth,
            guide_mask,
            raw_anchor_values=raw_anchor_values,
            expected_anchor_depths=expected_values,
        )
        self.assertEqual(fit.direction, -1)
        self.assertAlmostEqual(fit.slope, -1.8, places=5)
        self.assertAlmostEqual(fit.intercept, 3.0, places=5)
        self.assertLess(fit.rmse, 1e-5)


if __name__ == "__main__":
    unittest.main()
