import { LANDMARK_COUNT } from './landmarks';
import type { PoseFrame, PoseSequence } from './types';

const round = (v: number): number => Math.round(v * 1e5) / 1e5;

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
    })),
  });
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

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
