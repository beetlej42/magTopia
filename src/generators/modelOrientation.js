import * as THREE from "three";

export const MODEL_ORIENTATION_CANDIDATES = Object.freeze([0, 90, 180, 270]);

const orientationCache = new Map();
const orientationPreviewCache = new Map();
const SCORE_SIZE = 64;
const CONFIDENCE_THRESHOLD = 0.04;

export function resolveAutomaticModelOrientation(asset, model) {
  const key = `${asset.assetId}:${asset.model?.glb}:${asset.maps?.rgb}`;
  if (!orientationCache.has(key)) {
    orientationCache.set(key, detectModelOrientation(asset, model));
  }
  return orientationCache.get(key);
}

export function getModelOrientationPreviewUrls(assetId) {
  return orientationPreviewCache.get(assetId) ?? null;
}

export async function detectModelOrientation(asset, model) {
  if (!asset?.maps?.rgb) throw new Error(`${asset?.assetId ?? "asset"} has no RGB orientation reference`);
  const reference = await loadImagePixels(asset.maps.rgb);
  const scores = [];
  const previews = {};
  const renderer = createOrientationRenderer(256);
  try {
    for (const rotationY of MODEL_ORIENTATION_CANDIDATES) {
      const candidate = renderModelCandidate(renderer, model, asset.guideplate?.camera, rotationY);
      previews[rotationY] = candidate;
      scores.push({ rotationY, ...scoreOrientationCandidate(reference, candidate) });
    }
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
  }
  const previewUrls = Object.fromEntries(
    Object.entries(previews).map(([rotationY, preview]) => [rotationY, imagePixelsToDataUrl(preview)])
  );
  orientationPreviewCache.set(asset.assetId, previewUrls);

  const ranking = rankOrientationScores(scores);
  return {
    method: "fixed-camera-rgb-edge-four-way-v1",
    reference: asset.maps.rgb,
    candidates: [...MODEL_ORIENTATION_CANDIDATES],
    rotationY: ranking.best.rotationY,
    score: ranking.best.score,
    runnerUpRotationY: ranking.runnerUp.rotationY,
    runnerUpScore: ranking.runnerUp.score,
    confidence: ranking.confidence,
    requiresReview: ranking.confidence < CONFIDENCE_THRESHOLD,
    scores: scores.map(({ rotationY, score, colorError, edgeError, maskError }) => ({
      rotationY,
      score,
      colorError,
      edgeError,
      maskError
    })),
  };
}

export function scoreOrientationCandidate(reference, candidate, size = SCORE_SIZE) {
  const referenceGrid = normalizeImageToForeground(reference, size);
  const candidateGrid = normalizeImageToForeground(candidate, size);
  const referenceFeatures = standardizeChannels(referenceGrid, size);
  const candidateFeatures = standardizeChannels(candidateGrid, size);
  let colorError = 0;
  let maskError = 0;
  let comparedWeight = 0;
  let maskWeight = 0;

  for (let index = 0; index < size * size; index += 1) {
    const spatialWeight = facadeWeight(Math.floor(index / size), size);
    const refAlpha = referenceGrid.alpha[index];
    const candidateAlpha = candidateGrid.alpha[index];
    maskError += Math.abs(refAlpha - candidateAlpha) * spatialWeight;
    maskWeight += spatialWeight;
    if (Math.min(refAlpha, candidateAlpha) < 0.18) continue;
    const channelOffset = index * 3;
    for (let channel = 0; channel < 3; channel += 1) {
      const difference = referenceFeatures[channelOffset + channel] - candidateFeatures[channelOffset + channel];
      colorError += difference * difference * spatialWeight;
    }
    comparedWeight += spatialWeight * 3;
  }

  colorError /= Math.max(comparedWeight, 1);
  maskError /= Math.max(maskWeight, 1);
  const edgeError = compareEdges(referenceGrid, candidateGrid, size);
  return {
    score: colorError * 0.62 + edgeError * 0.3 + maskError * 0.08,
    colorError,
    edgeError,
    maskError
  };
}

