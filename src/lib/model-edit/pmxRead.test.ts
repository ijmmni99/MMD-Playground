import { describe, expect, it } from 'vitest';
import { validatePmx } from '@/lib/convert/pmx/validate';
import { writePmx } from '@/lib/convert/pmx/writer';
import type { PmxModel } from '@/lib/convert/pmx/types';
import { makeEditFixture } from './fixture';
import { readPmx } from './pmxRead';

const roundTrip = async (m: PmxModel): Promise<PmxModel> => readPmx(writePmx(m));

describe('procedural edit fixture', () => {
  it('is a valid PMX with outfit materials, fingers, IK, skirt physics and every morph kind', () => {
    const { pmx, textures } = makeEditFixture();
    expect(validatePmx(pmx).filter((i) => i.level === 'error')).toEqual([]);
    expect(pmx.materials.map((m) => m.name)).toEqual([
      '髪',
      '顔',
      '体',
      'トップス',
      'スカート',
      '靴',
      '手袋',
      'リボン',
    ]);
    const names = pmx.bones.map((b) => b.name);
    for (const n of ['左手首', '左人指３', '右中指２', '左足ＩＫ', '右つま先ＩＫ', 'スカート前3', '左腕捩'])
      expect(names).toContain(n);
    expect(pmx.rigidBodies.some((r) => r.mode === 1)).toBe(true);
    expect(pmx.joints.length).toBeGreaterThan(0);
    expect(new Set(pmx.morphs.map((m) => m.kind))).toEqual(new Set(['vertex', 'group', 'bone', 'material']));
    expect(Object.keys(textures).sort()).toEqual(['tex/face.png', 'tex/top.png']);
    expect(textures['tex/top.png'].subarray(1, 4)).toEqual(new Uint8Array([0x50, 0x4e, 0x47]));
  });

  it('donor option keeps only the chosen materials, renamed', () => {
    const { pmx } = makeEditFixture({
      materials: ['ジャケット'],
      topName: 'ジャケット',
      topColor: [0.8, 0.2, 0.2],
    });
    expect(pmx.materials.map((m) => m.name)).toEqual(['ジャケット']);
    expect(pmx.indices.length).toBe(pmx.materials[0].indexCount);
    expect(Math.max(...pmx.indices)).toBe(pmx.vertices.length - 1);
    expect(pmx.textures).toEqual(['tex/top.png']);
  });
});

describe('PMX round trip (writer → babylon-mmd reader → PmxModel)', () => {
  it('keeps counts, names, weights, IK, physics and morphs', async () => {
    const { pmx } = makeEditFixture();
    const back = await roundTrip(pmx);
    expect(back.vertices.length).toBe(pmx.vertices.length);
    expect(Array.from(back.indices)).toEqual(Array.from(pmx.indices));
    expect(back.materials.map((m) => [m.name, m.indexCount, m.texture])).toEqual(
      pmx.materials.map((m) => [m.name, m.indexCount, m.texture]),
    );
    expect(back.bones.map((b) => [b.name, b.parent])).toEqual(pmx.bones.map((b) => [b.name, b.parent]));
    const ik = back.bones.find((b) => b.name === '左足ＩＫ')!.ik!;
    expect(ik.links[0].limit!.max[0]).toBeCloseTo(-0.008726646, 5);
    expect(back.bones.find((b) => b.name === '左腕捩')!.fixedAxis).toBeDefined();
    expect(back.morphs.map((m) => [m.name, m.kind])).toEqual(pmx.morphs.map((m) => [m.name, m.kind]));
    expect(back.rigidBodies.map((r) => [r.name, r.collidesWith, r.mode])).toEqual(
      pmx.rigidBodies.map((r) => [r.name, r.collidesWith, r.mode]),
    );
    expect(back.joints.length).toBe(pmx.joints.length);
    const v = pmx.vertices.findIndex((x) => x.bones.length === 2);
    expect(back.vertices[v].bones).toEqual(pmx.vertices[v].bones);
    expect(back.vertices[v].weights[0]).toBeCloseTo(pmx.vertices[v].weights[0], 5);
    // Second trip is byte-identical.
    expect(new Uint8Array(writePmx(back))).toEqual(new Uint8Array(writePmx(await roundTrip(back))));
  });

  it('keeps SDEF / QDEF, additional UVs, uv / flip / impulse morphs, custom toon and external parent', async () => {
    const { pmx } = makeEditFixture();
    pmx.additionalUvCount = 1;
    pmx.vertices.forEach((v) => (v.addUv = [[0.1, 0.2, 0.3, 0.4]]));
    pmx.vertices[0] = {
      ...pmx.vertices[0],
      bones: [2, 3],
      weights: [0.3, 0.7],
      sdef: { c: [0, 10, 0], r0: [0, 10.5, 0], r1: [0, 9.5, 0] },
    };
    pmx.vertices[1] = {
      ...pmx.vertices[1],
      bones: [2, 3, 4, 5],
      weights: [0.25, 0.25, 0.25, 0.25],
      qdef: true,
    };
    pmx.textures.push('tex/toon.png');
    pmx.materials[0].sharedToon = -1;
    pmx.materials[0].toon = pmx.textures.length - 1;
    pmx.bones[6].externalParent = 3;
    pmx.morphs.push(
      {
        kind: 'uv',
        name: 'uv',
        nameEn: 'uv',
        panel: 4,
        uvIndex: 1,
        offsets: [{ vertex: 2, offset: [0.1, 0, 0, 0] }],
      },
      { kind: 'flip', name: 'flip', nameEn: 'flip', panel: 4, offsets: [{ morph: 0, weight: 1 }] },
      {
        kind: 'impulse',
        name: 'imp',
        nameEn: 'imp',
        panel: 4,
        offsets: [{ body: 0, local: true, velocity: [0, 1, 0], torque: [0, 0, 0] }],
      },
    );
    const back = await roundTrip(pmx);
    expect(back.additionalUvCount).toBe(1);
    expect(back.vertices[5].addUv![0][3]).toBeCloseTo(0.4, 5);
    expect(back.vertices[0].sdef!.r0[1]).toBeCloseTo(10.5, 5);
    expect(back.vertices[1].qdef).toBe(true);
    expect(back.materials[0].toon).toBe(pmx.textures.length - 1);
    expect(back.bones[6].externalParent).toBe(3);
    const tail = back.morphs.slice(-3);
    expect(tail.map((m) => m.kind)).toEqual(['uv', 'flip', 'impulse']);
    expect(tail[0].kind === 'uv' && tail[0].uvIndex).toBe(1);
  });
});
