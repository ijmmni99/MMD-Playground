import Encoding from 'encoding-japanese';
import { BezierInterpolate } from 'babylon-mmd/esm/Runtime/Animation/bezierInterpolate';
import { describe, expect, it } from 'vitest';
import { bezierWeight, curveWeight } from './bezier';
import { sampleBone, sampleCamera } from './evaluate';
import { makeClip, rng } from './fixtures';
import { boneInterpolationBlock, readVmd, RECORD, writeVmd } from './vmd';

const loadAnimation = async (buf: ArrayBuffer) => {
  const { NullEngine } = await import('@babylonjs/core/Engines/nullEngine');
  const { Scene } = await import('@babylonjs/core/scene');
  const { VmdLoader } = await import('babylon-mmd/esm/Loader/vmdLoader');
  const scene = new Scene(new NullEngine());
  const loader = new VmdLoader(scene);
  loader.loggingEnabled = false;
  const anim = await loader.loadFromBufferAsync('t', buf);
  scene.dispose();
  return anim;
};

describe('VMD read/write', () => {
  it('round-trips every section exactly (values, curves, names)', () => {
    const clip = makeClip(7, { randomCurves: true });
    const back = readVmd(writeVmd(clip));
    const sort = <T extends { name: string }>(a: T[]) => [...a].sort((x, y) => (x.name < y.name ? -1 : 1));
    expect(back.modelName).toBe(clip.modelName);
    expect(sort(back.bones)).toEqual(sort(clip.bones));
    expect(sort(back.morphs)).toEqual(sort(clip.morphs));
    expect(back.camera).toEqual(clip.camera);
    expect(back.lights).toEqual(clip.lights);
    expect(back.shadows).toEqual(clip.shadows);
    expect(back.props).toEqual(clip.props);
  });

  it('is stable: write(read(write(x))) is byte-identical', () => {
    const a = new Uint8Array(writeVmd(makeClip(3, { randomCurves: true })));
    const b = new Uint8Array(writeVmd(readVmd(a.buffer)));
    expect(b).toEqual(a);
  });

  it('uses 23-byte morph and 61-byte camera records', () => {
    expect(RECORD.morph).toBe(23);
    expect(RECORD.camera).toBe(61);
    const clip = makeClip(1);
    const empty = writeVmd({
      ...clip,
      bones: [],
      morphs: [],
      camera: [],
      lights: [],
      shadows: [],
      props: [],
    }).byteLength;
    const morphOnly = writeVmd({
      ...clip,
      bones: [],
      camera: [],
      lights: [],
      shadows: [],
      props: [],
    }).byteLength;
    const camOnly = writeVmd({
      ...clip,
      bones: [],
      morphs: [],
      lights: [],
      shadows: [],
      props: [],
    }).byteLength;
    const nMorph = clip.morphs.reduce((n, t) => n + t.keys.length, 0);
    expect(morphOnly - empty).toBe(nMorph * 23);
    expect(camOnly - empty).toBe(clip.camera.length * 61);
  });

  it('writes morph and camera records byte-exactly', () => {
    const buf = writeVmd({
      modelName: '',
      bones: [],
      morphs: [{ name: 'あ', keys: [{ f: 7, w: 0.5 }] }],
      camera: [
        {
          f: 9,
          t: [1, 2, 3],
          r: [0.1, 0.2, 0.3],
          d: -45,
          fov: 30,
          persp: true,
          ip: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24],
        },
      ],
      lights: [],
      shadows: [],
      props: [],
    });
    const v = new DataView(buf);
    const b = new Uint8Array(buf);
    let o = 54; // header 30 + name 20 + bone count 4
    expect(v.getUint32(o, true)).toBe(1);
    o += 4;
    const name = Encoding.convert(Encoding.stringToCode('あ'), { to: 'SJIS', from: 'UNICODE' });
    expect(Array.from(b.slice(o, o + name.length))).toEqual(name);
    expect(v.getUint32(o + 15, true)).toBe(7);
    expect(v.getFloat32(o + 19, true)).toBe(0.5);
    o += 23;
    expect(v.getUint32(o, true)).toBe(1);
    o += 4;
    expect(v.getUint32(o, true)).toBe(9);
    expect(v.getFloat32(o + 4, true)).toBe(-45);
    expect(v.getFloat32(o + 8, true)).toBe(1);
    expect(v.getFloat32(o + 20, true)).toBeCloseTo(0.1);
    // Interpolation: x1, x2, y1, y2 per channel (curves stored as x1, y1, x2, y2).
    expect(Array.from(b.slice(o + 32, o + 36))).toEqual([1, 3, 2, 4]);
    expect(v.getUint32(o + 56, true)).toBe(30);
    expect(b[o + 60]).toBe(0); // perspective on
  });

  it('bone interpolation block matches the MMD row layout', () => {
    const ip = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]; // X(x1,y1,x2,y2) Y Z R
    const b = boneInterpolationBlock(ip);
    // Row c, offsets 0/4/8/12 = channel c's x1, y1, x2, y2.
    for (let c = 0; c < 4; c++)
      expect([b[c * 16], b[c * 16 + 4], b[c * 16 + 8], b[c * 16 + 12]]).toEqual(ip.slice(c * 4, c * 4 + 4));
    expect([b[2], b[3]]).toEqual([0, 0]);
    expect(Array.from(boneInterpolationBlock(ip, 0x630f).slice(2, 4))).toEqual([0x63, 0x0f]);
  });

  it('loads in babylon-mmd with identical keys and interpolation', async () => {
    const clip = makeClip(11, { randomCurves: true });
    const anim = await loadAnimation(writeVmd(clip));
    const tracks = [...anim.boneTracks, ...anim.movableBoneTracks];
    for (const t of clip.bones) {
      const bt = tracks.find((x) => x.name === t.name)!;
      expect(Array.from(bt.frameNumbers)).toEqual(t.keys.map((k) => k.f));
      t.keys.forEach((k, i) => {
        // babylon stores x1, x2, y1, y2.
        expect(Array.from(bt.rotationInterpolations.slice(i * 4, i * 4 + 4))).toEqual([
          k.ip[12],
          k.ip[14],
          k.ip[13],
          k.ip[15],
        ]);
        expect(bt.rotations[i * 4 + 3]).toBeCloseTo(k.r[3], 6);
      });
      if ('positionInterpolations' in bt) {
        const pi = bt.positionInterpolations as Uint8Array;
        t.keys.forEach((k, i) => {
          for (let c = 0; c < 3; c++)
            expect(Array.from(pi.slice(i * 12 + c * 4, i * 12 + c * 4 + 4))).toEqual([
              k.ip[c * 4],
              k.ip[c * 4 + 2],
              k.ip[c * 4 + 1],
              k.ip[c * 4 + 3],
            ]);
        });
      }
    }
    expect(Array.from(anim.cameraTrack.frameNumbers)).toEqual(clip.camera.map((k) => k.f));
    clip.camera.forEach((k, i) => {
      expect(Array.from(anim.cameraTrack.fovInterpolations.slice(i * 4, i * 4 + 4))).toEqual([
        k.ip[20],
        k.ip[22],
        k.ip[21],
        k.ip[23],
      ]);
      expect(anim.cameraTrack.fovs[i]).toBe(k.fov);
    });
    const morph = anim.morphTracks.find((m) => m.name === 'まばたき')!;
    expect(Array.from(morph.frameNumbers)).toEqual([0, 30, 33, 36, 90]);
    expect(anim.propertyTrack.ikBoneNames).toEqual(['左足ＩＫ', '右足ＩＫ']);
  });

  it('keeps the last record when a frame is duplicated', () => {
    const clip = makeClip(1);
    const dup = {
      ...clip,
      bones: [
        {
          name: '頭',
          keys: [
            clip.bones[1].keys[0],
            { ...clip.bones[1].keys[0], r: [0, 1, 0, 0] as [number, number, number, number] },
          ],
        },
      ],
    };
    expect(readVmd(writeVmd(dup)).bones[0].keys).toHaveLength(1);
    expect(readVmd(writeVmd(dup)).bones[0].keys[0].r).toEqual([0, 1, 0, 0]);
  });
});

