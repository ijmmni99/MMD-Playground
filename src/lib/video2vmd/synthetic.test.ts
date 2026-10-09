import { describe, expect, it } from 'vitest';
import { LM } from '@/engine/video2vmd/landmarks';
import { poseFromJson, poseToJson } from '@/engine/video2vmd/poseJson';
import type { PoseSequence } from '@/engine/video2vmd/types';
import { dist, mid } from '@/lib/math3d';
import { camToWorld, project, viewDir, worldToCam } from './camera';
import { HAND_PRESETS } from './handPose';
import { fixtureCameras, handPoints, syntheticScene, viewFrame } from './synthetic';

describe('camera conventions', () => {
  it('R_y(θ) puts a 90° camera at +X looking along −X', () => {
    const [, side] = fixtureCameras(90);
    expect(viewDir(90)[0]).toBeCloseTo(-1);
    // A point at the origin projects to the image centre column from both cameras.
    expect(project(side, [0, 1, 0])[0]).toBeCloseTo(0.5);
    // The dancer's left (+X) is nearer to the side camera.
    expect(project(side, [0.3, 1, 0])[2]).toBeLessThan(project(side, [-0.3, 1, 0])[2]);
    const v: [number, number, number] = [0.2, -0.4, 0.7];
    const back = camToWorld(37, worldToCam(37, v));
    back.forEach((x, i) => expect(x).toBeCloseTo(v[i]));
  });
});

describe('synthetic two-camera fixture', () => {
  it('builds hands with the right segment lengths and curls a fist toward the palm', () => {
    const open = handPoints([0, 1, 0], [1, 0, 0], [0, 0, -1], 'left', HAND_PRESETS.open);
    const fist = handPoints([0, 1, 0], [1, 0, 0], [0, 0, -1], 'left', HAND_PRESETS.fist);
    expect(dist(open[5], open[6])).toBeCloseTo(0.04, 4);
    expect(dist(fist[6], fist[7])).toBeCloseTo(0.025, 4);
    expect(dist(fist[8], fist[0])).toBeLessThan(dist(open[8], open[0]) * 0.6);
    // Left palm faces down (−Y) for a hand pointing +X with the thumb toward −Z.
    expect(fist[6][1]).toBeLessThan(open[6][1] - 0.03);
    const right = handPoints([0, 1, 0], [-1, 0, 0], [0, 0, -1], 'right', HAND_PRESETS.fist);
    expect(right[6][1]).toBeLessThan(0.97);
  });

  it('renders MediaPipe-style views with monocular depth error', () => {
    const scene = syntheticScene(1.0, { depthHeavy: true });
    const [front, side] = fixtureCameras(90);
    const f = viewFrame(scene, { camera: front, depthNoise: 0, noise: 0 });
    const s = viewFrame(scene, { camera: side, depthNoise: 0, noise: 0 });
    const hip = mid(scene.body[LM.leftHip], scene.body[LM.rightHip]);
    const w = scene.body[LM.leftWrist];
    // Front view: x matches the truth, depth is compressed.
    expect(f.world[LM.leftWrist * 4]).toBeCloseTo(w[0] - hip[0], 4);
    expect(f.world[LM.leftWrist * 4 + 2]).toBeCloseTo((w[2] - hip[2]) * 0.55, 4);
    // Side view at 90° (at +X looking −X): its image x axis is the world's +Z (the front camera's depth).
    expect(s.world[LM.leftWrist * 4]).toBeCloseTo(w[2] - hip[2], 4);
    expect(f.face).not.toBeNull();
    expect(f.hands[0]!.world).toHaveLength(63);
    expect(f.hands[0]!.handedness).toBe('Right');
  });

  it('pose JSON keeps face and hand observations', () => {
    const scene = syntheticScene(0.3);
    const [front] = fixtureCameras();
    const v = viewFrame(scene, { camera: front });
    const seq: PoseSequence = {
      version: 1,
      estimator: 'synthetic',
      video: { name: 'x.webm', width: 640, height: 360, fps: 30, duration: 1, hasAudio: false },
      trim: [0, 1],
      crop: null,
      analysedSize: [640, 360],
      sampleFps: 30,
      frames: [{ time: 0, detected: true, image: v.image, world: v.world, face: v.face, hands: v.hands }],
    };
    const back = poseFromJson(poseToJson(seq)).frames[0];
    expect(back.face!.blend.length).toBe(52);
    expect(back.face!.points[0]).toBeCloseTo(v.face!.points[0], 3);
    expect(back.hands![1]!.world[30]).toBeCloseTo(v.hands[1]!.world[30], 3);
    expect(back.hands![0]!.handedness).toBe('Right');
  });
});