export function rankOrientationScores(scores) {
  if (!Array.isArray(scores) || scores.length < 2) throw new Error("At least two orientation scores are required");
  const ranked = [...scores].sort((left, right) => left.score - right.score || left.rotationY - right.rotationY);
  const best = ranked[0];
  const runnerUp = ranked[1];
  const confidence = Math.max(0, (runnerUp.score - best.score) / Math.max(runnerUp.score, 1e-9));
  return { best, runnerUp, confidence, ranked };
}

function createOrientationRenderer(size) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, premultipliedAlpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  return renderer;
}

function renderModelCandidate(renderer, sourceModel, cameraContract = {}, rotationY = 0) {
  const size = renderer.domElement.width;
  const scene = new THREE.Scene();
  const model = sourceModel.clone(true);
  model.rotation.y = THREE.MathUtils.degToRad(rotationY);
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const dimensions = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const scale = 2.7 / Math.max(dimensions.x, dimensions.y, dimensions.z, 1e-6);
  model.position.sub(center);
  model.scale.multiplyScalar(scale);
  model.updateMatrixWorld(true);
  scene.add(model);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xc8d7c5, 2.1));
  const key = new THREE.DirectionalLight(0xfff4d6, 2.4);
  key.position.set(4, 8, 5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xd9c6ff, 1.15);
  fill.position.set(-5, 3, -4);
  scene.add(fill);

  const yaw = THREE.MathUtils.degToRad(Number(cameraContract.yaw ?? 45));
  const elevation = THREE.MathUtils.degToRad(Number(cameraContract.elevation ?? 55));
  const direction = new THREE.Vector3(
    Math.cos(elevation) * Math.sin(yaw),
    Math.sin(elevation),
    Math.cos(elevation) * Math.cos(yaw)
  );
  const camera = new THREE.OrthographicCamera(-1.85, 1.85, 1.85, -1.85, 0.1, 30);
  camera.position.copy(direction.multiplyScalar(8));
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  renderer.render(scene, camera);
  const context = renderer.getContext();
  const raw = new Uint8Array(size * size * 4);
  context.readPixels(0, 0, size, size, context.RGBA, context.UNSIGNED_BYTE, raw);
  const data = flipRows(raw, size, size);
  return { data, width: size, height: size };
}

async function loadImagePixels(path) {
  const image = new Image();
  image.decoding = "async";
  image.src = path;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function normalizeImageToForeground(image, size) {
  const bounds = findAlphaBounds(image);
  const rgb = new Float32Array(size * size * 3);
  const alpha = new Float32Array(size * size);
  const sourceAspect = bounds.width / Math.max(bounds.height, 1);
  const fitWidth = sourceAspect >= 1 ? size : size * sourceAspect;
  const fitHeight = sourceAspect >= 1 ? size / sourceAspect : size;
  const offsetX = (size - fitWidth) / 2;
  const offsetY = (size - fitHeight) / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const targetIndex = y * size + x;
      const u = (x + 0.5 - offsetX) / fitWidth;
      const v = (y + 0.5 - offsetY) / fitHeight;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      const sourceX = bounds.minX + u * Math.max(bounds.width - 1, 0);
      const sourceY = bounds.minY + v * Math.max(bounds.height - 1, 0);
      const sample = sampleRgba(image, sourceX, sourceY);
      alpha[targetIndex] = sample[3] / 255;
      rgb[targetIndex * 3] = sample[0] / 255;
      rgb[targetIndex * 3 + 1] = sample[1] / 255;
      rgb[targetIndex * 3 + 2] = sample[2] / 255;
    }
  }
  return { rgb, alpha };
}

