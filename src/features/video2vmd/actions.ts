import { POSE_MODEL_URL, type EstimatorId } from '@/engine/video2vmd/estimator';
import { FACE_MODEL_URL } from '@/engine/video2vmd/faceEstimator';
import { probeVideo } from '@/engine/video2vmd/frameSource';
import { HAND_MODEL_URL } from '@/engine/video2vmd/handEstimator';
import type { DetectRequest } from '@/engine/video2vmd/pipeline';
import { poseFromJson, poseToJson } from '@/engine/video2vmd/poseJson';
import { standardSkeleton, type Skeleton } from '@/engine/video2vmd/skeleton';
import type { SyntheticViewConfig } from '@/engine/video2vmd/syntheticV2';
import {
  presetSettings,
  type ConversionSettings,
  type CropBox,
  type PoseSequence,
  type PresetId,
} from '@/engine/video2vmd/types';
import { downloadBlob, saveOrShare } from '@/features/app/filePickers';
import { getAsset, registerFile, resolveRef } from '@/lib/assets';
import { isCoarsePointer, isLowMemoryDevice } from '@/lib/device';
import { DEFAULT_FACE_SETTINGS } from '@/lib/video2vmd/face';
import type {
  FaceSettings,
  FeatureFlags,
  HandSettings,
  MorphMapEntry,
  TwoViewSettings,
  ViewSync,
} from '@/lib/video2vmd/types';
import { assignMotion, setAudio, setAudioOffset } from '@/store/actions';
import { engineOrNull, whenEngine } from '@/store/engineRef';
import { markDirty, studio, toast } from '@/store/studio';
import {
  ALL_PARTS,
  DEFAULT_TWO_VIEW,
  initialDetect,
  v2v,
  type V2VStep,
  type Video2VmdDoc,
  type ViewId,
  type ViewSlot,
} from '@/store/video2vmd';

/** Videos larger than this are not stored in the project (results still are). */
const MAX_STORED_VIDEO = 200 * 1024 * 1024;
export const LONG_VIDEO_SECONDS = 180;

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const stem = (name: string): string => name.replace(/\.[^.]+$/, '') || 'motion';
const NO_FEATURES: FeatureFlags = { twoView: false, face: false, fingers: false };

export const features = (): FeatureFlags => v2v.get().settings.features ?? NO_FEATURES;
export const faceSettings = (): FaceSettings => v2v.get().settings.face ?? DEFAULT_FACE_SETTINGS;

export function setStep(step: V2VStep): void {
  v2v.set({ step });
  markDirty();
}

/** Estimator chosen by the URL (?pose=synthetic / synthetic2 for tests and demos), MediaPipe otherwise. */
export function estimatorFromUrl(): EstimatorId {
  const p = new URLSearchParams(location.search).get('pose');
  return p === 'synthetic' ? 'synthetic' : p === 'synthetic2' ? 'synthetic2' : 'mediapipe';
}

/** Synthetic two-camera backend configuration (?sideYaw=90&sideOffset=0.4). */
function syntheticConfig(view: ViewId, size: [number, number]): SyntheticViewConfig {
  const q = new URLSearchParams(location.search);
  return {
    role: view,
    sideYawDeg: Number(q.get('sideYaw') ?? 90),
    offset: Number(q.get('sideOffset') ?? 0),
    depthHeavy: q.get('depthHeavy') !== '0',
    size,
  };
}

// ---------------------------------------------------------------- import

const VIDEO_ACCEPT = 'video/*,.mp4,.m4v,.mov,.webm,.mkv';

/** Open a file picker for one of the video slots. */
export function pickVideoFor(slot: 'front' | 'side'): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = VIDEO_ACCEPT;
  input.style.display = 'none';
  document.body.appendChild(input);
  input.onchange = () => {
    const f = input.files?.[0];
    if (f) void importVideo(f, f.name, slot);
    input.remove();
  };
  input.click();
}

