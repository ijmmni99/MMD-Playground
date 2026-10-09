// Face tracking → MMD: blendshapes to morph weights (editable mapping table), blink detection with a
// minimum duration, mouth attack / release, deadzone, One Euro smoothing, graceful fade to neutral, eye
// gaze from iris landmarks, head rotation from the facial transformation matrix.
import { canonicalMorph } from '@/lib/convert/morphs';
import { oneEuroSeries } from '@/engine/video2vmd/oneEuro';
import { axisAngle, qmul, qnormalize, quatFromBasis, slerp, type Quat, type Vec3 } from '@/lib/math3d';
import {
  BLENDSHAPES,
  BLEND_INDEX,
  FACE_POINT_KEYS,
  type Blendshape,
  type FaceObs,
  type FacePoint,
  type FaceSettings,
  type MorphMapEntry,
} from './types';

const DEG = 180 / Math.PI;

// ------------------------------------------------------------------------------------------- sources

type Blend = (n: Blendshape) => number;
const avg = (a: number, b: number): number => (a + b) / 2;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export type Vowel = 'a' | 'i' | 'u' | 'e' | 'o';
export const VOWELS: Vowel[] = ['a', 'i', 'u', 'e', 'o'];

/** Vowel weights from mouth blendshapes; scaled down together when they sum above 1. */
export function vowelsFromBlend(b: Blend): Record<Vowel, number> {
  const j = b('jawOpen');
  const f = b('mouthFunnel');
  const p = b('mouthPucker');
  const s = avg(b('mouthSmileLeft'), b('mouthSmileRight'));
  const st = avg(b('mouthStretchLeft'), b('mouthStretchRight'));
  const v: Record<Vowel, number> = {
    a: j * (1 - f) * (1 - p) * (1 - st * 0.6),
    i: ((s + st) / 2) * (1 - j),
    u: p * (1 - j),
    e: st * Math.min(1, j * 2) * (1 - p),
    o: f * Math.min(1, j * 1.5),
  };
  const sum = v.a + v.i + v.u + v.e + v.o;
  if (sum > 1) for (const k of VOWELS) v[k] /= sum;
  return v;
}

/** Named expression sources (ids used in the mapping table). `bs:<name>` reads one blendshape. */
export const SOURCES: Record<string, { label: string; fn: (b: Blend) => number }> = {
  blink: { label: 'Both eyes closed', fn: (b) => Math.min(b('eyeBlinkLeft'), b('eyeBlinkRight')) },
  winkLeft: {
    label: 'Left eye only',
    fn: (b) => Math.max(0, b('eyeBlinkLeft') - Math.min(b('eyeBlinkLeft'), b('eyeBlinkRight'))),
  },
  winkRight: {
    label: 'Right eye only',
    fn: (b) => Math.max(0, b('eyeBlinkRight') - Math.min(b('eyeBlinkLeft'), b('eyeBlinkRight'))),
  },
  vowelA: { label: 'Vowel A (jawOpen…)', fn: (b) => vowelsFromBlend(b).a },
  vowelI: { label: 'Vowel I (smile, stretch)', fn: (b) => vowelsFromBlend(b).i },
  vowelU: { label: 'Vowel U (pucker)', fn: (b) => vowelsFromBlend(b).u },
  vowelE: { label: 'Vowel E (stretch + jaw)', fn: (b) => vowelsFromBlend(b).e },
  vowelO: { label: 'Vowel O (funnel + jaw)', fn: (b) => vowelsFromBlend(b).o },
  closedMouth: {
    label: 'Lips pressed (ん)',
    fn: (b) => Math.max(b('mouthPressLeft'), b('mouthPressRight'), b('mouthClose')) * (1 - b('jawOpen')),
  },
  smile: {
    label: 'Smile + cheek squint',
    fn: (b) =>
      avg(b('mouthSmileLeft'), b('mouthSmileRight')) * 0.6 +
      avg(b('cheekSquintLeft'), b('cheekSquintRight')) * 0.4,
  },
  smirk: {
    label: 'One-sided smile',
    fn: (b) => Math.abs(b('mouthSmileLeft') - b('mouthSmileRight')),
  },
  browDown: { label: 'Brows down', fn: (b) => avg(b('browDownLeft'), b('browDownRight')) },
  troubled: {
    label: 'Inner brows up',
    fn: (b) =>
      clamp01(
        b('browInnerUp') * (1 - avg(b('browOuterUpLeft'), b('browOuterUpRight'))) +
          0.3 * avg(b('browDownLeft'), b('browDownRight')),
      ),
  },
  browUp: { label: 'Outer brows up', fn: (b) => avg(b('browOuterUpLeft'), b('browOuterUpRight')) },
  eyeWide: { label: 'Eyes wide', fn: (b) => avg(b('eyeWideLeft'), b('eyeWideRight')) },
};

