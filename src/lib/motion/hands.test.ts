import { describe, expect, it } from 'vitest';
import type { RigBone } from '@/lib/video2vmd/hands';
import { keyHandPreset } from './hands';
import { emptyClip } from './types';

/** A flat hand along +x for one side: wrist, then three joints and a tip per finger. */
function hand(P: '左' | '右'): RigBone[] {
  const x = P === '左' ? 1 : -1;
  const bones: RigBone[] = [{ name: `${P}手首`, parent: -1, position: [0, 0, 0] }];
  const fingers: [string, number][] = [
    ['人指', 0.25],
    ['中指', 0.05],
    ['薬指', -0.12],
    ['小指', -0.3],
  ];
  for (const [n, z] of fingers) {
    for (let j = 1; j <= 3; j++)
      bones.push({ name: `${P}${n}${'０１２３'[j]}`, parent: 0, position: [x * (0.8 + j * 0.3), 0, z] });
    bones.push({ name: `${P}${n}先`, parent: 0, position: [x * 1.9, 0, z] });
  }
  for (let j = 0; j <= 2; j++)
    bones.push({ name: `${P}親指${'０１２'[j]}`, parent: 0, position: [x * (0.3 + j * 0.3), 0, 0.4 + j * 0.1] });
  bones.push({ name: `${P}親指先`, parent: 0, position: [x * 0.95, 0, 0.7] });
  return bones;
}
const skeleton = [...hand('左'), ...hand('右')];

describe('keyHandPreset', () => {
  it('keys the finger bones of one side at the frame', () => {
    const out = keyHandPreset(emptyClip('m'), skeleton, 'left', 'fist', 12);
    const names = out.bones.map((t) => t.name);
    expect(names).toContain('左人指１');
    expect(names).toContain('左親指２');
    expect(names.some((n) => n.startsWith('右'))).toBe(false);
    for (const t of out.bones) expect(t.keys.map((k) => k.f)).toEqual([12]);
  });

  it('keys both hands, and a fist differs from an open hand', () => {
    const fist = keyHandPreset(emptyClip('m'), skeleton, 'both', 'fist', 0);
    const open = keyHandPreset(emptyClip('m'), skeleton, 'both', 'open', 0);
    expect(fist.bones.some((t) => t.name.startsWith('右'))).toBe(true);
    const q = (c: typeof fist, n: string) => c.bones.find((t) => t.name === n)!.keys[0].r;
    expect(q(fist, '左人指２')).not.toEqual(q(open, '左人指２'));
    expect(Math.abs(q(fist, '左人指２')[3])).toBeLessThan(Math.abs(q(open, '左人指２')[3]));
  });

  it('leaves the clip alone when the model has no hand bones', () => {
    const clip = emptyClip('m');
    expect(
      keyHandPreset(clip, [{ name: 'センター', parent: -1, position: [0, 0, 0] }], 'both', 'fist', 3),
    ).toBe(clip);
  });

  it('replaces an existing key at the same frame', () => {
    const a = keyHandPreset(emptyClip('m'), skeleton, 'left', 'fist', 5);
    const b = keyHandPreset(a, skeleton, 'left', 'open', 5);
    expect(b.bones.find((t) => t.name === '左人指１')!.keys).toHaveLength(1);
  });
});