export async function importVideo(file: Blob, name: string, slot: ViewId = 'front'): Promise<void> {
  try {
    const info = await probeVideo(file, name);
    const s = v2v.get();
    const prev = slot === 'front' ? s.video : s.side;
    if (prev) URL.revokeObjectURL(prev.url);
    const big = Math.max(info.width, info.height) > 1920;
    const view: ViewSlot = { blob: file, url: URL.createObjectURL(file), info, ref: null };
    const reset = {
      result: null,
      appliedTo: null,
      fusion: null,
      calibration: null,
      autoSync: null,
      abReports: null,
    };
    if (slot === 'front') {
      v2v.set({
        video: view,
        trim: [0, info.duration],
        crop: null,
        downscale: big || isLowMemoryDevice() || (s.downscale && !!s.side),
        detect: initialDetect,
        live: { frame: null, thumbnail: null },
        pose: null,
        poseRef: null,
        lipSync: null,
        step: 'import',
        ...reset,
      });
    } else {
      v2v.set({
        side: view,
        sideTrim: [0, info.duration],
        sideCrop: null,
        sidePose: null,
        sidePoseRef: null,
        ...reset,
      });
    }
    if (file.size <= MAX_STORED_VIDEO) {
      void registerFile({ path: name, blob: file }).then((ref) => {
        const cur = slot === 'front' ? v2v.get().video : v2v.get().side;
        if (cur?.blob === file)
          v2v.set(slot === 'front' ? { video: { ...cur, ref } } : { side: { ...cur, ref } });
        markDirty();
      });
    } else {
      toast('info', 'This video is large, so it is not saved in the project. The detected motion still is.');
    }
    markDirty();
  } catch (e) {
    toast('error', errMsg(e), 10000);
  }
}

export function setTrim(trim: [number, number], slot: ViewId = 'front'): void {
  const v = slot === 'front' ? v2v.get().video : v2v.get().side;
  if (!v) return;
  const a = Math.max(0, Math.min(trim[0], v.info.duration));
  const b = Math.max(a + 0.1, Math.min(trim[1], v.info.duration));
  v2v.set(slot === 'front' ? { trim: [a, b] } : { sideTrim: [a, b] });
  markDirty();
}

export function setCrop(crop: CropBox | null, slot: ViewId = 'front'): void {
  v2v.set(slot === 'front' ? { crop } : { sideCrop: crop });
  markDirty();
}

// ---------------------------------------------------------------- features & presets

export function setFeature(key: keyof FeatureFlags, value: boolean): void {
  const f = { ...features(), [key]: value };
  v2v.set((s) => ({
    settings: { ...s.settings, features: f },
    ...(key === 'twoView' && !value ? { fusion: null } : {}),
  }));
  if (value && (key === 'twoView' || isCoarsePointer()) && (key === 'twoView' || f.fingers)) {
    if (isCoarsePointer() || isLowMemoryDevice()) v2v.set({ downscale: true });
  }
  markDirty();
  if (key === 'twoView') void runTwoView();
  else void runConversion();
}

export type CapturePreset = 'fast' | 'balanced' | 'full';
export const CAPTURE_PRESETS: Record<
  CapturePreset,
  { label: string; description: string; flags: FeatureFlags }
> = {
  fast: {
    label: 'Fast',
    description: 'Body only, one video.',
    flags: { twoView: false, face: false, fingers: false },
  },
  balanced: {
    label: 'Balanced',
    description: 'Body + face (expressions, blinks, mouth, eyes).',
    flags: { twoView: false, face: true, fingers: false },
  },
  full: {
    label: 'Full',
    description: 'Two-view + face + fingers. Slowest, most accurate.',
    flags: { twoView: true, face: true, fingers: true },
  },
};

export function applyCapturePreset(id: CapturePreset): void {
  v2v.set((s) => ({ settings: { ...s.settings, features: { ...CAPTURE_PRESETS[id].flags } } }));
  if (id === 'full' && (isCoarsePointer() || isLowMemoryDevice())) v2v.set({ downscale: true });
  markDirty();
  void runTwoView();
}

export const capturePresetOf = (f: FeatureFlags): CapturePreset | null =>
  (Object.keys(CAPTURE_PRESETS) as CapturePreset[]).find((k) => {
    const p = CAPTURE_PRESETS[k].flags;
    return p.twoView === f.twoView && p.face === f.face && p.fingers === f.fingers;
  }) ?? null;

// ---------------------------------------------------------------- detection

let controller: AbortController | null = null;

