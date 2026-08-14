import {
  Color,
  LinearFilter,
  Matrix4,
  MeshDepthMaterial,
  NearestFilter,
  NoBlending,
  RGBADepthPacking,
  ShaderMaterial,
  UniformsUtils,
  UnsignedByteType,
  WebGLRenderTarget
} from "three";
import { Pass, FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";

const ADAPTIVE_BOKEH_SHADER = {
  uniforms: {
    tColor: { value: null },
    tDepth: { value: null },
    focus: { value: 1 },
    focusRange: { value: 4 },
    aspect: { value: 1 },
    aperture: { value: 0.025 },
    maxblur: { value: 0.01 },
    nearClip: { value: 0.1 },
    farClip: { value: 1000 },
    depthPacking: { value: 1 },
    quality: { value: 1 }
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    #include <common>
    #include <packing>

    varying vec2 vUv;
    uniform sampler2D tColor;
    uniform sampler2D tDepth;
    uniform float focus;
    uniform float focusRange;
    uniform float aspect;
    uniform float aperture;
    uniform float maxblur;
    uniform float nearClip;
    uniform float farClip;
    uniform float depthPacking;
    uniform float quality;

    float readSceneDepth(vec2 uv) {
      vec4 sampleValue = texture2D(tDepth, uv);
      return depthPacking > 0.5 ? unpackRGBAToDepth(sampleValue) : sampleValue.x;
    }

    float circleOfConfusionForViewZ(float viewZ) {
      float distanceFromFocus = max(abs(focus + viewZ) - focusRange, 0.0);
      return min(distanceFromFocus * aperture, maxblur);
    }

    void main() {
      float depth = readSceneDepth(vUv);
      if (depth >= 0.999999 || maxblur <= 0.000001) {
        gl_FragColor = texture2D(tColor, vUv);
        return;
      }

      float viewZ = perspectiveDepthToViewZ(depth, nearClip, farClip);
      float circleOfConfusion = circleOfConfusionForViewZ(viewZ);
      vec4 centerColor = texture2D(tColor, vUv);
      if (circleOfConfusion <= 0.000001) {
        gl_FragColor = centerColor;
        return;
      }

      // A sunflower disk avoids the visible triangular/hexagonal bands produced
      // by the former six-tap kernel while remaining temporally stable in motion.
      float sampleCount = quality > 0.75 ? 18.0 : 8.0;
      float centerDistance = -viewZ;
      float rejectStart = max(0.75, focusRange * 0.18);
      float rejectEnd = max(2.5, focusRange * 0.8);
      vec4 bokeh = centerColor * 1.25;
      float totalWeight = 1.25;
      for (int index = 0; index < 18; index += 1) {
        float sampleIndex = float(index);
        if (sampleIndex >= sampleCount) continue;
        float sampleRadius = sqrt((sampleIndex + 0.5) / sampleCount);
        float angle = (sampleIndex + 0.5) * 2.39996323;
        vec2 direction = vec2(cos(angle), sin(angle) * aspect);
        vec2 sampleUv = clamp(
          vUv + direction * circleOfConfusion * sampleRadius,
          vec2(0.001),
          vec2(0.999)
        );
        float sampleViewZ = perspectiveDepthToViewZ(readSceneDepth(sampleUv), nearClip, farClip);
        float closerDepthDelta = max(centerDistance - (-sampleViewZ), 0.0);
        float depthWeight = 1.0 - smoothstep(rejectStart, rejectEnd, closerDepthDelta);
        vec4 sampleColor = texture2D(tColor, sampleUv);
        float luminance = dot(sampleColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        sampleColor.rgb *= 1.0 + smoothstep(0.72, 1.28, luminance) * 0.12;
        bokeh += sampleColor * depthWeight;
        totalWeight += depthWeight;
      }

      gl_FragColor = bokeh / max(totalWeight, 0.0001);
    }
  `
};

const BOKEH_COMPOSITE_SHADER = {
  uniforms: {
    tColor: { value: null },
    tBokeh: { value: null },
    tDepth: { value: null },
    focus: { value: 1 },
    focusRange: { value: 4 },
    aperture: { value: 0.025 },
    maxblur: { value: 0.01 },
    nearClip: { value: 0.1 },
    farClip: { value: 1000 },
    depthPacking: { value: 1 }
  },
  vertexShader: ADAPTIVE_BOKEH_SHADER.vertexShader,
  fragmentShader: /* glsl */`
    #include <common>
    #include <packing>
    varying vec2 vUv;
    uniform sampler2D tColor;
    uniform sampler2D tBokeh;
    uniform sampler2D tDepth;
    uniform float focus;
    uniform float focusRange;
    uniform float aperture;
    uniform float maxblur;
    uniform float nearClip;
    uniform float farClip;
    uniform float depthPacking;

    float readSceneDepth(vec2 uv) {
      vec4 sampleValue = texture2D(tDepth, uv);
      return depthPacking > 0.5 ? unpackRGBAToDepth(sampleValue) : sampleValue.x;
    }

    void main() {
      vec4 sharpColor = texture2D(tColor, vUv);
      float depth = readSceneDepth(vUv);
      if (depth >= 0.999999 || maxblur <= 0.000001) {
        gl_FragColor = sharpColor;
        return;
      }
      float viewZ = perspectiveDepthToViewZ(depth, nearClip, farClip);
      float distanceFromFocus = max(abs(focus + viewZ) - focusRange, 0.0);
      float circleOfConfusion = min(distanceFromFocus * aperture, maxblur);
      float blendAmount = smoothstep(0.08, 0.68, circleOfConfusion / maxblur);
      gl_FragColor = mix(sharpColor, texture2D(tBokeh, vUv), blendAmount);
    }
  `
};

export class AdaptiveBokehPass extends Pass {
  constructor(scene, camera, {
    focus = 60,
    focusRange = 4,
    aperture = 0.0002,
    maxblur = 0.004,
    quality = 1
  } = {}) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.quality = quality;
    this._width = 1;
    this._height = 1;
    this._oldClearColor = new Color();
    this.depthMaterial = new MeshDepthMaterial({
      depthPacking: RGBADepthPacking,
      blending: NoBlending
    });
    this.depthTarget = new WebGLRenderTarget(1, 1, {
      type: UnsignedByteType,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthBuffer: true,
      stencilBuffer: false
    });
    this.depthTarget.texture.name = "AdaptiveBokehPass.packedDepth";
    this.bokehTarget = new WebGLRenderTarget(1, 1, {
      type: UnsignedByteType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
      stencilBuffer: false
    });
    this.bokehTarget.texture.name = "AdaptiveBokehPass.bokeh";
    this._depthValid = false;
    this._framesSinceDepthRender = 0;
    this._cachedViewProjection = new Matrix4();
    this._currentViewProjection = new Matrix4();
    this.sharedDepthFrames = 0;
    this.fallbackDepthRenders = 0;
    this.usingSharedDepth = false;
    const uniforms = UniformsUtils.clone(ADAPTIVE_BOKEH_SHADER.uniforms);
    uniforms.focus.value = focus;
    uniforms.focusRange.value = focusRange;
    uniforms.aperture.value = aperture;
    uniforms.maxblur.value = maxblur;
    uniforms.quality.value = quality;
    this.material = new ShaderMaterial({
      uniforms,
      vertexShader: ADAPTIVE_BOKEH_SHADER.vertexShader,
      fragmentShader: ADAPTIVE_BOKEH_SHADER.fragmentShader,
      blending: NoBlending
    });
    this.uniforms = uniforms;
    this.quad = new FullScreenQuad(this.material);
    this.compositeUniforms = UniformsUtils.clone(BOKEH_COMPOSITE_SHADER.uniforms);
    this.compositeMaterial = new ShaderMaterial({
      uniforms: this.compositeUniforms,
      vertexShader: BOKEH_COMPOSITE_SHADER.vertexShader,
      fragmentShader: BOKEH_COMPOSITE_SHADER.fragmentShader,
      blending: NoBlending
    });
    this.compositeQuad = new FullScreenQuad(this.compositeMaterial);
  }

  setQuality(quality) {
    const normalizedQuality = Number(quality) >= 0.75 ? 1 : 0.5;
    if (normalizedQuality === this.quality) return;
    this.quality = normalizedQuality;
    this.uniforms.quality.value = this.quality;
    this.setSize(this._width, this._height);
    this.invalidateDepth();
  }

  setSize(width, height) {
    this._width = Math.max(1, width);
    this._height = Math.max(1, height);
    this.uniforms.aspect.value = this._width / this._height;
    const depthScale = this.quality >= 0.75 ? 0.5 : 0.32;
    this.depthTarget.setSize(
      Math.max(1, Math.round(this._width * depthScale)),
      Math.max(1, Math.round(this._height * depthScale))
    );
    this.bokehTarget.setSize(
      Math.max(1, Math.round(this._width * depthScale)),
      Math.max(1, Math.round(this._height * depthScale))
    );
    this.invalidateDepth();
  }

  invalidateDepth() {
    this._depthValid = false;
  }

  render(renderer, writeBuffer, readBuffer) {
    const sharedDepthTexture = readBuffer.depthTexture?.isDepthTexture ? readBuffer.depthTexture : null;
    this.usingSharedDepth = Boolean(sharedDepthTexture);
    let depthTexture = sharedDepthTexture;
    if (sharedDepthTexture) {
      this.sharedDepthFrames += 1;
    } else {
      this._currentViewProjection.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
      const cameraChanged = !matrixApproximatelyEquals(this._currentViewProjection, this._cachedViewProjection);
      this._framesSinceDepthRender += 1;
      const shouldRefreshDepth = !this._depthValid
        || (cameraChanged && this._framesSinceDepthRender >= 2)
        || this._framesSinceDepthRender >= 15;
      if (shouldRefreshDepth) {
        const oldAutoClear = renderer.autoClear;
        const oldClearAlpha = renderer.getClearAlpha();
        const oldOverrideMaterial = this.scene.overrideMaterial;
        renderer.getClearColor(this._oldClearColor);
        renderer.autoClear = false;
        this.scene.overrideMaterial = this.depthMaterial;
        renderer.setClearColor(0xffffff);
        renderer.setClearAlpha(1);
        renderer.setRenderTarget(this.depthTarget);
        renderer.clear();
        renderer.render(this.scene, this.camera);
        this.scene.overrideMaterial = oldOverrideMaterial;
        renderer.setClearColor(this._oldClearColor);
        renderer.setClearAlpha(oldClearAlpha);
        renderer.autoClear = oldAutoClear;
        this._cachedViewProjection.copy(this._currentViewProjection);
        this._depthValid = true;
        this._framesSinceDepthRender = 0;
        this.fallbackDepthRenders += 1;
      }
      depthTexture = this.depthTarget.texture;
    }

    this.uniforms.tColor.value = readBuffer.texture;
    this.uniforms.tDepth.value = depthTexture;
    this.uniforms.depthPacking.value = sharedDepthTexture ? 0 : 1;
    this.uniforms.nearClip.value = this.camera.near;
    this.uniforms.farClip.value = this.camera.far;
    renderer.setRenderTarget(this.bokehTarget);
    renderer.clear();
    this.quad.render(renderer);

    this.compositeUniforms.tColor.value = readBuffer.texture;
    this.compositeUniforms.tBokeh.value = this.bokehTarget.texture;
    this.compositeUniforms.tDepth.value = depthTexture;
    this.compositeUniforms.depthPacking.value = sharedDepthTexture ? 0 : 1;
    this.compositeUniforms.focus.value = this.uniforms.focus.value;
    this.compositeUniforms.focusRange.value = this.uniforms.focusRange.value;
    this.compositeUniforms.aperture.value = this.uniforms.aperture.value;
    this.compositeUniforms.maxblur.value = this.uniforms.maxblur.value;
    this.compositeUniforms.nearClip.value = this.camera.near;
    this.compositeUniforms.farClip.value = this.camera.far;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.compositeQuad.render(renderer);
  }

  getDiagnostics() {
    return {
      usingSharedDepth: this.usingSharedDepth,
      sharedDepthFrames: this.sharedDepthFrames,
      fallbackDepthRenders: this.fallbackDepthRenders,
      focusRange: this.uniforms.focusRange.value,
      effectScale: this.quality >= 0.75 ? 0.5 : 0.32,
      samples: this.quality >= 0.75 ? 18 : 8
    };
  }

  dispose() {
    this.depthTarget.dispose();
    this.bokehTarget.dispose();
    this.depthMaterial.dispose();
    this.material.dispose();
    this.compositeMaterial.dispose();
    this.quad.dispose();
    this.compositeQuad.dispose();
  }
}

function matrixApproximatelyEquals(left, right, epsilon = 1e-6) {
  for (let index = 0; index < 16; index += 1) {
    if (Math.abs(left.elements[index] - right.elements[index]) > epsilon) return false;
  }
  return true;
}
