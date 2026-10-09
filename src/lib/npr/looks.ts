// Look presets for the NPR (anime / toon) material layer: parameters with ranges, preset values, per-material
// overrides, global quick controls and quality tiers. Pure data; the engine turns a resolved look into shader
// defines and uniforms.

export const LOOK_IDS = [
  'default',
  'animeSkin',
  'animeFace',
  'animeHair',
  'clothSmooth',
  'clothRough',
  'stockings',
  'metal',
  'eye',
  'flatUnlit',
] as const;
export type LookId = (typeof LOOK_IDS)[number];

export const LOOK_LABEL: Record<LookId, string> = {
  default: 'Default (PMX original)',
  animeSkin: 'Anime Skin',
  animeFace: 'Anime Face',
  animeHair: 'Anime Hair',
  clothSmooth: 'Cloth Smooth',
  clothRough: 'Cloth Rough',
  stockings: 'Stockings',
  metal: 'Metal',
  eye: 'Eye',
  flatUnlit: 'Flat Unlit',
};

export type Rgb = [number, number, number];
export type AlphaMode = 'keep' | 'blend' | 'mask' | 'hash';
export type RampMode = 'soft' | 'pmxToon';

export interface LookParams {
  /** 1 = pure toon, 0 = the realistic (GGX) term (High tier only). */
  toon: number;
  rampThreshold: number;
  /** 0 = hard terminator, 1 = very soft. */
  rampSoftness: number;
  rampMode: RampMode;
  /** How much the cast shadow (shadow map) darkens. */
  shadowStrength: number;
  shadowColor: Rgb;
  /** Saturation multiplier in shadow. */
  shadowSaturation: number;
  /** Pull N·L toward a constant (soft faces). */
  flatten: number;
  rimStrength: number;
  rimColor: Rgb;
  rimPower: number;
  /** 0 = rim everywhere, 1 = only on the lit side. */
  rimLightMask: number;
  specStrength: number;
  /** Highlight size (0 small … 1 wide). */
  specSize: number;
  specColor: Rgb;
  /** Hair: a ring-shaped band instead of a spot. */
  specBand: number;
  emission: number;
  /** Strength of the PMX sphere map / matcap (1 = as authored). */
  matcap: number;
  /** Cloth bump noise. */
  noiseStrength: number;
  noiseScale: number;
  sparkle: number;
  /** Stockings: sheen and edge opacity. */
  sheen: number;
  alphaEdge: number;
  alphaMode: AlphaMode;
  blush: number;
  blushColor: Rgb;
  /** Roughness for the realistic term. */
  roughness: number;
  /** Outline colour (null = PMX edge colour) and thickness multiplier. */
  outlineColor: Rgb | null;
  outlineScale: number;
  /** Flat, unlit (albedo + emission). */
  unlit: boolean;
}

export type ParamKey = keyof LookParams;

export interface NumberSpec {
  kind: 'number';
  label: string;
  min: number;
  max: number;
  step: number;
}
export interface ColorSpec {
  kind: 'color';
  label: string;
}
export type ParamSpec =
  | NumberSpec
  | ColorSpec
  | { kind: 'enum'; label: string; options: string[] }
  | { kind: 'bool'; label: string };

const num = (label: string, min: number, max: number, step = 0.01): NumberSpec => ({
  kind: 'number',
  label,
  min,
  max,
  step,
});

export const PARAM_SPECS: Record<ParamKey, ParamSpec> = {
  toon: num('Toon vs realistic', 0, 1),
  rampThreshold: num('Shadow line', -1, 1),
  rampSoftness: num('Ramp softness', 0, 1),
  rampMode: { kind: 'enum', label: 'Ramp', options: ['soft', 'pmxToon'] },
  shadowStrength: num('Cast shadow', 0, 1),
  shadowColor: { kind: 'color', label: 'Shadow colour' },
  shadowSaturation: num('Shadow saturation', 0, 2),
  flatten: num('Flatten shading', 0, 1),
  rimStrength: num('Rim strength', 0, 2),
  rimColor: { kind: 'color', label: 'Rim colour' },
  rimPower: num('Rim width', 0.5, 8, 0.1),
  rimLightMask: num('Rim on lit side only', 0, 1),
  specStrength: num('Highlight', 0, 2),
  specSize: num('Highlight size', 0, 1),
  specColor: { kind: 'color', label: 'Highlight colour' },
  specBand: num('Highlight band (hair)', 0, 1),
  emission: num('Emission', 0, 2),
  matcap: num('Sphere / matcap', 0, 2),
  noiseStrength: num('Cloth bump', 0, 1),
  noiseScale: num('Bump scale', 0.5, 40, 0.5),
  sparkle: num('Sparkle', 0, 2),
  sheen: num('Sheen', 0, 1),
  alphaEdge: num('Edge opacity', 0, 1),
  alphaMode: { kind: 'enum', label: 'Transparency', options: ['keep', 'blend', 'mask', 'hash'] },
  blush: num('Cheek blush', 0, 1),
  blushColor: { kind: 'color', label: 'Blush colour' },
  roughness: num('Roughness', 0.05, 1),
  outlineColor: { kind: 'color', label: 'Outline colour' },
  outlineScale: num('Outline thickness', 0, 4),
  unlit: { kind: 'bool', label: 'Unlit' },
};