/** True when the detected data lacks something the current features need (re-run detection). */
export function needsRedetect(): boolean {
  const s = v2v.get();
  const f = features();
  const lacks = (seq: PoseSequence | null): boolean =>
    !!seq &&
    ((f.face && !seq.frames.some((fr) => fr.face !== undefined)) ||
      (f.fingers && !seq.frames.some((fr) => fr.hands !== undefined)));
  return lacks(s.pose) || (f.twoView && !!s.side && (!s.sidePose || lacks(s.sidePose)));
}

/**
 * Run detection for every view that needs it (front, then side in two-view mode). `resume` continues a
 * cancelled run and skips views that are already done; otherwise every view is analysed again.
 */
export async function startDetection(opts: { resume?: boolean } = {}): Promise<void> {
  const s0 = v2v.get();
  if (!s0.video || controller) return;
  const f = features();
  const views: ViewId[] = f.twoView && s0.side ? ['front', 'side'] : ['front'];
  controller = new AbortController();
  try {
    for (const view of views) {
      const s = v2v.get();
      const seq = view === 'front' ? s.pose : s.sidePose;
      const cancelledHere = s.detect.status === 'cancelled' && s.detect.view === view;
      const need = !opts.resume || !seq || cancelledHere || needsRedetectFor(seq);
      if (!need) continue;
      const out = await detectView(view, controller.signal, !!opts.resume && cancelledHere);
      if (!out) return;
    }
    v2v.set((x) => ({ detect: { ...x.detect, status: 'done' }, step: 'clean', autoSync: null }));
    await runTwoView();
  } catch (e) {
    v2v.set((st) => ({ detect: { ...st.detect, status: 'error', error: errMsg(e), message: errMsg(e) } }));
    toast('error', `Pose detection failed: ${errMsg(e)}`, 10000);
  } finally {
    controller = null;
  }
}

function needsRedetectFor(seq: PoseSequence): boolean {
  const f = features();
  return (
    (f.face && !seq.frames.some((fr) => fr.face !== undefined)) ||
    (f.fingers && !seq.frames.some((fr) => fr.hands !== undefined))
  );
}

/** Detect one view; returns its sequence, or null when cancelled. */
async function detectView(
  view: ViewId,
  signal: AbortSignal,
  allowResume: boolean,
): Promise<PoseSequence | null> {
  const s = v2v.get();
  const slot = view === 'front' ? s.video! : s.side!;
  const trim = view === 'front' ? s.trim : s.sideTrim;
  const crop = view === 'front' ? s.crop : s.sideCrop;
  const prevSeq = view === 'front' ? s.pose : s.sidePose;
  const resume =
    allowResume &&
    prevSeq &&
    prevSeq.frames.length &&
    prevSeq.trim[0] === trim[0] &&
    !needsRedetectFor(prevSeq)
      ? prevSeq
      : null;
  const info = slot.info;
  const f = features();
  const constrained = isLowMemoryDevice() || isCoarsePointer();
  const maxLongEdge = s.downscale || constrained ? 720 : 1280;
  const q = new URLSearchParams(location.search);
  const estimator = estimatorFromUrl();
  const request: DetectRequest = {
    file: slot.blob,
    info,
    trim,
    crop,
    maxLongEdge,
    sampleFps: Math.max(1, Math.min(info.fps || 30, constrained ? 30 : 60)),
    estimator,
    wasmBase: new URL('mediapipe/wasm', document.baseURI).href,
    modelUrl: POSE_MODEL_URL,
    faceModelUrl: FACE_MODEL_URL,
    handModelUrl: HAND_MODEL_URL,
    preferGpu: true,
    estimatorDelayMs: Number(q.get('poseDelay')) || 0,
    resumeFrom: resume ? resume.frames[resume.frames.length - 1].time + 1e-3 : undefined,
    features: { face: f.face, hands: f.fingers },
    synthetic: estimator === 'synthetic2' ? syntheticConfig(view, [info.width, info.height]) : undefined,
  };
  const liveKey = view === 'front' ? 'live' : 'liveSide';
  v2v.set({
    step: 'detect',
    detect: {
      ...initialDetect,
      status: 'loading',
      message: f.twoView ? `${view === 'front' ? 'Front' : 'Side'} view: starting…` : 'Starting…',
      done: resume?.frames.length ?? 0,
      view,
    },
    [liveKey]: { frame: null, thumbnail: null },
  });
  let lastUi = 0;
  const label = f.twoView ? `${view === 'front' ? 'Front' : 'Side'} view: ` : '';
  const { runDetection } = await import('@/engine/video2vmd/detectClient');
  const out = await runDetection(
    request,
    {
      onStatus: (message, backend) =>
        v2v.set((st) => ({ detect: { ...st.detect, message: label + message, backend, status: 'loading' } })),
      onProgress: (p) => {
        const now = performance.now();
        const old = v2v.get()[liveKey].thumbnail;
        if (p.thumbnail && old) old.close();
        v2v.set((st) => ({
          [liveKey]: { frame: p.frame ?? st[liveKey].frame, thumbnail: p.thumbnail ?? st[liveKey].thumbnail },
        }));
        if (now - lastUi < 120 && p.done < p.total) return;
        lastUi = now;
        v2v.set((st) => ({
          detect: { ...st.detect, status: 'running', done: p.done, total: p.total, eta: p.eta, rate: p.rate },
        }));
      },
    },
    signal,
  );
  const sequence: PoseSequence = resume
    ? { ...out.sequence, frames: [...resume.frames, ...out.sequence.frames] }
    : out.sequence;
  v2v.set((st) => ({
    ...(view === 'front' ? { pose: sequence } : { sidePose: sequence }),
    detect: {
      ...st.detect,
      status: out.cancelled ? 'cancelled' : 'running',
      mode: out.mode,
      view,
      message: out.cancelled
        ? `${label}paused at ${sequence.frames.length} frames — resume to continue.`
        : `${label}analysed ${sequence.frames.length} frames.`,
    },
  }));
  if (out.cancelled) return null;
  await storePose(sequence, view);
  return sequence;
}

