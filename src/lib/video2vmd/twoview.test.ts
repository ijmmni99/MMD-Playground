import { describe, expect, it } from 'vitest';
import { LIMBS, LM } from '@/engine/video2vmd/landmarks';
import type { PoseFrame, PoseSequence } from '@/engine/video2vmd/types';
import { axisAngle, mid, rotate, sub, type Vec3 } from '@/lib/math3d';
import { camToWorld, focalFromFov, project, type PinholeCamera } from './camera';
import { calibrate, fitYaw, linearCamera, reprojectionError, triangulate, type PointPair } from './calibrate';
import { enforceBoneLengths, fuseViews, sampleFrame } from './fuse';
import { fixtureCameras, syntheticScene, viewFrame } from './synthetic';

const SIZE: [number, number] = [640, 360];

function sequence(
  cam: PinholeCamera,
  shift: number,
  seconds: number,
  fps: number,
  depthNoise = 0.04,
): PoseSequence {
  return {
    version: 1,
    estimator: 'synthetic',
    video: { name: 'v.webm', width: SIZE[0], height: SIZE[1], fps, duration: seconds, hasAudio: false },
    trim: [0, seconds],
    crop: null,
    analysedSize: SIZE,
    sampleFps: fps,
    frames: Array.from({ length: Math.round(seconds * fps) }, (_, i) => {
      const t = i / fps;
      const v = viewFrame(syntheticScene(t - shift, { depthHeavy: true }), { camera: cam, depthNoise });
      return { time: t, detected: true, image: v.image, world: v.world, face: v.face, hands: v.hands };
    }),
  };
}

/** Mean joint error (metres) of a sequence's world landmarks vs. the ground truth (hip-centred). */
function jointError(seq: PoseSequence, timeToScene: (t: number) => number, joints: number[]): number {
  let s = 0;
  let n = 0;
  for (const f of seq.frames) {
    if (!f.detected) continue;
    const truth = syntheticScene(timeToScene(f.time), { depthHeavy: true }).body;
    const hip = mid(truth[LM.leftHip], truth[LM.rightHip]);
    for (const j of joints) {
      const p: Vec3 = [f.world[j * 4], -f.world[j * 4 + 1], f.world[j * 4 + 2]];
      const t = sub(truth[j], hip);
      s += Math.hypot(p[0] - t[0], p[1] - t[1], p[2] - t[2]);
      n++;
    }
  }
  return s / n;
}

const ARMS_LEGS = [
  LM.leftElbow,
  LM.rightElbow,
  LM.leftWrist,
  LM.rightWrist,
  LM.leftKnee,
  LM.rightKnee,
  LM.leftAnkle,
  LM.rightAnkle,
];

describe('yaw-only Kabsch', () => {
  it('recovers a known yaw from synthetic skeletons, robust to noise and outliers', () => {
    for (const yaw of [90, 60, 120, -75]) {
      const pairs: PointPair[] = [];
      for (let f = 0; f < 60; f++) {
        const body = syntheticScene(f / 30, { depthHeavy: true }).body;
        const hip = mid(body[LM.leftHip], body[LM.rightHip]);
        for (const j of [11, 12, 13, 14, 15, 16, 25, 26, 27, 28]) {
          const a = sub(body[j], hip);
          // b = R(yaw)ᵀ a, with noise; every 15th pair is a gross outlier.
          const b = rotate(axisAngle([0, 1, 0], (yaw * Math.PI) / 180), a);
          const noisy: Vec3 = [b[0] + Math.sin(f * 7 + j) * 0.02, b[1], b[2] + Math.cos(f * 3 + j) * 0.02];
          pairs.push({
            a,
            b: pairs.length % 15 === 0 ? [noisy[0] + 0.8, noisy[1], noisy[2] - 0.6] : noisy,
            w: 1,
            frame: f,
          });
        }
      }
      // Sanity: R_y(θ) (camera convention) is −θ about +Y, so a = camToWorld(θ, b).
      const back = camToWorld(yaw, pairs[1].b);
      expect(Math.hypot(back[0] - pairs[1].a[0], back[2] - pairs[1].a[2])).toBeLessThan(0.05);
      const r = fitYaw(pairs, yaw + 25);
      expect(Math.abs(r.yawDeg - yaw)).toBeLessThan(1.5);
      expect(r.inliers).toBeGreaterThan(0.85);
    }
  });
});

