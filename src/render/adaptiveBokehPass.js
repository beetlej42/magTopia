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

    void main() {
      float depth = readSceneDepth(vUv);
      if (depth >= 0.999999 || maxblur <= 0.000001) {
        gl_FragColor = texture2D(tColor, vUv);
        return;
      }

      float viewZ = perspectiveDepthToViewZ(depth, nearClip, farClip);
      float circleOfConfusion = min(abs(focus + viewZ) * aperture, maxblur);
      vec2 radius = vec2(circleOfConfusion, circleOfConfusion * aspect);

      vec4 bokeh = texture2D(tColor, vUv) * 1.5;
      bokeh += texture2D(tColor, vUv + radius * vec2( 1.000,  0.000));
      bokeh += texture2D(tColor, vUv + radius * vec2(-0.500,  0.866));
      bokeh += texture2D(tColor, vUv + radius * vec2(-0.500, -0.866));
      float weight = 4.5;

      if (quality > 0.75) {
        bokeh += texture2D(tColor, vUv + radius * vec2( 0.500,  0.866));
        bokeh += texture2D(tColor, vUv + radius * vec2(-1.000,  0.000));
        bokeh += texture2D(tColor, vUv + radius * vec2( 0.500, -0.866));
        weight += 3.0;
      }

      gl_FragColor = bokeh / weight;
    }
  `
};

const BOKEH_COMPOSITE_SHADER = {
  uniforms: {
    tColor: { value: null },
    tBokeh: { value: null },
    tDepth: { value: null },
    focus: { value: 1 },
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
      float circleOfConfusion = min(abs(focus + viewZ) * aperture, maxblur);
      float blendAmount = smoothstep(0.12, 0.72, circleOfConfusion / maxblur);
      gl_FragColor = mix(sharpColor, texture2D(tBokeh, vUv), blendAmount);
    }
  `
};

export class AdaptiveBokehPass extends Pass {
  constructor(scene, camera, {
    focus = 60,
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
    const depthScale = this.quality >= 0.75 ? 0.4 : 0.25;
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
      fallbackDepthRenders: this.fallbackDepthRenders
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