export function cancelDetection(): void {
  controller?.abort();
}

async function storePose(seq: PoseSequence, view: ViewId = 'front'): Promise<void> {
  const blob = new Blob([poseToJson(seq)], { type: 'application/json' });
  const ref = await registerFile({
    path: `${stem(seq.video.name)}${view === 'side' ? '.side' : ''}.pose.json`,
    blob,
  });
  v2v.set(view === 'front' ? { poseRef: ref } : { sidePoseRef: ref });
  markDirty();
}

// ---------------------------------------------------------------- two-view: sync, calibration, fusion

/** Sync (auto unless a manual offset is set), calibrate and fuse; then convert. */
export async function runTwoView(): Promise<void> {
  const s = v2v.get();
  if (!features().twoView || !s.pose || !s.sidePose || !s.video || !s.side) {
    v2v.set({ fusion: null, calibration: null, abReports: null });
    await runConversion();
    return;
  }
  if (!s.autoSync) {
    const { motionSync } = await import('@/lib/video2vmd/sync');
    const motion = motionSync(s.pose.frames, s.sidePose.frames);
    let audio = null;
    if (s.video.info.hasAudio && s.side.info.hasAudio) {
      try {
        const { decodeMono, syncFromAudio } = await import('@/engine/video2vmd/audioAnalysis');
        const [a, b] = await Promise.all([decodeMono(s.video.blob), decodeMono(s.side.blob)]);
        if (a && b) audio = await syncFromAudio(a, b);
      } catch (e) {
        console.warn('Audio sync failed', e);
      }
    }
    v2v.set({ autoSync: { audio, motion } });
  }
  const auto = v2v.get().autoSync!;
  const best =
    auto.audio && (auto.audio.confidence >= 0.35 || auto.audio.confidence >= (auto.motion?.confidence ?? 0))
      ? { ...auto.audio, method: 'audio' as const }
      : auto.motion
        ? { ...auto.motion, method: 'motion' as const }
        : { offset: 0, confidence: 0, peak: 0, method: 'motion' as const };
  const manual = v2v.get().twoView.manualOffset;
  const sync: ViewSync =
    manual !== null
      ? { offset: manual, confidence: 1, method: 'manual' }
      : { offset: best.offset, confidence: best.confidence, method: best.method };
  v2v.set({ sync });
  await recalibrate();
}

