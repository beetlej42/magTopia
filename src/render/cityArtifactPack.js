export const CITY_ARTIFACT_PACK_MAGIC = "MTCP";
export const CITY_ARTIFACT_PACK_VERSION = 1;
export const CITY_ARTIFACT_PACK_KIND = "baked-city-artifact-pack";

const HEADER_BYTES = 16;

/**
 * A city pack stores the already-decoded MTBA building artifacts in one
 * deterministic container. HTTP Brotli compression is applied to the whole
 * container by the server, so the client pays one request and one transport
 * decompression instead of one request per building.
 *
 * Header: magic[4], version u16, flags u16, metadataBytes u32, payloadBytes u32
 * Metadata: JSON with city identity and payload entry offsets
 * Payload: concatenated raw MTBA building artifacts
 */
export function encodeCityArtifactPack({ cityId, cityVersion, manifestSha256, artifacts = [] } = {}) {
  if (!cityId || !Number.isInteger(Number(cityVersion))) throw new Error("City artifact pack requires city identity");
  const normalized = artifacts
    .filter((entry) => entry?.buildingId && entry.bytes !== undefined)
    .map((entry) => ({
      buildingId: String(entry.buildingId),
      designRevision: Number(entry.designRevision),
      sha256: String(entry.sha256 ?? ""),
      bytes: toUint8Array(entry.bytes)
    }))
    .sort((left, right) => left.buildingId.localeCompare(right.buildingId));
  const entries = [];
  let payloadBytes = 0;
  for (const artifact of normalized) {
    entries.push({
      buildingId: artifact.buildingId,
      designRevision: artifact.designRevision,
      sha256: artifact.sha256,
      offset: payloadBytes,
      byteLength: artifact.bytes.byteLength
    });
    payloadBytes += artifact.bytes.byteLength;
  }
  const metadataBytes = new TextEncoder().encode(JSON.stringify({
    kind: CITY_ARTIFACT_PACK_KIND,
    packVersion: CITY_ARTIFACT_PACK_VERSION,
    cityId: String(cityId),
    cityVersion: Number(cityVersion),
    manifestSha256: manifestSha256 ?? null,
    entries
  }));
  const output = new Uint8Array(HEADER_BYTES + metadataBytes.byteLength + payloadBytes);
  const view = new DataView(output.buffer);
  output.set(new TextEncoder().encode(CITY_ARTIFACT_PACK_MAGIC), 0);
  view.setUint16(4, CITY_ARTIFACT_PACK_VERSION, true);
  view.setUint16(6, 0, true);
  view.setUint32(8, metadataBytes.byteLength, true);
  view.setUint32(12, payloadBytes, true);
  output.set(metadataBytes, HEADER_BYTES);
  let offset = HEADER_BYTES + metadataBytes.byteLength;
  for (const artifact of normalized) {
    output.set(artifact.bytes, offset);
    offset += artifact.bytes.byteLength;
  }
  return output;
}

export function decodeCityArtifactPack(bytes, expected = {}) {
  const input = toUint8Array(bytes);
  if (input.byteLength < HEADER_BYTES) throw new Error("City artifact pack is truncated");
  const magic = new TextDecoder().decode(input.slice(0, 4));
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const version = view.getUint16(4, true);
  const metadataLength = view.getUint32(8, true);
  const payloadLength = view.getUint32(12, true);
  if (magic !== CITY_ARTIFACT_PACK_MAGIC) throw new Error("City artifact pack magic mismatch");
  if (version !== CITY_ARTIFACT_PACK_VERSION) throw new Error(`Unsupported city artifact pack version: ${version}`);
  const payloadStart = HEADER_BYTES + metadataLength;
  if (payloadStart + payloadLength !== input.byteLength) throw new Error("City artifact pack length mismatch");
  let metadata;
  try {
    metadata = JSON.parse(new TextDecoder().decode(input.slice(HEADER_BYTES, payloadStart)));
  } catch {
    throw new Error("City artifact pack metadata is invalid");
  }
  if (metadata.kind !== CITY_ARTIFACT_PACK_KIND || Number(metadata.packVersion) !== CITY_ARTIFACT_PACK_VERSION) {
    throw new Error("City artifact pack contract mismatch");
  }
  if (expected.cityId && metadata.cityId !== expected.cityId) throw new Error("City artifact pack city mismatch");
  if (expected.cityVersion !== undefined && Number(metadata.cityVersion) !== Number(expected.cityVersion)) throw new Error("City artifact pack version mismatch");
  if (expected.manifestSha256 && metadata.manifestSha256 !== expected.manifestSha256) throw new Error("City artifact pack manifest mismatch");
  const entries = Array.isArray(metadata.entries) ? metadata.entries : [];
  const ranges = entries.map((entry) => {
    const offset = Number(entry.offset);
    const byteLength = Number(entry.byteLength);
    if (!entry.buildingId || !Number.isInteger(offset) || !Number.isInteger(byteLength) || offset < 0 || byteLength < 0 || offset + byteLength > payloadLength) {
      throw new Error("City artifact pack entry is invalid");
    }
    return { entry, offset, byteLength };
  }).sort((left, right) => left.offset - right.offset);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index - 1].offset + ranges[index - 1].byteLength > ranges[index].offset) throw new Error("City artifact pack entries overlap");
  }
  return {
    ...metadata,
    entries: ranges.map(({ entry, offset, byteLength }) => ({
      ...entry,
      bytes: input.slice(payloadStart + offset, payloadStart + offset + byteLength)
    }))
  };
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return Uint8Array.from(value ?? []);
}
