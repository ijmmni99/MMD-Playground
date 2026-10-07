import { POSE_MODEL_URL, type EstimatorId } from '@/engine/video2vmd/estimator';
import { probeVideo } from '@/engine/video2vmd/frameSource';
import type { DetectRequest } from '@/engine/video2vmd/pipeline';
import { poseFromJson, poseToJson } from '@/engine/video2vmd/poseJson';
import { standardSkeleton, type Skeleton } from '@/engine/video2vmd/skeleton';
import {
  presetSettings,
  type ConversionSettings,
  type PoseSequence,
  type PresetId,
} from '@/engine/video2vmd/types';
import { downloadBlob, saveOrShare } from '@/features/app/filePickers';
import { getAsset, registerFile, resolveRef } from '@/lib/assets';
import { isCoarsePointer, isLowMemoryDevice } from '@/lib/device';
import { assignMotion, setAudio, setAudioOffset } from '@/store/actions';
import { engineOrNull, whenEngine } from '@/store/engineRef';
import { markDirty, studio, toast } from '@/store/studio';
import { initialDetect, v2v, type V2VStep, type Video2VmdDoc } from '@/store/video2vmd';

/** Videos larger than this are not stored in the project (results still are). */
const MAX_STORED_VIDEO = 200 * 1024 * 1024;
export const LONG_VIDEO_SECONDS = 180;

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const stem = (name: string): string => name.replace(/\.[^.]+$/, '') || 'motion';

export function setStep(step: V2VStep): void {
  v2v.set({ step });
  markDirty();
}

/** Estimator chosen by the URL (?pose=synthetic for tests/demos), MediaPipe otherwise. */
export function estimatorFromUrl(): EstimatorId {
  return new URLSearchParams(location.search).get('pose') === 'synthetic' ? 'synthetic' : 'mediapipe';
}

