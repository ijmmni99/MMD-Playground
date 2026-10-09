// Body proportion sliders. Each part (head, upper arm, hand, fingers, thigh…) is one or more *segments*: a
// root bone (the pivot) and an axis (root → next joint). A segment scales the vertices weighted to its bones
// along the axis (length), across it (thickness) and on all axes (overall). Segments downstream move rigidly
// with their parent's end, so chains stay connected; each vertex blends its segments by weight, so joints
// have no seams. Bones, IK targets, rigid bodies, joints, morph offsets and edge scale follow, and the
// feet stay on the floor.

import type { PmxModel, V3 } from '@/lib/convert/pmx/types';
import { boneIndex } from './refs';

export type Side = 'L' | 'R';
export type PartId =
  | 'whole'
  | 'head'
  | 'neck'
  | 'torso'
  | 'chest'
  | 'hips'
  | `upperArm${Side}`
  | `lowerArm${Side}`
  | `hand${Side}`
  | `fingers${Side}`
  | `upperLeg${Side}`
  | `lowerLeg${Side}`
  | `foot${Side}`;

export interface PartScale {
  overall: number;
  length: number;
  thickness: number;
}

export interface ProportionState {
  parts: Partial<Record<PartId, PartScale>>;
  /** Shift the model so the lowest point stays at its original height (default true). */
  keepFeet?: boolean;
}

export const IDENTITY: PartScale = { overall: 1, length: 1, thickness: 1 };
export const SCALE_MIN = 0.5;
export const SCALE_MAX = 2;
const HARD_MIN = 0.1;
const HARD_MAX = 5;

interface PartDef {
  id: PartId;
  label: string;
  /** Root bone names (first existing one per entry wins). */
  roots: string[][];
  /** Axis end: a bone name, or a fixed direction. */
  end?: string[] | V3;
}

const sided = (s: Side): PartDef[] => {
  const J = s === 'L' ? '左' : '右';
  const side = s === 'L' ? 'left' : 'right';
  return [
    { id: `upperArm${s}`, label: `Upper arm (${side})`, roots: [[`${J}腕`]], end: [`${J}ひじ`] },
    { id: `lowerArm${s}`, label: `Forearm (${side})`, roots: [[`${J}ひじ`]], end: [`${J}手首`] },
    {
      id: `hand${s}`,
      label: `Hand (${side})`,
      roots: [[`${J}手首`]],
      end: [`${J}中指１`, `${J}人指１`, `${J}ダミー`],
    },
    {
      id: `fingers${s}`,
      label: `Fingers (${side})`,
      roots: [[`${J}親指０`, `${J}親指１`], [`${J}人指１`], [`${J}中指１`], [`${J}薬指１`], [`${J}小指１`]],
    },
    { id: `upperLeg${s}`, label: `Thigh (${side})`, roots: [[`${J}足`]], end: [`${J}ひざ`] },
    { id: `lowerLeg${s}`, label: `Shin (${side})`, roots: [[`${J}ひざ`]], end: [`${J}足首`] },
    { id: `foot${s}`, label: `Foot (${side})`, roots: [[`${J}足首`]], end: [`${J}つま先`] },
  ];
};

export const PARTS: PartDef[] = [
  { id: 'whole', label: 'Whole body', roots: [] },
  { id: 'head', label: 'Head', roots: [['頭']], end: [0, 1, 0] },
  { id: 'neck', label: 'Neck', roots: [['首']], end: ['頭'] },
  { id: 'torso', label: 'Torso', roots: [['上半身']], end: ['上半身2', '首'] },
  { id: 'chest', label: 'Chest', roots: [['上半身2']], end: ['首'] },
  { id: 'hips', label: 'Hips', roots: [['下半身']], end: [0, -1, 0] },
  ...sided('L'),
  ...sided('R'),
];

export const partLabel = (id: PartId): string => PARTS.find((p) => p.id === id)?.label ?? id;
export const mirrorPart = (id: PartId): PartId | null =>
  id.endsWith('L')
    ? (`${id.slice(0, -1)}R` as PartId)
    : id.endsWith('R')
      ? (`${id.slice(0, -1)}L` as PartId)
      : null;

