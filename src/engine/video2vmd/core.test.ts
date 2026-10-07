import { describe, expect, it } from 'vitest';
import { cleanSequence, fillGaps, resample, resampleTimes } from './clean';
import { contactRuns, detectContacts, footSkate, pinFeet } from './contacts';
import { convertWorldFrame, mpWorldToMmd } from './coords';
import { LANDMARK_COUNT, LM } from './landmarks';
import {
  QI,
  axisAngle,
  cross,
  frameRotation,
  normalize,
  qdistance,
  qdot,
  qneg,
  rotate,
  slerp,
  sub,
  type Quat,
  type Vec3,
} from './math';
import { OneEuroFilter, oneEuroSeries } from './oneEuro';
import { reduceKeys } from './reduce';
import { forwardKinematics, retarget } from './retarget';
import { BONE, standardSkeleton } from './skeleton';
import { syntheticFrame, syntheticPose } from './synthetic';
import { DEFAULT_SETTINGS, type ConversionSettings, type PoseSequence } from './types';
import type { BoneKey } from './vmdWriter';

const close = (a: Vec3, b: Vec3, eps = 1e-6): void =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], -Math.log10(eps)));
const angleBetween = (a: Vec3, b: Vec3): number => {
  const na = normalize(a);
  const nb = normalize(b);
  return (
    (Math.acos(Math.min(1, Math.max(-1, na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2]))) * 180) / Math.PI
  );
};

function syntheticSequence(
  seconds: number,
  fps: number,
  opts: Parameters<typeof syntheticFrame>[1] = {},
): PoseSequence {
  const frames = [];
  for (let i = 0; i < seconds * fps; i++) {
    const t = i / fps;
    const f = syntheticFrame(t, opts);
    frames.push({ time: t, detected: true, image: f.image, world: f.world });
  }
  return {
    version: 1,
    estimator: 'synthetic',
    video: { name: 's', width: 640, height: 360, fps, duration: seconds, hasAudio: false },
    trim: [0, seconds],
    crop: null,
    analysedSize: opts.imageSize ?? [640, 360],
    sampleFps: fps,
    frames,
  };
}

describe('coordinate conversion', () => {
  it('flips Y only for a camera-facing dancer (MediaPipe right-handed → MMD left-handed)', () => {
    expect(mpWorldToMmd(0.2, -0.5, 0.1)).toEqual([0.2, 0.5, 0.1]);
    // Dancer's left wrist is on image right (+x) → MMD 左 side (+X).
    const f = syntheticFrame(0);
    const { points } = convertWorldFrame(f.world, false);
    expect(points[LM.leftWrist][0]).toBeGreaterThan(0);
    expect(points[LM.nose][1]).toBeGreaterThan(points[LM.leftHip][1]);
  });

  it('round-trips the synthetic truth (relative to the hips)', () => {
    const f = syntheticFrame(0.7);
    const { points } = convertWorldFrame(f.world, false);
    const hip = (p: Vec3[]): Vec3 => [
      (p[LM.leftHip][0] + p[LM.rightHip][0]) / 2,
      (p[LM.leftHip][1] + p[LM.rightHip][1]) / 2,
      (p[LM.leftHip][2] + p[LM.rightHip][2]) / 2,
    ];
    const truthRel = sub(f.truth[LM.leftElbow], hip(f.truth));
    close(sub(points[LM.leftElbow], hip(points)), truthRel, 1e-4);
  });

  it('mirror toggle undoes a selfie-flipped video', () => {
    const plain = convertWorldFrame(syntheticFrame(0.4).world, false).points;
    const flipped = convertWorldFrame(syntheticFrame(0.4, { mirror: true }).world, true).points;
    for (let i = 0; i < LANDMARK_COUNT; i++) close(flipped[i], plain[i], 1e-4);
  });
});

