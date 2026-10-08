// Physics: VRM spring bones and detected secondary chains (hair, skirt, tail, ribbons…) → PMX rigid
// bodies and 6-DOF spring joints, plus bone-following body colliders so skirts don't sink into legs.
// Works in PMX space (left-handed, model facing −Z, ~20 units tall).

import type { PmxBone, PmxJoint, PmxRigidBody, V3 } from './pmx/types';

export type ChainKind = 'hair' | 'skirt' | 'tail' | 'bust' | 'accessory';
export type ChainPreset = 'soft' | 'skirt' | 'stiff';

export interface PhysicsChain {
  id: string;
  name: string;
  kind: ChainKind;
  preset: ChainPreset;
  /** Output bone indices, root → tip. */
  bones: number[];
  source: 'vrm' | 'name' | 'structure';
  enabled: boolean;
  /** VRM parameters (already in model units). */
  vrm?: { radius: number; stiffness: number; drag: number; gravity: number };
}

export interface PhysicsOptions {
  enabled: boolean;
  /** 0 = stiff … 1 = loose. */
  sway: number;
  /** Bone-following body colliders (head, torso, arms, legs). */
  colliders: boolean;
}

export const DEFAULT_PHYSICS: PhysicsOptions = { enabled: true, sway: 0.5, colliders: true };

const KIND_RULES: [RegExp, ChainKind][] = [
  [/hair|髪|ahoge|bang|fringe|ponytail|twintail|tail_?hair|もみあげ|前髪|後髪|横髪/i, 'hair'],
  [/skirt|スカート|dress|ドレス|裾/i, 'skirt'],
  [/tail|尻尾|しっぽ/i, 'tail'],
  [/bust|breast|chest_?(sub|soft)|胸(?!.*上半身)|oppai|boob/i, 'bust'],
  [/ribbon|リボン|cloth|cape|マント|sleeve|袖|ear|耳|scarf|tie|ネクタイ|acc|accessory|飾り|string|ひも|紐|coat|コート|hood|フード/i, 'accessory'],
];

export const presetFor = (kind: ChainKind): ChainPreset => (kind === 'skirt' ? 'skirt' : kind === 'bust' || kind === 'accessory' ? 'stiff' : 'soft');

export function classify(name: string): ChainKind | null {
  for (const [re, k] of KIND_RULES) if (re.test(name)) return k;
  return null;
}

/**
 * Secondary chains among the extra (unmapped) bones: roots whose parent is a standard bone, followed
 * down single-child paths. A chain qualifies by name, or by hanging off 頭 / 下半身 / 上半身(2) with ≥ 2 bones.
 */
export function detectChains(bones: PmxBone[], extras: number[]): PhysicsChain[] {
  const extra = new Set(extras);
  const kids: number[][] = bones.map(() => []);
  bones.forEach((b, i) => b.parent >= 0 && kids[b.parent].push(i));
  const chains: PhysicsChain[] = [];
  const visit = (root: number): void => {
    const list = [root];
    for (let cur = root; ; ) {
      const next = kids[cur].filter((c) => extra.has(c));
      if (!next.length) break;
      // Branches start their own chains.
      next.slice(1).forEach(visit);
      cur = next[0];
      list.push(cur);
    }
    const parentName = bones[bones[root].parent]?.name ?? '';
    const named = classify(bones[root].name) ?? classify(bones[list[list.length - 1]].name);
    let kind = named;
    let source: PhysicsChain['source'] = 'name';
    if (!kind && list.length >= 2) {
      source = 'structure';
      kind = parentName === '頭' ? 'hair' : parentName === '下半身' ? 'skirt' : /^上半身/.test(parentName) ? 'accessory' : null;
    }
    if (!kind) return;
    chains.push({ id: `c${root}`, name: bones[root].name, kind, preset: presetFor(kind), bones: list, source, enabled: true });
  };
  for (const i of extras) if (!extra.has(bones[i].parent)) visit(i);
  return chains;
}

// ---------------------------------------------------------------- building

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const mid = (a: V3, b: V3): V3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

