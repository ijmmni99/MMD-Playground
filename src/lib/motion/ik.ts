// IK helpers: foot pins (non-destructive overlay), ground clamp, and a pure CCD IK solver with MMD
// semantics (used by tests and analysis; the viewport uses babylon-mmd's own solver).
import {
  add,
  axisAngle,
  cross,
  dot,
  length,
  normalize,
  qconj,
  qmul,
  qnormalize,
  rotate,
  slerp,
  sub,
  type Quat,
  type Vec3,
} from '@/lib/math3d';
import { sampleBone } from './evaluate';
import { BONE_CHANNELS, linearCurves, type BoneKey, type MotionClip, type PinRange } from './types';

const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Pin weight at a frame: 1 inside the range, eased in/out over the blend frames, 0 outside. */
export function pinWeight(pin: PinRange, f: number): number {
  if (f >= pin.start && f <= pin.end) return 1;
  if (f < pin.start) return pin.blendIn > 0 ? smooth(1 - (pin.start - f) / (pin.blendIn + 1)) : 0;
  return pin.blendOut > 0 ? smooth(1 - (f - pin.end) / (pin.blendOut + 1)) : 0;
}

/**
 * Apply pin ranges to IK bone tracks: inside a pin the IK target is held at its value on the start frame
 * (position and rotation), blended in and out, and IK translation Y is clamped ≥ 0 so a foot can't sink
 * below its rest (floor) height. Keys under a pin are rewritten densely; keys outside are untouched,
 * with boundary keys added so neighbouring motion keeps its values.
 */
export function applyPins(
  clip: MotionClip,
  pins: readonly PinRange[],
  opts: { groundClamp?: boolean } = {},
): MotionClip {
  if (!pins.length) return clip;
  const clamp = opts.groundClamp ?? true;
  const byBone = new Map<string, PinRange[]>();
  for (const p of pins) {
    if (p.end < p.start) continue;
    const list = byBone.get(p.bone) ?? [];
    list.push(p);
    byBone.set(p.bone, list);
  }
  return {
    ...clip,
    bones: clip.bones.map((t) => {
      const list = byBone.get(t.name);
      if (!list || !t.keys.length) return t;
      const from = Math.max(0, Math.min(...list.map((p) => p.start - p.blendIn)));
      const to = Math.max(...list.map((p) => p.end + p.blendOut));
      const outside = t.keys.filter((k) => k.f < from - 1 || k.f > to + 1);
      const dense: BoneKey[] = [];
      for (let f = Math.max(0, from - 1); f <= to + 1; f++) {
        const orig = sampleBone(t.keys, f);
        let p = orig.p;
        let r = orig.r;
        for (const pin of list) {
          const w = pinWeight(pin, f);
          if (w <= 0) continue;
          const anchor = pin.anchor ?? sampleBone(t.keys, pin.start);
          p = [
            p[0] + (anchor.p[0] - p[0]) * w,
            p[1] + (anchor.p[1] - p[1]) * w,
            p[2] + (anchor.p[2] - p[2]) * w,
          ];
          r = slerp(r, anchor.r, w);
        }
        if (clamp && p[1] < 0) p = [p[0], 0, p[2]];
        dense.push({ f, p, r, ip: linearCurves(BONE_CHANNELS) });
      }
      const keys = [...outside, ...dense]
        .map((k) => (clamp && k.p[1] < 0 ? { ...k, p: [k.p[0], 0, k.p[2]] as Vec3 } : k))
        .sort((a, b) => a.f - b.f);
      return { ...t, keys };
    }),
  };
}

// ---------------------------------------------------------------- CCD IK (MMD semantics)

export interface IkLink {
  /** Rest position (model space). */
  rest: Vec3;
  /** Euler-X-only hinge with limits in radians (MMD knees: [-π, -0.5°]). */
  limitX?: [number, number];
}

