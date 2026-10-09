import {
  BLENDSHAPES,
  FACE_POINT_KEYS,
  HAND_POINTS,
  type FaceObs,
  type HandObs,
  type HandPair,
} from '@/lib/video2vmd/types';
import { LANDMARK_COUNT } from './landmarks';
import type { PoseFrame, PoseSequence } from './types';

const round = (v: number): number => Math.round(v * 1e5) / 1e5;
const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;
const roundCrop = (c: { x: number; y: number; w: number; h: number }) => ({
  x: r4(c.x),
  y: r4(c.y),
  w: r4(c.w),
  h: r4(c.h),
});

const faceToJson = (f: FaceObs) => ({
  score: r4(f.score),
  blend: f.blend.map(r4),
  matrix: f.matrix.map(r4),
  points: f.points.map(r4),
  crop: roundCrop(f.crop),
});

const handToJson = (h: HandObs | null) =>
  h && {
    score: r4(h.score),
    handedness: h.handedness,
    handednessScore: r4(h.handednessScore),
    image: h.image.map(r4),
    world: h.world.map(r4),
    crop: roundCrop(h.crop),
  };

/** Serialise detection results (landmarks per frame) to JSON for re-running retargeting later. */
export function poseToJson(seq: PoseSequence): string {
  return JSON.stringify({
    format: 'mmd-studio-pose',
    ...seq,
    frames: seq.frames.map((f) => ({
      time: round(f.time),
      detected: f.detected,
      people: f.people ?? 1,
      image: Array.from(f.image, round),
      world: Array.from(f.world, round),
      ...(f.face ? { face: faceToJson(f.face) } : {}),
      ...(f.hands ? { hands: f.hands.map(handToJson) } : {}),
    })),
  });
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const numArr = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every(isNum);
const isCrop = (c: unknown): c is FaceObs['crop'] =>
  !!c && typeof c === 'object' && ['x', 'y', 'w', 'h'].every((k) => isNum((c as Record<string, unknown>)[k]));

function parseFace(v: unknown): FaceObs | null {
  const f = v as Partial<FaceObs> | null;
  if (!f || !numArr(f.blend, BLENDSHAPES.length) || !numArr(f.matrix, 16)) return null;
  if (!numArr(f.points, FACE_POINT_KEYS.length * 2) || !isCrop(f.crop) || !isNum(f.score)) return null;
  return { score: f.score, blend: f.blend, matrix: f.matrix, points: f.points, crop: f.crop };
}

function parseHand(v: unknown): HandObs | null {
  const h = v as Partial<HandObs> | null;
  if (!h || !numArr(h.image, HAND_POINTS * 3) || !numArr(h.world, HAND_POINTS * 3) || !isCrop(h.crop))
    return null;
  return {
    score: isNum(h.score) ? h.score : 1,
    handedness: typeof h.handedness === 'string' ? h.handedness : '',
    handednessScore: isNum(h.handednessScore) ? h.handednessScore : 0,
    image: h.image,
    world: h.world,
    crop: h.crop,
  };
}

/** Parse and validate pose JSON produced by {@link poseToJson}. */
export function poseFromJson(text: string): PoseSequence {
  const j = JSON.parse(text) as Partial<PoseSequence> & { format?: string };
  if (j.format !== 'mmd-studio-pose' || j.version !== 1 || !Array.isArray(j.frames) || !j.video) {
    throw new Error('Not an MMD Studio pose file');
  }
  const frames: PoseFrame[] = j.frames.map((f: PoseFrame) => {
    const ok =
      f.detected && Array.isArray(f.image) && Array.isArray(f.world) && f.world.length === LANDMARK_COUNT * 4;
    return {
      time: isNum(f.time) ? f.time : 0,
      detected: !!ok,
      people: isNum(f.people) ? f.people : 1,
      image: ok ? Float32Array.from(f.image as number[]) : new Float32Array(0),
      world: ok ? Float32Array.from(f.world as number[]) : new Float32Array(0),
      ...(f.face !== undefined ? { face: parseFace(f.face) } : {}),
      ...(Array.isArray(f.hands)
        ? { hands: [parseHand(f.hands[0]), parseHand(f.hands[1])] as HandPair }
        : {}),
    };
  });
  return {
    version: 1,
    estimator: String(j.estimator ?? 'unknown'),
    video: j.video,
    trim: Array.isArray(j.trim) ? (j.trim as [number, number]) : [0, j.video.duration],
    crop: j.crop ?? null,
    analysedSize: Array.isArray(j.analysedSize)
      ? (j.analysedSize as [number, number])
      : [j.video.width, j.video.height],
    sampleFps: isNum(j.sampleFps) ? j.sampleFps : 30,
    frames,
  };
}
