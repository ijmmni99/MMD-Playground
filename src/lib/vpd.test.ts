import { describe, expect, it } from 'vitest';
import { parseVpd, poseToVpd, vpdToPose, writeVpd, type Vpd } from './vpd';

const sample: Vpd = {
  modelName: 'ミク.osm',
  bones: [
    { name: 'センター', position: [0, 1.5, -0.25], rotation: [0, 0, 0, 1] },
    { name: '右腕', position: [0, 0, 0], rotation: [0.1, -0.2, 0.3, 0.9273618] },
  ],
  morphs: { まばたき: 1, あ: 0.5 },
};
const buf = (u: Uint8Array): ArrayBuffer =>
  u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

describe('vpd', () => {
  it('round-trips bones, morphs and Shift-JIS names', () => {
    const out = parseVpd(buf(writeVpd(sample)));
    expect(out.modelName).toBe('ミク.osm');
    expect(out.bones.map((b) => b.name)).toEqual(['センター', '右腕']);
    expect(out.bones[0].position).toEqual([0, 1.5, -0.25]);
    expect(out.bones[1].rotation[1]).toBeCloseTo(-0.2, 6);
    expect(out.morphs).toEqual({ まばたき: 1, あ: 0.5 });
  });

  it('parses a hand-written file with LF endings and exponent numbers', () => {
    const text = [
      'Vocaloid Pose Data file',
      '',
      'a.osm;  // parent',
      '1;',
      '',
      'Bone0{首',
      '  1.0e-1,0,0;',
      '  0,0,0,1;',
      '}',
    ].join('\n');
    const out = parseVpd(buf(new TextEncoder().encode(text)));
    expect(out.bones).toHaveLength(1);
    expect(out.bones[0].position[0]).toBeCloseTo(0.1);
  });

  it('rejects a file without the signature', () => {
    expect(() => parseVpd(buf(new TextEncoder().encode('hello')))).toThrow('Not a VPD file');
  });

  it('skips malformed entries and keeps the rest', () => {
    const text =
      'Vocaloid Pose Data file\n\nx.osm;\n2;\n\nBone0{a\n  1,2;\n}\nBone1{b\n  0,0,0;\n  0,0,0,1;\n}\n';
    expect(parseVpd(buf(new TextEncoder().encode(text))).bones.map((b) => b.name)).toEqual(['b']);
  });

  it('converts to a pose and back, dropping rest bones and zero morphs', () => {
    const pose = vpdToPose(sample);
    expect(pose.version).toBe(1);
    expect(pose.bones).toHaveLength(2);
    const back = poseToVpd({ ...pose, morphs: { ...pose.morphs, 無: 0 } });
    expect(back.bones.map((b) => b.name)).toEqual(['センター', '右腕']);
    expect(Object.keys(back.morphs)).toEqual(['まばたき', 'あ']);
    const rest = poseToVpd({
      version: 1,
      model: 'm',
      bones: [{ name: 'x', position: [0, 0, 0], rotation: [0, 0, 0, 1] }],
      morphs: {},
    });
    expect(rest.bones).toEqual([]);
  });
});
