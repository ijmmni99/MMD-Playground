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