/** Calibration + fusion for the current offset and two-view settings. */
async function recalibrate(): Promise<void> {
  const s = v2v.get();
  if (!s.pose || !s.sidePose || !s.sync) return;
  const [{ calibrate }, { alignedFrames, fuseViews }] = await Promise.all([
    import('@/lib/video2vmd/calibrate'),
    import('@/lib/video2vmd/fuse'),
  ]);
  const pairs = alignedFrames(s.pose, s.sidePose, s.sync.offset);
  const calibration = calibrate({
    front: pairs.front,
    side: pairs.side,
    priorDeg: s.twoView.angleDeg,
    fovDeg: s.twoView.fovDeg,
    frontSize: s.pose.analysedSize,
    sideSize: s.sidePose.analysedSize,
    fps: 30,
  });
  const fusion =
    pairs.front.length > 1
      ? fuseViews(s.pose, s.sidePose, s.sync.offset, calibration, { triangulate: s.twoView.triangulate })
      : null;
  v2v.set({ calibration, fusion });
  await runConversion();
}

export function setManualOffset(offset: number | null): void {
  v2v.set((s) => ({ twoView: { ...s.twoView, manualOffset: offset } }));
  markDirty();
  void runTwoView();
}

/** Move the offset by whole frames of the side video. */
export function nudgeOffset(frames: number): void {
  const s = v2v.get();
  const fps = s.side?.info.fps || 30;
  setManualOffset(Math.round(((s.sync?.offset ?? 0) + frames / fps) * 1000) / 1000);
}

export function setTwoView(patch: Partial<TwoViewSettings>): void {
  v2v.set((s) => ({ twoView: { ...s.twoView, ...patch } }));
  markDirty();
  void recalibrate();
}

export function setAB(ab: 'two' | 'single'): void {
  v2v.set({ ab });
  void runConversion();
}

// ---------------------------------------------------------------- conversion

/** Skeleton of the target model, or the standard MMD skeleton. */
function targetSkeleton(): { skeleton: Skeleton; modelId: string | null } {
  const s = v2v.get();
  const studioState = studio.get();
  const id =
    s.targetModelId && studioState.models.some((m) => m.id === s.targetModelId)
      ? s.targetModelId
      : (studioState.models.find((m) => m.id === studioState.selectedModelId && !m.stage)?.id ??
        studioState.models.find((m) => !m.stage)?.id ??
        null);
  const sk = id ? engineOrNull()?.getSkeleton(id) : null;
  return sk && sk.bones.length
    ? { skeleton: sk, modelId: id }
    : { skeleton: standardSkeleton(), modelId: null };
}

let convertTimer: ReturnType<typeof setTimeout> | null = null;

/** Clean → retarget → reduce → write VMD. Fast enough for the main thread; debounced for sliders. */
export function runConversion(delay = 0): Promise<void> {
  if (convertTimer) clearTimeout(convertTimer);
  return new Promise((resolve) => {
    convertTimer = setTimeout(() => {
      convertTimer = null;
      void convertNow().then(resolve);
    }, delay);
  });
}

async function convertNow(): Promise<void> {
  const s = v2v.get();
  if (!s.pose) return;
  v2v.set({ converting: true, convertError: null });
  try {
    if (features().face && faceSettings().lipSync && !s.lipSync) await ensureLipSync();
    const { convertPoses } = await import('@/engine/video2vmd/convert');
    const { skeleton, modelId } = targetSkeleton();
    const model = modelId ? studio.get().models.find((m) => m.id === modelId) : null;
    const ctx = {
      modelMorphs: model ? model.info.morphs.map((m) => m.name) : null,
      lipSync: v2v.get().lipSync,
    };
    const twoView = features().twoView && s.fusion;
    const input = twoView && s.ab === 'two' ? s.fusion!.sequence : s.pose;
    const result = convertPoses(input, skeleton, s.settings, ctx);
    let abReports = null;
    if (twoView) {
      const other = convertPoses(s.ab === 'two' ? s.pose : s.fusion!.sequence, skeleton, s.settings, ctx);
      abReports =
        s.ab === 'two'
          ? { two: result.report, single: other.report }
          : { two: other.report, single: result.report };
      if (s.calibration && s.sync)
        result.report.twoView = {
          detectedPct: s.fusion!.stats.detected,
          calibrationConfidence: s.calibration.confidence,
          yawDeg: s.calibration.yawDeg,
          fusedPct: s.fusion!.stats.fusedPct,
          syncOffsetMs: Math.round(s.sync.offset * 1000),
          syncConfidence: s.sync.confidence,
          syncMethod: s.sync.method,
        };
      for (const w of s.calibration?.warnings ?? []) result.report.warnings.unshift({ time: 0, message: w });
      if (s.sync && s.sync.method !== 'manual' && s.sync.confidence < 0.35)
        result.report.warnings.unshift({
          time: 0,
          message:
            'Automatic sync is uncertain; check the offset in the Clean step (a clap at the start helps).',
        });
    }
    v2v.set({
      result: {
        ...result,
        skeletonName: skeleton.name,
        vmdBlob: new Blob([result.vmd], { type: 'application/octet-stream' }),
      },
      abReports,
      converting: false,
    });
  } catch (e) {
    v2v.set({ converting: false, convertError: errMsg(e), result: null });
  }
}