export const PRESETS: Record<string, ProportionState> = {
  Chibi: {
    parts: {
      head: { overall: 1.6, length: 1, thickness: 1 },
      neck: { overall: 1, length: 0.6, thickness: 1 },
      torso: { overall: 1, length: 0.75, thickness: 1 },
      chest: { overall: 1, length: 0.75, thickness: 1 },
      upperArmL: { overall: 1, length: 0.7, thickness: 1.1 },
      upperArmR: { overall: 1, length: 0.7, thickness: 1.1 },
      lowerArmL: { overall: 1, length: 0.7, thickness: 1.1 },
      lowerArmR: { overall: 1, length: 0.7, thickness: 1.1 },
      upperLegL: { overall: 1, length: 0.65, thickness: 1.1 },
      upperLegR: { overall: 1, length: 0.65, thickness: 1.1 },
      lowerLegL: { overall: 1, length: 0.65, thickness: 1.1 },
      lowerLegR: { overall: 1, length: 0.65, thickness: 1.1 },
    },
  },
  'Long legs': {
    parts: {
      upperLegL: { overall: 1, length: 1.15, thickness: 1 },
      upperLegR: { overall: 1, length: 1.15, thickness: 1 },
      lowerLegL: { overall: 1, length: 1.15, thickness: 1 },
      lowerLegR: { overall: 1, length: 1.15, thickness: 1 },
    },
  },
  'Bigger head': { parts: { head: { overall: 1.25, length: 1, thickness: 1 } } },
  Reset: { parts: {} },
};

const clampScale = (x: number): number => Math.max(HARD_MIN, Math.min(HARD_MAX, Number.isFinite(x) ? x : 1));
export const isIdentity = (s: PartScale | undefined): boolean =>
  !s || (s.overall === 1 && s.length === 1 && s.thickness === 1);
export const outOfRange = (s: PartScale): boolean =>
  [s.overall, s.length, s.thickness].some((x) => x < SCALE_MIN || x > SCALE_MAX);

// ------------------------------------------------------------------ segments

export interface Segment {
  part: PartId;
  root: number;
  pivot: V3;
  axis: V3;
  scale: PartScale;
  /** Parent segment index, -1 = none. */
  parent: number;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-9 ? mul(a, 1 / l) : [0, 1, 0];
};

/** Logical twin of a deform helper (左足D → 左足), or -1. */
function twinOf(m: PmxModel, name: string): number {
  if (name.endsWith('D') && name.length > 1) return boneIndex(m, name.slice(0, -1));
  return -1;
}

export interface SegmentMap {
  segments: Segment[];
  /** Segment index per bone, -1 = none (moves with the whole body only). */
  boneSegment: Int32Array;
}

export function buildSegments(m: PmxModel, state: ProportionState): SegmentMap {
  const segments: Segment[] = [];
  const rootSeg = new Map<number, number>();
  for (const def of PARTS) {
    if (def.id === 'whole') continue;
    for (const alts of def.roots) {
      const root = alts.map((n) => boneIndex(m, n)).find((i) => i >= 0);
      if (root === undefined || rootSeg.has(root)) continue;
      const pivot = m.bones[root].position;
      let axis: V3 | null = null;
      if (Array.isArray(def.end) && typeof def.end[0] === 'string') {
        const e = (def.end as string[]).map((n) => boneIndex(m, n)).find((i) => i >= 0);
        if (e !== undefined) axis = unit(sub(m.bones[e].position, pivot));
      } else if (def.end) axis = unit(def.end as V3);
      if (!axis) {
        // First child, else the tail.
        const b = m.bones[root];
        const child = m.bones.findIndex((x) => x.parent === root);
        if (child >= 0) axis = unit(sub(m.bones[child].position, pivot));
        else if (typeof b.tail === 'number' && b.tail >= 0) axis = unit(sub(m.bones[b.tail].position, pivot));
        else if (Array.isArray(b.tail)) axis = unit(b.tail);
        else axis = [0, 1, 0];
      }
      const s = state.parts[def.id] ?? IDENTITY;
      rootSeg.set(root, segments.length);
      segments.push({
        part: def.id,
        root,
        pivot: [...pivot],
        axis,
        scale: {
          overall: clampScale(s.overall),
          length: clampScale(s.length),
          thickness: clampScale(s.thickness),
        },
        parent: -1,
      });
    }
  }
  const boneSegment = new Int32Array(m.bones.length).fill(-2);
  const resolve = (i: number, depth = 0): number => {
    if (i < 0 || depth > m.bones.length) return -1;
    if (boneSegment[i] !== -2) return boneSegment[i];
    let r: number;
    const twin = twinOf(m, m.bones[i].name);
    if (rootSeg.has(i)) r = rootSeg.get(i)!;
    else if (twin >= 0) r = resolve(twin, depth + 1);
    else if (m.bones[i].ik)
      r = -1; // IK handles follow their targets separately
    else r = resolve(m.bones[i].parent, depth + 1);
    boneSegment[i] = r;
    return r;
  };
  for (let i = 0; i < m.bones.length; i++) resolve(i);
  segments.forEach((s) => {
    const b = m.bones[s.root];
    const twin = twinOf(m, b.name);
    s.parent = twin >= 0 ? -1 : b.parent >= 0 ? boneSegment[b.parent] : -1;
  });
  return { segments, boneSegment };
}

