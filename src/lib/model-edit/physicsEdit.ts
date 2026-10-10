// Physics editing helpers: Soft / Skirt / Stiff presets with a sway amount (same numbers as the converter's
// generator), auto physics for a bone chain (the converter's generator on that chain), and sanity checks.

import { buildPhysics, classify, type ChainKind, type PhysicsChain } from '@/lib/convert/physics';
import type { PmxModel, V3 } from '@/lib/convert/pmx/types';
import { removeBodies } from './refs';

export type PhysicsPresetName = 'soft' | 'skirt' | 'stiff';

export interface PresetValues {
  damping: number;
  limit: V3;
  spring: number;
}

/** Joint limits (radians), spring and damping for a preset at a sway (0 = stiff … 1 = loose). */
export function presetValues(preset: PhysicsPresetName, sway: number): PresetValues {
  const s = Math.max(0, Math.min(1, sway));
  const stiff = preset === 'stiff';
  const skirt = preset === 'skirt';
  const looseness = (0.5 + s) * (stiff ? 0.35 : 1);
  return {
    damping: Math.min(0.99, 0.5 + 0.49 * (skirt ? 0.5 : 0.4)),
    limit: [
      Math.min(1.2, (skirt ? 0.7 : 0.55) * looseness),
      Math.min(0.6, (skirt ? 0.1 : 0.2) * looseness),
      Math.min(1.2, (skirt ? 0.45 : 0.55) * looseness),
    ],
    spring: (stiff ? 120 : skirt ? 40 : 25) * (1.5 - s),
  };
}

export function applyPhysicsPreset(
  m: PmxModel,
  bodies: readonly number[],
  preset: PhysicsPresetName,
  sway: number,
): void {
  const v = presetValues(preset, sway);
  const set = new Set(bodies);
  for (const i of set) {
    const r = m.rigidBodies[i];
    if (!r) continue;
    r.linearDamping = v.damping;
    r.angularDamping = v.damping;
  }
  for (const j of m.joints) {
    if (!set.has(j.b)) continue;
    j.rotateMin = [-v.limit[0], -v.limit[1], -v.limit[2]];
    j.rotateMax = [...v.limit];
    j.springRotate = [v.spring, v.spring, v.spring];
  }
}

/** Bones whose bone-following bodies count as the body the generated chain must not pass through. */
const BODY_BONE =
  /^(頭|首|上半身\d?|下半身|[左右](足|ひざ|足首|腕|ひじ|手首|肩))$|^(head|neck|spine|chest|hips|pelvis)/i;

/**
 * Generate rigid bodies and joints for a chain of bones (root → tip) and append them. The chain collides with
 * the model's own body colliders (whatever collision groups the model uses); body parts that have no collider
 * get a generated one, so the chain can't swing through the head, torso, hips, arms or legs.
 */
export function applyAutoPhysics(
  m: PmxModel,
  chain: number[],
  preset: PhysicsPresetName,
  sway: number,
): void {
  if (!chain.length) return;
  const kind: ChainKind = classify(m.bones[chain[0]].name) ?? (preset === 'skirt' ? 'skirt' : 'accessory');
  // Bodies already on these bones are replaced.
  const onChain = new Set(chain);
  removeBodies(m, new Set(m.rigidBodies.map((r, i) => (onChain.has(r.bone) ? i : -1)).filter((i) => i >= 0)));
  const height = Math.max(1, ...m.bones.map((b) => b.position[1]));
  const c: PhysicsChain = {
    id: 'auto',
    name: m.bones[chain[0]].name,
    kind,
    preset,
    bones: chain,
    source: 'name',
    enabled: true,
  };
  const gen = buildPhysics(
    m.bones,
    [c],
    { enabled: true, sway, colliders: true },
    Math.max(10, height * 1.15),
  );

  // The model's body colliders: bone-following bodies on body bones.
  const colliders = m.rigidBodies
    .map((r, i) => (r.mode === 0 && BODY_BONE.test(m.bones[r.bone]?.name ?? '') ? i : -1))
    .filter((i) => i >= 0);
  const bodyGroups = new Set(colliders.map((i) => m.rigidBodies[i].group));
  const bodyGroup = bodyGroups.size ? Math.min(...bodyGroups) : 0;
  bodyGroups.add(bodyGroup);
  // The chain's group: one no body uses (else any that isn't a body group).
  const used = new Set(m.rigidBodies.map((r) => r.group));
  const free = [...Array(16).keys()].filter((g) => !bodyGroups.has(g));
  const chainGroup = free.find((g) => !used.has(g)) ?? free[0] ?? 15;
  const chainBit = 1 << chainGroup;
  let bodyMask = 0;
  for (const g of bodyGroups) bodyMask |= 1 << g;
  for (const i of colliders) m.rigidBodies[i].collidesWith |= chainBit;

  const covered = new Set(colliders.map((i) => m.rigidBodies[i].bone));
  const remap = new Map<number, number>();
  const base = m.rigidBodies.length;
  gen.rigidBodies.forEach((r, i) => {
    const isCollider = r.mode === 0 && r.collidesWith !== 0 && !onChain.has(r.bone);
    if (isCollider) {
      // Generated collider only where the model has none on that bone.
      if (covered.has(r.bone)) return;
      r.group = bodyGroup;
      r.collidesWith = chainBit;
    } else {
      r.group = chainGroup;
      // The first segment starts at the attachment (often inside the head or torso collider): no collisions.
      const first = r.bone === chain[0];
      r.collidesWith = r.collidesWith === 0 || first ? 0 : bodyMask;
    }
    remap.set(i, base + remap.size);
    m.rigidBodies.push(r);
  });
  for (const j of gen.joints) {
    const a = remap.get(j.a);
    const b = remap.get(j.b);
    if (a !== undefined && b !== undefined) m.joints.push({ ...j, a, b });
  }
}