/** Decode the front video's audio and compute lip-sync vowels in a Worker. */
export async function ensureLipSync(): Promise<void> {
  const s = v2v.get();
  if (!s.video?.info.hasAudio || s.lipSync) return;
  try {
    const { decodeMono, lipSyncFromAudio } = await import('@/engine/video2vmd/audioAnalysis');
    const audio = await decodeMono(s.video.blob);
    if (!audio) return;
    v2v.set({ lipSync: { fps: 30, vowels: await lipSyncFromAudio(audio, 30) } });
  } catch (e) {
    toast('warning', `Lip-sync: could not read the audio (${errMsg(e)}).`);
  }
}

export function updateSettings(patch: Partial<ConversionSettings>, delay = 120): void {
  v2v.set((s) => ({ settings: { ...s.settings, ...patch } }));
  markDirty();
  void runConversion(delay);
}

export function updateFace(patch: Partial<FaceSettings>, delay = 120): void {
  updateSettings({ face: { ...faceSettings(), ...patch } }, delay);
}

export function updateMorphEntry(index: number, patch: Partial<MorphMapEntry>): void {
  const map = faceSettings().map.map((e, i) => (i === index ? { ...e, ...patch } : e));
  updateFace({ map }, 150);
}

export function resetMorphMap(): void {
  updateFace({ map: DEFAULT_FACE_SETTINGS.map }, 0);
}

export function updateHands(patch: Partial<HandSettings>, delay = 120): void {
  void import('@/engine/video2vmd/convert').then(({ DEFAULT_HAND_SETTINGS }) =>
    updateSettings({ hands: { ...(v2v.get().settings.hands ?? DEFAULT_HAND_SETTINGS), ...patch } }, delay),
  );
}

export function applyPreset(id: PresetId): void {
  v2v.set((s) => ({ settings: presetSettings(id, s.settings) }));
  markDirty();
  void runConversion();
}

export function setTargetModel(id: string | null): void {
  v2v.set({ targetModelId: id });
  markDirty();
  void runConversion();
}

// ---------------------------------------------------------------- preview & export

/**
 * Assign the generated motion to the target model and play it. With the Clip Timeline in use, the face goes
 * on its own Face track (body, fingers and eyes become the Dance clip).
 */
export async function applyToModel(): Promise<void> {
  let s = v2v.get();
  if (!s.result) await runConversion();
  s = v2v.get();
  if (!s.result) return;
  const { modelId } = targetSkeleton();
  if (!modelId) {
    toast('warning', 'Load a model (Models → Add model) to preview the motion on it.');
    return;
  }
  const { writeParts } = await import('@/engine/video2vmd/convert');
  const { ct } = await import('@/store/clipTimeline');
  const timeline = ct.get().open || ct.get().doc.tracks.length > 0;
  const base = stem(s.pose?.video.name ?? 'video');
  const parts = s.result.parts;
  const name = s.result.skeletonName;
  const body = writeParts(name, parts, { body: true, fingers: true, eyes: true, face: !timeline });
  await assignMotion(modelId, { path: `${base}.vmd`, blob: new Blob([body]) });
  if (timeline) {
    const clips = await import('@/features/clip-timeline/actions');
    if (parts.morphs.length) {
      // addMotionFiles first puts the just-assigned dance on the timeline (when the model has none yet).
      const face = writeParts(name, parts, { body: false, fingers: false, eyes: false, face: true });
      await clips.addMotionFiles([{ path: `${base}-face.vmd`, blob: new Blob([face]) }], modelId);
    } else await clips.importLoaded();
  }
  v2v.set({ appliedTo: modelId });
  const engine = await whenEngine();
  engine.seek(0);
  engine.play();
}