export async function importVideo(file: Blob, name: string): Promise<void> {
  try {
    const info = await probeVideo(file, name);
    const prev = v2v.get().video;
    if (prev) URL.revokeObjectURL(prev.url);
    const big = Math.max(info.width, info.height) > 1920;
    v2v.set({
      video: { blob: file, url: URL.createObjectURL(file), info, ref: null },
      trim: [0, info.duration],
      crop: null,
      downscale: big || isLowMemoryDevice(),
      detect: initialDetect,
      live: { frame: null, thumbnail: null },
      pose: null,
      poseRef: null,
      result: null,
      appliedTo: null,
      step: 'import',
    });
    if (file.size <= MAX_STORED_VIDEO) {
      void registerFile({ path: name, blob: file }).then((ref) => {
        const v = v2v.get().video;
        if (v?.blob === file) v2v.set({ video: { ...v, ref } });
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

export function setTrim(trim: [number, number]): void {
  const v = v2v.get().video;
  if (!v) return;
  const a = Math.max(0, Math.min(trim[0], v.info.duration));
  const b = Math.max(a + 0.1, Math.min(trim[1], v.info.duration));
  v2v.set({ trim: [a, b] });
  markDirty();
}

let controller: AbortController | null = null;

/** Run (or resume) frame extraction + pose estimation. */
export async function startDetection(): Promise<void> {
  const s = v2v.get();
  if (!s.video || controller) return;
  const resume =
    s.detect.status === 'cancelled' && s.pose && s.pose.frames.length && s.pose.trim[0] === s.trim[0]
      ? s.pose
      : null;
  const info = s.video.info;
  const constrained = isLowMemoryDevice() || isCoarsePointer();
  const request: DetectRequest = {
    file: s.video.blob,
    info,
    trim: s.trim,
    crop: s.crop,
    maxLongEdge: s.downscale || constrained ? 720 : 1280,
    sampleFps: Math.max(1, Math.min(info.fps || 30, constrained ? 30 : 60)),
    estimator: estimatorFromUrl(),
    wasmBase: new URL('mediapipe/wasm', document.baseURI).href,
    modelUrl: POSE_MODEL_URL,
    preferGpu: true,
    resumeFrom: resume ? resume.frames[resume.frames.length - 1].time + 1e-3 : undefined,
  };
  controller = new AbortController();
  v2v.set({
    step: 'detect',
    detect: { ...initialDetect, status: 'loading', message: 'Starting…', done: resume?.frames.length ?? 0 },
    live: { frame: null, thumbnail: null },
  });
  let lastUi = 0;
  try {
    const { runDetection } = await import('@/engine/video2vmd/detectClient');
    const out = await runDetection(
      request,
      {
        onStatus: (message, backend) =>
          v2v.set((st) => ({ detect: { ...st.detect, message, backend, status: 'loading' } })),
        onProgress: (p) => {
          const now = performance.now();
          const old = v2v.get().live.thumbnail;
          if (p.thumbnail && old) old.close();
          v2v.set((st) => ({
            live: { frame: p.frame ?? st.live.frame, thumbnail: p.thumbnail ?? st.live.thumbnail },
          }));
          if (now - lastUi < 120 && p.done < p.total) return;
          lastUi = now;
          v2v.set((st) => ({
            detect: {
              ...st.detect,
              status: 'running',
              done: p.done,
              total: p.total,
              eta: p.eta,
              rate: p.rate,
            },
          }));
        },
      },
      controller.signal,
    );
    const sequence: PoseSequence = resume
      ? { ...out.sequence, frames: [...resume.frames, ...out.sequence.frames] }
      : out.sequence;
    v2v.set((st) => ({
      pose: sequence,
      detect: {
        ...st.detect,
        status: out.cancelled ? 'cancelled' : 'done',
        mode: out.mode,
        message: out.cancelled
          ? `Paused at ${sequence.frames.length} frames — resume to continue.`
          : `Analysed ${sequence.frames.length} frames.`,
      },
    }));
    if (!out.cancelled) {
      await storePose(sequence);
      v2v.set({ step: 'clean' });
      await runConversion();
    }
  } catch (e) {
    v2v.set((st) => ({ detect: { ...st.detect, status: 'error', error: errMsg(e), message: errMsg(e) } }));
    toast('error', `Pose detection failed: ${errMsg(e)}`, 10000);
  } finally {
    controller = null;
  }
}

export function cancelDetection(): void {
  controller?.abort();
}

async function storePose(seq: PoseSequence): Promise<void> {
  const blob = new Blob([poseToJson(seq)], { type: 'application/json' });
  const ref = await registerFile({ path: `${stem(seq.video.name)}.pose.json`, blob });
  v2v.set({ poseRef: ref });
  markDirty();
}

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
    const { convertPoses } = await import('@/engine/video2vmd/convert');
    const { skeleton } = targetSkeleton();
    const result = convertPoses(s.pose, skeleton, s.settings);
    v2v.set({
      result: {
        ...result,
        skeletonName: skeleton.name,
        vmdBlob: new Blob([result.vmd], { type: 'application/octet-stream' }),
      },
      converting: false,
    });
  } catch (e) {
    v2v.set({ converting: false, convertError: errMsg(e), result: null });
  }
}

export function updateSettings(patch: Partial<ConversionSettings>, delay = 120): void {
  v2v.set((s) => ({ settings: { ...s.settings, ...patch } }));
  markDirty();
  void runConversion(delay);
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

/** Assign the generated motion to the target model in the studio and play it. */
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
  const name = `${stem(s.pose?.video.name ?? 'video')}.vmd`;
  await assignMotion(modelId, { path: name, blob: s.result.vmdBlob });
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
    const wav = encodeWav(buffer, s.trim[0], s.trim[1]);
    await setAudio({ path: `${stem(s.video.info.name)}-audio.wav`, blob: wav });
    setAudioOffset(0);
  } catch (e) {
    toast('error', `Could not read the video's audio track: ${errMsg(e)}`);
  }
}

export async function downloadVmd(): Promise<void> {
  const s = v2v.get();
  if (!s.result) return;
  await saveOrShare(s.result.vmdBlob, `${stem(s.pose?.video.name ?? 'motion')}.vmd`);
}

export function downloadPoseJson(): void {
  const s = v2v.get();
  if (!s.pose) return;
  downloadBlob(
    new Blob([poseToJson(s.pose)], { type: 'application/json' }),
    `${stem(s.pose.video.name)}.pose.json`,
  );
}

/** Load previously exported pose JSON (skips pose estimation). */
export async function importPoseJson(file: Blob): Promise<void> {
  try {
    const seq = poseFromJson(await file.text());
    v2v.set({
      pose: seq,
      trim: seq.trim,
      crop: seq.crop,
      detect: {
        ...initialDetect,
        status: 'done',
        message: `Loaded ${seq.frames.length} frames from pose JSON.`,
      },
      step: 'clean',
    });
    await storePose(seq);
    await runConversion();
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
  };
}

export async function restoreVideo2Vmd(doc: Video2VmdDoc | undefined): Promise<void> {
  const prev = v2v.get().video;
  if (prev) URL.revokeObjectURL(prev.url);
  v2v.set({
    video: null,
    pose: null,
    poseRef: null,
    result: null,
    detect: initialDetect,
    live: { frame: null, thumbnail: null },
    step: 'import',
    appliedTo: null,
  });
  if (!doc) return;
  v2v.set({
    settings: { ...v2v.get().settings, ...doc.settings },
    trim: doc.trim,
    crop: doc.crop,
    downscale: doc.downscale,
    targetModelId: doc.targetModelId,
    step: doc.step,
  });
  if (doc.video && doc.videoInfo) {
    const blob = await getAsset(doc.video.blobId);
    if (blob)
      v2v.set({ video: { blob, url: URL.createObjectURL(blob), info: doc.videoInfo, ref: doc.video } });
  }
  if (doc.pose) {
    try {
      const seq = poseFromJson(await (await resolveRef(doc.pose)).blob.text());
      v2v.set({
        pose: seq,
        poseRef: doc.pose,
        detect: {
          ...initialDetect,
          status: 'done',
          message: `Restored ${seq.frames.length} analysed frames.`,
        },
      });
      await runConversion();
    } catch (e) {
      console.warn('Could not restore pose data', e);
    }
  }
}