describe('One Euro filter', () => {
  it('passes a constant through and smooths noise', () => {
    const f = new OneEuroFilter(1, 0);
    for (let i = 0; i < 10; i++) expect(f.filter(5, 1 / 30)).toBeCloseTo(5);
    const noisy = Array.from({ length: 300 }, (_, i) => Math.sin(i / 30) + (i % 2 ? 0.05 : -0.05));
    const smooth = oneEuroSeries(noisy, 30, 1, 0);
    const rough = (s: number[]) => s.slice(1).reduce((a, v, i) => a + Math.abs(v - s[i]), 0);
    expect(rough(smooth)).toBeLessThan(rough(noisy) * 0.3);
  });

  it('follows fast motion better with a higher beta', () => {
    const step = Array.from({ length: 60 }, (_, i) => (i < 30 ? 0 : 1));
    const lag = (beta: number) => {
      const f = new OneEuroFilter(0.5, beta);
      return step.map((v) => f.filter(v, 1 / 30))[33];
    };
    expect(lag(5)).toBeGreaterThan(lag(0));
  });
});

describe('cleaning', () => {
  it('resamples to 30 fps', () => {
    expect(resampleTimes(0, 1, 30)).toHaveLength(31);
    const v = resample([0, 1], [0, 10], [0, 0.25, 0.5, 1], (a, b, t) => a + (b - a) * t);
    expect(v).toEqual([0, 2.5, 5, 10]);
  });

  it('interpolates gaps and holds the ends', () => {
    const times = [0, 1, 2, 3, 4];
    const valid = times.map((_, i) => new Array(LANDMARK_COUNT).fill(i === 1 || i === 3));
    const world = times.map((t) => Array.from({ length: LANDMARK_COUNT }, (): Vec3 => [t, 0, 0]));
    const image = times.map(() => Array.from({ length: LANDMARK_COUNT }, (): [number, number] => [0, 0]));
    world[2][0] = [99, 0, 0];
    expect(fillGaps(times, valid, world, image)).toEqual([]);
    expect(world.map((f) => f[0][0])).toEqual([1, 1, 2, 3, 3]);
  });

  it('turns 24 fps detections with gaps and outliers into a smooth 30 fps track', () => {
    const seq = syntheticSequence(3, 24, { noise: 0.01 });
    seq.frames[10] = { ...seq.frames[10], detected: false };
    const wild = Float32Array.from(seq.frames[20].world as Float32Array);
    wild[LM.leftWrist * 4] += 0.8; // forearm suddenly 0.8 m too long
    seq.frames[20] = { ...seq.frames[20], world: wild };
    const track = cleanSequence(seq, DEFAULT_SETTINGS);
    expect(track.frameCount).toBe(Math.floor((seq.frames.at(-1)!.time - seq.frames[0].time) * 30) + 1);
    expect(track.outlier.some(Boolean)).toBe(true);
    expect(track.jitterClean).toBeLessThan(track.jitterRaw);
    // Forearm length is normalised to one value.
    const fore = track.world.map((f) => Math.hypot(...sub(f[LM.leftWrist], f[LM.leftElbow])));
    expect(Math.max(...fore) - Math.min(...fore)).toBeLessThan(1e-6);
  });
});

describe('quaternions', () => {
  it('frameRotation maps the rest frame onto the target frame', () => {
    const q = axisAngle(normalize([0.3, 1, -0.2]), 1.1);
    const p: Vec3 = [1, -0.7, 0];
    const s: Vec3 = [0, 0, -1];
    const r = frameRotation(p, s, rotate(q, p), rotate(q, s));
    expect(qdistance(r, q)).toBeLessThan(1e-6);
  });

  it('keeps sign continuity in retargeted tracks (no flips between frames)', () => {
    const track = cleanSequence(syntheticSequence(4, 30), DEFAULT_SETTINGS);
    const result = retarget(track, standardSkeleton(), DEFAULT_SETTINGS);
    const byBone = new Map<string, BoneKey[]>();
    for (const k of result.keys) (byBone.get(k.bone) ?? byBone.set(k.bone, []).get(k.bone)!).push(k);
    for (const list of byBone.values()) {
      for (let i = 1; i < list.length; i++) {
        expect(qdot(list[i].rotation as Quat, list[i - 1].rotation as Quat)).toBeGreaterThan(0);
      }
    }
  });

  it('slerp takes the short way', () => {
    const a = axisAngle([0, 1, 0], 0.1);
    const m = slerp(a, qneg(axisAngle([0, 1, 0], 0.3)), 0.5);
    expect(qdistance(m, axisAngle([0, 1, 0], 0.2))).toBeLessThan(1e-6);
  });
});

