// Fingers: joint angles from the 21 hand landmarks, retargeted onto MMD finger bones (親指０–２, 人指１–３,
// 中指１–３, 薬指１–３, 小指１–３) of the loaded PMX, with limits, cleaning, dropout handling and presets.
import { oneEuroSeries } from '@/engine/video2vmd/oneEuro';
import {
  QI,
  axisAngle,
  cross,
  dot,
  length,
  normalize,
  qmul,
  scale,
  sub,
  type Quat,
  type Vec3,
} from '@/lib/math3d';
import { HAND_PRESETS, cloneHandPose, lerpHandPose, type HandPose, type HandPresetId } from './handPose';
import { FINGERS, HAND, type Finger, type HandObs, type HandSettings } from './types';

const DEG = Math.PI / 180;

export type Side = 'left' | 'right';

/** Hand world points (MediaPipe axes) → MMD axes; mirrored videos also reflect X. */
export function handPointsMmd(world: ArrayLike<number>, mirror: boolean): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < 21; i++)
    out.push([world[i * 3] * (mirror ? -1 : 1), -world[i * 3 + 1], world[i * 3 + 2]]);
  return out;
}

/** Palm frame: h = wrist → middle MCP, a = thumb side (orthogonalised), n = palm normal. */
export function palmFrame(p: Vec3[], side: Side): { h: Vec3; a: Vec3; n: Vec3 } {
  const h = normalize(sub(p[HAND.middleMcp], p[HAND.wrist]));
  const across = sub(p[HAND.indexMcp], p[HAND.pinkyMcp]);
  const a = normalize(sub(across, scale(h, dot(across, h))), [0, 0, -1]);
  const n = normalize(side === 'left' ? cross(a, h) : cross(h, a));
  return { h, a, n };
}

/** Signed angle from u to v about `axis` (degrees). */
function signedAngle(u: Vec3, v: Vec3, axis: Vec3): number {
  const c = cross(u, v);
  return Math.atan2(dot(c, axis), dot(u, v)) / DEG;
}

/** Joint angles (degrees) of one hand. Rotation invariant; needs only the hand's own points. */
export function measureHand(p: Vec3[], side: Side): HandPose {
  const { h, a, n } = palmFrame(p, side);
  const pose = {} as HandPose;
  for (const f of ['index', 'middle', 'ring', 'little'] as const) {
    const base = { index: 5, middle: 9, ring: 13, little: 17 }[f];
    const m = normalize(sub(p[base], p[HAND.wrist]));
    const s1 = normalize(sub(p[base + 1], p[base]));
    const s2 = normalize(sub(p[base + 2], p[base + 1]));
    const s3 = normalize(sub(p[base + 3], p[base + 2]));
    const k = normalize(cross(m, n));
    const spreadRaw = signedAngle(m, s1, n);
    pose[f] = {
      flex: [signedAngle(m, s1, k), signedAngle(s1, s2, k), signedAngle(s2, s3, k)],
      spread: side === 'left' ? -spreadRaw : spreadRaw,
    };
  }
  const base = normalize([h[0] + a[0] * 0.9, h[1] + a[1] * 0.9, h[2] + a[2] * 0.9]);
  const meta = normalize(sub(p[HAND.thumbMcp], p[HAND.thumbCmc]));
  const t1 = normalize(sub(p[HAND.thumbIp], p[HAND.thumbMcp]));
  const t2 = normalize(sub(p[HAND.thumbTip], p[HAND.thumbIp]));
  const kt = normalize(cross(meta, n));
  pose.thumb = {
    flex: [
      Math.atan2(dot(meta, n), dot(meta, base)) / DEG,
      signedAngle(meta, t1, kt),
      signedAngle(t1, t2, kt),
    ],
    spread: 0,
  };
  return pose;
}

/** Anatomical limits (degrees) per joint: [min, max]. */
export const LIMITS = {
  finger: [
    [-15, 95],
    [0, 110],
    [0, 90],
  ] as [number, number][],
  thumb: [
    [-10, 60],
    [-10, 80],
    [-10, 80],
  ] as [number, number][],
  spread: [-20, 20] as [number, number],
};

const limitsOf = (f: Finger) => (f === 'thumb' ? LIMITS.thumb : LIMITS.finger);

