import { MIN_FACE_PX, MIN_HAND_PX, sourcePixels } from '@/lib/video2vmd/crop';
import {
  DEFAULT_FACE_SETTINGS,
  computeFaceTracks,
  eyeRotation,
  type FaceTrackResult,
  type Vowel,
} from '@/lib/video2vmd/face';
import {
  computeFingerTracks,
  fingerRig,
  fingerRotations,
  handDirections,
  type FingerTrackResult,
} from '@/lib/video2vmd/hands';
import type { HandSettings } from '@/lib/video2vmd/types';
import { cleanSequence, type CleanTrack } from './clean';
import { LANDMARK_COUNT, LM, PART_NAME } from './landmarks';
import { positionToleranceFor, reduceKeys } from './reduce';
import { retarget, type RetargetExtras, type RetargetResult } from './retarget';
import { SkeletonIndex, type Skeleton } from './skeleton';
import type { ConversionSettings, PoseSequence, QualityReport, QualityWarning } from './types';
import { writeVmd, type BoneKey, type MorphKey, type PropertyKey } from './vmdWriter';

export const DEFAULT_HAND_SETTINGS: HandSettings = {
  minCutoff: 2,
  beta: 0.4,
  presetSnap: false,
  wristRefine: true,
  reduceTolerance: 0.6,
  holdSeconds: 0.5,
};

/** Key sets of one conversion, so export can include any subset. */
export interface MotionParts {
  body: BoneKey[];
  fingers: BoneKey[];
  eyes: BoneKey[];
  morphs: MorphKey[];
  properties: PropertyKey[];
}

export type PartId = 'body' | 'fingers' | 'face' | 'eyes';

export interface ConversionResult {
  track: CleanTrack;
  retarget: RetargetResult;
  vmd: ArrayBuffer;
  report: QualityReport;
  parts: MotionParts;
  face: FaceTrackResult | null;
  fingers: FingerTrackResult | null;
}

/** Extra inputs for the v2 features. */
export interface ConversionContext {
  /** Morph names of the target model (null = no model: standard names). */
  modelMorphs?: string[] | null;
  /** Audio lip-sync vowels sampled every 1/fps seconds of video time (see lipsync.ts). */
  lipSync?: { fps: number; vowels: Record<Vowel, number[]> } | null;
}

/** Write a VMD with a subset of the parts. */
export function writeParts(
  modelName: string,
  parts: MotionParts,
  include: Record<PartId, boolean>,
): ArrayBuffer {
  return writeVmd({
    modelName,
    bones: [
      ...(include.body ? parts.body : []),
      ...(include.fingers ? parts.fingers : []),
      ...(include.eyes ? parts.eyes : []),
    ],
    morphs: include.face ? parts.morphs : [],
    properties: include.body ? parts.properties : [],
  });
}

