import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const sourcePath = process.argv[2];
const outDir = process.argv[3];

if (!sourcePath || !outDir) {
  console.error("Usage: node scripts/derive_isometric_asset_maps.mjs <source.png> <out-dir>");
  process.exit(1);
}

const source = readPng(sourcePath);
fs.mkdirSync(outDir, { recursive: true });

const key = sampleBorderKey(source);
const matte = createMatte(source, key);
const rgb = applyMatte(source, matte);
const pixelRgb = pixelateImage(rgb, 320);
const mask = createMask(source.width, source.height, matte);
const depth = createDepth(source, matte);
const normal = createNormal(depth, matte);
const atlas = createAtlas([
  { label: "RGB", image: rgb },
  { label: "DEPTH", image: depth },
  { label: "NORMAL", image: normal },
  { label: "MASK", image: mask }
]);
const pixelAtlas = createAtlas([
  { label: "PIXEL RGB", image: pixelRgb },
  { label: "DEPTH", image: depth },
  { label: "NORMAL", image: normal },
  { label: "MASK", image: mask }
]);

writePng(path.join(outDir, "rgb.png"), rgb);
writePng(path.join(outDir, "rgb-pixel.png"), pixelRgb);
writePng(path.join(outDir, "depth.png"), depth);
writePng(path.join(outDir, "normal.png"), normal);
writePng(path.join(outDir, "mask.png"), mask);
writePng(path.join(outDir, "atlas-rgb-depth-normal-mask.png"), atlas);
writePng(path.join(outDir, "atlas-pixel-depth-normal-mask.png"), pixelAtlas);
fs.writeFileSync(
  path.join(outDir, "asset.json"),
  `${JSON.stringify(
    {
      source: path.basename(sourcePath),
      width: source.width,
      height: source.height,
      keyColor: `#${hex(key.r)}${hex(key.g)}${hex(key.b)}`,
      maps: {
        rgb: "rgb.png",
        pixelRgb: "rgb-pixel.png",
        depth: "depth.png",
        normal: "normal.png",
        mask: "mask.png",
        atlas: "atlas-rgb-depth-normal-mask.png",
        pixelAtlas: "atlas-pixel-depth-normal-mask.png"
      },
      pixelGrid: 320,
      depthNote:
        "Approximate local depth derived from alpha coverage, vertical isometric height, luminance, and edge lift. Replace with model depth when available."
    },
    null,
    2
  )}\n`
);

function readPng(filePath) {
  const bytes = fs.readFileSync(filePath);
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`${filePath} is not a PNG`);
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];

  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error("Interlaced PNGs are not supported");
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  if (bitDepth !== 8 || ![2, 6].includes(colorType)) {
    throw new Error(`Unsupported PNG format: bitDepth=${bitDepth}, colorType=${colorType}`);
  }

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const rgba = Buffer.alloc(width * height * 4);
  const previous = Buffer.alloc(stride);
  const current = Buffer.alloc(stride);
  let rawOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset];
    rawOffset += 1;
    raw.copy(current, 0, rawOffset, rawOffset + stride);
    rawOffset += stride;
    unfilter(current, previous, filter, channels);

    for (let x = 0; x < width; x += 1) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      rgba[dst] = current[src];
      rgba[dst + 1] = current[src + 1];
      rgba[dst + 2] = current[src + 2];
      rgba[dst + 3] = channels === 4 ? current[src + 3] : 255;
    }
    current.copy(previous);
  }

  return { width, height, data: rgba };
}

function unfilter(row, previous, filter, bpp) {
  for (let i = 0; i < row.length; i += 1) {
    const left = i >= bpp ? row[i - bpp] : 0;
    const up = previous[i] ?? 0;
    const upLeft = i >= bpp ? previous[i - bpp] : 0;
    if (filter === 1) row[i] = (row[i] + left) & 255;
    else if (filter === 2) row[i] = (row[i] + up) & 255;
    else if (filter === 3) row[i] = (row[i] + Math.floor((left + up) / 2)) & 255;
    else if (filter === 4) row[i] = (row[i] + paeth(left, up, upLeft)) & 255;
    else if (filter !== 0) throw new Error(`Unsupported PNG filter: ${filter}`);
  }
}

function writePng(filePath, image) {
  const { width, height, data } = image;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    data.copy(raw, row + 1, y * width * 4, (y + 1) * width * 4);
  }

  const chunks = [
    chunk("IHDR", ihdr(width, height)),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ];
  fs.writeFileSync(filePath, Buffer.concat([PNG_SIGNATURE, ...chunks]));
}

function ihdr(width, height) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8;
  data[9] = 6;
  return data;
}

function chunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crcBytes = Buffer.concat([name, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcBytes));
  return Buffer.concat([length, name, data, crc]);
}

function sampleBorderKey(image) {
  const samples = [];
  const step = Math.max(1, Math.floor(Math.min(image.width, image.height) / 32));
  for (let x = 0; x < image.width; x += step) {
    samples.push(pixel(image, x, 0), pixel(image, x, image.height - 1));
  }
  for (let y = 0; y < image.height; y += step) {
    samples.push(pixel(image, 0, y), pixel(image, image.width - 1, y));
  }
  samples.sort((a, b) => b.r + b.b - b.g - (a.r + a.b - a.g));
  return samples[0];
}

function createMatte(image, key) {
  const matte = new Float32Array(image.width * image.height);
  for (let i = 0; i < matte.length; i += 1) {
    const idx = i * 4;
    const dr = image.data[idx] - key.r;
    const dg = image.data[idx + 1] - key.g;
    const db = image.data[idx + 2] - key.b;
    const distance = Math.sqrt(dr * dr + dg * dg + db * db);
    matte[i] = smoothstep(24, 138, distance);
  }

  return softenMatte(contractMatte(matte, image.width, image.height), image.width, image.height);
}

function applyMatte(image, matte) {
  const data = Buffer.from(image.data);
  const key = sampleBorderKey(image);
  for (let i = 0; i < matte.length; i += 1) {
    const idx = i * 4;
    const alphaFloat = clamp01(matte[i]);
    const alpha = Math.round(alphaFloat * 255);
    if (alpha < 12) {
      data[idx] = 0;
      data[idx + 1] = 0;
      data[idx + 2] = 0;
      data[idx + 3] = 0;
      continue;
    }
    if (alphaFloat < 0.98) {
      data[idx] = unpremixKey(data[idx], key.r, alphaFloat);
      data[idx + 1] = unpremixKey(data[idx + 1], key.g, alphaFloat);
      data[idx + 2] = unpremixKey(data[idx + 2], key.b, alphaFloat);
    }
    if (data[idx] > 205 && data[idx + 2] > 205 && data[idx + 1] < 120) {
      const replacement = nearestOpaqueAverage(image, matte, i);
      data[idx] = replacement.r;
      data[idx + 1] = replacement.g;
      data[idx + 2] = replacement.b;
    }
    data[idx + 3] = alpha;
  }
  return { width: image.width, height: image.height, data };
}

function unpremixKey(channel, keyChannel, alpha) {
  return Math.round(Math.max(0, Math.min(255, (channel - keyChannel * (1 - alpha)) / alpha)));
}

function nearestOpaqueAverage(image, matte, pixelIndex) {
  const x = pixelIndex % image.width;
  const y = Math.floor(pixelIndex / image.width);
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let oy = -3; oy <= 3; oy += 1) {
    for (let ox = -3; ox <= 3; ox += 1) {
      const sx = x + ox;
      const sy = y + oy;
      if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) continue;
      const si = sy * image.width + sx;
      if (matte[si] < 0.98) continue;
      const idx = si * 4;
      r += image.data[idx];
      g += image.data[idx + 1];
      b += image.data[idx + 2];
      count += 1;
    }
  }
  if (!count) return { r: 120, g: 80, b: 150 };
  return { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) };
}

function createMask(width, height, matte) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < matte.length; i += 1) {
    const value = Math.round(clamp01(matte[i]) * 255);
    data[i * 4] = value;
    data[i * 4 + 1] = value;
    data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

function pixelateImage(image, pixelGrid) {
  const { width, height } = image;
  const scale = pixelGrid / Math.max(width, height);
  const lowWidth = Math.max(1, Math.round(width * scale));
  const lowHeight = Math.max(1, Math.round(height * scale));
  const low = Buffer.alloc(lowWidth * lowHeight * 4);
  const data = Buffer.alloc(width * height * 4);

  for (let y = 0; y < lowHeight; y += 1) {
    for (let x = 0; x < lowWidth; x += 1) {
      const sx0 = Math.floor((x / lowWidth) * width);
      const sy0 = Math.floor((y / lowHeight) * height);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) / lowWidth) * width));
      const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) / lowHeight) * height));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let weight = 0;
      for (let sy = sy0; sy < sy1; sy += 1) {
        for (let sx = sx0; sx < sx1; sx += 1) {
          const si = (Math.min(height - 1, sy) * width + Math.min(width - 1, sx)) * 4;
          const alpha = image.data[si + 3] / 255;
          r += image.data[si] * alpha;
          g += image.data[si + 1] * alpha;
          b += image.data[si + 2] * alpha;
          a += image.data[si + 3];
          weight += alpha;
        }
      }
      const count = (sy1 - sy0) * (sx1 - sx0);
      const di = (y * lowWidth + x) * 4;
      if (weight > 0) {
        low[di] = Math.round(r / weight);
        low[di + 1] = Math.round(g / weight);
        low[di + 2] = Math.round(b / weight);
        low[di + 3] = Math.round(a / count);
      }
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(lowWidth - 1, Math.floor((x / width) * lowWidth));
      const sy = Math.min(lowHeight - 1, Math.floor((y / height) * lowHeight));
      const src = (sy * lowWidth + sx) * 4;
      const dst = (y * width + x) * 4;
      data[dst] = low[src];
      data[dst + 1] = low[src + 1];
      data[dst + 2] = low[src + 2];
      data[dst + 3] = low[src + 3];
    }
  }

  return { width, height, data };
}

function createDepth(image, matte) {
  const { width, height } = image;
  const data = Buffer.alloc(width * height * 4);
  const bounds = alphaBounds(width, height, matte);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const alpha = clamp01(matte[i]);
      let value = 0;
      if (alpha > 0.02) {
        const p = pixel(image, x, y);
        const luma = (0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b) / 255;
        const vertical = bounds.height > 0 ? 1 - (y - bounds.top) / bounds.height : 0.5;
        const horizontal = bounds.width > 0 ? Math.abs((x - bounds.left) / bounds.width - 0.5) : 0;
        const edge = 1 - Math.min(1, distanceToTransparent(matte, width, height, x, y, 10) / 10);
        value = clamp01(0.18 + vertical * 0.54 + luma * 0.18 + horizontal * 0.08 + edge * 0.08);
      }
      const shade = Math.round(value * alpha * 255);
      const idx = i * 4;
      data[idx] = shade;
      data[idx + 1] = shade;
      data[idx + 2] = shade;
      data[idx + 3] = 255;
    }
  }

  return { width, height, data };
}

function createNormal(depth, matte) {
  const { width, height } = depth;
  const data = Buffer.alloc(width * height * 4);
  const sample = (x, y) => {
    const sx = Math.max(0, Math.min(width - 1, x));
    const sy = Math.max(0, Math.min(height - 1, y));
    return depth.data[(sy * width + sx) * 4] / 255;
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const dx = (sample(x + 1, y) - sample(x - 1, y)) * 8;
      const dy = (sample(x, y + 1) - sample(x, y - 1)) * 8;
      const n = normalize(-dx, dy, 1);
      const idx = i * 4;
      data[idx] = Math.round((n.x * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.round((n.y * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.round((n.z * 0.5 + 0.5) * 255);
      data[idx + 3] = matte[i] > 0.02 ? 255 : 0;
    }
  }

  return { width, height, data };
}

function createAtlas(entries) {
  const width = entries[0].image.width;
  const height = entries[0].image.height;
  const atlas = {
    width: width * 2,
    height: height * 2,
    data: Buffer.alloc(width * height * 16, 0)
  };

  entries.forEach((entry, index) => {
    const ox = (index % 2) * width;
    const oy = Math.floor(index / 2) * height;
    blit(atlas, entry.image, ox, oy);
  });
  return atlas;
}

function blit(target, source, ox, oy) {
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const src = (y * source.width + x) * 4;
      const dst = ((oy + y) * target.width + ox + x) * 4;
      target.data[dst] = source.data[src];
      target.data[dst + 1] = source.data[src + 1];
      target.data[dst + 2] = source.data[src + 2];
      target.data[dst + 3] = source.data[src + 3];
    }
  }
}

function alphaBounds(width, height, matte) {
  let left = width;
  let right = 0;
  let top = height;
  let bottom = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (matte[y * width + x] <= 0.08) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return { left, right, top, bottom, width: right - left || 1, height: bottom - top || 1 };
}

function contractMatte(matte, width, height) {
  const output = new Float32Array(matte);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      if (matte[i] < 0.98) continue;
      const minNeighbor = Math.min(
        matte[i - 1],
        matte[i + 1],
        matte[i - width],
        matte[i + width],
        matte[i - width - 1],
        matte[i - width + 1],
        matte[i + width - 1],
        matte[i + width + 1]
      );
      output[i] = minNeighbor < 0.2 ? 0.82 : matte[i];
    }
  }
  return output;
}

function softenMatte(matte, width, height) {
  const output = new Float32Array(matte.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          const sx = x + ox;
          const sy = y + oy;
          if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
          sum += matte[sy * width + sx];
          count += 1;
        }
      }
      output[y * width + x] = sum / count;
    }
  }
  return output;
}

function distanceToTransparent(matte, width, height, x, y, radius) {
  for (let d = 1; d <= radius; d += 1) {
    for (let oy = -d; oy <= d; oy += 1) {
      for (let ox = -d; ox <= d; ox += 1) {
        if (Math.abs(ox) !== d && Math.abs(oy) !== d) continue;
        const sx = x + ox;
        const sy = y + oy;
        if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
        if (matte[sy * width + sx] < 0.05) return d;
      }
    }
  }
  return radius;
}

function pixel(image, x, y) {
  const i = (y * image.width + x) * 4;
  return {
    r: image.data[i],
    g: image.data[i + 1],
    b: image.data[i + 2],
    a: image.data[i + 3]
  };
}

function normalize(x, y, z) {
  const length = Math.hypot(x, y, z) || 1;
  return { x: x / length, y: y / length, z: z / length };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function smoothstep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function hex(value) {
  return value.toString(16).padStart(2, "0");
}

var crcTable = null;

function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256).map((_, n) => {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      return c >>> 0;
    });
  }
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