describe('calibration and fusion on the synthetic two-camera fixture', () => {
  const [front, side] = fixtureCameras(90, SIZE);
  const offset = 0.4;
  const F = sequence(front, 0, 4, 30);
  const S = sequence(side, offset, 4.5, 30);
  const aligned = (seq: PoseSequence, shift: number): PoseFrame[] =>
    Array.from({ length: 100 }, (_, i) => sampleFrame(seq.frames, i / 30 + shift));

  const cal = calibrate({
    front: aligned(F, 0),
    side: aligned(S, offset),
    priorDeg: 70,
    fovDeg: 2 * Math.atan(320 / front.focal) * (180 / Math.PI),
    frontSize: SIZE,
    sideSize: SIZE,
    fps: 30,
  });

  it('estimates the camera angle, scale and distances', () => {
    expect(Math.abs(cal.yawDeg - 90)).toBeLessThan(4);
    expect(cal.scale).toBeCloseTo(1, 1);
    expect(cal.distance[0]).toBeGreaterThan(3);
    expect(cal.distance[0]).toBeLessThan(5);
    expect(cal.confidence).toBeGreaterThan(0.5);
    expect(cal.warnings).toEqual([]);
  });

  it('two-view fusion beats single-view on depth-heavy motion', () => {
    const fused = fuseViews(F, S, offset, cal, { triangulate: false });
    const single = jointError(F, (t) => t, ARMS_LEGS);
    const two = jointError(fused.sequence, (t) => t, ARMS_LEGS);
    expect(two).toBeLessThan(single * 0.7);
    expect(fused.stats.fusedPct).toBeGreaterThan(80);
    const dlt = fuseViews(F, S, offset, { ...cal, yawDeg: 90 }, { triangulate: true });
    expect(jointError(dlt.sequence, (t) => t, ARMS_LEGS)).toBeLessThan(single * 0.7);
    expect(dlt.stats.dltPct).toBeGreaterThan(0);
  });

  it('falls back to one view (flagged) and leaves joints both views lost for interpolation', () => {
    const S2: PoseSequence = {
      ...S,
      frames: S.frames.map((f) => {
        const w = Float32Array.from(f.world);
        w[LM.leftWrist * 4 + 3] = 0.1;
        return { ...f, world: w };
      }),
    };
    const F2: PoseSequence = {
      ...F,
      frames: F.frames.map((f, i) => {
        const w = Float32Array.from(f.world);
        if (i >= 30 && i < 40) w[LM.leftWrist * 4 + 3] = 0.1;
        return { ...f, world: w };
      }),
    };
    const r = fuseViews(F2, S2, offset, cal);
    expect(r.stats.singleView.every(Boolean)).toBe(true);
    const fr = r.sequence.frames;
    expect(fr[5].world[LM.leftWrist * 4 + 3]).toBeGreaterThan(0.5);
    expect(fr[34].world[LM.leftWrist * 4 + 3]).toBe(0);
  });

  it('enforces bone lengths after fusion', () => {
    const fused = fuseViews(F, S, offset, cal);
    const lens = (f: PoseFrame, [a, b]: [number, number]) =>
      Math.hypot(
        f.world[a * 4] - f.world[b * 4],
        f.world[a * 4 + 1] - f.world[b * 4 + 1],
        f.world[a * 4 + 2] - f.world[b * 4 + 2],
      );
    for (const limb of LIMBS.slice(0, 6)) {
      const v = fused.sequence.frames.map((f) => lens(f, limb));
      expect(Math.max(...v) - Math.min(...v)).toBeLessThan(1e-4);
    }
    const frames = [{ ...F.frames[0], world: Float32Array.from(F.frames[0].world) }];
    enforceBoneLengths(frames);
    expect(frames[0].world.length).toBe(132);
  });

  it('warns when the views are too similar', () => {
    const [f2] = fixtureCameras(90, SIZE);
    const near = { ...f2, yawDeg: 12 };
    const c = calibrate({
      front: aligned(F, 0),
      side: Array.from({ length: 100 }, (_, i) => sampleFrame(sequence(near, 0, 4, 30).frames, i / 30)),
      priorDeg: 90,
      fovDeg: 60,
      frontSize: SIZE,
      sideSize: SIZE,
      fps: 30,
    });
    expect(c.warnings.join(' ')).toMatch(/too similar/);
  });
});

describe('DLT triangulation', () => {
  it('recovers a 3D point from two calibrated views', () => {
    const fov = 58;
    const f = focalFromFov(fov, SIZE[0]);
    const camA: PinholeCamera = { yawDeg: 0, distance: 4, height: 1, size: SIZE, focal: f };
    const camB: PinholeCamera = { yawDeg: 80, distance: 3.5, height: 1.2, size: SIZE, focal: f };
    // The same cameras expressed with the front camera at the origin.
    const posA: Vec3 = [0, 1, -4];
    const posB = ((): Vec3 => {
      const p = camToWorld(80, [0, 0, -3.5]);
      return [p[0], 1.2, p[2]];
    })();
    const la = linearCamera(0, sub(posA, posA), f, SIZE);
    const lb = linearCamera(80, sub(posB, posA), f, SIZE);
    const P: Vec3 = [0.3, 1.4, -0.2];
    const [ua, va] = project(camA, P);
    const [ub, vb] = project(camB, P);
    const obs = [
      { cam: la, u: ua, v: va },
      { cam: lb, u: ub, v: vb },
    ];
    const X = triangulate(obs)!;
    const expected = sub(P, posA);
    X.forEach((x, i) => expect(x).toBeCloseTo(expected[i], 4));
    expect(reprojectionError(X, obs)).toBeLessThan(1e-3);
  });
});
