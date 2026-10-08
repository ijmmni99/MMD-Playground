import { PmxReader } from 'babylon-mmd/esm/Loader/Parser/pmxReader';
import { describe, expect, it } from 'vitest';
import { BoneFlag, MaterialFlag, type PmxModel, type PmxVertex } from './types';
import { validatePmx } from './validate';
import { indexSize, writePmx } from './writer';

const vtx = (x: number, y: number, z: number, bones: number[], weights: number[]): PmxVertex => ({
  position: [x, y, z],
  normal: [0, 0, -1],
  uv: [0, 0],
  bones,
  weights,
  edgeScale: 1,
});

/** Tiny hand-built model touching every record type. */
export function handModel(extraVerts = 0): PmxModel {
  const vertices = [vtx(0, 0, 0, [0], [1]), vtx(1, 0, 0, [0, 1], [0.5, 0.5]), vtx(0, 1, 0, [0, 1, 2], [0.5, 0.3, 0.2])];
  for (let i = 0; i < extraVerts; i++) vertices.push(vtx(i * 0.001, 2, 0, [1], [1]));
  return {
    name: 'テストモデル',
    nameEn: 'Test model',
    comment: 'コメント',
    commentEn: 'comment',
    vertices,
    indices: [0, 2, 1],
    textures: ['tex/body.png'],
    materials: [
      {
        name: '体',
        nameEn: 'body',
        diffuse: [1, 0.8, 0.7, 1],
        specular: [0.1, 0.1, 0.1],
        shininess: 5,
        ambient: [0.5, 0.4, 0.35],
        flags: MaterialFlag.Edge | MaterialFlag.DrawShadow,
        edgeColor: [0, 0, 0, 1],
        edgeSize: 1,
        texture: 0,
        sphere: -1,
        sphereMode: 0,
        sharedToon: 0,
        memo: '',
        indexCount: 3,
      },
    ],
    bones: [
      { name: '全ての親', nameEn: 'master', position: [0, 0, 0], parent: -1, layer: 0, flags: BoneFlag.Rotatable | BoneFlag.Movable | BoneFlag.Visible | BoneFlag.Enabled, tail: 1 },
      { name: '左足', nameEn: 'leg_L', position: [1, 8, 0], parent: 0, layer: 0, flags: BoneFlag.Rotatable | BoneFlag.Visible | BoneFlag.Enabled, tail: 2 },
      { name: '左ひざ', nameEn: 'knee_L', position: [1, 4, 0], parent: 1, layer: 0, flags: BoneFlag.Rotatable | BoneFlag.Visible | BoneFlag.Enabled, tail: [0, -3, 0] },
      { name: '左足首', nameEn: 'ankle_L', position: [1, 1, 0], parent: 2, layer: 0, flags: BoneFlag.Rotatable | BoneFlag.Visible | BoneFlag.Enabled, tail: [0, 0, -1], localAxis: { x: [1, 0, 0], z: [0, 0, 1] } },
      {
        name: '左足ＩＫ',
        nameEn: 'leg IK_L',
        position: [1, 1, 0],
        parent: 0,
        layer: 0,
        flags: BoneFlag.Rotatable | BoneFlag.Movable | BoneFlag.Visible | BoneFlag.Enabled,
        tail: [0, 0, 1],
        ik: { target: 3, loop: 40, limit: 2, links: [{ bone: 2, limit: { min: [-Math.PI, 0, 0], max: [-0.008, 0, 0] } }, { bone: 1 }] },
      },
      { name: '左腕捩', nameEn: 'arm twist_L', position: [2, 14, 0], parent: 0, layer: 0, flags: BoneFlag.Rotatable | BoneFlag.Visible | BoneFlag.Enabled, tail: [0, 0, 0], fixedAxis: [1, 0, 0] },
      { name: '腰キャンセル左', nameEn: 'waist cancel_L', position: [1, 9, 0], parent: 0, layer: 0, flags: BoneFlag.Rotatable | BoneFlag.Enabled, tail: [0, 0, 0], append: { parent: 1, ratio: -1, rotate: true, move: false } },
    ],
    morphs: [
      { kind: 'vertex', name: 'まばたき', nameEn: 'blink', panel: 2, offsets: [{ vertex: 2, offset: [0, -0.1, 0] }] },
      { kind: 'vertex', name: 'あ', nameEn: 'a', panel: 3, offsets: [{ vertex: 1, offset: [0, 0.05, 0] }] },
      { kind: 'group', name: '笑い', nameEn: 'smile', panel: 2, offsets: [{ morph: 0, weight: 0.7 }, { morph: 1, weight: 0.3 }] },
    ],
    frames: [
      { name: 'Root', nameEn: 'Root', special: true, items: [{ kind: 'bone', index: 0 }] },
      { name: '表情', nameEn: 'Exp', special: true, items: [{ kind: 'morph', index: 0 }, { kind: 'morph', index: 2 }] },
      { name: '足', nameEn: 'Legs', special: false, items: [{ kind: 'bone', index: 1 }, { kind: 'bone', index: 4 }] },
    ],
    rigidBodies: [
      { name: '頭', nameEn: 'head', bone: 0, group: 0, collidesWith: 0xffff, shape: 0, size: [1, 0, 0], position: [0, 16, 0], rotation: [0, 0, 0], mass: 1, linearDamping: 0.5, angularDamping: 0.5, restitution: 0, friction: 0.5, mode: 0 },
      { name: '髪1', nameEn: 'hair1', bone: 1, group: 1, collidesWith: 0xffff & ~(1 << 1), shape: 2, size: [0.3, 1, 0], position: [0, 15, 0.5], rotation: [0.2, 0, 0], mass: 0.5, linearDamping: 0.9, angularDamping: 0.9, restitution: 0, friction: 0.5, mode: 1 },
    ],
    joints: [
      { name: '髪1J', nameEn: 'hair1J', a: 0, b: 1, position: [0, 15.5, 0.4], rotation: [0, 0, 0], moveMin: [0, 0, 0], moveMax: [0, 0, 0], rotateMin: [-0.5, -0.1, -0.5], rotateMax: [0.5, 0.1, 0.5], springMove: [0, 0, 0], springRotate: [50, 50, 50] },
    ],
  };
}