export interface IkChainDef {
  /** Links from the effector's parent up to the chain root, e.g. [knee, hip]. */
  links: IkLink[];
  /** Effector (e.g. ankle) rest position. */
  effectorRest: Vec3;
  iterations: number;
  /** Max rotation per link step (radians). */
  unitAngle: number;
}

/** Forward kinematics for a chain: rotations local, applied root → effector. Returns world positions. */
export function chainPositions(
  def: IkChainDef,
  rot: Quat[],
  rootPos?: Vec3,
): { joints: Vec3[]; effector: Vec3; world: Quat[] } {
  // Order root-first.
  const links = [...def.links].reverse();
  const rots = [...rot].reverse();
  const joints: Vec3[] = [];
  const world: Quat[] = [];
  let pos = rootPos ?? links[0].rest;
  let acc: Quat = [0, 0, 0, 1];
  for (let i = 0; i < links.length; i++) {
    if (i > 0) pos = add(pos, rotate(acc, sub(links[i].rest, links[i - 1].rest)));
    acc = qnormalize(qmul(acc, rots[i]));
    joints.push(pos);
    world.push(acc);
  }
  const effector = add(pos, rotate(acc, sub(def.effectorRest, links[links.length - 1].rest)));
  return { joints: joints.reverse(), effector, world: world.reverse() };
}

/** Clamp a quaternion to an X-axis hinge within [min, max] (MMD knee behaviour). */
function clampHinge(q: Quat, [min, max]: [number, number]): Quat {
  // Project onto the X axis: angle from the quaternion's X component and W.
  let angle = 2 * Math.atan2(q[0], q[3]);
  if (angle > Math.PI) angle -= 2 * Math.PI;
  if (angle < -Math.PI) angle += 2 * Math.PI;
  return axisAngle([1, 0, 0], Math.min(max, Math.max(min, angle)));
}

/**
 * Solve a chain with cyclic coordinate descent like MMD: iterate links effector-side first, rotate each
 * toward the target (limited by unitAngle), apply hinge limits. `initial` are the starting local
 * rotations (link order). Returns local rotations in link order.
 */
export function solveIk(def: IkChainDef, target: Vec3, initial?: Quat[], rootPos?: Vec3): Quat[] {
  const n = def.links.length;
  const rot: Quat[] = initial
    ? initial.map((q) => [...q] as Quat)
    : def.links.map(() => [0, 0, 0, 1] as Quat);
  for (let it = 0; it < def.iterations; it++) {
    for (let i = 0; i < n; i++) {
      const { joints, effector, world } = chainPositions(def, rot, rootPos);
      const toEff = normalize(sub(effector, joints[i]));
      const toTgt = normalize(sub(target, joints[i]));
      const d = Math.min(1, Math.max(-1, dot(toEff, toTgt)));
      const angle = Math.min(Math.acos(d), def.unitAngle * (i + 1));
      if (angle < 1e-5) continue;
      let axis = cross(toEff, toTgt);
      if (length(axis) < 1e-8) continue;
      axis = normalize(axis);
      // World-space axis → this link's parent space (world rotation of the link without its own local).
      const parentWorld = qmul(world[i], qconj(rot[i]));
      const localAxis = rotate(qconj(parentWorld), axis);
      let next = qnormalize(qmul(axisAngle(localAxis, angle), rot[i]));
      const limit = def.links[i].limitX;
      if (limit) {
        next = clampHinge(next, limit);
        // MMD trick: a fully straight knee can't start bending; nudge it on the first iteration.
        if (it === 0 && Math.abs(2 * Math.atan2(next[0], next[3])) < 1e-3)
          next = axisAngle([1, 0, 0], limit[1]);
      }
      rot[i] = next;
    }
  }
  return rot;
}

/** Signed knee angle (radians) of an X-hinge rotation. */
export const hingeAngle = (q: Quat): number => {
  let a = 2 * Math.atan2(q[0], q[3]);
  if (a > Math.PI) a -= 2 * Math.PI;
  return a;
};