/** The handful of parameters each preset shows as sliders (all others stay in "More"). */
export const KEY_PARAMS: ParamKey[] = [
  'shadowColor',
  'rampSoftness',
  'rimStrength',
  'rimColor',
  'specStrength',
  'emission',
];

const BASE: LookParams = {
  toon: 1,
  rampThreshold: 0,
  rampSoftness: 0.25,
  rampMode: 'soft',
  shadowStrength: 0.8,
  shadowColor: [0.72, 0.68, 0.82],
  shadowSaturation: 1.15,
  flatten: 0,
  rimStrength: 0.25,
  rimColor: [1, 1, 1],
  rimPower: 3,
  rimLightMask: 0.6,
  specStrength: 0,
  specSize: 0.3,
  specColor: [1, 1, 1],
  specBand: 0,
  emission: 0,
  matcap: 1,
  noiseStrength: 0,
  noiseScale: 12,
  sparkle: 0,
  sheen: 0,
  alphaEdge: 0,
  alphaMode: 'keep',
  blush: 0,
  blushColor: [1, 0.55, 0.55],
  roughness: 0.6,
  outlineColor: null,
  outlineScale: 1,
  unlit: false,
};

export const PRESETS: Record<Exclude<LookId, 'default'>, LookParams> = {
  animeSkin: {
    ...BASE,
    rampSoftness: 0.35,
    shadowColor: [0.95, 0.72, 0.68],
    shadowSaturation: 1.3,
    rimStrength: 0.2,
    rimColor: [1, 0.92, 0.85],
    roughness: 0.7,
  },
  animeFace: {
    ...BASE,
    rampSoftness: 0.75,
    rampThreshold: -0.35,
    shadowColor: [0.98, 0.8, 0.76],
    shadowSaturation: 1.2,
    shadowStrength: 0.35,
    flatten: 0.65,
    rimStrength: 0.1,
    rimColor: [1, 0.92, 0.88],
    blush: 0,
    roughness: 0.75,
  },
  animeHair: {
    ...BASE,
    rampSoftness: 0.18,
    shadowColor: [0.62, 0.6, 0.78],
    shadowSaturation: 1.25,
    rimStrength: 0.35,
    rimPower: 2.5,
    specStrength: 0.6,
    specSize: 0.25,
    specBand: 0.8,
    specColor: [1, 0.97, 0.92],
    roughness: 0.45,
  },
  clothSmooth: {
    ...BASE,
    rampSoftness: 0.22,
    shadowColor: [0.66, 0.66, 0.8],
    rimStrength: 0.15,
    specStrength: 0.15,
    specSize: 0.45,
    roughness: 0.55,
  },
  clothRough: {
    ...BASE,
    rampSoftness: 0.4,
    shadowColor: [0.62, 0.6, 0.72],
    rimStrength: 0.1,
    noiseStrength: 0.35,
    noiseScale: 18,
    roughness: 0.9,
  },
  stockings: {
    ...BASE,
    rampSoftness: 0.3,
    shadowColor: [0.6, 0.58, 0.7],
    rimStrength: 0.15,
    sheen: 0.45,
    alphaEdge: 0.95,
    alphaMode: 'hash',
    roughness: 0.5,
  },
  metal: {
    ...BASE,
    rampSoftness: 0.12,
    shadowColor: [0.5, 0.52, 0.62],
    rimStrength: 0.45,
    rimPower: 2,
    specStrength: 1.2,
    specSize: 0.15,
    sparkle: 0.6,
    roughness: 0.25,
    toon: 0.7,
  },
  eye: {
    ...BASE,
    rampSoftness: 0.9,
    shadowStrength: 0.15,
    shadowColor: [0.9, 0.9, 0.95],
    flatten: 0.8,
    rimStrength: 0,
    emission: 0.35,
    outlineScale: 0,
  },
  flatUnlit: { ...BASE, unlit: true, rimStrength: 0, outlineScale: 1 },
};