/**
 * Euler angles (PMX: x = pitch, y = yaw, z = roll, applied as babylon `RotationYawPitchRoll`) that turn
 * the capsule's local +Y axis onto `d`.
 */
export function eulerForY(d: V3): V3 {
  const l = len(d) || 1;
  const [x, y, z] = [d[0] / l, d[1] / l, d[2] / l];
  // R = Ry(yaw)·Rx(pitch)·Rz(roll) with yaw = 0: R·ŷ = (−sin roll, cos roll·cos pitch, cos roll·sin pitch).
  const roll = Math.asin(Math.max(-1, Math.min(1, -x)));
  const c = Math.cos(roll);
  const pitchAngle = Math.abs(c) < 1e-6 ? 0 : Math.atan2(z / c, y / c);
  return [pitchAngle, 0, roll];
}

interface BodyRef {
  index: number;
  bone: number;
}

export function buildPhysics(
  bones: PmxBone[],
  chains: PhysicsChain[],
  opts: PhysicsOptions,
  height = 20,
): { rigidBodies: PmxRigidBody[]; joints: PmxJoint[] } {
  const rigidBodies: PmxRigidBody[] = [];
  const joints: PmxJoint[] = [];
  if (!opts.enabled) return { rigidBodies, joints };
  const byName = new Map(bones.map((b, i) => [b.name, i]));
  const kids: number[][] = bones.map(() => []);
  bones.forEach((b, i) => b.parent >= 0 && kids[b.parent].push(i));
  const unit = height / 20;
  const sway = Math.max(0, Math.min(1, opts.sway));
  const GROUP = { body: 0, hair: 1, skirt: 2, anchor: 3 } as const;
  const bit = (g: number): number => 1 << g;

  const body = (
    name: string,
    bone: number,
    group: number,
    collides: number,
    shape: 0 | 1 | 2,
    size: V3,
    position: V3,
    rotation: V3,
    mode: 0 | 1 | 2,
    mass = 1,
    damping: [number, number] = [0.5, 0.5],
  ): number => {
    rigidBodies.push({
      name,
      nameEn: name,
      bone,
      group,
      collidesWith: collides,
      shape,
      size,
      position,
      rotation,
      mass,
      linearDamping: damping[0],
      angularDamping: damping[1],
      restitution: 0,
      friction: 0.5,
      mode,
    });
    return rigidBodies.length - 1;
  };
  const capsuleBetween = (a: V3, b: V3, r: number): { size: V3; position: V3; rotation: V3 } => {
    const d = sub(b, a);
    return { size: [r, Math.max(0.01, len(d) - 0.0), 0], position: mid(a, b), rotation: eulerForY(d) };
  };

  // Body colliders (bone-following, collide with hair and skirt).
  const bodyCollide = bit(GROUP.hair) | bit(GROUP.skirt);
  const colliderFor = new Map<number, number>();
  if (opts.colliders) {
    const seg = (name: string, a: string, b: string, r: number): void => {
      const ia = byName.get(a);
      const ib = byName.get(b);
      if (ia === undefined || ib === undefined) return;
      const c = capsuleBetween(bones[ia].position, bones[ib].position, r * unit);
      colliderFor.set(ia, body(name, ia, GROUP.body, bodyCollide, 2, c.size, c.position, c.rotation, 0));
    };
    const head = byName.get('頭');
    if (head !== undefined) {
      const p = bones[head].position;
      colliderFor.set(head, body('頭', head, GROUP.body, bodyCollide, 0, [1.25 * unit, 0, 0], [p[0], p[1] + 1.2 * unit, p[2]], [0, 0, 0], 0));
    }
    seg('上半身', '上半身', bones[byName.get('上半身2') ?? -1] ? '上半身2' : '首', 1.1);
    seg('上半身2', '上半身2', '首', 1.2);
    const lower = byName.get('下半身');
    if (lower !== undefined) {
      const p = bones[lower].position;
      colliderFor.set(lower, body('下半身', lower, GROUP.body, bodyCollide, 0, [1.35 * unit, 0, 0], [p[0], p[1] - 0.9 * unit, p[2]], [0, 0, 0], 0));
    }
    for (const J of ['左', '右']) {
      seg(`${J}足`, `${J}足`, `${J}ひざ`, 0.75);
      seg(`${J}ひざ`, `${J}ひざ`, `${J}足首`, 0.55);
      seg(`${J}腕`, `${J}腕`, `${J}ひじ`, 0.45);
      seg(`${J}ひじ`, `${J}ひじ`, `${J}手首`, 0.4);
    }
  }

  for (const chain of chains) {
    if (!chain.enabled || !chain.bones.length) continue;
    const g = chain.kind === 'skirt' ? GROUP.skirt : GROUP.hair;
    const stiff = chain.preset === 'stiff';
    const skirt = chain.preset === 'skirt';
    // Limits (radians) and springs from the preset, the sway slider and VRM stiffness.
    const vrmStiff = chain.vrm ? Math.max(0.05, chain.vrm.stiffness) : 1;
    const looseness = (0.5 + sway) * (stiff ? 0.35 : 1) / Math.sqrt(vrmStiff);
    const limX = Math.min(1.2, (skirt ? 0.7 : 0.55) * looseness);
    const limY = Math.min(0.6, (skirt ? 0.1 : 0.2) * looseness);
    const limZ = Math.min(1.2, (skirt ? 0.45 : 0.55) * looseness);
    const spring = (stiff ? 120 : skirt ? 40 : 25) * vrmStiff * (1.5 - sway);
    const drag = chain.vrm ? chain.vrm.drag : skirt ? 0.5 : 0.4;
    const damp = Math.min(0.99, 0.5 + 0.49 * drag);
    const parentBone = bones[chain.bones[0]].parent;
    // Anchor: a bone-following body on the chain's parent (no collisions).
    const ap = bones[parentBone]?.position ?? bones[chain.bones[0]].position;
    let prev: BodyRef = { index: body(`${chain.name}_root`, parentBone, GROUP.anchor, 0, 0, [0.1 * unit, 0, 0], [...ap], [0, 0, 0], 0), bone: parentBone };
    chain.bones.forEach((bi, k) => {
      const a = bones[bi].position;
      const nextBone = chain.bones[k + 1] ?? kids[bi][0];
      let b: V3;
      if (nextBone !== undefined) b = bones[nextBone].position;
      else {
        // Tip: extend along the previous segment (or straight down).
        const pa = k > 0 ? bones[chain.bones[k - 1]].position : ap;
        const d = sub(a, pa);
        const l = len(d) || unit;
        b = [a[0] + (d[0] / l) * l * 0.6, a[1] + (d[1] / l) * l * 0.6, a[2] + (d[2] / l) * l * 0.6];
      }
      const segLen = len(sub(b, a));
      const r = chain.vrm ? Math.max(0.05 * unit, chain.vrm.radius) : Math.max(0.12 * unit, Math.min(0.5 * unit, segLen * 0.22));
      const c = capsuleBetween(a, b, r);
      const mass = Math.max(0.1, (1 - (k / Math.max(1, chain.bones.length)) * 0.6) * (1 + (chain.vrm?.gravity ?? 0)));
      const idx = body(`${chain.name}_${k + 1}`, bi, g, bit(GROUP.body), 2, c.size, c.position, c.rotation, k === 0 && stiff ? 2 : 1, mass, [damp, damp]);
      joints.push({
        name: `${chain.name}_${k + 1}`,
        nameEn: `${chain.name}_${k + 1}`,
        a: prev.index,
        b: idx,
        position: [...a],
        rotation: [0, 0, 0],
        moveMin: [0, 0, 0],
        moveMax: [0, 0, 0],
        rotateMin: [-limX, -limY, -limZ],
        rotateMax: [limX, limY, limZ],
        springMove: [0, 0, 0],
        springRotate: [spring, spring, spring],
      });
      prev = { index: idx, bone: bi };
    });
  }
  return { rigidBodies, joints };
}
