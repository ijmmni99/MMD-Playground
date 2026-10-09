// Validation before preview / save, in plain language: the PMX validator plus edit-specific checks
// (weights, physics numbers, bone names VMDs use, sizes).

import type { PmxModel } from '@/lib/convert/pmx/types';
import { validatePmx, type ValidationIssue } from '@/lib/convert/pmx/validate';
import { physicsWarnings } from './physicsEdit';

export type { ValidationIssue };

export function checkModel(m: PmxModel, files?: ReadonlySet<string>): ValidationIssue[] {
  const out = validatePmx(m, files);
  for (const w of physicsWarnings(m)) out.push({ level: 'error', message: w });
  const enc = new TextEncoder();
  m.bones.forEach((b) => {
    // VMD stores 15 bytes of Shift-JIS; long names can't be keyed by motions. UTF-8 length is a fair proxy.
    if (enc.encode(b.name).length > 30)
      out.push({ level: 'warning', message: `Bone ${b.name}: name is too long for VMD motions` });
    if (!b.name.trim()) out.push({ level: 'error', message: 'A bone has an empty name' });
  });
  const morphNames = new Set<string>();
  for (const mo of m.morphs) {
    if (morphNames.has(mo.name)) out.push({ level: 'warning', message: `Duplicate morph name ${mo.name}` });
    morphNames.add(mo.name);
  }
  m.bones.forEach((b) => {
    if (!b.ik) return;
    if (!(b.ik.loop > 0)) out.push({ level: 'warning', message: `IK ${b.name}: loop count is 0` });
    if (!b.ik.links.length) out.push({ level: 'error', message: `IK ${b.name}: no chain bones` });
  });
  if (m.vertices.length > 2_000_000)
    out.push({ level: 'warning', message: 'Very large model (over 2M vertices)' });
  return out;
}

export const hasErrors = (issues: readonly ValidationIssue[]): boolean =>
  issues.some((i) => i.level === 'error');