/** Everything after pose estimation: clean → retarget → reduce → VMD bytes + quality report. */
export function convertPoses(
  seq: PoseSequence,
  skeleton: Skeleton,
  settings: ConversionSettings,
  ctx: ConversionContext = {},
): ConversionResult {
  if (!seq.frames.some((f) => f.detected)) throw new Error('No person was detected in this video.');
  const track = cleanSequence(seq, settings);
  const features = settings.features ?? { twoView: false, face: false, fingers: false };
  const faceSettings = settings.face ?? DEFAULT_FACE_SETTINGS;
  const handSettings = settings.hands ?? DEFAULT_HAND_SETTINGS;
  const hasFace = features.face && seq.frames.some((f) => f.face);
  const hasHands = features.fingers && seq.frames.some((f) => f.hands?.[0] || f.hands?.[1]);

  let face: FaceTrackResult | null = null;
  if (hasFace) {
    let lipSync: Record<Vowel, number[]> | null = null;
    const ls = ctx.lipSync;
    if (faceSettings.lipSync && ls) {
      const at = (series: number[], t: number): number =>
        series[Math.max(0, Math.min(series.length - 1, Math.round(t * ls.fps)))] ?? 0;
      lipSync = Object.fromEntries(
        (Object.keys(ls.vowels) as Vowel[]).map((v) => [v, track.times.map((t) => at(ls.vowels[v], t))]),
      ) as Record<Vowel, number[]>;
    }
    face = computeFaceTracks(seq.frames, track.times, faceSettings, {
      mirror: settings.mirror,
      modelMorphs: ctx.modelMorphs ?? null,
      size: seq.analysedSize,
      fps: track.fps,
      lipSync,
    });
  }
  const fingers = hasHands
    ? computeFingerTracks(seq.frames, track.times, handSettings, { mirror: settings.mirror, fps: track.fps })
    : null;

  const extras: RetargetExtras = {};
  if (face) extras.head = face.head;
  if (hasHands && handSettings.wristRefine) {
    extras.wristTwist = true;
    extras.hands = [0, 1].map((s) => {
      const src = settings.mirror ? 1 - s : s;
      return track.times.map((t) => {
        const fr = nearestFrame(seq, t);
        const h = fr?.hands?.[src];
        if (!h || h.score < 0.5 || h.world.length < 63) return null;
        return { ...handDirections(h.world, settings.mirror), w: Math.min(1, h.score) * 0.8 };
      });
    }) as RetargetExtras['hands'];
  }
  const rt = retarget(track, skeleton, settings, extras);
  const reduced = reduceKeys(
    rt.keys,
    settings.reduceTolerance,
    positionToleranceFor(settings.reduceTolerance),
  );

  // Fingers.
  const fingerKeys: BoneKey[] = [];
  if (fingers) {
    for (const s of [0, 1] as const) {
      const rig = fingerRig(skeleton.bones, s === 0 ? 'left' : 'right');
      if (!rig) continue;
      fingers.poses[s].forEach((pose, f) => {
        for (const [bone, q] of fingerRotations(rig, pose))
          fingerKeys.push({ bone, frame: f, position: [0, 0, 0], rotation: [q[0], q[1], q[2], q[3]] });
      });
    }
  }
  const fingersReduced = reduceKeys(fingerKeys, handSettings.reduceTolerance, 0);

  // Eyes and morphs.
  const eyeKeys: BoneKey[] = [];
  const morphKeys: MorphKey[] = [];
  if (face) {
    const sk = new SkeletonIndex(skeleton);
    const eyeBones = sk.has('両目') ? ['両目'] : ['左目', '右目'].filter((b) => sk.has(b));
    if (faceSettings.eyes && eyeBones.length) {
      face.gaze.forEach(([yaw, pitch], f) => {
        const q = eyeRotation(yaw, pitch);
        for (const bone of eyeBones)
          eyeKeys.push({ bone, frame: f, position: [0, 0, 0], rotation: [q[0], q[1], q[2], q[3]] });
      });
    }
    for (const [morph, frames] of face.keyFrames) {
      const series = face.morphs.get(morph)!;
      for (const f of frames) morphKeys.push({ morph, frame: f, weight: Math.round(series[f] * 1e4) / 1e4 });
    }
  }
  const eyesReduced = reduceKeys(eyeKeys, 0.3, 0);

  const parts: MotionParts = {
    body: reduced,
    fingers: fingersReduced,
    eyes: eyesReduced,
    morphs: morphKeys,
    properties: rt.properties,
  };
  const vmd = writeParts(skeleton.name, parts, { body: true, fingers: true, face: true, eyes: true });
  const report = buildReport(seq, track, rt, rt.keys.length, reduced.length, settings);
  extendReport(
    report,
    seq,
    track,
    face,
    fingers,
    fingerKeys.length + eyeKeys.length,
    fingersReduced.length + eyesReduced.length,
  );
  return { track, retarget: rt, vmd, report, parts, face, fingers };
}