/** A material's look: preset plus overrides of single parameters. */
export interface MaterialLook {
  look: LookId;
  params?: Partial<LookParams>;
}

export interface ModelLooks {
  /** By material name (the PMX's Japanese name, the real ID). */
  materials: Record<string, MaterialLook>;
  /** Eyes / brows draw over nearby hair. */
  seeThroughEyes: boolean;
}

export const EMPTY_MODEL_LOOKS: ModelLooks = { materials: {}, seeThroughEyes: true };

export type TierSetting = 'auto' | 'high' | 'medium' | 'low';
export type Tier = 'high' | 'medium' | 'low';

export interface NprSettings {
  tier: TierSetting;
  /** Before / after: show PMX original materials. */
  showOriginal: boolean;
  /** Global quick controls: toon (1) vs realistic (0), rim multiplier, shadow warmth. */
  toonStrength: number;
  rimStrength: number;
  /** −1 cool … +1 warm shadows. */
  shadowWarmth: number;
  outlineMode: 'hull' | 'post';
  outlineFalloff: boolean;
}

export const DEFAULT_NPR_SETTINGS: NprSettings = {
  tier: 'auto',
  showOriginal: false,
  toonStrength: 1,
  rimStrength: 1,
  shadowWarmth: 0,
  outlineMode: 'hull',
  outlineFalloff: true,
};

export const clamp = (v: number, lo: number, hi: number): number =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
const clampRgb = (c: unknown): Rgb | null =>
  Array.isArray(c) && c.length >= 3 && c.slice(0, 3).every((x) => typeof x === 'number' && Number.isFinite(x))
    ? [clamp(c[0], 0, 1), clamp(c[1], 0, 1), clamp(c[2], 0, 1)]
    : null;

/** Validate one parameter value against its spec (null = invalid). */
export function cleanParam<K extends ParamKey>(key: K, value: unknown): LookParams[K] | null {
  const spec = PARAM_SPECS[key];
  if (!spec) return null;
  switch (spec.kind) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? (clamp(value, spec.min, spec.max) as LookParams[K])
        : null;
    case 'color':
      if (key === 'outlineColor' && value === null) return null;
      return clampRgb(value) as LookParams[K] | null;
    case 'enum':
      return typeof value === 'string' && spec.options.includes(value) ? (value as LookParams[K]) : null;
    case 'bool':
      return typeof value === 'boolean' ? (value as LookParams[K]) : null;
  }
}

/** Full parameters of a material look (preset + overrides), or null for Default. */
export function resolveLook(m: MaterialLook | undefined): LookParams | null {
  if (!m || m.look === 'default' || !(m.look in PRESETS)) return null;
  const base = PRESETS[m.look as Exclude<LookId, 'default'>];
  const out: LookParams = { ...base };
  for (const [k, v] of Object.entries(m.params ?? {})) {
    if (k === 'outlineColor' && v === null) {
      out.outlineColor = null;
      continue;
    }
    const c = cleanParam(k as ParamKey, v);
    if (c !== null) (out as unknown as Record<string, unknown>)[k] = c;
  }
  return out;
}

/** Apply the global quick controls to resolved parameters. */
export function applyGlobals(p: LookParams, s: NprSettings): LookParams {
  const warm = clamp(s.shadowWarmth, -1, 1);
  const sc = p.shadowColor;
  const shadowColor: Rgb = [
    clamp(sc[0] + warm * 0.12, 0, 1),
    clamp(sc[1] + warm * 0.02, 0, 1),
    clamp(sc[2] - warm * 0.12, 0, 1),
  ];
  return {
    ...p,
    toon: clamp(p.toon * clamp(s.toonStrength, 0, 1), 0, 1),
    rimStrength: clamp(p.rimStrength * clamp(s.rimStrength, 0, 3), 0, 4),
    shadowColor,
  };
}

/** The tier in use: an explicit setting, else the viewport quality (which adaptive quality lowers on slow devices). */
export function selectTier(setting: TierSetting, viewportQuality: 'low' | 'medium' | 'high'): Tier {
  return setting === 'auto' ? viewportQuality : setting;
}