/** Linear part of a segment's scale applied to an offset from its pivot. */
function scaleLocal(s: Segment, d: V3): V3 {
  const { overall: o, length: l, thickness: t } = s.scale;
  const along = dot(d, s.axis);
  const perp = sub(d, mul(s.axis, along));
  return mul(add(mul(s.axis, along * l), mul(perp, t)), o);
}

/** Normal transform (inverse transpose of the scale), not normalised. */
function scaleNormal(s: Segment, n: V3): V3 {
  const { overall: o, length: l, thickness: t } = s.scale;
  const along = dot(n, s.axis);
  const perp = sub(n, mul(s.axis, along));
  return mul(add(mul(s.axis, along / l), mul(perp, 1 / t)), 1 / o);
}

/** World transform of each segment: G_s(x) = G_parent(pivot_s) + A_s (x − pivot_s). */
function segmentTransforms(segs: Segment[]): ((x: V3) => V3)[] {
  const out: ((x: V3) => V3)[] = [];
  const done: boolean[] = [];
  const build = (i: number): ((x: V3) => V3) => {
    if (done[i]) return out[i];
    const s = segs[i];
    const parentAt = s.parent >= 0 ? build(s.parent)(s.pivot) : s.pivot;
    out[i] = (x: V3) => add(parentAt, scaleLocal(s, sub(x, s.pivot)));
    done[i] = true;
    return out[i];
  };
  segs.forEach((_, i) => build(i));
  return out;
}

const identityState = (st: ProportionState): boolean => Object.values(st.parts).every(isIdentity);