export function clampPose(p: HandPose): HandPose {
  const out = cloneHandPose(p);
  for (const f of FINGERS) {
    const lim = limitsOf(f);
    out[f].flex = out[f].flex.map((v, i) => Math.min(lim[i][1], Math.max(lim[i][0], v))) as [
      number,
      number,
      number,
    ];
    out[f].spread = Math.min(LIMITS.spread[1], Math.max(LIMITS.spread[0], out[f].spread));
  }
  return out;
}

/** Physically impossible measurements (far outside the limits): the frame is treated as a dropout. */
export function isImpossible(p: HandPose, margin = 30): boolean {
  return FINGERS.some((f) =>
    p[f].flex.some((v, i) => v < limitsOf(f)[i][0] - margin || v > limitsOf(f)[i][1] + margin),
  );
}

const poseVector = (p: HandPose): number[] => FINGERS.flatMap((f) => [...p[f].flex, p[f].spread * 0.5]);

/** Nearest preset (weighted L2 on joint angles). */
export function classifyHand(p: HandPose): { id: HandPresetId; distance: number } {
  const v = poseVector(p);
  let best: HandPresetId = 'relaxed';
  let bestD = Infinity;
  for (const id of Object.keys(HAND_PRESETS) as HandPresetId[]) {
    const w = poseVector(HAND_PRESETS[id]);
    const d = Math.sqrt(v.reduce((s, x, i) => s + (x - w[i]) ** 2, 0) / v.length);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return { id: best, distance: bestD };
}

// ------------------------------------------------------------------------------------ rig axes

export const FINGER_BONES: Record<Finger, [string, string, string]> = {
  thumb: ['親指０', '親指１', '親指２'],
  index: ['人指１', '人指２', '人指３'],
  middle: ['中指１', '中指２', '中指３'],
  ring: ['薬指１', '薬指２', '薬指３'],
  little: ['小指１', '小指２', '小指３'],
};
const TIP_BONES: Record<Finger, string[]> = {
  thumb: ['親指先'],
  index: ['人指先'],
  middle: ['中指先'],
  ring: ['薬指先'],
  little: ['小指先'],
};

export interface RigBone {
  name: string;
  parent: number;
  position: Vec3;
}

export interface FingerRig {
  side: Side;
  /** For each finger: per-joint bone name (null when the model lacks it) + bend axis. */
  joints: Record<Finger, { bone: string | null; axis: Vec3 }[]>;
  /** Palm normal in model space. */
  n: Vec3;
  /** Spread axis = palm normal. */
  thumbRestOpposition: number;
}

const mmdPrefix = (s: Side): string => (s === 'left' ? '左' : '右');

/** Bend axes of a model's finger bones (MMD bones have no rest rotation: axes live in model space). */
export function fingerRig(bones: RigBone[], side: Side): FingerRig | null {
  const P = mmdPrefix(side);
  const pos = new Map<string, Vec3>(bones.map((b) => [b.name, b.position]));
  const wrist = pos.get(`${P}手首`);
  const mid1 = pos.get(`${P}中指１`);
  const idx1 = pos.get(`${P}人指１`);
  const lit1 = pos.get(`${P}小指１`) ?? pos.get(`${P}薬指１`);
  if (!wrist || !mid1 || !idx1 || !lit1) return null;
  const h = normalize(sub(mid1, wrist));
  const across = sub(idx1, lit1);
  const a = normalize(sub(across, scale(h, dot(across, h))), [0, 0, -1]);
  const n = normalize(side === 'left' ? cross(a, h) : cross(h, a));
  const joints = {} as FingerRig['joints'];
  for (const f of FINGERS) {
    const names = FINGER_BONES[f].map((b) => `${P}${b}`);
    const tip = TIP_BONES[f].map((b) => `${P}${b}`).find((b) => pos.has(b));
    joints[f] = names.map((name, i) => {
      const here = pos.get(name);
      const next = pos.get(names[i + 1] ?? '') ?? (tip ? pos.get(tip) : undefined);
      const prev = i > 0 ? pos.get(names[i - 1]) : undefined;
      const dir =
        here && next && length(sub(next, here)) > 1e-6
          ? normalize(sub(next, here))
          : here && prev
            ? normalize(sub(here, prev))
            : h;
      return { bone: here ? name : null, axis: normalize(cross(dir, n), [0, 0, 1]) };
    });
  }
  // How far the model's thumb already leans toward the palm at rest.
  const t0 = pos.get(`${P}親指０`);
  const t1 = pos.get(`${P}親指１`);
  const base = normalize([h[0] + a[0] * 0.9, h[1] + a[1] * 0.9, h[2] + a[2] * 0.9]);
  const meta = t0 && t1 ? normalize(sub(t1, t0)) : base;
  return { side, joints, n, thumbRestOpposition: Math.atan2(dot(meta, n), dot(meta, base)) / DEG };
}

/** Human "relaxed" thumb opposition, subtracted so a model's rest thumb maps to a relaxed hand. */
const THUMB_REST = 15;

/** Local rotations of the finger bones for a pose. */
export function fingerRotations(rig: FingerRig, pose: HandPose): Map<string, Quat> {
  const out = new Map<string, Quat>();
  const p = clampPose(pose);
  for (const f of FINGERS) {
    rig.joints[f].forEach((j, i) => {
      if (!j.bone) return;
      let angle = p[f].flex[i];
      if (f === 'thumb' && i === 0) angle = Math.max(-20, Math.min(50, angle - THUMB_REST));
      let q = axisAngle(j.axis, angle * DEG);
      if (i === 0 && f !== 'thumb' && p[f].spread) {
        const s = p[f].spread * DEG * (rig.side === 'left' ? -1 : 1);
        q = qmul(axisAngle(rig.n, s), q);
      }
      out.set(j.bone, q);
    });
  }
  return out;
}

// --------------------------------------------------------------------------------- sequences

export interface FingerTrackResult {
  /** Per output frame per side: the cleaned pose (null when the model has no fingers). */
  poses: [HandPose[], HandPose[]];
  /** Output frames with a real detection, per side. */
  detected: [boolean[], boolean[]];
  /** Classified preset per output frame per side. */
  presets: [HandPresetId[], HandPresetId[]];
  /** Fraction detected per side. */
  coverage: [number, number];
  /** Frames rejected as impossible, per side. */
  rejected: [number, number];
  /** Handedness labels agreeing with the body side (−1 = no labels). */
  labelAgreement: number;
}

export interface HandInputFrame {
  time: number;
  hands?: [HandObs | null, HandObs | null] | null;
}

/** Hand bone-length signature (wrist → MCP and finger segments) for outlier checks. */
const SEGS: [number, number][] = [
  [0, 5],
  [0, 9],
  [0, 17],
  [5, 6],
  [9, 10],
  [13, 14],
  [17, 18],
];

/**
 * Per-source-frame hand observations → cleaned poses at the output times. Output side 0 = the dancer's left
 * (MMD 左). The source crop index comes from the body: unmirrored left = pose landmark 15 (index 0).
 */
export function computeFingerTracks(
  frames: HandInputFrame[],
  times: number[],
  settings: HandSettings,
  o: { mirror: boolean; fps: number },
): FingerTrackResult {
  const n = times.length;
  const srcTimes = frames.map((f) => f.time);
  const relaxed = HAND_PRESETS.relaxed;
  const result: FingerTrackResult = {
    poses: [[], []],
    detected: [[], []],
    presets: [[], []],
    coverage: [0, 0],
    rejected: [0, 0],
    labelAgreement: -1,
  };
  let agree = 0;
  let labelled = 0;
  for (const s of [0, 1] as const) {
    const side: Side = s === 0 ? 'left' : 'right';
    const src = o.mirror ? 1 - s : s;
    // Measure each source frame.
    const meas: (HandPose | null)[] = frames.map((f) => {
      const h = f.hands?.[src];
      if (!h || h.world.length < 63 || h.score < 0.3) return null;
      if (h.handedness) {
        labelled++;
        // MediaPipe labels as if mirrored: an unmirrored left hand (crop 0) reads "Right".
        if ((h.handedness === 'Right') === (src === 0)) agree++;
      }
      return measureHand(handPointsMmd(h.world, o.mirror), side);
    });
    const conf = frames.map((f) => f.hands?.[src]?.score ?? 0);
    // Bone-length outliers.
    const pts = frames.map((f) => {
      const h = f.hands?.[src];
      return h && h.world.length >= 63 ? handPointsMmd(h.world, false) : null;
    });
    const med = SEGS.map(([a, b]) => {
      const v = pts
        .filter((p): p is Vec3[] => !!p)
        .map((p) => length(sub(p[a], p[b])))
        .sort((x, y) => x - y);
      return v[v.length >> 1] ?? 0;
    });
    let rejected = 0;
    meas.forEach((m, i) => {
      if (!m) return;
      const p = pts[i]!;
      const badLen = SEGS.some(
        ([a, b], k) => med[k] > 0 && Math.abs(length(sub(p[a], p[b])) - med[k]) / med[k] > 0.4,
      );
      if (badLen || isImpossible(m)) {
        meas[i] = null;
        rejected++;
      }
    });
    result.rejected[s] = rejected;

    // Resample to output times (nearest valid within half a frame, else linear between neighbours).
    const outPose: (HandPose | null)[] = [];
    const outConf: number[] = [];
    for (const t of times) {
      let i = 0;
      while (i + 1 < srcTimes.length && srcTimes[i + 1] <= t) i++;
      const a = meas[i];
      const b = meas[i + 1];
      if (a && b && srcTimes[i + 1] > srcTimes[i]) {
        const u = Math.min(1, Math.max(0, (t - srcTimes[i]) / (srcTimes[i + 1] - srcTimes[i])));
        outPose.push(lerpHandPose(a, b, u));
        outConf.push(conf[i] + (conf[i + 1] - conf[i]) * u);
      } else {
        outPose.push(a ?? b ?? null);
        outConf.push(a ? conf[i] : b ? conf[i + 1] : 0);
      }
    }

    // Dropouts: hold the last pose, then ease to relaxed.
    const holdF = Math.round(settings.holdSeconds * o.fps);
    const easeF = Math.max(1, Math.round(0.5 * o.fps));
    let last: HandPose = relaxed;
    let missing = 0;
    const filled: HandPose[] = [];
    for (let f = 0; f < n; f++) {
      let p = outPose[f];
      if (p && settings.presetSnap && outConf[f] < 0.6) p = HAND_PRESETS[classifyHand(p).id];
      if (p) {
        last = p;
        missing = 0;
        filled.push(p);
      } else {
        missing++;
        const t = Math.min(1, Math.max(0, (missing - holdF) / easeF));
        filled.push(lerpHandPose(last, relaxed, t));
      }
    }
    // One Euro per joint angle.
    const smooth = cloneSeries(filled);
    for (const f of FINGERS) {
      for (let j = 0; j < 4; j++) {
        const series = smooth.map((p) => (j < 3 ? p[f].flex[j] : p[f].spread));
        const out = oneEuroSeries(series, o.fps, settings.minCutoff, settings.beta);
        out.forEach((v, k) => {
          if (j < 3) smooth[k][f].flex[j] = v;
          else smooth[k][f].spread = v;
        });
      }
    }
    result.poses[s] = smooth.map(clampPose);
    result.detected[s] = outPose.map((p) => !!p);
    result.presets[s] = result.poses[s].map((p) => classifyHand(p).id);
    result.coverage[s] = n ? result.detected[s].filter(Boolean).length / n : 0;
  }
  result.labelAgreement = labelled ? agree / labelled : -1;
  return result;
}

const cloneSeries = (s: HandPose[]): HandPose[] => s.map(cloneHandPose);

// ------------------------------------------------------------------------------ wrist refinement

/** Hand direction / thumb-side vectors (MMD axes, camera frame) for the wrist driver. */
export function handDirections(world: ArrayLike<number>, mirror: boolean): { dir: Vec3; side: Vec3 } {
  const p = handPointsMmd(world, mirror);
  return {
    dir: normalize(sub(p[HAND.middleMcp], p[HAND.wrist])),
    side: normalize(sub(p[HAND.indexMcp], p[HAND.pinkyMcp])),
  };
}

/** Swing–twist: the part of `q` that rotates about `axis` (unit). */
export function twistAbout(q: Quat, axis: Vec3): Quat {
  const d = q[0] * axis[0] + q[1] * axis[1] + q[2] * axis[2];
  const t: Quat = [axis[0] * d, axis[1] * d, axis[2] * d, q[3]];
  const len = Math.hypot(t[0], t[1], t[2], t[3]);
  return len < 1e-9 ? [...QI] : [t[0] / len, t[1] / len, t[2] / len, t[3] / len];
}

export { HAND_PRESETS, type HandPose, type HandPresetId };
