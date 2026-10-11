import { describe, expect, it } from 'vitest';
import { readVmdLightTracks, sampleLight, sampleSelfShadow } from './vmdLight';

function buildVmd(opts: {
  lights?: { frame: number; color: number[]; dir: number[] }[];
  shadows?: { frame: number; mode: number; distance: number }[];
  bones?: number;
  truncate?: number;
}): ArrayBuffer {
  const lights = opts.lights ?? [];
  const shadows = opts.shadows ?? [];
  const bones = opts.bones ?? 0;
  const size = 50 + 4 + bones * 111 + 4 + 4 + 4 + lights.length * 28 + 4 + shadows.length * 9;
  const buf = new ArrayBuffer(size);
  const v = new DataView(buf);
  new Uint8Array(buf).set(new TextEncoder().encode('Vocaloid Motion Data 0002'));
  let o = 50;
  v.setUint32(o, bones, true);
  o += 4 + bones * 111;
  v.setUint32(o, 0, true); // morphs
  o += 4;
  v.setUint32(o, 0, true); // cameras
  o += 4;
  v.setUint32(o, lights.length, true);
  o += 4;
  for (const l of lights) {
    v.setUint32(o, l.frame, true);
    l.color.forEach((c, i) => v.setFloat32(o + 4 + i * 4, c, true));
    l.dir.forEach((c, i) => v.setFloat32(o + 16 + i * 4, c, true));
    o += 28;
  }
  v.setUint32(o, shadows.length, true);
  o += 4;
  for (const s of shadows) {
    v.setUint32(o, s.frame, true);
    v.setUint8(o + 4, s.mode);
    v.setFloat32(o + 5, s.distance, true);
    o += 9;
  }
  return opts.truncate === undefined ? buf : buf.slice(0, opts.truncate);
}

describe('readVmdLightTracks', () => {
  it('reads light and self-shadow keys after other sections', () => {
    const buf = buildVmd({
      bones: 2,
      lights: [
        { frame: 30, color: [1, 0.5, 0.25], dir: [-0.5, -1, 0.5] },
        { frame: 0, color: [0.6, 0.6, 0.6], dir: [0, -1, 0] },
      ],
      shadows: [{ frame: 10, mode: 1, distance: 0.8 }],
    });
    const t = readVmdLightTracks(buf);
    expect(t.light.map((k) => k.frame)).toEqual([0, 30]);
    expect(t.light[1].color[1]).toBeCloseTo(0.5);
    expect(t.light[1].direction[2]).toBeCloseTo(0.5);
    expect(t.selfShadow).toEqual([{ frame: 10, mode: 1, distance: expect.closeTo(0.8, 5) }]);
  });

  it('returns empty tracks when the file has none', () => {
    const t = readVmdLightTracks(buildVmd({}));
    expect(t.light).toEqual([]);
    expect(t.selfShadow).toEqual([]);
  });

  it('does not throw on a truncated file', () => {
    const buf = buildVmd({ lights: [{ frame: 0, color: [1, 1, 1], dir: [0, -1, 0] }] });
    expect(readVmdLightTracks(buf.slice(0, 60)).light).toEqual([]);
    expect(readVmdLightTracks(buf.slice(0, 40)).light).toEqual([]);
  });
});

describe('sampleLight', () => {
  const keys = [
    {
      frame: 0,
      color: [0, 0, 0] as [number, number, number],
      direction: [0, -1, 0] as [number, number, number],
    },
    {
      frame: 10,
      color: [1, 1, 1] as [number, number, number],
      direction: [1, -1, 0] as [number, number, number],
    },
  ];
  it('is null for no keys', () => expect(sampleLight([], 5)).toBeNull());
  it('holds before the first and after the last key', () => {
    expect(sampleLight(keys, -5)?.color).toEqual([0, 0, 0]);
    expect(sampleLight(keys, 99)?.color).toEqual([1, 1, 1]);
  });
  it('interpolates linearly between keys', () => {
    const s = sampleLight(keys, 5)!;
    expect(s.color[0]).toBeCloseTo(0.5);
    expect(s.direction[0]).toBeCloseTo(0.5);
  });
});

describe('sampleSelfShadow', () => {
  const keys = [
    { frame: 5, mode: 1, distance: 0.5 },
    { frame: 20, mode: 0, distance: 0 },
  ];
  it('is null before the first key', () => expect(sampleSelfShadow(keys, 2)).toBeNull());
  it('steps to the latest key', () => {
    expect(sampleSelfShadow(keys, 5)?.mode).toBe(1);
    expect(sampleSelfShadow(keys, 19)?.mode).toBe(1);
    expect(sampleSelfShadow(keys, 20)?.mode).toBe(0);
  });
});
