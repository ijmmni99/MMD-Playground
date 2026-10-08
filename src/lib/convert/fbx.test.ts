import { describe, expect, it } from 'vitest';
import { parseFbx } from './fbx';
import { makeHumanoidFbx } from './fixtureFbx';
import { convertModel } from './pipeline';

describe('FBX', () => {
  it('parses a skinned ASCII FBX (cm units, blend shapes, embedded texture)', async () => {
    const bytes = makeHumanoidFbx();
    const m = await parseFbx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    expect(m.format).toBe('fbx');
    const hips = m.bones.find((b) => b.name === 'mixamorigHips')!;
    expect(hips.position[1]).toBeCloseTo(95, 1);
    expect(m.meshes.length).toBe(2);
    expect(m.meshes[0].morphs.map((x) => x.name)).toEqual(['eyesClosed', 'jawOpen', 'eyeBlinkRight']);
    expect(m.textures).toHaveLength(1);
    expect(m.textures[0].data.length).toBeGreaterThan(50);
    const ys = Array.from(m.meshes[0].positions).filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys)).toBeGreaterThan(150);
  });

  it('converts the FBX into a rigged PMX', async () => {
    const bytes = makeHumanoidFbx();
    const m = await parseFbx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const r = convertModel(m);
    expect(r.mapping.weak).toEqual([]);
    expect(r.validation.filter((v) => v.level === 'error')).toEqual([]);
    expect(r.pmx.bones.map((b) => b.name)).toContain('左足ＩＫ');
    expect(r.pmx.morphs.map((x) => x.name)).toEqual(expect.arrayContaining(['まばたき', 'あ', 'ウィンク右']));
    expect(r.pmx.textures).toHaveLength(1);
  });
});
