// Post-process outline: edges from the depth buffer (Sobel on linear depth) drawn as dark lines over the image.
// An alternative to the inverted-hull outline; it outlines everything on screen, independent of PMX edge data.

import type { Camera } from '@babylonjs/core/Cameras/camera';
import { Effect } from '@babylonjs/core/Materials/effect';
import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess';
import type { DepthRenderer } from '@babylonjs/core/Rendering/depthRenderer';
import '@babylonjs/core/Rendering/depthRendererSceneComponent';
import type { Scene } from '@babylonjs/core/scene';

const NAME = 'nprPostOutline';
Effect.ShadersStore[`${NAME}FragmentShader`] = /* glsl */ `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform sampler2D depthSampler;
uniform vec2 texel;
uniform vec4 params; // thickness, threshold, strength, unused
float d(vec2 o) { return texture2D(depthSampler, vUV + o * texel * params.x).r; }
void main(void) {
  vec4 c = texture2D(textureSampler, vUV);
  float gx = -d(vec2(-1.0,-1.0)) - 2.0*d(vec2(-1.0,0.0)) - d(vec2(-1.0,1.0)) + d(vec2(1.0,-1.0)) + 2.0*d(vec2(1.0,0.0)) + d(vec2(1.0,1.0));
  float gy = -d(vec2(-1.0,-1.0)) - 2.0*d(vec2(0.0,-1.0)) - d(vec2(1.0,-1.0)) + d(vec2(-1.0,1.0)) + 2.0*d(vec2(0.0,1.0)) + d(vec2(1.0,1.0));
  float center = max(d(vec2(0.0)), 1e-4);
  float e = smoothstep(params.y, params.y * 2.0, sqrt(gx*gx + gy*gy) / center);
  gl_FragColor = vec4(mix(c.rgb, vec3(0.05, 0.04, 0.06), e * params.z), c.a);
}`;

export class PostOutline {
  private pp: PostProcess | null = null;
  private depth: DepthRenderer | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
  ) {}

  setEnabled(on: boolean): void {
    if (on && !this.pp) {
      this.depth = this.scene.enableDepthRenderer(this.camera, false);
      const pp = new PostProcess(NAME, NAME, ['texel', 'params'], ['depthSampler'], 1, this.camera);
      pp.onApply = (effect) => {
        effect.setTexture('depthSampler', this.depth!.getDepthMap());
        effect.setFloat2('texel', 1 / pp.width, 1 / pp.height);
        effect.setFloat4('params', 1.2, 0.04, 0.9, 0);
      };
      this.pp = pp;
    } else if (!on && this.pp) {
      this.pp.dispose(this.camera);
      this.pp = null;
      this.scene.disableDepthRenderer(this.camera);
      this.depth = null;
    }
  }
}