describe('bezier', () => {
  it('matches babylon-mmd BezierInterpolate exactly', () => {
    const r = rng(5);
    for (let i = 0; i < 500; i++) {
      const [x1, x2, y1, y2, x] = [r(), r(), r(), r(), r()];
      expect(bezierWeight(x1, x2, y1, y2, x)).toBe(BezierInterpolate(x1, x2, y1, y2, x));
    }
  });

  it('linear curve is ~identity; curves are channel-indexed', () => {
    const ip = [20, 20, 107, 107, 127, 0, 127, 0];
    expect(curveWeight(ip, 0, 0.3)).toBeCloseTo(0.3, 2);
    expect(curveWeight(ip, 1, 0.5)).toBeLessThan(0.1); // step-like
  });

  it('samples keys with the later key’s curve; camera holds on consecutive-frame cuts', () => {
    const keys = [
      {
        f: 0,
        p: [0, 0, 0] as [number, number, number],
        r: [0, 0, 0, 1] as [number, number, number, number],
        ip: [20, 20, 107, 107, 20, 20, 107, 107, 20, 20, 107, 107, 20, 20, 107, 107],
      },
      {
        f: 10,
        p: [10, 0, 0] as [number, number, number],
        r: [0, 0, 0, 1] as [number, number, number, number],
        ip: [127, 0, 127, 0, 20, 20, 107, 107, 20, 20, 107, 107, 20, 20, 107, 107],
      },
    ];
    expect(sampleBone(keys, 5).p[0]).toBeLessThan(1); // B's step-like X curve
    const cam = makeClip(1).camera;
    const cut = [cam[0], { ...cam[1], f: cam[0].f + 1 }];
    expect(sampleCamera(cut, cam[0].f + 0.5).d).toBe(cam[0].d);
  });
});