/** A synthetic MMD-proportioned leg (hip → knee → ankle), knee bending backward (negative X). */
export function syntheticLeg(): IkChainDef {
  return {
    links: [
      { rest: [1, 6, 0.2], limitX: [-Math.PI, -0.5 * (Math.PI / 180)] }, // knee
      { rest: [1, 10.6, 0.3] }, // hip (足)
    ],
    effectorRest: [1, 1.3, 0.6],
    iterations: 40,
    unitAngle: 2,
  };
}

// ---------------------------------------------------------------- IK ↔ FK writes

/** IK enabled state of `bone` at frame f from the property track (default on). */
export function ikStateAt(clip: MotionClip, bone: string, f: number): boolean {
  let state = true;
  for (const k of clip.props) {
    if (k.f > f) break;
    if (bone in k.ik) state = k.ik[bone];
  }
  return state;
}

/**
 * Set IK solvers on/off over [from, to] via the property track, restoring the previous state at to + 1.
 * Property keys inside the range keep their other bones' states.
 */
export function setIkRange(
  clip: MotionClip,
  bones: readonly string[],
  from: number,
  to: number,
  enabled: boolean,
): MotionClip {
  const props = [...clip.props].sort((a, b) => a.f - b.f);
  const stateAt = (f: number): { visible: boolean; ik: Record<string, boolean> } => {
    let visible = true;
    const ik: Record<string, boolean> = {};
    for (const k of props) {
      if (k.f > f) break;
      visible = k.visible;
      Object.assign(ik, k.ik);
    }
    return { visible, ik };
  };
  const after = stateAt(to + 1);
  const restore = Object.fromEntries(bones.map((b) => [b, after.ik[b] ?? true]));
  const startState = stateAt(from);
  const map = new Map(props.map((k) => [k.f, { ...k, ik: { ...k.ik } }]));
  const put = (
    f: number,
    base: { visible: boolean; ik: Record<string, boolean> },
    patch: Record<string, boolean>,
  ): void => {
    const cur = map.get(f) ?? { f, visible: base.visible, ik: { ...base.ik } };
    map.set(f, { ...cur, ik: { ...cur.ik, ...patch } });
  };
  const off = Object.fromEntries(bones.map((b) => [b, enabled]));
  put(from, startState, off);
  for (const k of props) if (k.f > from && k.f <= to) put(k.f, k, off);
  put(to + 1, stateAt(to + 1), restore);
  return { ...clip, props: [...map.values()].sort((a, b) => a.f - b.f) };
}

/** Replace [from, to] of bone tracks with per-frame keys (positions from the existing track if omitted). */
export function writeDenseKeys(
  clip: MotionClip,
  from: number,
  to: number,
  keys: Record<string, { f: number; p?: Vec3; r: Quat }[]>,
): MotionClip {
  const bones = clip.bones.map((t) => ({ ...t }));
  for (const [name, list] of Object.entries(keys)) {
    if (!list.length) continue;
    const i = bones.findIndex((t) => t.name === name);
    const old = i >= 0 ? bones[i].keys : [];
    const dense: BoneKey[] = list.map((k) => ({
      f: k.f,
      p: k.p ?? sampleBone(old, k.f).p,
      r: qnormalize(k.r),
      ip: linearCurves(BONE_CHANNELS),
    }));
    // Keep the value just outside the range so neighbouring segments don't change.
    const edge: BoneKey[] = [];
    for (const f of [from - 1, to + 1]) {
      if (f < 0 || !old.length || old.some((k) => k.f === f)) continue;
      const s = sampleBone(old, f);
      if (f > to && !old.some((k) => k.f > to)) continue;
      if (f < from && !old.some((k) => k.f < from)) continue;
      edge.push({ f, p: s.p, r: s.r, ip: linearCurves(BONE_CHANNELS) });
    }
    const track = {
      name,
      keys: [...old.filter((k) => k.f < from || k.f > to), ...edge, ...dense].sort((a, b) => a.f - b.f),
    };
    if (i >= 0) bones[i] = track;
    else bones.push(track);
  }
  return { ...clip, bones };
}
