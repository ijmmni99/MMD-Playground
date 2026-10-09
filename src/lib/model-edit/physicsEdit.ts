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

/** Generate rigid bodies and joints for a chain of bones (root → tip) and append them. */
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
    { enabled: true, sway, colliders: false },
    Math.max(10, height * 1.15),
  );
  const base = m.rigidBodies.length;
  m.rigidBodies.push(...gen.rigidBodies);
  m.joints.push(...gen.joints.map((j) => ({ ...j, a: j.a + base, b: j.b + base })));
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
