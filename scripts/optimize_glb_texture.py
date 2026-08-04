#!/usr/bin/env python3
"""Resize embedded GLB images and encode them as required EXT_texture_webp textures."""

from __future__ import annotations

import argparse
import json
import struct
from io import BytesIO
from pathlib import Path

from PIL import Image


GLB_MAGIC = 0x46546C67
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942


def parse_glb(path: Path) -> tuple[dict, bytes]:
    data = path.read_bytes()
    magic, version, declared_length = struct.unpack_from("<III", data, 0)
    if magic != GLB_MAGIC or version != 2 or declared_length != len(data):
        raise ValueError(f"{path} is not a valid glTF 2.0 binary")

    document = None
    binary = b""
    offset = 12
    while offset < len(data):
        chunk_length, chunk_type = struct.unpack_from("<II", data, offset)
        chunk = data[offset + 8 : offset + 8 + chunk_length]
        if chunk_type == JSON_CHUNK:
            document = json.loads(chunk.rstrip(b" \x00").decode("utf8"))
        elif chunk_type == BIN_CHUNK:
            binary = chunk
        offset += 8 + chunk_length

    if document is None:
        raise ValueError("GLB has no JSON chunk")
    return document, binary


def encode_webp(source: bytes, max_size: int, quality: int) -> tuple[bytes, tuple[int, int], tuple[int, int]]:
    with Image.open(BytesIO(source)) as image:
        original_size = image.size
        image = image.convert("RGB")
        image.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
        output = BytesIO()
        image.save(output, "WEBP", quality=quality, method=6)
        return output.getvalue(), original_size, image.size


def optimize_glb(input_path: Path, output_path: Path, max_size: int, quality: int) -> dict:
    document, original_binary = parse_glb(input_path)
    buffer_views = document.get("bufferViews", [])
    images = document.get("images", [])
    replacements: dict[int, bytes] = {}
    optimized_images = []

    for image_index, image in enumerate(images):
        view_index = image.get("bufferView")
        if view_index is None or image.get("mimeType") not in {"image/png", "image/jpeg"}:
            continue
        view = buffer_views[view_index]
        start = view.get("byteOffset", 0)
        end = start + view["byteLength"]
        encoded, original_size, optimized_size = encode_webp(original_binary[start:end], max_size, quality)
        replacements[view_index] = encoded
        image["mimeType"] = "image/webp"
        optimized_images.append({
            "imageIndex": image_index,
            "from": list(original_size),
            "to": list(optimized_size),
            "originalBytes": end - start,
            "optimizedBytes": len(encoded),
        })

    if not replacements:
        raise ValueError("GLB has no embedded PNG or JPEG textures to optimize")

    converted_image_indices = {
        index for index, image in enumerate(images) if image.get("mimeType") == "image/webp"
    }
    for texture in document.get("textures", []):
        source = texture.get("source")
        if source not in converted_image_indices:
            continue
        texture.setdefault("extensions", {})["EXT_texture_webp"] = {"source": source}
        texture.pop("source", None)

    for key in ("extensionsUsed", "extensionsRequired"):
        extensions = document.setdefault(key, [])
        if "EXT_texture_webp" not in extensions:
            extensions.append("EXT_texture_webp")

    rebuilt_binary = bytearray()
    for index, view in enumerate(buffer_views):
        while len(rebuilt_binary) % 4:
            rebuilt_binary.append(0)
        start = view.get("byteOffset", 0)
        source = replacements.get(index, original_binary[start : start + view["byteLength"]])
        view["byteOffset"] = len(rebuilt_binary)
        view["byteLength"] = len(source)
        rebuilt_binary.extend(source)

    while len(rebuilt_binary) % 4:
        rebuilt_binary.append(0)
    document["buffers"][0]["byteLength"] = len(rebuilt_binary)

    json_bytes = json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf8")
    json_bytes += b" " * ((-len(json_bytes)) % 4)
    total_length = 12 + 8 + len(json_bytes) + 8 + len(rebuilt_binary)
    output = bytearray(struct.pack("<III", GLB_MAGIC, 2, total_length))
    output.extend(struct.pack("<II", len(json_bytes), JSON_CHUNK))
    output.extend(json_bytes)
    output.extend(struct.pack("<II", len(rebuilt_binary), BIN_CHUNK))
    output.extend(rebuilt_binary)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(output)
    return {
        "input": str(input_path),
        "output": str(output_path),
        "originalBytes": input_path.stat().st_size,
        "optimizedBytes": output_path.stat().st_size,
        "maxTextureSize": max_size,
        "webpQuality": quality,
        "images": optimized_images,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--max-size", type=int, default=1024)
    parser.add_argument("--quality", type=int, default=80)
    args = parser.parse_args()
    result = optimize_glb(args.input, args.out, args.max_size, args.quality)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
