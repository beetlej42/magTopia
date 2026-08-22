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
  const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  const saturation = night ? 0.82 : 0.88;
  red = luminance + (red - luminance) * saturation;
  green = luminance + (green - luminance) * saturation;
  blue = luminance + (blue - luminance) * saturation;

  const greenMask = smoothstep(0.015, 0.2, green - Math.max(red, blue)) * (1 - smoothstep(0.7, 1, luminance));
  red += greenMask * green * 0.105;
  green *= 1 - greenMask * 0.105;
  blue += greenMask * green * 0.035;

  const redMask = smoothstep(0.025, 0.2, red - Math.max(green, blue)) * (1 - smoothstep(0.78, 1, luminance));
  red *= 1 + redMask * 0.035;
  green *= 1 - redMask * 0.045;
  blue *= 1 - redMask * 0.025;

  const blueMask = smoothstep(0.035, 0.27, blue - Math.max(red, green));
  red += blueMask * blue * 0.075;
  green += blueMask * blue * 0.055;
  blue *= 1 - blueMask * 0.105;
  const skyCompression = 1 - blueMask * 0.09;
  red *= skyCompression;
  green *= skyCompression;
  blue *= skyCompression;

  const shadow = 1 - smoothstep(0.14, 0.58, luminance);
  const highlight = smoothstep(0.38, 0.92, luminance);
  const coolTint = night ? [0.72, 0.88, 1.15] : [0.75, 0.92, 1.13];
  const warmTint = night ? [1.06, 1.025, 0.9] : [1.12, 1.04, 0.78];
  const shadowAmount = night ? 0.27 : 0.235;
  const highlightAmount = night ? 0.08 : 0.195;
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
