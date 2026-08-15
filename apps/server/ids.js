import { createHash, randomBytes, randomUUID } from "node:crypto";

const VOLATILE_VOXEL_DESIGN_FIELDS = new Set(["status", "buildingId", "createdAt", "updatedAt"]);

export function createId(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function createSecret(prefix) {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

export function hashSecret(secret) {
  return createHash("sha256").update(secret).digest("hex");
}

export function hashRequest(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value, context = null) {
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry, context)).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value)
      .filter((key) => context !== "voxel_design" || !VOLATILE_VOXEL_DESIGN_FIELDS.has(key))
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key], key)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
