import { describe, expect, it } from 'vitest';
import { axisAngle, qdistance, rotate } from '@/lib/math3d';
import {
  DEFAULT_FACE_SETTINGS,
  attackRelease,
  blinkPulse,
  computeFaceTracks,
  detectBlinks,
  eyeRotation,
  gazeFromPoints,
  headFromMatrix,
  mirrorBlend,
  reduceCurve,
  resolveMorphs,
  sourceValue,
  vowelsFromBlend,
} from './face';
import { blinkAt, fixtureCameras, syntheticScene, viewFrame, vowelAt } from './synthetic';
import { BLENDSHAPES, BLEND_INDEX, type Blendshape } from './types';

const blendOf = (v: Partial<Record<Blendshape, number>>) => {
  const b = new Array<number>(BLENDSHAPES.length).fill(0);
  for (const [k, x] of Object.entries(v)) b[BLEND_INDEX[k as Blendshape]] = x!;
  return (n: Blendshape) => b[BLEND_INDEX[n]];
};

const SIZE: [number, number] = [640, 360];

describe('blendshape → MMD morph mapping', () => {
  it('derives vowels from mouth blendshapes', () => {
    expect(vowelsFromBlend(blendOf({ jawOpen: 0.8 })).a).toBeGreaterThan(0.7);
    expect(vowelsFromBlend(blendOf({ mouthPucker: 0.9, jawOpen: 0.1 })).u).toBeGreaterThan(0.7);
    const o = vowelsFromBlend(blendOf({ mouthFunnel: 0.75, jawOpen: 0.6 }));
    expect(o.o).toBeGreaterThan(o.a);
    const i = vowelsFromBlend(
      blendOf({ mouthSmileLeft: 0.7, mouthSmileRight: 0.7, mouthStretchLeft: 0.5, mouthStretchRight: 0.5 }),
    );
    expect(i.i).toBeGreaterThan(0.5);
    const all = vowelsFromBlend(
      blendOf({
        jawOpen: 1,
        mouthStretchLeft: 1,
        mouthStretchRight: 1,
        mouthSmileLeft: 1,
        mouthSmileRight: 1,
      }),
    );
    expect(all.a + all.i + all.u + all.e + all.o).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('reads named sources and raw blendshapes; mirror swaps sides', () => {
    expect(sourceValue('winkLeft', blendOf({ eyeBlinkLeft: 0.9, eyeBlinkRight: 0.1 }))).toBeCloseTo(0.8);
    expect(sourceValue('blink', blendOf({ eyeBlinkLeft: 0.9, eyeBlinkRight: 0.7 }))).toBeCloseTo(0.7);
    expect(sourceValue('bs:cheekPuff', blendOf({ cheekPuff: 0.4 }))).toBeCloseTo(0.4);
    const raw = new Array<number>(BLENDSHAPES.length).fill(0);
    raw[BLEND_INDEX.eyeBlinkLeft] = 1;
    expect(mirrorBlend(raw)[BLEND_INDEX.eyeBlinkRight]).toBe(1);
  });

  it('only writes morphs the model has, resolving common aliases', () => {
    const r = resolveMorphs(DEFAULT_FACE_SETTINGS.map, ['瞬き', 'あ', 'ウインク右', '眉上']);
    const by = Object.fromEntries(r.map((x) => [x.entry.morph, x.name]));
    expect(by['まばたき']).toBe('瞬き');
    expect(by['ウィンク右']).toBe('ウインク右');
    expect(by['上']).toBe('眉上');
    expect(by['い']).toBeNull();
    expect(resolveMorphs(DEFAULT_FACE_SETTINGS.map, null)[0].name).toBe('まばたき');
  });

  it('applies gain, offset, enable and the deadzone', () => {
    const frames = Array.from({ length: 30 }, (_, i) => {
      const b = new Array<number>(BLENDSHAPES.length).fill(0);
      b[BLEND_INDEX.browDownLeft] = 0.5;
      b[BLEND_INDEX.browDownRight] = 0.5;
      return {
        time: i / 30,
        face: {
          score: 0.9,
          blend: b,
          matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          points: new Array(38).fill(0.5),
          crop: { x: 0, y: 0, w: 1, h: 1 },
        },
      };
    });
    const times = frames.map((f) => f.time);
    const run = (gain: number, offset: number, enabled = true) =>
      computeFaceTracks(
        frames,
        times,
        {
          ...DEFAULT_FACE_SETTINGS,
          map: [{ morph: '怒り', source: 'browDown', gain, offset, enabled, group: 'brow' }],
        },
        { mirror: false, modelMorphs: null, size: SIZE, fps: 30 },
      );
    const dz = DEFAULT_FACE_SETTINGS.deadzone;
    expect(run(1, 0).morphs.get('怒り')![15]).toBeCloseTo((0.5 - dz) / (1 - dz), 2);
    expect(run(2, 0).morphs.get('怒り')![15]).toBeCloseTo(1, 2);
    expect(run(1, 0.2).morphs.get('怒り')![15]).toBeCloseTo((0.7 - dz) / (1 - dz), 2);
    expect(run(1, 0, false).morphs.has('怒り')).toBe(false);
    const missing = computeFaceTracks(frames, times, DEFAULT_FACE_SETTINGS, {
      mirror: false,
      modelMorphs: ['あ'],
      size: SIZE,
      fps: 30,
    }).missing;
    expect(missing).toContain('まばたき');
    expect(missing).not.toContain('あ');
  });
});

describe('cleaning', () => {
  it('keeps a 2-frame blink at 60 fps as at least 3 closed frames at 30 fps', () => {
    const src = Array.from({ length: 60 }, (_, i) => i / 60);
    const lid = src.map((_, i) => (i === 30 || i === 31 ? 0.9 : 0.05));
    const iv = detectBlinks(src, lid);
    expect(iv).toHaveLength(1);
    const out = Array.from({ length: 30 }, (_, i) => i / 30);
    const pulse = blinkPulse(iv, out, 30, 3);
    expect(pulse.filter((v) => v === 1).length).toBeGreaterThanOrEqual(3);
    expect(pulse.filter((v) => v === 0.5).length).toBe(2);
  });

  it('attack is faster than release', () => {
    const step = [...new Array(10).fill(0), ...new Array(10).fill(1), ...new Array(10).fill(0)];
    const y = attackRelease(step, 30, 0.03, 0.09);
    // One frame after each step: the rise covers more than the fall.
    expect(y[10]).toBeGreaterThan(0.6);
    expect(y[20]).toBeGreaterThan(0.6);
    expect(y[10]).toBeGreaterThan(1 - y[20]);
  });

  it('reduces flat morph curves to few keys within tolerance', () => {
    const v = Array.from({ length: 90 }, (_, i) => (i < 40 ? 0 : i < 50 ? (i - 40) / 10 : 1));
    const keep = reduceCurve(v, 0.02);
    expect(keep.length).toBeLessThan(8);
    expect(keep).toContain(40);
    expect(keep).toContain(50);
  });

  it('fades to neutral while the face is lost and reports coverage', () => {
    const [front] = fixtureCameras();
    const frames = Array.from({ length: 90 }, (_, i) => {
      const t = i / 30;
      const v = viewFrame(syntheticScene(t), { camera: front });
      return { time: t, face: i >= 40 && i < 70 ? null : v.face };
    });
    const r = computeFaceTracks(
      frames,
      frames.map((f) => f.time),
      DEFAULT_FACE_SETTINGS,
      { mirror: false, modelMorphs: null, size: SIZE, fps: 30 },
    );
    expect(r.detected).toBeCloseTo(60 / 90, 1);
    const a = r.morphs.get('あ')!;
    expect(a[65]).toBeLessThan(0.05);
    // Blinks of the ground truth come through.
    const blink = r.morphs.get('まばたき')!;
    const truth = frames.map((f) => blinkAt(f.time));
    const hits = truth.filter((b, i) => b && (i < 40 || i >= 70) && blink[i] > 0.9).length;
    expect(hits).toBeGreaterThanOrEqual(truth.filter((b, i) => b && (i < 40 || i >= 70)).length - 1);
    // Vowel "a" frames have あ open.
    const aFrames = frames
      .map((f, i) => (vowelAt(f.time) === 'a' && (i < 38 || i > 75) ? i : -1))
      .filter((i) => i > 2);
    expect(aFrames.some((i) => a[i] > 0.5)).toBe(true);
  });
});

describe('eyes and head', () => {
  it('recovers gaze from iris landmarks', () => {
    const [front] = fixtureCameras(90, SIZE);
    for (const t of [0.4, 1.1, 2.0]) {
      const s = syntheticScene(t);
      const f = viewFrame(s, { camera: front }).face!;
      const [yaw, pitch] = gazeFromPoints(f, SIZE, false);
      // Within a few degrees (perspective and head yaw foreshorten the eye slightly).
      expect(Math.abs(yaw - (s.gaze[0] * 180) / Math.PI)).toBeLessThan(2.5);
      expect(Math.abs(pitch - (s.gaze[1] * 180) / Math.PI)).toBeLessThan(2.5);
      expect(gazeFromPoints(f, SIZE, true)[0]).toBeCloseTo(-yaw);
    }
  });

  it('turns eye bones toward the gaze', () => {
    const q = eyeRotation(15, 0);
    const d = rotate(q, [0, 0, -1]);
    expect(d[0]).toBeGreaterThan(0.2);
    const up = rotate(eyeRotation(0, 10), [0, 0, -1]);
    expect(up[1]).toBeGreaterThan(0.1);
  });

  it('reads the head rotation from the face matrix in front and side views', () => {
    const [front, side] = fixtureCameras(90);
    for (const t of [0.3, 0.9]) {
      const s = syntheticScene(t);
      const truth = axisAngle([0, 1, 0], s.headYaw);
      const fq = headFromMatrix(viewFrame(s, { camera: front }).face!.matrix, 0);
      expect(qdistance(fq, truth)).toBeLessThan(1e-4);
      const sv = viewFrame(s, { camera: side });
      if (sv.face) expect(qdistance(headFromMatrix(sv.face.matrix, 90), truth)).toBeLessThan(1e-4);
    }
  });
});