export function sourceValue(id: string, b: Blend): number {
  if (id.startsWith('bs:')) {
    const i = BLEND_INDEX[id.slice(3) as Blendshape];
    return i === undefined ? 0 : b(id.slice(3) as Blendshape);
  }
  return SOURCES[id]?.fn(b) ?? 0;
}

export const sourceLabel = (id: string): string =>
  id.startsWith('bs:') ? id.slice(3) : (SOURCES[id]?.label ?? id);

/** All selectable sources for the mapping table. */
export const SOURCE_IDS: string[] = [...Object.keys(SOURCES), ...BLENDSHAPES.slice(1).map((n) => `bs:${n}`)];

const entry = (
  morph: string,
  source: string,
  group: MorphMapEntry['group'],
  gain = 1,
  enabled = true,
): MorphMapEntry => ({ morph, source, gain, offset: 0, enabled, group });

export const DEFAULT_MORPH_MAP: MorphMapEntry[] = [
  entry('まばたき', 'blink', 'eye', 1.1),
  entry('ウィンク', 'winkLeft', 'eye', 1.1),
  entry('ウィンク右', 'winkRight', 'eye', 1.1),
  entry('びっくり', 'eyeWide', 'eye'),
  entry('あ', 'vowelA', 'mouth'),
  entry('い', 'vowelI', 'mouth'),
  entry('う', 'vowelU', 'mouth'),
  entry('え', 'vowelE', 'mouth'),
  entry('お', 'vowelO', 'mouth'),
  entry('ん', 'closedMouth', 'mouth', 0.8),
  entry('笑い', 'smile', 'eye'),
  entry('にやり', 'smirk', 'mouth', 0.8),
  entry('怒り', 'browDown', 'brow'),
  entry('困る', 'troubled', 'brow'),
  entry('上', 'browUp', 'brow'),
  entry('ぷくー', 'bs:cheekPuff', 'other', 1, false),
  entry('口角上げ', 'bs:mouthUpperUpLeft', 'other', 1, false),
  entry('下', 'bs:browDownLeft', 'other', 1, false),
];

/** Blink-like sources get the pulse treatment (hysteresis + minimum duration). */
const BLINK_SOURCES = new Set(['blink', 'winkLeft', 'winkRight']);

export const DEFAULT_FACE_SETTINGS: FaceSettings = {
  map: DEFAULT_MORPH_MAP,
  minCutoff: 1.5,
  beta: 0.4,
  deadzone: 0.05,
  attack: 0.03,
  release: 0.09,
  minBlinkFrames: 3,
  reduceTolerance: 0.02,
  eyes: true,
  headBlend: 0.7,
  lipSync: false,
};

// ------------------------------------------------------------------------------- name resolution

const EXTRA_ALIASES: Record<string, string[]> = {
  上: ['上', '眉上'],
  下: ['下', '眉下'],
  ん: ['ん', 'n'],
  にやり: ['にやり', 'にやり２', 'にやり2'],
  びっくり: ['びっくり', '驚き'],
  ぷくー: ['ぷくー', 'ぷく'],
};

/**
 * Model morph to write for each mapping entry: the exact name, else a synonym (瞬き → まばたき, blink,
 * Fcl_EYE_Close…). `modelMorphs` null = no model loaded: write the standard names.
 */
export function resolveMorphs(
  map: MorphMapEntry[],
  modelMorphs: string[] | null,
): { entry: MorphMapEntry; name: string | null }[] {
  return map.map((e) => {
    if (!modelMorphs) return { entry: e, name: e.morph };
    if (modelMorphs.includes(e.morph)) return { entry: e, name: e.morph };
    const alias = EXTRA_ALIASES[e.morph]?.find((a) => modelMorphs.includes(a));
    if (alias) return { entry: e, name: alias };
    const syn = modelMorphs.find((m) => canonicalMorph(m) === e.morph);
    return { entry: e, name: syn ?? null };
  });
}