/** Source frame closest to a time (frames are sorted). */
function nearestFrame(seq: PoseSequence, t: number): PoseSequence['frames'][number] | undefined {
  const fr = seq.frames;
  let lo = 0;
  let hi = fr.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (fr[m].time <= t) lo = m;
    else hi = m;
  }
  return Math.abs((fr[hi]?.time ?? Infinity) - t) < Math.abs((fr[lo]?.time ?? Infinity) - t)
    ? fr[hi]
    : fr[lo];
}

/** Face and hand sections of the quality report. */
function extendReport(
  report: QualityReport,
  seq: PoseSequence,
  track: CleanTrack,
  face: FaceTrackResult | null,
  fingers: FingerTrackResult | null,
  keysOriginal: number,
  keysReduced: number,
): void {
  const minRun = Math.round(track.fps * 0.5);
  const at = (f: number): number => track.times[f] ?? 0;
  const src: [number, number] = [seq.video.width, seq.video.height];
  const median = (v: number[]): number => {
    const s = [...v].sort((a, b) => a - b);
    return s[s.length >> 1] ?? 0;
  };
  if (face) {
    const written = [...face.morphs.keys()];
    const crops = seq.frames.filter((f) => f.face).map((f) => sourcePixels(f.face!.crop, seq.crop, src));
    const px = Math.round(median(crops));
    report.face = { detectedPct: face.detected * 100, written, missing: face.missing, cropPx: px };
    for (const [a, b] of runs(
      face.present.map((p) => !p),
      minRun,
    ).slice(0, 4))
      report.warnings.push({
        time: at(a),
        message: `Face not detected ${formatTime(at(a))}–${formatTime(at(b))}; the expression eases to neutral.`,
      });
    if (crops.length && px < MIN_FACE_PX)
      report.warnings.push({
        time: 0,
        message: `The face is small in the video (~${px} px); film at 1080p or closer for better expressions.`,
      });
    if (face.missing.length)
      report.warnings.push({
        time: 0,
        message: `Skipped morphs the model doesn't have: ${face.missing.join(', ')}.`,
      });
  }
  if (fingers) {
    const sideName = ['Left', 'Right'];
    report.hands = {
      detectedPct: [fingers.coverage[0] * 100, fingers.coverage[1] * 100],
      rejected: fingers.rejected[0] + fingers.rejected[1],
      cropPx: Math.round(
        median(
          seq.frames.flatMap((f) =>
            (f.hands ?? []).filter((h) => !!h).map((h) => sourcePixels(h!.crop, seq.crop, src)),
          ),
        ),
      ),
      labelAgreement: fingers.labelAgreement,
    };
    for (const s of [0, 1] as const) {
      for (const [a, b] of runs(
        fingers.detected[s].map((d) => !d),
        minRun,
      ).slice(0, 3))
        report.warnings.push({
          time: at(a),
          message: `${sideName[s]} hand not detected ${formatTime(at(a))}–${formatTime(at(b))}, using a relaxed pose.`,
        });
    }
    if (report.hands.cropPx && report.hands.cropPx < MIN_HAND_PX)
      report.warnings.push({
        time: 0,
        message: `Hands are small in the video (~${report.hands.cropPx} px); fingers may be unreliable. Film at 1080p or closer.`,
      });
    if (fingers.labelAgreement >= 0 && fingers.labelAgreement < 0.7)
      report.warnings.push({
        time: 0,
        message:
          'Hand crops often catch the other hand (crossed or overlapping hands); check the finger result.',
      });
    if (fingers.rejected[0] + fingers.rejected[1] > track.frameCount * 0.1)
      report.warnings.push({
        time: 0,
        message: 'Many hand frames looked impossible (motion blur or occlusion) and were skipped.',
      });
  }
  report.keysOriginal += keysOriginal;
  report.keysReduced += keysReduced;
  report.warnings.sort((a, b) => a.time - b.time);
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
