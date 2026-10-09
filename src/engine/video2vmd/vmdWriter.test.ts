import Encoding from 'encoding-japanese';
import { VmdObject } from 'babylon-mmd/esm/Loader/Parser/vmdObject';
import { describe, expect, it } from 'vitest';
import { summarizeVmd } from '@/lib/vmd';
import {
  LINEAR_INTERPOLATION,
  VMD_BONE_KEY_BYTES,
  VMD_MORPH_KEY_BYTES,
  normalizeBoneKeys,
  normalizeMorphKeys,
  shiftJis,
  writeVmd,
  type BoneKey,
} from './vmdWriter';

const key = (bone: string, frame: number, rot: [number, number, number, number] = [0, 0, 0, 1]): BoneKey => ({
  bone,
  frame,
  position: [0, 0, 0],
  rotation: rot,
});

const sjis = (s: string): number[] =>
  Encoding.convert(Encoding.stringToCode(s), { to: 'SJIS', from: 'UNICODE' }) as number[];

describe('vmd writer', () => {
  it('writes the 30-byte zero-padded header and 20-byte Shift-JIS model name', () => {
    const buf = new Uint8Array(writeVmd({ modelName: '初音ミク', bones: [] }));
    const sig = 'Vocaloid Motion Data 0002';
    expect(Array.from(buf.slice(0, sig.length))).toEqual([...sig].map((c) => c.charCodeAt(0)));
    expect(Array.from(buf.slice(sig.length, 30))).toEqual([0, 0, 0, 0, 0]);
    const name = sjis('初音ミク');
    expect(Array.from(buf.slice(30, 30 + name.length))).toEqual(name);
    expect(buf.slice(30 + name.length, 50).every((b) => b === 0)).toBe(true);
  });

  it('uses 111-byte bone records and writes all section counts', () => {
    const keys = [key('センター', 0), key('センター', 10), key('上半身', 0)];
    const buf = writeVmd({ modelName: 'm', bones: keys });
    // header + name + count + records + 4 empty sections + property count
    expect(buf.byteLength).toBe(30 + 20 + 4 + 3 * VMD_BONE_KEY_BYTES + 4 * 4 + 4);
    expect(VMD_BONE_KEY_BYTES).toBe(111);
    const view = new DataView(buf);
    expect(view.getUint32(50, true)).toBe(3);
    const after = 54 + 3 * 111;
    for (let i = 0; i < 5; i++) expect(view.getUint32(after + i * 4, true)).toBe(0);
    expect(summarizeVmd(buf)).toMatchObject({ boneKeyCount: 3, morphKeyCount: 0, cameraKeyCount: 0 });
  });

  it('encodes bone names as 15-byte Shift-JIS and fields little-endian', () => {
    const buf = writeVmd({
      modelName: 'm',
      bones: [{ bone: '左足ＩＫ', frame: 42, position: [1.5, -2, 3], rotation: [0.1, 0.2, 0.3, 0.9] }],
    });
    const bytes = new Uint8Array(buf);
    const view = new DataView(buf);
    const name = sjis('左足ＩＫ');
    expect(Array.from(bytes.slice(54, 54 + name.length))).toEqual(name);
    expect(bytes.slice(54 + name.length, 54 + 15).every((b) => b === 0)).toBe(true);
    expect(view.getUint32(54 + 15, true)).toBe(42);
    expect(view.getFloat32(54 + 19, true)).toBeCloseTo(1.5);
    expect(view.getFloat32(54 + 23, true)).toBeCloseTo(-2);
    expect(view.getFloat32(54 + 43, true)).toBeCloseTo(0.9);
    expect(Array.from(bytes.slice(54 + 47, 54 + 111))).toEqual(Array.from(LINEAR_INTERPOLATION));
  });

  it('linear interpolation block follows the MMD row layout with physics on', () => {
    const b = LINEAR_INTERPOLATION;
    expect(b.length).toBe(64);
    expect([b[0], b[1], b[2], b[3]]).toEqual([20, 20, 0, 0]);
    expect([b[4], b[8], b[12]]).toEqual([20, 107, 107]);
    expect(Array.from(b.slice(16, 32))).toEqual([
      20, 20, 20, 20, 20, 20, 20, 107, 107, 107, 107, 107, 107, 107, 107, 0,
    ]);
    expect(Array.from(b.slice(60, 64))).toEqual([107, 0, 0, 0]);
  });

  it('never splits a double-byte character when truncating', () => {
    // 8 full-width characters = 16 bytes; only 7 fit in 15 bytes.
    expect(shiftJis('あいうえおかきく', 15).length).toBe(14);
    expect(shiftJis('abc', 15).length).toBe(3);
  });

  it('sorts by bone then frame and drops duplicate frames', () => {
    const out = normalizeBoneKeys([key('b', 5), key('a', 3), key('b', 1), key('b', 5, [0, 0, 1, 0])]);
    expect(out.map((k) => `${k.bone}${k.frame}`)).toEqual(['a3', 'b1', 'b5']);
    expect(out[2].rotation).toEqual([0, 0, 1, 0]);
  });

  it('round-trips through the babylon-mmd VMD parser', () => {
    const bones: BoneKey[] = [];
    const names = ['センター', '上半身', '下半身', '左腕', '右ひじ', '左足ＩＫ', '右つま先ＩＫ'];
    for (const n of names)
      for (let f = 0; f < 30; f += 3) bones.push(key(n, f, [0, Math.sin(f / 10), 0, Math.cos(f / 10)]));
    const buf = writeVmd({
      modelName: 'テスト',
      bones,
      properties: [{ frame: 0, visible: true, ik: [{ bone: '左足ＩＫ', enabled: false }] }],
    });
    const vmd = VmdObject.ParseFromBuffer(buf);
    expect(vmd.boneKeyFrames.length).toBe(bones.length);
    const parsed = new Set<string>();
    let maxFrame = 0;
    for (let i = 0; i < vmd.boneKeyFrames.length; i++) {
      const k = vmd.boneKeyFrames.get(i);
      parsed.add(k.boneName);
      maxFrame = Math.max(maxFrame, k.frameNumber);
    }
    expect([...parsed].sort()).toEqual([...names].sort());
    expect(maxFrame).toBe(27);
    const first = vmd.boneKeyFrames.get(0);
    expect(first.rotation[3]).toBeCloseTo(1);
    expect(vmd.propertyKeyFrames).toHaveLength(1);
    expect(vmd.propertyKeyFrames[0].ikStates[0]).toEqual(['左足ＩＫ', false]);
  });

  it('loads as an MmdAnimation with the right tracks and length', async () => {
    const { NullEngine } = await import('@babylonjs/core/Engines/nullEngine');
    const { Scene } = await import('@babylonjs/core/scene');
    const { VmdLoader } = await import('babylon-mmd/esm/Loader/vmdLoader');
    const scene = new Scene(new NullEngine());
    const bones = [key('センター', 0), key('センター', 60), key('左足ＩＫ', 0), key('左足ＩＫ', 60)];
    bones[1].position = [0, 2, 0];
    bones[3].position = [1, 0, 0];
    const buf = writeVmd({
      modelName: 'x',
      bones,
      properties: [{ frame: 0, visible: true, ik: [{ bone: '左足ＩＫ', enabled: false }] }],
    });
    const loader = new VmdLoader(scene);
    loader.loggingEnabled = false;
    const anim = await loader.loadFromBufferAsync('t', buf);
    const names = [...anim.boneTracks, ...anim.movableBoneTracks].map((t) => t.name).sort();
    expect(names).toEqual(['センター', '左足ＩＫ']);
    expect(anim.endFrame).toBe(60);
    expect(anim.propertyTrack.ikBoneNames).toEqual(['左足ＩＫ']);
    scene.dispose();
  });

  it('writes 23-byte morph records: 15-byte Shift-JIS name, uint32 frame, float32 weight', () => {
    const buf = writeVmd({
      modelName: 'm',
      bones: [key('センター', 0)],
      morphs: [
        { morph: 'まばたき', frame: 12, weight: 0.75 },
        { morph: 'あ', frame: 3, weight: 1 },
      ],
    });
    expect(VMD_MORPH_KEY_BYTES).toBe(23);
    expect(buf.byteLength).toBe(30 + 20 + 4 + 111 + 4 + 2 * 23 + 4 * 3 + 4);
    const bytes = new Uint8Array(buf);
    const view = new DataView(buf);
    const m0 = 54 + 111;
    expect(view.getUint32(m0, true)).toBe(2);
    // Sorted by name (code unit order): あ (U+3042) before まばたき (U+307E).
    const a = sjis('あ');
    expect(Array.from(bytes.slice(m0 + 4, m0 + 4 + a.length))).toEqual(a);
    expect(bytes.slice(m0 + 4 + a.length, m0 + 4 + 15).every((b) => b === 0)).toBe(true);
    expect(view.getUint32(m0 + 4 + 15, true)).toBe(3);
    expect(view.getFloat32(m0 + 4 + 19, true)).toBe(1);
    const r2 = m0 + 4 + 23;
    const blink = sjis('まばたき');
    expect(Array.from(bytes.slice(r2, r2 + blink.length))).toEqual(blink);
    expect(view.getUint32(r2 + 15, true)).toBe(12);
    expect(view.getFloat32(r2 + 19, true)).toBe(0.75);
    expect(summarizeVmd(buf)).toMatchObject({ boneKeyCount: 1, morphKeyCount: 2 });
  });

  it('sorts morph keys by name then frame and drops duplicates', () => {
    const out = normalizeMorphKeys([
      { morph: 'う', frame: 4, weight: 0.1 },
      { morph: 'あ', frame: 9, weight: 0.2 },
      { morph: 'う', frame: 1, weight: 0.3 },
      { morph: 'う', frame: 4, weight: 0.9 },
    ]);
    expect(out.map((k) => `${k.morph}${k.frame}:${k.weight}`)).toEqual(['あ9:0.2', 'う1:0.3', 'う4:0.9']);
  });

  it('round-trips body, finger and morph tracks through babylon-mmd', async () => {
    const bones: BoneKey[] = [];
    const names = ['センター', '左腕', '左人指１', '左人指２', '右親指０', '右小指３', '両目'];
    for (const n of names)
      for (let f = 0; f <= 30; f += 5) bones.push(key(n, f, [Math.sin(f / 20), 0, 0, Math.cos(f / 20)]));
    const morphs = ['まばたき', 'あ', 'ウィンク右'].flatMap((m, i) =>
      [0, 10, 20, 30].map((f) => ({ morph: m, frame: f, weight: ((f / 10 + i) % 3) / 2 })),
    );
    const buf = writeVmd({ modelName: 'テスト', bones, morphs });
    const vmd = VmdObject.ParseFromBuffer(buf);
    expect(vmd.boneKeyFrames.length).toBe(bones.length);
    expect(vmd.morphKeyFrames.length).toBe(morphs.length);
    const morphNames = new Set<string>();
    for (let i = 0; i < vmd.morphKeyFrames.length; i++) morphNames.add(vmd.morphKeyFrames.get(i).morphName);
    expect([...morphNames].sort()).toEqual(['あ', 'ウィンク右', 'まばたき'].sort());

    const { NullEngine } = await import('@babylonjs/core/Engines/nullEngine');
    const { Scene } = await import('@babylonjs/core/scene');
    const { VmdLoader } = await import('babylon-mmd/esm/Loader/vmdLoader');
    const scene = new Scene(new NullEngine());
    const loader = new VmdLoader(scene);
    loader.loggingEnabled = false;
    const anim = await loader.loadFromBufferAsync('t', buf);
    const tracks = [...anim.boneTracks, ...anim.movableBoneTracks].map((t) => t.name).sort();
    expect(tracks).toEqual([...names].sort());
    const blink = anim.morphTracks.find((t) => t.name === 'まばたき')!;
    expect(Array.from(blink.frameNumbers)).toEqual([0, 10, 20, 30]);
    expect(blink.weights[1]).toBeCloseTo(0.5);
    expect(anim.endFrame).toBe(30);
    scene.dispose();
  });
});