// ------------------------------------------------------------------------------------- helpers

/** Swap Left / Right blendshapes (mirrored video). */
export function mirrorBlend(blend: number[]): number[] {
  const out = blend.slice();
  BLENDSHAPES.forEach((n, i) => {
    const other = n.endsWith('Left')
      ? n.slice(0, -4) + 'Right'
      : n.endsWith('Right')
        ? n.slice(0, -5) + 'Left'
        : null;
    if (other && BLEND_INDEX[other as Blendshape] !== undefined)
      out[i] = blend[BLEND_INDEX[other as Blendshape]];
  });
  return out;
}

/** Blink intervals (seconds) by hysteresis on an eyelid series. */
export function detectBlinks(
  times: number[],
  values: (number | null)[],
  hi = 0.55,
  lo = 0.35,
): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i < times.length; i++) {
    const v = values[i];
    if (v === null) continue;
    if (start < 0 && v >= hi) start = i;
    else if (start >= 0 && v < lo) {
      out.push([times[start], times[i - 1] ?? times[start]]);
      start = -1;
    }
  }
  if (start >= 0) out.push([times[start], times[times.length - 1]]);
  return out;
}

/**
 * Pulse series at the output frame times for blink intervals, each held at least `minFrames` frames
 * (centred on the blink), with a half-height frame on either side.
 */
export function blinkPulse(
  intervals: [number, number][],
  times: number[],
  fps: number,
  minFrames: number,
): number[] {
  const out = times.map(() => 0);
  const dt = 1 / fps;
  for (const [a, b] of intervals) {
    const minDur = (minFrames - 1) * dt;
    let s = a;
    let e = b;
    if (e - s < minDur) {
      const c = (s + e) / 2;
      s = c - minDur / 2;
      e = c + minDur / 2;
    }
    // Frames whose time lies in [s − dt/2, e + dt/2] are fully closed.
    times.forEach((t, f) => {
      if (t >= s - dt / 2 - 1e-9 && t <= e + dt / 2 + 1e-9) out[f] = 1;
    });
  }
  // Ramp frames.
  const ramp = out.slice();
  for (let f = 0; f < out.length; f++) {
    if (out[f] < 1 && ((out[f - 1] ?? 0) === 1 || (out[f + 1] ?? 0) === 1)) ramp[f] = 0.5;
  }
  return ramp;
}

/** One-pole smoothing with separate rise (attack) and fall (release) time constants (seconds). */
export function attackRelease(values: number[], fps: number, attack: number, release: number): number[] {
  const out: number[] = [];
  let y = values[0] ?? 0;
  const ka = 1 - Math.exp(-1 / (fps * Math.max(1e-3, attack)));
  const kr = 1 - Math.exp(-1 / (fps * Math.max(1e-3, release)));
  for (const v of values) {
    y += (v - y) * (v > y ? ka : kr);
    out.push(y);
  }
  return out;
}

export const applyDeadzone = (v: number, dz: number): number => (v <= dz ? 0 : (v - dz) / (1 - dz));

/** Douglas–Peucker on a 1D curve sampled every frame: indices of the keys to keep. */
export function reduceCurve(values: number[], tolerance: number): number[] {
  const n = values.length;
  if (n <= 2 || tolerance <= 0) return values.map((_, i) => i);
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let wi = -1;
    for (let i = a + 1; i < b; i++) {
      const lin = values[a] + ((values[b] - values[a]) * (i - a)) / (b - a);
      const d = Math.abs(values[i] - lin);
      if (d > worst) {
        worst = d;
        wi = i;
      }
    }
    if (worst > tolerance) {
      keep[wi] = 1;
      stack.push([a, wi], [wi, b]);
    }
  }
  const out: number[] = [];
  keep.forEach((k, i) => k && out.push(i));
  return out;
}

const pointOf = (f: FaceObs, k: FacePoint): [number, number] => {
  const i = FACE_POINT_KEYS.indexOf(k) * 2;
  return [f.points[i], f.points[i + 1]];
};

/**
 * Gaze from the iris position inside each eye: [yaw toward the dancer's left (+X), pitch up], degrees.
 * Image coordinates are in the analysed area (aspect matters), so pass its pixel size.
 */