/** Shader features of a resolved look at a tier (each combination is one compiled variant). */
export interface LookFeatures {
  unlit: boolean;
  rampTexture: boolean;
  hybrid: boolean;
  rim: boolean;
  spec: boolean;
  noise: boolean;
  sparkle: boolean;
  sheen: boolean;
  blush: boolean;
  alpha: AlphaMode;
}

export function featuresFor(p: LookParams, tier: Tier): LookFeatures {
  const low = tier === 'low';
  return {
    unlit: p.unlit,
    rampTexture: p.rampMode === 'pmxToon',
    hybrid: tier === 'high' && p.toon < 0.999,
    rim: !low && p.rimStrength > 0,
    spec: !low && p.specStrength > 0,
    noise: !low && p.noiseStrength > 0,
    sparkle: tier === 'high' && p.sparkle > 0,
    sheen: !low && (p.sheen > 0 || p.alphaEdge > 0),
    blush: !low && p.blush > 0,
    alpha: low && p.alphaMode === 'hash' ? 'mask' : p.alphaMode,
  };
}

/** Rough relative fragment cost (1 = Default) for the FPS cost indicator. */
export function lookCost(f: LookFeatures): number {
  let c = 1.3;
  if (f.rim) c += 0.15;
  if (f.spec) c += 0.15;
  if (f.noise) c += 0.3;
  if (f.sparkle) c += 0.35;
  if (f.sheen) c += 0.1;
  if (f.hybrid) c += 0.5;
  if (f.alpha === 'hash') c += 0.2;
  return c;
}

export const isHeavy = (f: LookFeatures): boolean => lookCost(f) >= 1.9;

// ------------------------------------------------------------------ serialisation

export interface LooksFile {
  type: 'mmd-studio-looks';
  version: 1;
  model?: string;
  looks: ModelLooks;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function cleanMaterialLook(v: unknown): MaterialLook | null {
  if (!isObj(v) || typeof v.look !== 'string' || !(LOOK_IDS as readonly string[]).includes(v.look))
    return null;
  const out: MaterialLook = { look: v.look as LookId };
  if (isObj(v.params)) {
    const params: Partial<LookParams> = {};
    for (const [k, val] of Object.entries(v.params)) {
      if (!(k in PARAM_SPECS)) continue;
      if (k === 'outlineColor' && val === null) {
        params.outlineColor = null;
        continue;
      }
      const c = cleanParam(k as ParamKey, val);
      if (c !== null) (params as Record<string, unknown>)[k] = c;
    }
    if (Object.keys(params).length) out.params = params;
  }
  return out;
}

export function cleanModelLooks(v: unknown): ModelLooks | null {
  if (!isObj(v) || !isObj(v.materials)) return null;
  const materials: Record<string, MaterialLook> = {};
  for (const [name, m] of Object.entries(v.materials)) {
    const c = cleanMaterialLook(m);
    if (c) materials[name] = c;
  }
  return { materials, seeThroughEyes: v.seeThroughEyes !== false };
}

export function cleanSettings(v: unknown): NprSettings {
  const s = isObj(v) ? v : {};
  const n = (k: keyof NprSettings, lo: number, hi: number): number =>
    typeof s[k] === 'number' ? clamp(s[k] as number, lo, hi) : (DEFAULT_NPR_SETTINGS[k] as number);
  return {
    tier: ['auto', 'high', 'medium', 'low'].includes(s.tier as string) ? (s.tier as TierSetting) : 'auto',
    showOriginal: s.showOriginal === true,
    toonStrength: n('toonStrength', 0, 1),
    rimStrength: n('rimStrength', 0, 3),
    shadowWarmth: n('shadowWarmth', -1, 1),
    outlineMode: s.outlineMode === 'post' ? 'post' : 'hull',
    outlineFalloff: s.outlineFalloff !== false,
  };
}

export const looksToJson = (looks: ModelLooks, model?: string): string =>
  JSON.stringify({ type: 'mmd-studio-looks', version: 1, model, looks } satisfies LooksFile, null, 2);

export function looksFromJson(text: string): ModelLooks {
  const json = JSON.parse(text) as unknown;
  if (!isObj(json) || json.type !== 'mmd-studio-looks') throw new Error('Not an MMD Studio looks file');
  const looks = cleanModelLooks(json.looks);
  if (!looks) throw new Error('The looks file has no materials');
  return looks;
}