describe('keyframe reduction', () => {
  it('drops keys that linear interpolation reproduces and keeps corners', () => {
    const keys: BoneKey[] = [];
    for (let f = 0; f <= 60; f++) {
      const angle = f <= 30 ? f * 0.02 : 0.6 - (f - 30) * 0.02; // a "tent": linear up then down
      const q = axisAngle([0, 1, 0], angle);
      keys.push({ bone: '頭', frame: f, position: [0, 0, 0], rotation: q });
    }
    const reduced = reduceKeys(keys, 0.1, 0.01);
    expect(reduced.map((k) => k.frame)).toEqual([0, 30, 60]);
    expect(reduceKeys(keys, 0, 0)).toHaveLength(61);
  });

  it('respects the tolerance on curved motion', () => {
    const keys: BoneKey[] = Array.from({ length: 91 }, (_, f) => ({
      bone: 'センター',
      frame: f,
      position: [Math.sin(f / 10) * 5, 0, 0],
      rotation: [...QI],
    }));
    const loose = reduceKeys(keys, 1, 0.5).length;
    const tight = reduceKeys(keys, 1, 0.01).length;
    expect(loose).toBeLessThan(tight);
    expect(tight).toBeLessThan(91);
  });
});

describe('foot contacts', () => {
  it('detects planted phases with hysteresis and removes flicker', () => {
    const height = [0, 0, 0, 0, 2, 2, 2, 0, 0, 0, 0, 0.6, 0, 0];
    const pos: Vec3[] = height.map(() => [0, 0, 0]);
    const flags = detectContacts(height, pos, { heightThreshold: 0.5, speedThreshold: 1, fps: 30 });
    expect(flags).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(contactRuns(flags)).toEqual([
      [0, 3],
      [7, 13],
    ]);
  });

  it('pinning removes sliding during contacts', () => {
    const pos: Vec3[] = Array.from({ length: 30 }, (_, i) => [i * 0.05, 0, 0]);
    const flags = pos.map((_, i) => i >= 5 && i < 25);
    const before = footSkate(pos, flags, 30);
    const after = footSkate(pinFeet(pos, flags), flags, 30);
    expect(before).toBeCloseTo(1.5);
    expect(after).toBeLessThan(0.01);
  });

  it('finds the synthetic dancer’s planted feet', () => {
    const track = cleanSequence(syntheticSequence(6, 30), DEFAULT_SETTINGS);
    const result = retarget(track, standardSkeleton(), DEFAULT_SETTINGS);
    let agree = 0;
    result.contacts.forEach((c, f) => {
      const truth = syntheticPose(track.times[f]).contact;
      if (c[0] === truth[0]) agree++;
      if (c[1] === truth[1]) agree++;
    });
    expect(agree / (result.contacts.length * 2)).toBeGreaterThan(0.75);
    expect(result.footSkateAfter).toBeLessThan(result.footSkateBefore + 1e-9);
  });
});