/** Copy the video's soundtrack (trimmed) into the studio audio slot. */
export async function extractAudio(): Promise<void> {
  const s = v2v.get();
  if (!s.video) return;
  try {
    const ctx = new (
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    )();
    const buffer = await ctx.decodeAudioData(await s.video.blob.arrayBuffer());
    void ctx.close();
    const { encodeWav } = await import('./wav');
    const start = s.result ? s.result.track.times[0] : s.trim[0];
    const wav = encodeWav(buffer, start ?? s.trim[0], s.trim[1]);
    await setAudio({ path: `${stem(s.video.info.name)}-audio.wav`, blob: wav });
    setAudioOffset(0);
  } catch (e) {
    toast('error', `Could not read the video's audio track: ${errMsg(e)}`);
  }
}

export function setExportPart(part: keyof typeof ALL_PARTS, on: boolean): void {
  v2v.set((s) => ({ exportParts: { ...s.exportParts, [part]: on } }));
  markDirty();
}

/** The .vmd with the chosen parts. */
export async function exportBlob(): Promise<Blob | null> {
  const s = v2v.get();
  if (!s.result) return null;
  const { writeParts } = await import('@/engine/video2vmd/convert');
  return new Blob([writeParts(s.result.skeletonName, s.result.parts, s.exportParts)], {
    type: 'application/octet-stream',
  });
}

export async function downloadVmd(): Promise<void> {
  const s = v2v.get();
  const blob = await exportBlob();
  if (!blob) return;
  await saveOrShare(blob, `${stem(s.pose?.video.name ?? 'motion')}.vmd`);
}

/** Landmark bundle: both views (body, face, hands), sync and calibration. */
export function landmarksJson(): string | null {
  const s = v2v.get();
  if (!s.pose) return null;
  if (!s.sidePose) return poseToJson(s.pose);
  return JSON.stringify({
    format: 'mmd-studio-landmarks',
    version: 1,
    front: JSON.parse(poseToJson(s.pose)),
    side: JSON.parse(poseToJson(s.sidePose)),
    sync: s.sync,
    calibration: s.calibration,
    twoView: s.twoView,
  });
}

export function downloadPoseJson(): void {
  const s = v2v.get();
  const text = landmarksJson();
  if (!text || !s.pose) return;
  downloadBlob(new Blob([text], { type: 'application/json' }), `${stem(s.pose.video.name)}.landmarks.json`);
}

/** Load previously exported landmarks (single pose JSON or a two-view bundle); skips detection. */
export async function importPoseJson(file: Blob): Promise<void> {
  try {
    const text = await file.text();
    const j = JSON.parse(text) as {
      format?: string;
      front?: unknown;
      side?: unknown;
      sync?: ViewSync | null;
      twoView?: TwoViewSettings;
    };
    const front = poseFromJson(j.format === 'mmd-studio-landmarks' ? JSON.stringify(j.front) : text);
    const side = j.format === 'mmd-studio-landmarks' && j.side ? poseFromJson(JSON.stringify(j.side)) : null;
    v2v.set({
      pose: front,
      trim: front.trim,
      crop: front.crop,
      sidePose: side,
      sideTrim: side?.trim ?? [0, 0],
      sideCrop: side?.crop ?? null,
      autoSync: null,
      twoView: { ...v2v.get().twoView, ...(j.twoView ?? {}) },
      detect: {
        ...initialDetect,
        status: 'done',
        message: `Loaded ${front.frames.length} frames from pose JSON.`,
      },
      step: 'clean',
    });
    if (side) {
      v2v.set((s) => ({ settings: { ...s.settings, features: { ...features(), twoView: true } } }));
      if (j.sync) v2v.set((s) => ({ twoView: { ...s.twoView, manualOffset: j.sync!.offset } }));
      await storePose(side, 'side');
    }
    await storePose(front);
    await runTwoView();
  } catch (e) {
    toast('error', `Pose file: ${errMsg(e)}`);
  }
}