/** Capsule axis (rest pose) of a rigid body: R·ŷ with R = Ry·Rx·Rz (PMX / Babylon Euler order). */
function bodyAxis(rot: V3): V3 {
  const [x, y, z] = rot;
  const v: V3 = [-Math.sin(z), Math.cos(z) * Math.cos(x), Math.cos(z) * Math.sin(x)];
  return [v[0] * Math.cos(y) + v[2] * Math.sin(y), v[1], -v[0] * Math.sin(y) + v[2] * Math.cos(y)];
}

/** A body as a segment + radius (sphere: zero-length segment; box: along its longest side). */
function bodySegment(r: PmxModel['rigidBodies'][number]): { a: V3; b: V3; radius: number } {
  const p = r.position;
  if (r.shape === 0) return { a: p, b: p, radius: r.size[0] };
  if (r.shape === 2) {
    const ax = bodyAxis(r.rotation);
    const h = r.size[1] / 2;
    return {
      a: [p[0] - ax[0] * h, p[1] - ax[1] * h, p[2] - ax[2] * h],
      b: [p[0] + ax[0] * h, p[1] + ax[1] * h, p[2] + ax[2] * h],
      radius: r.size[0],
    };
  }
  const half = r.size;
  return {
    a: p,
    b: p,
    radius: Math.min(half[0], half[1], half[2]) + 0.5 * (Math.max(...half) - Math.min(...half)),
  };
}