export function gazeFromPoints(f: FaceObs, size: [number, number], mirror: boolean): [number, number] {
  const px = (k: FacePoint): [number, number] => {
    const [x, y] = pointOf(f, k);
    return [x * size[0], y * size[1]];
  };
  const one = (
    outer: FacePoint,
    inner: FacePoint,
    iris: FacePoint,
    rightToLeft: 1 | -1,
  ): [number, number] => {
    const o = px(outer);
    const n = px(inner);
    const c: [number, number] = [(o[0] + n[0]) / 2, (o[1] + n[1]) / 2];
    // Unit vector from the dancer's right to left across the eye (image right when unmirrored).
    let dx = (n[0] - o[0]) * rightToLeft;
    let dy = (n[1] - o[1]) * rightToLeft;
    const half = Math.hypot(dx, dy) / 2 || 1;
    dx /= half * 2;
    dy /= half * 2;
    const ir = px(iris);
    const rx = ir[0] - c[0];
    const ry = ir[1] - c[1];
    const u = (rx * dx + ry * dy) / half;
    // Perpendicular pointing down the image.
    const v = (rx * -dy + ry * dx) / (half * 0.4);
    return [u * 25, -v * 20];
  };
  const a = one('aOuter', 'aInner', 'aIris', 1);
  const b = one('bOuter', 'bInner', 'bIris', -1);
  const yaw = (a[0] + b[0]) / 2;
  return [mirror ? -yaw : yaw, (a[1] + b[1]) / 2];
}

/**
 * Head rotation (MMD world, left-handed) from MediaPipe's facial transformation matrix (camera space,
 * right-handed, z toward the viewer): R_mmd = S·R·S with S = diag(1, 1, −1), then into the world frame of
 * a camera at `camYawDeg`. Mirroring reflects X.
 */
export function headFromMatrix(m: number[], camYawDeg = 0, mirror = false): Quat {
  const col = (c: number): Vec3 => {
    const v: Vec3 = [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];
    const len = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / len, v[1] / len, v[2] / len];
  };
  const sx = mirror ? -1 : 1;
  // Conjugate by S (and the mirror reflection M = diag(−1, 1, 1)): entry (i, j) is scaled by s_i·s_j.
  const s: Vec3 = [sx, 1, -1];
  const c = [col(0), col(1), col(2)];
  const e = [0, 1, 2].map((j) => [0, 1, 2].map((i) => c[j][i] * s[i] * s[j]) as Vec3);
  const local = quatFromBasis(e[0], e[1], e[2]);
  if (!camYawDeg) return local;
  // World = R_y(θ) · local; R_y(θ) (camera.ts) is a rotation by −θ about +Y.
  return qnormalize(qmul(axisAngle([0, 1, 0], (-camYawDeg * Math.PI) / 180), local));
}

// --------------------------------------------------------------------------------- main entry

export interface FaceInputFrame {
  time: number;
  face?: FaceObs | null;
}

export interface FaceTrackResult {
  /** Morph weights per output frame, keyed by the model morph name. */
  morphs: Map<string, number[]>;
  /** Morph keys after reduction: name → frame indices kept. */
  keyFrames: Map<string, number[]>;
  /** Mapping entries whose morph the model lacks. */
  missing: string[];
  /** Gaze per output frame (degrees): [yaw +X, pitch up]. */
  gaze: [number, number][];
  /** Head rotation from the face per output frame with its blend weight (0 = use the body). */
  head: { q: Quat; w: number }[];
  /** Fraction of output frames with a confident face. */
  detected: number;
  /** Output frames with a face (for reports). */
  present: boolean[];
}

export interface FaceTrackOptions {
  mirror: boolean;
  /** Morph names of the target model (null = standard names). */
  modelMorphs: string[] | null;
  /** Analysed area pixel size (aspect for gaze). */
  size: [number, number];
  fps: number;
  /** Camera yaw of the view the face came from (two-view fusion picks per frame). */
  camYawDeg?: number | ((frame: number) => number);
  /** Lip-sync vowels per output frame (replace the video's mouth shapes when given). */
  lipSync?: Record<Vowel, number[]> | null;
}

const VOWEL_SOURCE: Record<string, Vowel> = {
  vowelA: 'a',
  vowelI: 'i',
  vowelU: 'u',
  vowelE: 'e',
  vowelO: 'o',
};