function findAlphaBounds(image) {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] < 24) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return { minX: 0, minY: 0, width: image.width, height: image.height };
  return { minX, minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function sampleRgba(image, x, y) {
  const x0 = Math.max(0, Math.min(image.width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(image.height - 1, Math.floor(y)));
  const x1 = Math.min(image.width - 1, x0 + 1);
  const y1 = Math.min(image.height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const result = [0, 0, 0, 0];
  for (let channel = 0; channel < 4; channel += 1) {
    const top = image.data[(y0 * image.width + x0) * 4 + channel] * (1 - tx)
      + image.data[(y0 * image.width + x1) * 4 + channel] * tx;
    const bottom = image.data[(y1 * image.width + x0) * 4 + channel] * (1 - tx)
      + image.data[(y1 * image.width + x1) * 4 + channel] * tx;
    result[channel] = top * (1 - ty) + bottom * ty;
  }
  return result;
}

function standardizeChannels(grid, size) {
  const means = [0, 0, 0];
  const variances = [0, 0, 0];
  let weight = 0;
  for (let index = 0; index < grid.alpha.length; index += 1) {
    const alpha = grid.alpha[index] * facadeWeight(Math.floor(index / size), size);
    if (alpha < 0.18) continue;
    weight += alpha;
    for (let channel = 0; channel < 3; channel += 1) means[channel] += grid.rgb[index * 3 + channel] * alpha;
  }
  for (let channel = 0; channel < 3; channel += 1) means[channel] /= Math.max(weight, 1e-9);
  for (let index = 0; index < grid.alpha.length; index += 1) {
    const alpha = grid.alpha[index] * facadeWeight(Math.floor(index / size), size);
    if (alpha < 0.18) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      const difference = grid.rgb[index * 3 + channel] - means[channel];
      variances[channel] += difference * difference * alpha;
    }
  }
  const deviations = variances.map((variance) => Math.sqrt(variance / Math.max(weight, 1e-9) + 0.0025));
  const output = new Float32Array(grid.rgb.length);
  for (let index = 0; index < grid.alpha.length; index += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      output[index * 3 + channel] = (grid.rgb[index * 3 + channel] - means[channel]) / deviations[channel];
    }
  }
  return output;
}

function compareEdges(reference, candidate, size) {
  const referenceLuma = luminance(reference);
  const candidateLuma = luminance(candidate);
  let error = 0;
  let compared = 0;
  for (let y = 1; y < size - 1; y += 1) {
    for (let x = 1; x < size - 1; x += 1) {
      const index = y * size + x;
      if (Math.min(reference.alpha[index], candidate.alpha[index]) < 0.18) continue;
      const spatialWeight = facadeWeight(y, size);
      const referenceX = referenceLuma[index + 1] - referenceLuma[index - 1];
      const referenceY = referenceLuma[index + size] - referenceLuma[index - size];
      const candidateX = candidateLuma[index + 1] - candidateLuma[index - 1];
      const candidateY = candidateLuma[index + size] - candidateLuma[index - size];
      const differenceX = referenceX - candidateX;
      const differenceY = referenceY - candidateY;
      error += (differenceX * differenceX + differenceY * differenceY) * spatialWeight;
      compared += 2 * spatialWeight;
    }
  }
  return error / Math.max(compared, 1);
}

function facadeWeight(y, size) {
  const normalizedY = y / Math.max(size - 1, 1);
  if (normalizedY < 0.38) return 0.04;
  const facadeProgress = (normalizedY - 0.38) / 0.62;
  return 0.25 + facadeProgress * facadeProgress * 1.75;
}

function luminance(grid) {
  const output = new Float32Array(grid.alpha.length);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = grid.rgb[index * 3] * 0.2126 + grid.rgb[index * 3 + 1] * 0.7152 + grid.rgb[index * 3 + 2] * 0.0722;
  }
  return output;
}

function flipRows(source, width, height) {
  const output = new Uint8ClampedArray(source.length);
  const rowLength = width * 4;
  for (let y = 0; y < height; y += 1) {
    output.set(source.subarray((height - 1 - y) * rowLength, (height - y) * rowLength), y * rowLength);
  }
  return output;
}

function imagePixelsToDataUrl(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  context.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  return canvas.toDataURL("image/png");
}