/** Closest distance between segments ab and cd. */
function segmentDistance(a: V3, b: V3, c: V3, d: V3): number {
  const sub3 = (u: V3, v: V3): V3 => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const dot3 = (u: V3, v: V3): number => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const d1 = sub3(b, a);
  const d2 = sub3(d, c);
  const r = sub3(a, c);
  const aa = dot3(d1, d1);
  const ee = dot3(d2, d2);
  const f = dot3(d2, r);
  let sN = 0;
  let tN = 0;
  if (aa < 1e-12 && ee < 1e-12) return Math.hypot(...r);
  if (aa < 1e-12) tN = Math.min(1, Math.max(0, f / ee));
  else {
    const cc = dot3(d1, r);
    if (ee < 1e-12) sN = Math.min(1, Math.max(0, -cc / aa));
    else {
      const bb = dot3(d1, d2);
      const den = aa * ee - bb * bb;
      sN = den > 1e-12 ? Math.min(1, Math.max(0, (bb * f - cc * ee) / den)) : 0;
      tN = (bb * sN + f) / ee;
      if (tN < 0) {
        tN = 0;
        sN = Math.min(1, Math.max(0, -cc / aa));
      } else if (tN > 1) {
        tN = 1;
        sN = Math.min(1, Math.max(0, (bb - cc) / aa));
      }
    }
  }
  const p: V3 = [a[0] + d1[0] * sN, a[1] + d1[1] * sN, a[2] + d1[2] * sN];
  const q: V3 = [c[0] + d2[0] * tN, c[1] + d2[1] * tN, c[2] + d2[2] * tN];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/**
 * Make every physics body (hair, skirt, bust, accessories) collide with the body: body parts without a
 * collider get one, the body colliders share a group, and each physics body collides with that group only
 * (not with other hair, which tangles). Bodies that already sit deep inside a collider at rest (a chain's
 * first segment at the head, bust inside the chest) are left without body collisions so they can't explode.
 * Also repairs models whose masks were inverted. Returns counts for the UI.
 */
export function fixBodyCollisions(m: PmxModel): {
  colliders: number;
  added: number;
  bodies: number;
  skipped: number;
} {
  const isCollider = (i: number): boolean =>
    m.rigidBodies[i].mode === 0 && BODY_BONE.test(m.bones[m.rigidBodies[i].bone]?.name ?? '');
  const dynamic = m.rigidBodies.map((r, i) => (r.mode !== 0 ? i : -1)).filter((i) => i >= 0);
  const dynGroups = new Set(dynamic.map((i) => m.rigidBodies[i].group));
  // Body group: the colliders' most common group if no physics body uses it, else a free one.
  const existing = m.rigidBodies.map((_, i) => i).filter(isCollider);
  const counts = new Map<number, number>();
  for (const i of existing) counts.set(m.rigidBodies[i].group, (counts.get(m.rigidBodies[i].group) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g);
  const bodyGroup =
    ranked.find((g) => !dynGroups.has(g)) ??
    [...Array(16).keys()].find((g) => !dynGroups.has(g) && !m.rigidBodies.some((r) => r.group === g)) ??
    [...Array(16).keys()].find((g) => !dynGroups.has(g)) ??
    0;
  // Generated colliders for body parts that have none.
  const height = Math.max(1, ...m.bones.map((b) => b.position[1]));
  const gen = buildPhysics(
    m.bones,
    [],
    { enabled: true, sway: 0.5, colliders: true },
    Math.max(10, height * 1.15),
  );
  const covered = new Set(existing.map((i) => m.rigidBodies[i].bone));
  let added = 0;
  for (const r of gen.rigidBodies) {
    if (covered.has(r.bone)) continue;
    m.rigidBodies.push({ ...r, group: bodyGroup });
    added++;
  }
  const colliders = m.rigidBodies.map((_, i) => i).filter(isCollider);
  const segs = colliders.map((i) => bodySegment(m.rigidBodies[i]));
  let dynMask = 0;
  for (const i of dynamic) dynMask |= 1 << m.rigidBodies[i].group;
  for (const i of colliders) {
    const r = m.rigidBodies[i];
    r.group = bodyGroup;
    r.collidesWith = dynMask;
  }
  let skipped = 0;
  for (const i of dynamic) {
    const r = m.rigidBodies[i];
    const s = bodySegment(r);
    // Sitting deep inside a collider at rest: no body collisions for this body.
    const deep = segs.some((c) => segmentDistance(s.a, s.b, c.a, c.b) < (s.radius + c.radius) * 0.6);
    if (deep) skipped++;
    r.collidesWith = deep ? 0 : 1 << bodyGroup;
  }
  return { colliders: colliders.length, added, bodies: dynamic.length - skipped, skipped };
}

/** Plain-language physics problems: NaN / infinite numbers, zero sizes, joints to themselves. */
export function physicsWarnings(m: PmxModel): string[] {
  const out: string[] = [];
  const fin = (a: readonly number[]): boolean => a.every(Number.isFinite);
  m.rigidBodies.forEach((r) => {
    if (!fin(r.position) || !fin(r.size) || !fin(r.rotation) || !Number.isFinite(r.mass))
      out.push(`Rigid body ${r.name} has invalid numbers`);
    else if (r.size[0] <= 0) out.push(`Rigid body ${r.name} has zero size`);
    if (r.mode !== 0 && r.mass <= 0) out.push(`Rigid body ${r.name} is physics-driven but has no mass`);
  });
  m.joints.forEach((j) => {
    if (j.a === j.b) out.push(`Joint ${j.name} connects a body to itself`);
    if (![j.position, j.rotation, j.rotateMin, j.rotateMax, j.springRotate].every(fin))
      out.push(`Joint ${j.name} has invalid numbers`);
  });
  return out;
}
