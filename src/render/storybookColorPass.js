import * as THREE from "three";
import { Pass, FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";

export const STORYBOOK_LUT_SIZE = 32;

export function calculateStorybookGradeState({
  enabled = true,
  strength = 0.78,
  daylight = 1,
  night = 0,
  twilight = 0
} = {}) {
  const resolvedStrength = clamp01(Number(strength) || 0);
  const nightBlend = clamp01(Number(night) || 0);
  const daylightFactor = clamp01(Number(daylight) || 0);
  const twilightFactor = clamp01(Number(twilight) || 0);
  const timeWeight = 0.88 + daylightFactor * 0.08 + twilightFactor * 0.08 - nightBlend * 0.08;
  return {
    enabled: Boolean(enabled) && resolvedStrength > 0,
    strength: clamp01(resolvedStrength * timeWeight),
    nightBlend
  };
}

export function gradeStorybookColor([red, green, blue], nightBlend = 0) {
  const input = [clamp01(red), clamp01(green), clamp01(blue)];
  const day = gradePalette(input, false);
  const night = gradePalette(input, true);
  const blend = clamp01(nightBlend);
  return day.map((value, index) => clamp01(value + (night[index] - value) * blend));
}

export class StorybookColorPass extends Pass {
  constructor({ strength = 0.78, lutSize = STORYBOOK_LUT_SIZE } = {}) {
    super();
    this.name = "StorybookColorPass";
    this.lutDay = createStorybookLut(lutSize, 0);
    this.lutNight = createStorybookLut(lutSize, 1);
    this.uniforms = {
      tDiffuse: { value: null },
      lutDay: { value: this.lutDay },
      lutNight: { value: this.lutNight },
      strength: { value: strength },
      nightBlend: { value: 0 }
    };
    this.material = new THREE.ShaderMaterial({
      name: "StorybookColorGradeMaterial",
      uniforms: this.uniforms,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision highp sampler3D;
        uniform sampler2D tDiffuse;
        uniform sampler3D lutDay;
        uniform sampler3D lutNight;
        uniform float strength;
        uniform float nightBlend;
        varying vec2 vUv;

        void main() {
          vec4 source = texture2D(tDiffuse, vUv);
          vec3 domain = clamp(source.rgb, 0.0, 1.0);
          vec3 dayColor = texture(lutDay, domain).rgb;
          vec3 nightColor = texture(lutNight, domain).rgb;
          vec3 graded = mix(dayColor, nightColor, nightBlend);
          gl_FragColor = vec4(mix(source.rgb, graded, strength), source.a);
        }
      `,
      depthTest: false,
      depthWrite: false
    });
    this.fsQuad = new FullScreenQuad(this.material);
  }

  setStyle(style = {}, options = {}) {
    const state = calculateStorybookGradeState({
      enabled: options.enabled ?? this.enabled,
      strength: options.strength ?? this.uniforms.strength.value,
      daylight: style.daylightFactor,
      night: style.nightFactor,
      twilight: style.twilightFactor
    });
    this.enabled = state.enabled;
    this.uniforms.strength.value = state.strength;
    this.uniforms.nightBlend.value = state.nightBlend;
    return state;
  }

  render(renderer, writeBuffer, readBuffer) {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.fsQuad.render(renderer);
  }

  dispose() {
    this.lutDay.dispose();
    this.lutNight.dispose();
    this.material.dispose();
    this.fsQuad.dispose();
  }
}

function createStorybookLut(size, nightBlend) {
  const resolvedSize = Math.max(2, Math.round(size));
  const data = new Uint8Array(resolvedSize ** 3 * 4);
  let offset = 0;
  for (let blue = 0; blue < resolvedSize; blue += 1) {
    for (let green = 0; green < resolvedSize; green += 1) {
      for (let red = 0; red < resolvedSize; red += 1) {
        const graded = gradeStorybookColor([
          red / (resolvedSize - 1),
          green / (resolvedSize - 1),
          blue / (resolvedSize - 1)
        ], nightBlend);
        data[offset] = Math.round(graded[0] * 255);
        data[offset + 1] = Math.round(graded[1] * 255);
        data[offset + 2] = Math.round(graded[2] * 255);
        data[offset + 3] = 255;
        offset += 4;
      }
    }
  }
  const texture = new THREE.Data3DTexture(data, resolvedSize, resolvedSize, resolvedSize);
  texture.name = nightBlend ? "StorybookNightLUT" : "StorybookDayLUT";
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.wrapR = THREE.ClampToEdgeWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

function gradePalette(input, night) {
  let [red, green, blue] = input;
  const sourceRed = red;
  const sourceGreen = green;
  const sourceBlue = blue;
  const sourceChroma = Math.max(red, green, blue) - Math.min(red, green, blue);
  const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  const saturation = night ? 0.82 : 0.88;
  red = luminance + (red - luminance) * saturation;
  green = luminance + (green - luminance) * saturation;
  blue = luminance + (blue - luminance) * saturation;

  const greenDifference = night
    ? green - Math.max(red, blue)
    : sourceGreen - Math.max(sourceRed, sourceBlue);
  const greenMask = smoothstep(night ? 0.015 : 0.01, night ? 0.2 : 0.1, greenDifference) * (1 - smoothstep(0.7, 1, luminance));
  red += greenMask * green * (night ? 0.105 : 0.1);
  green *= 1 - greenMask * (night ? 0.105 : 0.12);
  blue += greenMask * green * (night ? 0.035 : 0.045);

  const redDifference = night
    ? red - Math.max(green, blue)
    : sourceRed - Math.max(sourceGreen, sourceBlue);
  const redMask = smoothstep(night ? 0.025 : 0.01, night ? 0.2 : 0.11, redDifference) * (1 - smoothstep(0.78, 1, luminance));
  if (night) {
    red *= 1 + redMask * 0.035;
    green *= 1 - redMask * 0.045;
    blue *= 1 - redMask * 0.025;
  } else {
    const terracottaMask = redMask * smoothstep(0.12, 0.48, luminance) * (1 - smoothstep(0.72, 0.9, luminance));
    red += terracottaMask * 0.23;
    green += terracottaMask * 0.105;
    blue += terracottaMask * 0.018;
  }

  const blueDifference = night
    ? blue - Math.max(red, green)
    : sourceBlue - Math.max(sourceRed, sourceGreen);
  const blueMask = smoothstep(night ? 0.035 : 0.02, night ? 0.27 : 0.16, blueDifference);
  if (night) {
    red += blueMask * blue * 0.075;
    green += blueMask * blue * 0.055;
    blue *= 1 - blueMask * 0.105;
    const skyCompression = 1 - blueMask * 0.09;
    red *= skyCompression;
    green *= skyCompression;
    blue *= skyCompression;
  } else {
    const skyMask = smoothstep(0.015, 0.1, sourceBlue - Math.max(sourceRed, sourceGreen)) * smoothstep(0.4, 0.62, luminance);
    const paperSky = [
      0.54 + luminance * 0.37,
      0.53 + luminance * 0.35,
      0.48 + luminance * 0.3
    ];
    red = mix(red, paperSky[0], skyMask * 0.94);
    green = mix(green, paperSky[1], skyMask * 0.94);
    blue = mix(blue, paperSky[2], skyMask * 0.94);
  }

  if (!night) {
    const warmNeutral = smoothstep(0.035, 0.11, sourceRed - sourceBlue)
      * (1 - smoothstep(0.14, 0.25, sourceChroma))
      * smoothstep(0.4, 0.72, luminance)
      * (1 - smoothstep(0.82, 0.96, luminance));
    red += warmNeutral * 0.18;
    green += warmNeutral * 0.1;
    blue += warmNeutral * 0.04;
  }

  const shadow = 1 - smoothstep(0.14, 0.58, luminance);
  const highlight = smoothstep(0.38, 0.92, luminance);
  const coolTint = night ? [0.72, 0.88, 1.15] : [0.88, 0.96, 1.03];
  const warmTint = night ? [1.06, 1.025, 0.9] : [1.16, 1.07, 0.82];
  const shadowAmount = night ? 0.27 : 0.12;
  const highlightAmount = night ? 0.08 : 0.23;
  red *= mix(1, coolTint[0], shadow * shadowAmount) * mix(1, warmTint[0], highlight * highlightAmount);
  green *= mix(1, coolTint[1], shadow * shadowAmount) * mix(1, warmTint[1], highlight * highlightAmount);
  blue *= mix(1, coolTint[2], shadow * shadowAmount) * mix(1, warmTint[2], highlight * highlightAmount);

  // Preserve readable shapes at night without turning the scene grey. This is a
  // chromatic toe lift: the deepest values settle into ink blue while midtones
  // remain dark enough for emissive windows and street lights to lead the eye.
  if (night) {
    const occupiedShadow = smoothstep(0.003, 0.045, luminance);
    const nightLift = occupiedShadow * (1 - smoothstep(0.16, 0.5, luminance)) * 0.025;
    red += nightLift * 0.32;
    green += nightLift * 0.5;
    blue += nightLift * 0.82;
  }

  const contrast = night ? 1 : 1.115;
  const pivot = night ? 0.36 : 0.42;
  red = (red - pivot) * contrast + pivot;
  green = (green - pivot) * contrast + pivot;
  blue = (blue - pivot) * contrast + pivot;
  const toe = night ? 0.003 : 0.012;
  const gamma = night ? 0.88 : 0.97;
  return [red, green, blue].map((value) => Math.pow(Math.max(0, value + toe), gamma));
}

function smoothstep(edge0, edge1, value) {
  const amount = clamp01((value - edge0) / Math.max(1e-6, edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
}

function mix(left, right, amount) {
  return left + (right - left) * amount;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}