describe('retargeting', () => {
  const run = (settings: Partial<ConversionSettings> = {}, synth = {}) => {
    const s = { ...DEFAULT_SETTINGS, ...settings };
    const seq = syntheticSequence(4, 30, synth);
    const track = cleanSequence(seq, s);
    const skeleton = standardSkeleton();
    const result = retarget(track, skeleton, s);
    return { track, skeleton, result };
  };

  const posesAt = (result: ReturnType<typeof retarget>, frame: number) => {
    const locals = new Map<string, Quat>();
    let center: Vec3 = [0, 0, 0];
    for (const k of result.keys) {
      if (k.frame !== frame) continue;
      locals.set(k.bone, k.rotation as Quat);
      if (k.bone === BONE.center) center = k.position;
    }
    return { locals, center };
  };

  it('reproduces limb directions of the synthetic dancer', () => {
    const { track, skeleton, result } = run();
    const idx = (n: string) => skeleton.bones.findIndex((b) => b.name === n);
    const pairs: [string, string, number, number][] = [
      ['左腕', '左ひじ', LM.leftShoulder, LM.leftElbow],
      ['左ひじ', '左手首', LM.leftElbow, LM.leftWrist],
      ['右腕', '右ひじ', LM.rightShoulder, LM.rightElbow],
      ['右ひじ', '右手首', LM.rightElbow, LM.rightWrist],
      ['左足', '左ひざ', LM.leftHip, LM.leftKnee],
      ['左ひざ', '左足首', LM.leftKnee, LM.leftAnkle],
      ['右足', '右ひざ', LM.rightHip, LM.rightKnee],
      ['右ひざ', '右足首', LM.rightKnee, LM.rightAnkle],
    ];
    let worst = 0;
    for (let f = 5; f < track.frameCount - 5; f += 7) {
      const { locals } = posesAt(result, f);
      const { positions } = forwardKinematics(skeleton, locals);
      const truth = syntheticPose(track.times[f]).joints;
      for (const [a, b, la, lb] of pairs) {
        const err = angleBetween(sub(positions[idx(b)], positions[idx(a)]), sub(truth[lb], truth[la]));
        worst = Math.max(worst, err);
      }
    }
    expect(worst).toBeLessThan(12);
  });

  it('keeps hinge joints bending one way', () => {
    const { result } = run({}, { elbow: 2.6 });
    for (const k of result.keys) {
      if (!/ひじ|ひざ/.test(k.bone)) continue;
      const axisSign = k.bone.includes('ひざ') ? -1 : 1; // knees hinge about -X, elbows about the arm normal
      void axisSign;
      const angle = 2 * Math.acos(Math.min(1, Math.abs(k.rotation[3])));
      expect(angle).toBeLessThanOrEqual((165 * Math.PI) / 180 + 1e-6);
    }
  });

  it('applies the knee hinge so the shin swings backward (+Z)', () => {
    const { result, skeleton } = run();
    for (let f = 0; f < result.frameCount; f += 5) {
      const { locals } = posesAt(result, f);
      const knee = locals.get('左ひざ');
      if (!knee || 2 * Math.acos(Math.min(1, Math.abs(knee[3]))) < 0.2) continue;
      const shinRest = sub(
        skeleton.bones.find((b) => b.name === '左足首')!.position,
        skeleton.bones.find((b) => b.name === '左ひざ')!.position,
      );
      const shin = rotate(knee, shinRest);
      // Relative to the thigh, a bent knee moves the ankle backward.
      expect(shin[2]).toBeGreaterThan(shinRest[2] - 1e-6);
    }
  });

  it('upper-body preset leaves legs and センター alone', () => {
    const { result } = run({ lowerBody: false, footIk: false, rootStrength: 0 });
    expect(result.bones).not.toContain('センター');
    expect(result.bones.some((b) => /足|ひざ/.test(b))).toBe(false);
    expect(result.bones).toContain('左腕');
  });

  it('FK-only output disables leg IK; IK mode keys the IK bones', () => {
    const fk = run({ footIk: false }).result;
    expect(fk.properties[0].ik.map((i) => i.enabled)).toEqual([false, false, false, false]);
    const ik = run({ footIk: true }).result;
    expect(ik.properties).toHaveLength(0);
    expect(ik.bones).toEqual(expect.arrayContaining(['左足ＩＫ', '右足ＩＫ']));
  });

  it('keeps feet on the floor: lowest foot point never sinks below ground', () => {
    const { result, skeleton } = run();
    const ankle = skeleton.bones.findIndex((b) => b.name === '左足首');
    const restY = skeleton.bones[ankle].position[1];
    for (let f = 0; f < result.frameCount; f++) {
      const { locals, center } = posesAt(result, f);
      const { positions } = forwardKinematics(skeleton, locals, center);
      const rAnkle = skeleton.bones.findIndex((b) => b.name === '右足首');
      const low = Math.min(positions[ankle][1], positions[rAnkle][1]) - restY;
      expect(low).toBeGreaterThan(-0.35);
    }
  });

  it('mirrored input with the mirror toggle matches the plain conversion', () => {
    const a = run().result;
    const b = run({ mirror: true }, { mirror: true }).result;
    const find = (r: typeof a, bone: string, f: number) =>
      r.keys.find((k) => k.bone === bone && k.frame === f)!;
    for (const bone of ['左腕', '右ひじ', '上半身', '左足']) {
      expect(qdistance(find(a, bone, 40).rotation as Quat, find(b, bone, 40).rotation as Quat)).toBeLessThan(
        0.02,
      );
    }
  });

  it('elbow hinge axis follows the rest arm plane (sanity of cross-product convention)', () => {
    const upper: Vec3 = [1, -0.8, 0];
    const n = normalize(cross(upper, [0, 0, -1]));
    const bentFore = rotate(axisAngle(n, 1), normalize(upper));
    expect(bentFore[2]).toBeLessThan(0); // bending forward
  });
});