/** Turn per-source-frame face observations into per-output-frame morph weights, gaze and head rotation. */
export function computeFaceTracks(
  frames: FaceInputFrame[],
  times: number[],
  settings: FaceSettings,
  o: FaceTrackOptions,
): FaceTrackResult {
  const n = times.length;
  const srcTimes = frames.map((f) => f.time);
  const valid = frames.map((f) => !!f.face && f.face.score >= 0.5);
  const blends = frames.map((f, i) =>
    valid[i] ? (o.mirror ? mirrorBlend(f.face!.blend) : f.face!.blend) : null,
  );

  // Nearest / interpolated source frames for each output time.
  const sample = <T>(series: (T | null)[], lerp: (a: T, b: T, t: number) => T): (T | null)[] =>
    times.map((t) => {
      let i = 0;
      while (i + 1 < srcTimes.length && srcTimes[i + 1] <= t) i++;
      const a = series[i];
      const b = series[i + 1];
      if (a !== null && a !== undefined && b !== null && b !== undefined && srcTimes[i + 1] > srcTimes[i]) {
        return lerp(a, b, Math.min(1, Math.max(0, (t - srcTimes[i]) / (srcTimes[i + 1] - srcTimes[i]))));
      }
      return a ?? b ?? null;
    });
  const lerpArr = (a: number[], b: number[], t: number): number[] => a.map((v, k) => v + (b[k] - v) * t);
  const outBlend = sample(blends, lerpArr);
  const present = outBlend.map((b) => b !== null);

  // Fade to neutral (0.3 s) while the face is missing, and back in.
  const ease: number[] = [];
  let e = present[0] ? 1 : 0;
  const step = 1 / (o.fps * 0.3);
  const held: number[][] = [];
  let last = new Array<number>(BLENDSHAPES.length).fill(0);
  for (let f = 0; f < n; f++) {
    if (present[f]) {
      e = Math.min(1, e + step);
      last = outBlend[f]!;
    } else e = Math.max(0, e - step);
    ease.push(e);
    held.push(last);
  }

  const resolved = resolveMorphs(settings.map, o.modelMorphs);
  const missing = resolved.filter((r) => r.entry.enabled && !r.name).map((r) => r.entry.morph);
  const morphs = new Map<string, number[]>();
  const keyFrames = new Map<string, number[]>();

  // Blink intervals on the source-rate series (before resampling, so short blinks survive).
  const lid = (fn: (b: Blend) => number): (number | null)[] =>
    blends.map((b) => (b ? fn((nm) => b[BLEND_INDEX[nm]]) : null));
  const blinkIntervals: Record<string, [number, number][]> = {};
  const both = detectBlinks(
    srcTimes,
    lid((b) => Math.min(b('eyeBlinkLeft'), b('eyeBlinkRight'))),
  );
  const overlaps = (iv: [number, number]): boolean => both.some(([a, b]) => iv[0] <= b && iv[1] >= a);
  blinkIntervals.blink = both;
  blinkIntervals.winkLeft = detectBlinks(
    srcTimes,
    lid((b) => b('eyeBlinkLeft')),
  ).filter((iv) => !overlaps(iv));
  blinkIntervals.winkRight = detectBlinks(
    srcTimes,
    lid((b) => b('eyeBlinkRight')),
  ).filter((iv) => !overlaps(iv));
  const anyBlink = blinkPulse(
    [...both, ...blinkIntervals.winkLeft, ...blinkIntervals.winkRight],
    times,
    o.fps,
    settings.minBlinkFrames,
  );

  for (const { entry: en, name } of resolved) {
    if (!en.enabled || !name) continue;
    const raw = held.map((b, f) => {
      const bf: Blend = (nm) => b[BLEND_INDEX[nm]];
      let v: number;
      const vowel = VOWEL_SOURCE[en.source];
      if (vowel && o.lipSync) v = o.lipSync[vowel][f] ?? 0;
      else v = sourceValue(en.source, bf);
      return applyDeadzone(clamp01(en.gain * v + en.offset), settings.deadzone);
    });
    let series: number[];
    if (BLINK_SOURCES.has(en.source)) {
      const pulse = blinkPulse(blinkIntervals[en.source], times, o.fps, settings.minBlinkFrames);
      // Partial lid closure (squints) still shows, capped below a full blink.
      const cont = oneEuroSeries(
        raw.map((v) => Math.min(v, 0.5)),
        o.fps,
        settings.minCutoff,
        settings.beta,
      );
      series = pulse.map((p, f) => Math.max(p * clamp01(en.gain), cont[f]));
    } else if (en.group === 'mouth' && !o.lipSync) {
      series = attackRelease(raw, o.fps, settings.attack, settings.release);
    } else if (en.group === 'mouth') {
      series = raw;
    } else {
      series = oneEuroSeries(raw, o.fps, settings.minCutoff, settings.beta);
    }
    // Vowels from lip-sync are not faded with the face (the audio is always there).
    const fade = VOWEL_SOURCE[en.source] && o.lipSync ? null : ease;
    const final = series.map((v, f) => clamp01(v * (fade ? fade[f] : 1)));
    const prev = morphs.get(name);
    morphs.set(name, prev ? prev.map((v, f) => Math.max(v, final[f])) : final);
  }
  for (const [name, series] of morphs) keyFrames.set(name, reduceCurve(series, settings.reduceTolerance));

  // Gaze: per source frame, then resampled, rest-gaze removed, clamped, frozen during blinks.
  const rawGaze = frames.map((f, i) => (valid[i] ? gazeFromPoints(f.face!, o.size, o.mirror) : null));
  const outGaze = sample(
    rawGaze,
    (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] as [number, number],
  );
  const med = (k: 0 | 1): number => {
    const v = outGaze
      .filter((g): g is [number, number] => !!g)
      .map((g) => g[k])
      .sort((a, b) => a - b);
    return v[v.length >> 1] ?? 0;
  };
  const m0 = med(0);
  const m1 = med(1);
  let lastG: [number, number] = [0, 0];
  const gzY: number[] = [];
  const gzP: number[] = [];
  for (let f = 0; f < n; f++) {
    const g = outGaze[f];
    if (g && anyBlink[f] < 0.5)
      lastG = [Math.max(-20, Math.min(20, g[0] - m0)), Math.max(-15, Math.min(15, g[1] - m1))];
    gzY.push(lastG[0] * ease[f]);
    gzP.push(lastG[1] * ease[f]);
  }
  const sy = oneEuroSeries(gzY, o.fps, settings.minCutoff, settings.beta);
  const sp = oneEuroSeries(gzP, o.fps, settings.minCutoff, settings.beta);
  const gaze = sy.map((y, f): [number, number] => [y, sp[f]]);

  // Head rotation from the face matrix, weighted by confidence.
  const camYaw = (f: number): number =>
    typeof o.camYawDeg === 'function' ? o.camYawDeg(f) : (o.camYawDeg ?? 0);
  const rawHead = frames.map((fr, i) => (valid[i] ? fr.face! : null));
  const outFace = sample(rawHead, (a, b, t) => (t < 0.5 ? a : b));
  let lastQ: Quat = [0, 0, 0, 1];
  const head = outFace.map((fo, f) => {
    if (fo) lastQ = headFromMatrix(fo.matrix, camYaw(f), o.mirror);
    return { q: lastQ, w: settings.headBlend * ease[f] * (fo ? Math.min(1, fo.score) : 0.5) };
  });
  // Light temporal smoothing of the head quaternion (zero-lag forward / backward slerp).
  for (let f = 1; f < n; f++) head[f].q = slerp(head[f - 1].q, head[f].q, 0.6);
  for (let f = n - 2; f >= 0; f--) head[f].q = slerp(head[f + 1].q, head[f].q, 0.6);

  return {
    morphs,
    keyFrames,
    missing,
    gaze,
    head,
    detected: n ? present.filter(Boolean).length / n : 0,
    present,
  };
}

/** Eye bone yaw / pitch (degrees) → local rotation; yaw toward +X, pitch up. */
export function eyeRotation(yawDeg: number, pitchDeg: number): Quat {
  // Gaze direction in the head frame (forward = −Z) and the shortest rotation onto it.
  const d: Vec3 = [Math.tan(yawDeg / DEG), Math.tan(pitchDeg / DEG), -1];
  const len = Math.hypot(d[0], d[1], d[2]);
  const nd: Vec3 = [d[0] / len, d[1] / len, d[2] / len];
  // fromTo([0,0,−1], nd)
  const a: Vec3 = [0, 0, -1];
  const c: Vec3 = [a[1] * nd[2] - a[2] * nd[1], a[2] * nd[0] - a[0] * nd[2], a[0] * nd[1] - a[1] * nd[0]];
  const w = 1 + (a[0] * nd[0] + a[1] * nd[1] + a[2] * nd[2]);
  return qnormalize([c[0], c[1], c[2], w]);
}
