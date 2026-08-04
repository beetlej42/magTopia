import assert from "node:assert/strict";
import test from "node:test";
import { mergeAssetRegistry } from "../src/city/assets.js";

test("runtime assets merge with built-ins and retain dynamic rendering maps", () => {
  const runtime = {
    id: "asset_dynamic_001",
    archetype: "moon_residence",
    footprint: "1x1",
    source: "qwen-image",
    tags: ["moonflower"],
    manifest: {
      maps: {
        rgb: "/generated/agent-assets/job-1/rgb.png",
        depth: "/generated/agent-assets/job-1/depth.png",
        normal: "/generated/agent-assets/job-1/normal.png",
        mask: "/generated/agent-assets/job-1/mask.png",
        emissive: "/generated/agent-assets/job-1/emissive.png"
      },
      baseAnchorsUv: {
        left: [0.22, 0.35],
        near: [0.5, 0.23],
        right: [0.78, 0.35]
      }
    }
  };

  const registry = mergeAssetRegistry([runtime]);
  const dynamic = registry.find((asset) => asset.assetId === runtime.id);

  assert.ok(registry.some((asset) => asset.assetId === "starter-cottage-001"));
  assert.equal(dynamic.archetype, "moon_residence");
  assert.equal(dynamic.source, "qwen-image");
  assert.equal(dynamic.maps.emissive, runtime.manifest.maps.emissive);
  assert.deepEqual(dynamic.baseAnchorsUv, runtime.manifest.baseAnchorsUv);
});

test("runtime registry ignores incomplete manifests", () => {
  const registry = mergeAssetRegistry([{ id: "broken", manifest: { maps: { rgb: "/rgb.png" } } }]);
  assert.equal(registry.some((asset) => asset.assetId === "broken"), false);
});