// ---------------------------------------------------------------- persistence

export function buildVideo2VmdDoc(): Video2VmdDoc | undefined {
  const s = v2v.get();
  if (!s.video && !s.pose) return undefined;
  return {
    video: s.video?.ref ?? null,
    videoInfo: s.video?.info ?? s.pose?.video ?? null,
    pose: s.poseRef,
    settings: s.settings,
    trim: s.trim,
    crop: s.crop,
    downscale: s.downscale,
    targetModelId: s.targetModelId,
    step: s.step,
    side: s.side?.ref ?? null,
    sideInfo: s.side?.info ?? s.sidePose?.video ?? null,
    sidePose: s.sidePoseRef,
    sideTrim: s.sideTrim,
    sideCrop: s.sideCrop,
    twoView: s.twoView,
    sync: s.sync,
    exportParts: s.exportParts,
  };
}

export async function restoreVideo2Vmd(doc: Video2VmdDoc | undefined): Promise<void> {
  const prev = v2v.get();
  if (prev.video) URL.revokeObjectURL(prev.video.url);
  if (prev.side) URL.revokeObjectURL(prev.side.url);
  v2v.set({
    video: null,
    pose: null,
    poseRef: null,
    result: null,
    detect: initialDetect,
    live: { frame: null, thumbnail: null },
    liveSide: { frame: null, thumbnail: null },
    step: 'import',
    appliedTo: null,
    side: null,
    sidePose: null,
    sidePoseRef: null,
    autoSync: null,
    sync: null,
    calibration: null,
    fusion: null,
    abReports: null,
    lipSync: null,
    twoView: { ...DEFAULT_TWO_VIEW },
    exportParts: { ...ALL_PARTS },
  });
  if (!doc) return;
  v2v.set({
    settings: { ...v2v.get().settings, ...doc.settings },
    trim: doc.trim,
    crop: doc.crop,
    downscale: doc.downscale,
    targetModelId: doc.targetModelId,
    step: doc.step,
    sideTrim: doc.sideTrim ?? [0, 0],
    sideCrop: doc.sideCrop ?? null,
    twoView: { ...DEFAULT_TWO_VIEW, ...(doc.twoView ?? {}) },
    exportParts: { ...ALL_PARTS, ...(doc.exportParts ?? {}) },
  });
  const loadSlot = async (
    ref: Video2VmdDoc['video'],
    info: Video2VmdDoc['videoInfo'],
  ): Promise<ViewSlot | null> => {
    if (!ref || !info) return null;
    const blob = await getAsset(ref.blobId);
    return blob ? { blob, url: URL.createObjectURL(blob), info, ref } : null;
  };
  const [video, side] = await Promise.all([
    loadSlot(doc.video, doc.videoInfo),
    loadSlot(doc.side ?? null, doc.sideInfo ?? null),
  ]);
  v2v.set({ video, side });
  const loadPose = async (ref: Video2VmdDoc['pose']): Promise<PoseSequence | null> => {
    if (!ref) return null;
    try {
      return poseFromJson(await (await resolveRef(ref)).blob.text());
    } catch (e) {
      console.warn('Could not restore pose data', e);
      return null;
    }
  };
  const [pose, sidePose] = await Promise.all([loadPose(doc.pose), loadPose(doc.sidePose ?? null)]);
  if (pose) {
    v2v.set({
      pose,
      poseRef: doc.pose,
      sidePose,
      sidePoseRef: sidePose ? (doc.sidePose ?? null) : null,
      detect: {
        ...initialDetect,
        status: 'done',
        message: `Restored ${pose.frames.length} analysed frames.`,
      },
    });
    if (doc.sync && doc.twoView?.manualOffset === null && doc.sync.method !== 'manual') {
      // Keep the auto result without recomputing the audio correlation.
      const r = { offset: doc.sync.offset, confidence: doc.sync.confidence, peak: 1 };
      v2v.set({
        autoSync: doc.sync.method === 'audio' ? { audio: r, motion: null } : { audio: null, motion: r },
      });
    }
    await runTwoView();
  }
}
