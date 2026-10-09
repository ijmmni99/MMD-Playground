import { VmdObject } from 'babylon-mmd/esm/Loader/Parser/vmdObject';
import { describe, expect, it } from 'vitest';
import { convertPoses, writeParts } from '@/engine/video2vmd/convert';
import { forwardKinematics } from '@/engine/video2vmd/retarget';
import { standardSkeleton } from '@/engine/video2vmd/skeleton';
import { DEFAULT_SETTINGS, type PoseSequence } from '@/engine/video2vmd/types';
import { fixtureCameras, handPoseAt, syntheticScene, viewFrame } from './synthetic';
import { DEFAULT_FACE_SETTINGS } from './face';
import { lipSyncVowels } from './lipsync';

function frontSequence(seconds = 4, fps = 30): PoseSequence {
  const [front] = fixtureCameras();
  return {
    version: 1,
    estimator: 'synthetic',
    video: { name: 'front.webm', width: 1920, height: 1080, fps, duration: seconds, hasAudio: false },
    trim: [0, seconds],
    crop: null,
    analysedSize: [640, 360],
    sampleFps: fps,
    frames: Array.from({ length: seconds * fps }, (_, i) => {
      const v = viewFrame(syntheticScene(i / fps), { camera: front });
      return { time: i / fps, detected: true, image: v.image, world: v.world, face: v.face, hands: v.hands };
    }),
  };
}

const SETTINGS = { ...DEFAULT_SETTINGS, features: { twoView: false, face: true, fingers: true } };

describe('face + fingers through the conversion', () => {
  const seq = frontSequence();
  const sk = standardSkeleton();
  const r = convertPoses(seq, sk, SETTINGS, {
    modelMorphs: ['まばたき', 'あ', 'い', 'う', 'え', 'お', '笑い'],
  });

  it('writes morph, finger and eye keys alongside the body', () => {
    const morphNames = new Set(r.parts.morphs.map((k) => k.morph));
    expect([...morphNames]).toEqual(expect.arrayContaining(['まばたき', 'あ', 'お']));
    expect(morphNames.has('怒り')).toBe(false);
    expect(r.report.face!.missing).toContain('怒り');
    const fingerBones = new Set(r.parts.fingers.map((k) => k.bone));
    expect(fingerBones.has('左人指２')).toBe(true);
    expect(fingerBones.has('右親指１')).toBe(true);
    expect(r.parts.eyes.every((k) => k.bone === '両目')).toBe(true);
    expect(r.parts.eyes.length).toBeGreaterThan(2);
    expect(r.report.hands!.detectedPct[0]).toBeCloseTo(100, 0);
    expect(r.report.face!.detectedPct).toBeGreaterThan(90);
    const vmd = VmdObject.ParseFromBuffer(r.vmd);
    expect(vmd.morphKeyFrames.length).toBe(r.parts.morphs.length);
    expect(vmd.boneKeyFrames.length).toBe(r.parts.body.length + r.parts.fingers.length + r.parts.eyes.length);
  });

  it('fingers follow the ground truth: fist frames close the hand, open frames open it', () => {
    const fistF = 45; // 1.5 s: fist
    const openF = 15; // 0.5 s: open
    expect(handPoseAt(fistF / 30).index.flex[1]).toBeGreaterThan(90);
    const at = (frame: number) => {
      const locals = new Map(
        r.parts.fingers
          .filter((k) => k.frame <= frame)
          .sort((a, b) => a.frame - b.frame)
          .map((k) => [k.bone, k.rotation] as const),
      );
      return forwardKinematics(sk, locals as never).positions;
    };
    const tip = sk.bones.findIndex((b) => b.name === '左人指３');
    const wrist = sk.bones.findIndex((b) => b.name === '左手首');
    const d = (p: ReturnType<typeof at>) => Math.hypot(...[0, 1, 2].map((i) => p[tip][i] - p[wrist][i]));
    expect(d(at(fistF))).toBeLessThan(d(at(openF)) - 0.3);
  });

  it('exports any subset of parts', () => {
    const faceOnly = VmdObject.ParseFromBuffer(
      writeParts('m', r.parts, { body: false, fingers: false, face: true, eyes: false }),
    );
    expect(faceOnly.boneKeyFrames.length).toBe(0);
    expect(faceOnly.morphKeyFrames.length).toBe(r.parts.morphs.length);
    const bodyFingers = VmdObject.ParseFromBuffer(
      writeParts('m', r.parts, { body: true, fingers: true, face: false, eyes: false }),
    );
    expect(bodyFingers.morphKeyFrames.length).toBe(0);
    expect(bodyFingers.boneKeyFrames.length).toBe(r.parts.body.length + r.parts.fingers.length);
  });

  it('body-only settings ignore face and hand data', () => {
    const body = convertPoses(seq, sk, DEFAULT_SETTINGS);
    expect(body.parts.morphs).toHaveLength(0);
    expect(body.parts.fingers).toHaveLength(0);
    expect(body.report.face).toBeUndefined();
  });

  it('lip-sync replaces the mouth vowels with audio-derived ones', () => {
    const sr = 11025;
    const samples = new Float32Array(sr * 4).map((_, i) =>
      i > sr * 2 ? Math.sin((2 * Math.PI * 3000 * i) / sr) * 0.5 : 0,
    );
    const ls = convertPoses(
      seq,
      sk,
      { ...SETTINGS, face: { ...DEFAULT_FACE_SETTINGS, lipSync: true } },
      {
        modelMorphs: null,
        lipSync: {
          fps: 30,
          vowels: lipSyncVowels(
            samples,
            sr,
            Array.from({ length: 120 }, (_, k) => k / 30),
          ),
        },
      },
    );
    const i = ls.face!.morphs.get('い')!;
    expect(Math.max(...i.slice(0, 50))).toBeLessThan(0.05);
    expect(Math.max(...i.slice(70, 110))).toBeGreaterThan(0.4);
  });
});