/** Apply the proportion state in place. */
export function applyProportions(m: PmxModel, state: ProportionState): void {
  if (identityState(state)) return;
  const { segments, boneSegment } = buildSegments(m, state);
  const G = segmentTransforms(segments);
  const T = (seg: number, x: V3): V3 => (seg >= 0 ? G[seg](x) : x);
  const minY0 = m.vertices.reduce((a, v) => Math.min(a, v.position[1]), Infinity);

  // Vertices: blend segment transforms by weight; normals and morph offsets use the dominant segment.
  const dominant = new Int32Array(m.vertices.length);
  m.vertices.forEach((v, vi) => {
    const p = v.position;
    let acc: V3 = [0, 0, 0];
    let best = -1;
    let bestW = -1;
    const segW = new Map<number, number>();
    v.bones.forEach((b, k) => {
      const s = b >= 0 && b < boneSegment.length ? boneSegment[b] : -1;
      segW.set(s, (segW.get(s) ?? 0) + v.weights[k]);
    });
    for (const [s, w] of segW) {
      acc = add(acc, mul(T(s, p), w));
      if (w > bestW) {
        bestW = w;
        best = s;
      }
    }
    const total = [...segW.values()].reduce((a, b) => a + b, 0) || 1;
    v.position = mul(acc, 1 / total);
    dominant[vi] = best;
    if (best >= 0) {
      v.normal = unit(scaleNormal(segments[best], v.normal));
      v.edgeScale *= segments[best].scale.thickness;
      if (v.sdef) {
        // SDEF centres follow the blended deformation of their own points.
        const sd = v.sdef;
        const s0 = boneSegment[v.bones[0]];
        const s1 = boneSegment[v.bones[1]];
        sd.c = T(best, sd.c);
        sd.r0 = T(s0, sd.r0);
        sd.r1 = T(s1, sd.r1);
      }
    }
  });
  for (const mo of m.morphs)
    if (mo.kind === 'vertex')
      for (const o of mo.offsets) {
        const s = dominant[o.vertex];
        if (s >= 0) o.offset = scaleLocal(segments[s], o.offset);
      }

  // Bones: rest positions through their segment; IK handles follow their target's move.
  const oldPos = m.bones.map((b) => [...b.position] as V3);
  m.bones.forEach((b, i) => {
    const s = boneSegment[i];
    b.position = T(s, b.position);
    if (Array.isArray(b.tail) && s >= 0) b.tail = scaleLocal(segments[s], b.tail);
  });
  const moved = (i: number): V3 => sub(m.bones[i].position, oldPos[i]);
  m.bones.forEach((b, i) => {
    if (!b.ik || boneSegment[i] >= 0) return;
    b.position = add(oldPos[i], moved(b.ik.target));
    // Children of the IK handle (つま先ＩＫ under 足ＩＫ) are IK handles too and are handled the same way.
  });
  // Non-IK bones parented to an IK handle (rare) move with it.
  m.bones.forEach((b, i) => {
    if (b.ik || boneSegment[i] >= 0 || b.parent < 0 || !m.bones[b.parent].ik) return;
    b.position = add(oldPos[i], moved(b.parent));
  });
  for (const mo of m.morphs)
    if (mo.kind === 'bone')
      for (const o of mo.offsets) {
        const s = boneSegment[o.bone];
        if (s >= 0) o.position = scaleLocal(segments[s], o.position);
      }

  // Rigid bodies follow their bone's segment; sizes scale with it.
  const bodySeg = m.rigidBodies.map((r) => (r.bone >= 0 ? boneSegment[r.bone] : -1));
  m.rigidBodies.forEach((r, k) => {
    const s = bodySeg[k];
    if (s < 0) return;
    const sc = segments[s].scale;
    r.position = T(s, r.position);
    const rad = sc.overall * sc.thickness;
    if (r.shape === 0) r.size = [r.size[0] * rad, r.size[1], r.size[2]];
    else if (r.shape === 2) r.size = [r.size[0] * rad, r.size[1] * sc.overall * sc.length, r.size[2]];
    else {
      const avg = sc.overall * Math.cbrt(sc.length * sc.thickness * sc.thickness);
      r.size = [r.size[0] * avg, r.size[1] * avg, r.size[2] * avg];
    }
  });
  for (const j of m.joints) {
    const s = bodySeg[j.b] ?? -1;
    if (s >= 0) j.position = T(s, j.position);
  }

  // Whole body: overall on all axes, length vertically, thickness horizontally, about the origin.
  const w = state.parts.whole;
  if (w && !isIdentity(w)) {
    const o = clampScale(w.overall);
    const ly = o * clampScale(w.length);
    const tx = o * clampScale(w.thickness);
    const S = (p: V3): V3 => [p[0] * tx, p[1] * ly, p[2] * tx];
    for (const v of m.vertices) {
      v.position = S(v.position);
      v.normal = unit([v.normal[0] / tx, v.normal[1] / ly, v.normal[2] / tx]);
      if (v.sdef) v.sdef = { c: S(v.sdef.c), r0: S(v.sdef.r0), r1: S(v.sdef.r1) };
    }
    for (const b of m.bones) {
      b.position = S(b.position);
      if (Array.isArray(b.tail)) b.tail = S(b.tail);
    }
    for (const mo of m.morphs) {
      if (mo.kind === 'vertex') for (const x of mo.offsets) x.offset = S(x.offset);
      if (mo.kind === 'bone') for (const x of mo.offsets) x.position = S(x.position);
    }
    for (const r of m.rigidBodies) {
      r.position = S(r.position);
      r.size = r.shape === 2 ? [r.size[0] * tx, r.size[1] * ly, r.size[2]] : (r.size.map((x) => x * o) as V3);
    }
    for (const j of m.joints) {
      j.position = S(j.position);
      j.moveMin = S(j.moveMin);
      j.moveMax = S(j.moveMax);
    }
  }

  // Feet on the floor: shift everything so the lowest vertex is back at its original height.
  if (state.keepFeet !== false && Number.isFinite(minY0)) {
    const ws = w ? clampScale(w.overall) * clampScale(w.length) : 1;
    const target = minY0 * ws;
    const minY = m.vertices.reduce((a, v) => Math.min(a, v.position[1]), Infinity);
    const dy = target - minY;
    if (Math.abs(dy) > 1e-6) {
      const up = (p: V3): V3 => [p[0], p[1] + dy, p[2]];
      for (const v of m.vertices) {
        v.position = up(v.position);
        if (v.sdef) v.sdef = { c: up(v.sdef.c), r0: up(v.sdef.r0), r1: up(v.sdef.r1) };
      }
      // The root (全ての親) stays at the origin so motions keep their placement.
      m.bones.forEach((b, i) => {
        if (i === 0 && b.parent < 0) return;
        b.position = up(b.position);
      });
      for (const r of m.rigidBodies) r.position = up(r.position);
      for (const j of m.joints) j.position = up(j.position);
    }
  }
}

/** Segment weight per vertex for one part (0–1), for selection overlays and tests. */
export function partWeights(m: PmxModel, part: PartId): Float32Array {
  const { segments, boneSegment } = buildSegments(m, { parts: {} });
  const out = new Float32Array(m.vertices.length);
  m.vertices.forEach((v, i) => {
    v.bones.forEach((b, k) => {
      const s = boneSegment[b];
      if (s >= 0 && segments[s].part === part) out[i] += v.weights[k];
    });
  });
  return out;
}

/** Which part a bone belongs to (for click-to-jump), or null. */
export function partOfBone(m: PmxModel, bone: number): PartId | null {
  const { segments, boneSegment } = buildSegments(m, { parts: {} });
  const s = boneSegment[bone];
  return s >= 0 ? segments[s].part : null;
}

/** Parts that exist on this model (have at least one root bone). */
export function availableParts(m: PmxModel): PartId[] {
  const { segments } = buildSegments(m, { parts: {} });
  const have = new Set(segments.map((s) => s.part));
  return PARTS.filter((p) => p.id === 'whole' || have.has(p.id)).map((p) => p.id);
}
