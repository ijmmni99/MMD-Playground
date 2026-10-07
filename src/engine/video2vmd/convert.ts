import { cleanSequence, type CleanTrack } from './clean';
import { LANDMARK_COUNT, LM, PART_NAME } from './landmarks';
import { positionToleranceFor, reduceKeys } from './reduce';
import { retarget, type RetargetResult } from './retarget';
import type { Skeleton } from './skeleton';
import type { ConversionSettings, PoseSequence, QualityReport, QualityWarning } from './types';
import { writeVmd } from './vmdWriter';

export interface ConversionResult {
  track: CleanTrack;
  retarget: RetargetResult;
  vmd: ArrayBuffer;
  report: QualityReport;
}

/** Everything after pose estimation: clean → retarget → reduce → VMD bytes + quality report. */
export function convertPoses(
  seq: PoseSequence,
  skeleton: Skeleton,
  settings: ConversionSettings,
): ConversionResult {
  if (!seq.frames.some((f) => f.detected)) throw new Error('No person was detected in this video.');
  const track = cleanSequence(seq, settings);
  const rt = retarget(track, skeleton, settings);
  const reduced = reduceKeys(
    rt.keys,
    settings.reduceTolerance,
    positionToleranceFor(settings.reduceTolerance),
  );
  const vmd = writeVmd({ modelName: skeleton.name, bones: reduced, properties: rt.properties });
  const report = buildReport(seq, track, rt, rt.keys.length, reduced.length, settings);
  return { track, retarget: rt, vmd, report };
}

export const formatTime = (s: number): string => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

/** Runs of `true` longer than `minLen` as [startIndex, endIndex]. */
function runs(flags: boolean[], minLen: number): [number, number][] {
  const out: [number, number][] = [];
  let s = -1;
  for (let i = 0; i <= flags.length; i++) {
    if (i < flags.length && flags[i]) {
      if (s < 0) s = i;
    } else if (s >= 0) {
      if (i - s >= minLen) out.push([s, i - 1]);
      s = -1;
    }
  }
  return out;
}

const WATCH: number[] = [
  LM.nose,
  LM.leftWrist,
  LM.rightWrist,
  LM.leftAnkle,
  LM.rightAnkle,
  LM.leftKnee,
  LM.rightKnee,
];

export function buildReport(
  seq: PoseSequence,
  track: CleanTrack,
  rt: RetargetResult,
  keysOriginal: number,
  keysReduced: number,
  settings: ConversionSettings,
): QualityReport {
  const frames = seq.frames;
  const detected = frames.filter((f) => f.detected);
  let confSum = 0;
  let confCount = 0;
  for (const f of detected) {
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      confSum += f.world[i * 4 + 3] ?? 0;
      confCount++;
    }
  }
  const warnings: QualityWarning[] = [];
  const minRun = Math.max(2, Math.round(seq.sampleFps * 0.3));
  for (const [a, b] of runs(
    frames.map((f) => !f.detected),
    minRun,
  )) {
    warnings.push({
      time: frames[a].time,
      message: `No dancer detected ${formatTime(frames[a].time)}–${formatTime(frames[b].time)}; motion was interpolated.`,
    });
  }
  // Body parts out of frame or hidden.
  for (const lm of WATCH) {
    const hidden = frames.map((f) => {
      if (!f.detected) return false;
      const x = f.image[lm * 4];
      const y = f.image[lm * 4 + 1];
      const vis = Math.min(f.world[lm * 4 + 3] ?? 0, f.image[lm * 4 + 3] ?? 1);
      return vis < settings.visibilityThreshold || x < 0 || x > 1 || y < 0 || y > 1;
    });
    for (const [a] of runs(hidden, minRun).slice(0, 3)) {
      const t = frames[a].time;
      const part = PART_NAME[lm] ?? 'body';
      const outside =
        frames[a].image[lm * 4] < 0 ||
        frames[a].image[lm * 4] > 1 ||
        frames[a].image[lm * 4 + 1] < 0 ||
        frames[a].image[lm * 4 + 1] > 1;
      warnings.push({
        time: t,
        message: outside
          ? `Dancer partially out of frame at ${formatTime(t)} (${part}).`
          : `${part[0].toUpperCase()}${part.slice(1)} hard to see at ${formatTime(t)} (occluded or blurred).`,
      });
    }
  }
  const multi = frames.filter((f) => (f.people ?? 1) > 1).length;
  if (multi > frames.length * 0.05) {
    warnings.push({
      time: frames.find((f) => (f.people ?? 1) > 1)?.time ?? 0,
      message: `More than one person detected in ${Math.round((multi / frames.length) * 100)}% of frames; the largest person was tracked. Crop to the dancer for best results.`,
    });
  }
  if (track.missingLandmarks.some((l) => l === LM.leftAnkle || l === LM.rightAnkle) && settings.lowerBody) {
    warnings.push({ time: 0, message: 'Feet were never visible. Try the “Upper body only” preset.' });
  }
  const outlierFrames = track.outlier.filter(Boolean).length;
  if (outlierFrames > track.frameCount * 0.1) {
    warnings.push({
      time: 0,
      message: `${outlierFrames} frames had implausible limb lengths and were repaired; check fast or occluded moves.`,
    });
  }
  if (track.jitterClean > 6) {
    warnings.push({
      time: 0,
      message: 'Motion is still jittery. Try the “Slow / clean” preset or lower the min cutoff.',
    });
  }
  if (!settings.footIk && rt.footSkateBefore > 4) {
    warnings.push({ time: 0, message: 'Feet slide noticeably. Turn on foot IK to pin planted feet.' });
  }
  warnings.sort((a, b) => a.time - b.time);
  return {
    frames: frames.length,
    detectedPct: frames.length ? (detected.length / frames.length) * 100 : 0,
    avgConfidence: confCount ? confSum / confCount : 0,
    footSkateBefore: rt.footSkateBefore,
    footSkateAfter: rt.footSkateAfter,
    jitterRaw: track.jitterRaw,
    jitterClean: track.jitterClean,
    outlierFrames,
    multiPersonFrames: multi,
    keysOriginal,
    keysReduced,
    warnings,
  };
}