describe('PMX writer', () => {
  it('validates the hand-built model', () => {
    expect(validatePmx(handModel(), new Set(['tex/body.png']))).toEqual([]);
  });

  it('writes the header with dynamic index sizes', () => {
    const buf = writePmx(handModel());
    const dv = new DataView(buf);
    expect(new TextDecoder().decode(new Uint8Array(buf, 0, 4))).toBe('PMX ');
    expect(dv.getFloat32(4, true)).toBe(2);
    expect(dv.getUint8(8)).toBe(8);
    expect([...new Uint8Array(buf, 9, 8)]).toEqual([0, 0, 1, 1, 1, 1, 1, 1]);
    expect(indexSize(255, true)).toBe(1);
    expect(indexSize(256, true)).toBe(2);
    expect(indexSize(70000, true)).toBe(4);
    expect(indexSize(126)).toBe(1);
    expect(indexSize(127)).toBe(2);
    expect(indexSize(40000)).toBe(4);
    // Model name, UTF-16LE.
    const len = dv.getInt32(17, true);
    expect(len).toBe('テストモデル'.length * 2);
    expect(new TextDecoder('utf-16le').decode(new Uint8Array(buf, 21, len))).toBe('テストモデル');
  });

  for (const extra of [0, 300]) {
    it(`round-trips through babylon-mmd's PMX reader (${extra ? '2-byte' : '1-byte'} vertex indices)`, async () => {
      const model = handModel(extra);
      const pmx = await PmxReader.ParseAsync(writePmx(model));
      expect(pmx.header.version).toBe(2);
      expect(pmx.header.modelName).toBe('テストモデル');
      expect(pmx.header.englishModelName).toBe('Test model');
      expect(pmx.vertices.length).toBe(model.vertices.length);
      expect(pmx.vertices[2].weightType).toBe(2);
      expect(pmx.vertices[1].weightType).toBe(1);
      expect([...pmx.indices]).toEqual([0, 2, 1]);
      expect(pmx.textures).toEqual(['tex/body.png']);
      expect(pmx.materials.map((m) => [m.name, m.indexCount, m.textureIndex, m.isSharedToonTexture])).toEqual([['体', 3, 0, true]]);
      expect(pmx.bones.map((b) => b.name)).toEqual(model.bones.map((b) => b.name));
      const ik = pmx.bones[4].ik!;
      expect(ik.target).toBe(3);
      expect(ik.iteration).toBe(40);
      expect(ik.links[0].limitation?.minimumAngle[0]).toBeCloseTo(-Math.PI, 5);
      expect(pmx.bones[5].axisLimit).toEqual([1, 0, 0]);
      expect(pmx.bones[6].appendTransform?.ratio).toBe(-1);
      expect(pmx.bones[3].localVector?.x).toEqual([1, 0, 0]);
      expect(pmx.morphs.map((m) => [m.name, m.category, m.type])).toEqual([
        ['まばたき', 2, 1],
        ['あ', 3, 1],
        ['笑い', 2, 0],
      ]);
      expect(pmx.displayFrames.map((f) => f.name)).toEqual(['Root', '表情', '足']);
      expect(pmx.rigidBodies.map((r) => [r.name, r.shapeType, r.physicsMode, r.collisionGroup])).toEqual([
        ['頭', 0, 0, 0],
        ['髪1', 2, 1, 1],
      ]);
      expect(pmx.rigidBodies[1].collisionMask).toBe(1 << 1);
      expect(pmx.joints.map((j) => [j.name, j.rigidbodyIndexA, j.rigidbodyIndexB])).toEqual([['髪1J', 0, 1]]);
      expect(pmx.joints[0].springRotation).toEqual([50, 50, 50]);
    });
  }

  it('catches broken models', () => {
    const m = handModel();
    m.vertices[0].weights = [0.5];
    m.bones[1].parent = 2;
    m.indices = [0, 2, 9];
    const msgs = validatePmx(m).map((i) => i.message).join('\n');
    expect(msgs).toMatch(/don't sum to 1/);
    expect(msgs).toMatch(/cycle/);
    expect(msgs).toMatch(/out of range/);
  });
});
