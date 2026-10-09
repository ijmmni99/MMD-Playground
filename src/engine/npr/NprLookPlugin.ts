// NPR look layer: a Babylon MaterialPlugin added on top of babylon-mmd's MmdStandardMaterial. It keeps the
// standard vertex path (skinning, SDEF, morphs), the light loop (shadow map) and the MMD outline renderer, and
// replaces the final colour at CUSTOM_FRAGMENT_BEFORE_FOG, so fog, image processing, bloom and tone mapping
// still apply. Written from scratch for MMD Studio.

import { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import type { Material } from '@babylonjs/core/Materials/material';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import type { Scene } from '@babylonjs/core/scene';
import type { SubMesh } from '@babylonjs/core/Meshes/subMesh';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import type { Effect } from '@babylonjs/core/Materials/effect';
import type { LookFeatures, LookParams } from '@/lib/npr/looks';
import { NprGlobals } from './globals';

export class NprDefines extends MaterialDefines {
  NPR = false;
  NPR_TIER_HIGH = false;
  NPR_UNLIT = false;
  NPR_RAMP_TEX = false;
  NPR_HYBRID = false;
  NPR_RIM = false;
  NPR_SPEC = false;
  NPR_NOISE = false;
  NPR_SPARKLE = false;
  NPR_SHEEN = false;
  NPR_BLUSH = false;
  NPR_ALPHA_HASH = false;
  NPR_ALPHA_MASK = false;
  NPR_ALPHA_BLEND = false;
  NPR_SEE_THROUGH = false;
  /** Test hook: a deliberately broken variant (compile-failure fallback test). */
  NPR_BREAK = false;
}

const VEC4 = [
  'nprA',
  'nprShadow',
  'nprRim',
  'nprRim2',
  'nprSpec',
  'nprFx',
  'nprFx2',
  'nprBlush',
  'nprMisc',
  'nprSun',
  'nprSunColor',
  'nprSky',
  'nprGround',
] as const;
const LOOK_VEC4 = 9; // the first nine are per material, the rest global

const FRAGMENT = /* glsl */ `
#ifdef NPR
{
  vec3 nN = normalW;
  vec3 nV = viewDirectionW;
#ifdef NPR_NOISE
  {
    vec3 q = vPositionW * nprFx.w;
    vec3 g = vec3(sin(q.y * 1.7 + cos(q.z * 2.3)), sin(q.z * 1.3 + cos(q.x * 1.9)), sin(q.x * 2.1 + cos(q.y * 1.1)));
    nN = normalize(nN + g * nprFx.z * 0.35);
  }
#endif
  vec3 nL = nprSun.xyz;
  vec3 nAlbedo = baseColor.rgb * clamp(diffuseColor, 0.0, 1.0);
  float nSunShadow = clamp(aggShadow * numLights - (numLights - 1.0), 0.0, 1.0);
  float nNdl = dot(nN, nL);
  float nNdv = clamp(dot(nN, nV), 0.0, 1.0);
  vec3 nSun = nprSunColor.rgb;
  vec3 nAmb = mix(nprGround.rgb, nprSky.rgb, nN.y * 0.5 + 0.5);
  vec3 nOut;
#ifdef NPR_UNLIT
  nOut = nAlbedo * (1.0 + nprFx.x);
#else
  float nF = mix(nNdl, 0.6, nprA.w);
  float nLit;
  vec3 nShade;
  float nLum = dot(nAlbedo, vec3(0.299, 0.587, 0.114));
  nShade = clamp(mix(vec3(nLum), nAlbedo, nprShadow.w), 0.0, 1.0) * nprShadow.rgb;
  float nCast = mix(1.0, nSunShadow, nprMisc.y);
#if defined(NPR_RAMP_TEX) && defined(TOON_TEXTURE)
  float nT = clamp(max(nF, 0.0) * nCast, 0.02, 0.98);
  vec3 nRamp = texture2D(toonSampler, vec2(0.5, nT)).rgb;
  nLit = dot(nRamp, vec3(0.333));
  vec3 nToon = nAlbedo * nRamp * nSun;
#else
  float nW = mix(0.004, 0.6, nprA.z);
  nLit = smoothstep(nprA.y - nW, nprA.y + nW, nF) * nCast;
  vec3 nToon = mix(nShade, nAlbedo, nLit) * nSun;
#endif
  nToon += nAlbedo * nAmb * 0.25;
#ifdef NPR_SPEC
  {
    vec3 nH = normalize(nL + nV);
    float nNdh = clamp(dot(nN, nH), 0.0, 1.0);
    float nSize = nprRim2.w;
    float nSpot = smoothstep(0.995 - nSize * 0.12, 0.998 - nSize * 0.12, nNdh);
    float nC = 0.93 - nSize * 0.12;
    float nRing = smoothstep(nC - 0.03, nC, nNdh) * (1.0 - smoothstep(nC + 0.02, nC + 0.05, nNdh));
    nToon += nprSpec.rgb * nprRim2.z * mix(nSpot, max(nSpot, nRing), nprSpec.w) * max(nLit, 0.25);
  }
#endif
#ifdef NPR_RIM
  {
    float nFres = pow(1.0 - nNdv, nprRim2.x);
    float nMask = mix(1.0, smoothstep(-0.2, 0.6, nNdl), nprRim2.y);
    nToon += nprRim.rgb * nprRim.w * nFres * nMask;
  }
#endif
#ifdef NPR_BLUSH
  {
    float nCheek = smoothstep(0.2, 0.5, abs(nN.x)) * smoothstep(0.0, 0.4, -nN.z) * (1.0 - smoothstep(0.25, 0.6, abs(nN.y)));
    nToon = mix(nToon, nToon * nprBlush.rgb * 1.25, nCheek * nprBlush.w);
  }
#endif
#ifdef NPR_SPARKLE
  {
    vec3 nCell = floor(vPositionW * 40.0);
    float nRnd = fract(sin(dot(nCell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    float nGl = pow(clamp(dot(reflect(-nL, nN), nV), 0.0, 1.0), 6.0);
    nToon += nSun * step(0.975, nRnd) * nGl * nprFx2.x * 3.0;
  }
#endif
#ifdef NPR_SHEEN
  nToon += nSun * pow(1.0 - nNdv, 2.0) * nprFx2.y * 0.6;
#endif
  nToon += nAlbedo * nprFx.x;
#if defined(NPR_HYBRID) && defined(NPR_TIER_HIGH)
  {
    vec3 nH = normalize(nL + nV);
    float nR = max(nprMisc.z, 0.05);
    float nA2 = nR * nR * nR * nR;
    float nNdh = clamp(dot(nN, nH), 0.0, 1.0);
    float nD = nA2 / (3.14159 * pow(nNdh * nNdh * (nA2 - 1.0) + 1.0, 2.0));
    float nFr = 0.04 + 0.96 * pow(1.0 - clamp(dot(nH, nV), 0.0, 1.0), 5.0);
    float nNl = clamp(nNdl, 0.0, 1.0);
    vec3 nPbr = nAlbedo * (nNl * nSunShadow * nSun + nAmb * 0.45) + nSun * nD * nFr * nNl * nSunShadow * 0.25;
    nToon = mix(nPbr, nToon, nprA.x);
  }
#endif
  nOut = nToon;
#endif
#if defined(NORMAL) && defined(SPHERE_TEXTURE)
#ifdef SPHERE_TEXTURE_BLEND_MODE_MULTIPLY
  nOut *= mix(vec3(1.0), sphereReflectionColor.rgb, nprFx.y);
#elif defined(SPHERE_TEXTURE_BLEND_MODE_ADD)
  nOut += sphereReflectionColor.rgb * nprFx.y;
#endif
#endif
  float nAlpha = color.a;
#ifdef NPR_SHEEN
  nAlpha = mix(nAlpha * (1.0 - 0.45 * step(0.001, nprFx2.z)), max(nAlpha, nprFx2.z), pow(1.0 - nNdv, 1.5));
#endif
#ifdef NPR_ALPHA_HASH
  float nIgn = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (nAlpha < nIgn) discard;
  nAlpha = 1.0;
#elif defined(NPR_ALPHA_MASK)
  if (nAlpha < 0.5) discard;
  nAlpha = 1.0;
#endif
  color = vec4(nOut, nAlpha);
#ifdef NPR_BREAK
  color = undefinedNprSymbol;
#endif
}
#endif
`;

const SEE_THROUGH = /* glsl */ `
#ifdef NPR_SEE_THROUGH
{
  vec4 nClip = nprViewProj * vec4(vPositionW + viewDirectionW * nprMisc.x, 1.0);
  gl_FragDepth = clamp(nClip.z / nClip.w * 0.5 + 0.5, 0.0, 1.0);
}
#endif
`;

export class NprLookPlugin extends MaterialPluginBase {
  /** Per-material look values, packed (9 vec4). */
  readonly values = new Float32Array(LOOK_VEC4 * 4);
  private features: LookFeatures | null = null;
  private seeThrough = false;
  private tierHigh = true;
  private broken = false;
  private version = 1;
  private boundVersion = 0;
  private boundGlobals = 0;
  private boundEffect: Effect | null = null;
  private _active = false;

  constructor(material: Material) {
    // After babylon-mmd's plugin (priority 100), so its sphere colour is available.
    super(material, 'NprLook', 300, new NprDefines(), true, false, false);
  }

  get active(): boolean {
    return this._active;
  }

  isCompatible(shaderLanguage: ShaderLanguage): boolean {
    return shaderLanguage === ShaderLanguage.GLSL;
  }

  /** Apply a resolved look (null = off). Defines change only when the feature set changes. */
  setLook(
    p: LookParams | null,
    f: LookFeatures | null,
    opts: { tierHigh: boolean; seeThrough: boolean; seeThroughBias: number; broken?: boolean },
  ): void {
    const on = !!p && !!f;
    const prev = this.features;
    const definesChanged =
      on !== this._active ||
      opts.tierHigh !== this.tierHigh ||
      opts.seeThrough !== this.seeThrough ||
      !!opts.broken !== this.broken ||
      JSON.stringify(prev) !== JSON.stringify(f);
    this.features = f;
    this.tierHigh = opts.tierHigh;
    this.seeThrough = opts.seeThrough;
    this.broken = !!opts.broken;
    if (p) {
      const v = this.values;
      v.set([p.toon, p.rampThreshold, p.rampSoftness, p.flatten], 0);
      v.set([...p.shadowColor, p.shadowSaturation], 4);
      v.set([...p.rimColor, p.rimStrength], 8);
      v.set([p.rimPower, p.rimLightMask, p.specStrength, p.specSize], 12);
      v.set([...p.specColor, p.specBand], 16);
      v.set([p.emission, p.matcap, p.noiseStrength, p.noiseScale], 20);
      v.set([p.sparkle, p.sheen, p.alphaEdge, 0], 24);
      v.set([...p.blushColor, p.blush], 28);
      v.set([opts.seeThroughBias, p.shadowStrength, p.roughness, 0], 32);
    }
    this.version++;
    if (on !== this._active) {
      this._active = on;
      this._enable(on);
    }
    if (definesChanged) this.markAllDefinesAsDirty();
  }

  prepareDefines(defines: NprDefines): void {
    const f = this.features;
    const on = this._active && !!f;
    defines.NPR = on;
    defines.NPR_TIER_HIGH = on && this.tierHigh;
    defines.NPR_UNLIT = on && f!.unlit;
    defines.NPR_RAMP_TEX = on && f!.rampTexture;
    defines.NPR_HYBRID = on && f!.hybrid;
    defines.NPR_RIM = on && f!.rim;
    defines.NPR_SPEC = on && f!.spec;
    defines.NPR_NOISE = on && f!.noise;
    defines.NPR_SPARKLE = on && f!.sparkle;
    defines.NPR_SHEEN = on && f!.sheen;
    defines.NPR_BLUSH = on && f!.blush;
    defines.NPR_ALPHA_HASH = on && f!.alpha === 'hash';
    defines.NPR_ALPHA_MASK = on && f!.alpha === 'mask';
    defines.NPR_ALPHA_BLEND = on && f!.alpha === 'blend';
    defines.NPR_SEE_THROUGH = on && this.seeThrough;
    defines.NPR_BREAK = on && this.broken;
  }

  getUniforms(): { ubo: { name: string; size: number; type: string }[]; fragment: string } {
    return {
      ubo: [
        ...VEC4.map((name) => ({ name, size: 4, type: 'vec4' })),
        { name: 'nprViewProj', size: 16, type: 'mat4' },
      ],
      fragment: `${VEC4.map((n) => `uniform vec4 ${n};`).join('')}uniform mat4 nprViewProj;`,
    };
  }

  bindForSubMesh(ubo: UniformBuffer, scene: Scene, _engine: AbstractEngine, subMesh: SubMesh): void {
    if (!this._active) return;
    const effect = subMesh.effect;
    const g = NprGlobals;
    if (this.seeThrough) ubo.updateMatrix('nprViewProj', scene.getTransformMatrix());
    if (effect === this.boundEffect && this.boundVersion === this.version && this.boundGlobals === g.version)
      return;
    const v = this.values;
    for (let i = 0; i < LOOK_VEC4; i++)
      ubo.updateFloat4(VEC4[i], v[i * 4], v[i * 4 + 1], v[i * 4 + 2], v[i * 4 + 3]);
    const gv = g.values;
    for (let i = LOOK_VEC4; i < VEC4.length; i++) {
      const o = (i - LOOK_VEC4) * 4;
      ubo.updateFloat4(VEC4[i], gv[o], gv[o + 1], gv[o + 2], gv[o + 3]);
    }
    this.boundEffect = effect;
    this.boundVersion = this.version;
    this.boundGlobals = g.version;
  }

  getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType !== 'fragment') return null;
    return {
      CUSTOM_FRAGMENT_BEFORE_FOG: FRAGMENT,
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: SEE_THROUGH,
    };
  }

  getClassName(): string {
    return 'NprLookPlugin';
  }
}
