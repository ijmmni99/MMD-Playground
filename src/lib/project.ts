import { DEFAULT_CAMERA, DEFAULT_SETTINGS, DEFAULT_TRANSFORM } from '@/engine/defaults';
import type { CameraState, ModelRuntimeState, SceneSettings } from '@/engine/types';
import type { MotionEditorDoc } from '@/store/motionEditor';
import type { LabelOverrides } from '@/lib/names/types';
import type { Video2VmdDoc } from '@/store/video2vmd';
import type { TimelineDoc } from '@/lib/clips/types';
import { parseTimeline } from '@/lib/clips/serialize';

export const PROJECT_VERSION = 1;
export const PROJECT_EXT = '.mmdstudio.zip';

/** Reference to a file blob stored in the asset store (content-addressed by SHA-256). */
export interface FileRef {
  blobId: string;
  path: string;
}

export interface ProjectModel {
  id: string;
  name: string;
  mainPath: string;
  files: FileRef[];
  motion: FileRef | null;
  state: ModelRuntimeState;
}

export interface ProjectDoc {
  version: number;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  settings: SceneSettings;
  camera: CameraState;
  playback: { frame: number; speed: number; loop: boolean };
  audio: { file: FileRef; offsetMs: number; volume: number } | null;
  cameraMotion: FileRef | null;
  /** Body motions used in this project, offered by the motion picker. */
  motions?: FileRef[];
  hdr: FileRef | null;
  models: ProjectModel[];
  thumbnail?: string;
  /** Video to VMD session (source video, pose data, settings). */
  video2vmd?: Video2VmdDoc;
  /** Motion editor: edited clips (base + original), pins, markers, BPM, shots. */
  motionEditor?: MotionEditorDoc;
  /** User English labels for bone / morph / material names, keyed by model label key (display only). */
  labels?: Record<string, LabelOverrides>;
  /** Clip timeline: tracks, clips (non-destructive edits) and their sources. */
  clipTimeline?: TimelineDoc;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  modelCount: number;
  thumbnail?: string;
}

export function newProjectId(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function createEmptyProject(name = 'Untitled project'): ProjectDoc {
  const now = Date.now();
  return {
    version: PROJECT_VERSION,
    id: newProjectId(),
    name,
    createdAt: now,
    updatedAt: now,
    settings: structuredClone(DEFAULT_SETTINGS),
    camera: structuredClone(DEFAULT_CAMERA),
    playback: { frame: 0, speed: 1, loop: false },
    audio: null,
    cameraMotion: null,
    hdr: null,
    models: [],
  };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Deep-merge `value` over `defaults`, keeping only keys known to the defaults and matching primitive types. */
export function mergeDefaults<T>(defaults: T, value: unknown): T {
  if (!isObj(defaults) || !isObj(value)) {
    if (value === undefined || value === null) return defaults;
    if (typeof defaults === typeof value || defaults === null) return value as T;
    return defaults;
  }
  const out: Record<string, unknown> = {};
  for (const [k, d] of Object.entries(defaults)) out[k] = mergeDefaults(d, value[k]);
  return out as T;
}

function isFileRef(v: unknown): v is FileRef {
  return isObj(v) && typeof v.blobId === 'string' && typeof v.path === 'string';
}

/** Validate and upgrade an unknown JSON value into a ProjectDoc. Throws on unrecoverable input. */
export function parseProjectDoc(json: unknown): ProjectDoc {
  if (!isObj(json)) throw new Error('Invalid project file');
  if (typeof json.version !== 'number' || json.version > PROJECT_VERSION) {
    throw new Error(`Unsupported project version: ${String(json.version)}`);
  }
  const base = createEmptyProject(typeof json.name === 'string' ? json.name : 'Imported project');
  const models: ProjectModel[] = Array.isArray(json.models)
    ? json.models.filter(isObj).flatMap((m) => {
        if (typeof m.mainPath !== 'string' || !Array.isArray(m.files)) return [];
        const state = isObj(m.state) ? m.state : {};
        return [
          {
            id: typeof m.id === 'string' ? m.id : newProjectId(),
            name: typeof m.name === 'string' ? m.name : m.mainPath,
            mainPath: m.mainPath,
            files: m.files.filter(isFileRef),
            motion: isFileRef(m.motion) ? m.motion : null,
            state: {
              visible: state.visible !== false,
              physics: state.physics !== false,
              transform: mergeDefaults(DEFAULT_TRANSFORM, state.transform),
              materials: Array.isArray(state.materials)
                ? (state.materials as ModelRuntimeState['materials'])
                : [],
              morphs: isObj(state.morphs) ? (state.morphs as Record<string, number>) : {},
            },
          },
        ];
      })
    : [];
  const audio =
    isObj(json.audio) && isFileRef(json.audio.file)
      ? {
          file: json.audio.file,
          offsetMs: typeof json.audio.offsetMs === 'number' ? json.audio.offsetMs : 0,
          volume: typeof json.audio.volume === 'number' ? json.audio.volume : 1,
        }
      : null;
  return {
    ...base,
    id: typeof json.id === 'string' ? json.id : base.id,
    createdAt: typeof json.createdAt === 'number' ? json.createdAt : base.createdAt,
    updatedAt: typeof json.updatedAt === 'number' ? json.updatedAt : base.updatedAt,
    settings: mergeDefaults(DEFAULT_SETTINGS, json.settings),
    camera: { ...mergeDefaults({ ...DEFAULT_CAMERA, follow: null }, json.camera), follow: null },
    playback: mergeDefaults(base.playback, json.playback),
    audio,
    cameraMotion: isFileRef(json.cameraMotion) ? json.cameraMotion : null,
    hdr: isFileRef(json.hdr) ? json.hdr : null,
    motions: Array.isArray(json.motions) ? json.motions.filter(isFileRef) : undefined,
    models,
    thumbnail: typeof json.thumbnail === 'string' ? json.thumbnail : undefined,
    video2vmd: parseVideo2Vmd(json.video2vmd),
    motionEditor: parseMotionEditor(json.motionEditor),
    labels: parseLabels(json.labels),
    clipTimeline: parseTimeline(json.clipTimeline),
  };
}

/** All blob ids referenced by a project. */
export function projectBlobIds(doc: ProjectDoc): Set<string> {
  const ids = new Set<string>();
  for (const m of doc.models) {
    for (const f of m.files) ids.add(f.blobId);
    if (m.motion) ids.add(m.motion.blobId);
  }
  if (doc.audio) ids.add(doc.audio.file.blobId);
  if (doc.cameraMotion) ids.add(doc.cameraMotion.blobId);
  for (const m of doc.motions ?? []) ids.add(m.blobId);
  if (doc.hdr) ids.add(doc.hdr.blobId);
  if (doc.video2vmd?.video) ids.add(doc.video2vmd.video.blobId);
  if (doc.video2vmd?.pose) ids.add(doc.video2vmd.pose.blobId);
  for (const m of Object.values(doc.motionEditor?.models ?? {})) {
    ids.add(m.base.blobId);
    ids.add(m.original.blobId);
  }
  if (doc.motionEditor?.camera) {
    ids.add(doc.motionEditor.camera.base.blobId);
    ids.add(doc.motionEditor.camera.original.blobId);
  }
  for (const s of doc.clipTimeline?.sources ?? []) if (s.ref) ids.add(s.ref.blobId);
  for (const f of doc.clipTimeline?.fonts ?? []) ids.add(f.ref.blobId);
  return ids;
}

export function summarize(doc: ProjectDoc): ProjectSummary {
  return {
    id: doc.id,
    name: doc.name,
    updatedAt: doc.updatedAt,
    modelCount: doc.models.length,
    thumbnail: doc.thumbnail,
  };
}

/** Pack a project and all its blobs into a single ZIP. */
export async function exportProjectZip(
  doc: ProjectDoc,
  getBlob: (id: string) => Promise<Blob | undefined>,
): Promise<Blob> {
  const files: { path: string; data: Blob | string }[] = [
    { path: 'project.json', data: JSON.stringify(doc, null, 2) },
  ];
  for (const id of projectBlobIds(doc)) {
    const blob = await getBlob(id);
    if (!blob) throw new Error(`Missing asset ${id} — cannot export project`);
    files.push({ path: `blobs/${id}`, data: blob });
  }
  const { zipFiles } = await import('./zip');
  return zipFiles(files);
}

/** Read a project ZIP. The returned doc gets a fresh id so it never overwrites an existing project. */
export async function importProjectZip(blob: Blob): Promise<{ doc: ProjectDoc; blobs: Map<string, Blob> }> {
  const { unzipBuffer } = await import('./zip');
  const entries = await unzipBuffer(await blob.arrayBuffer());
  const json = entries.find((e) => e.path === 'project.json');
  if (!json) throw new Error('project.json not found in archive');
  const doc = parseProjectDoc(JSON.parse(new TextDecoder().decode(json.data)));
  const blobs = new Map<string, Blob>();
  for (const e of entries) if (e.path.startsWith('blobs/')) blobs.set(e.path.slice(6), new Blob([e.data]));
  for (const id of projectBlobIds(doc)) if (!blobs.has(id)) throw new Error(`Archive is missing asset ${id}`);
  return { doc: { ...doc, id: newProjectId(), updatedAt: Date.now() }, blobs };
}

function parseVideo2Vmd(v: unknown): Video2VmdDoc | undefined {
  if (!isObj(v) || !isObj(v.settings)) return undefined;
  const steps = ['import', 'detect', 'clean', 'retarget', 'preview', 'export'];
  return {
    video: isFileRef(v.video) ? v.video : null,
    videoInfo: isObj(v.videoInfo) ? (v.videoInfo as unknown as Video2VmdDoc['videoInfo']) : null,
    pose: isFileRef(v.pose) ? v.pose : null,
    settings: v.settings as unknown as Video2VmdDoc['settings'],
    trim: Array.isArray(v.trim) && v.trim.length === 2 ? (v.trim as [number, number]) : [0, 0],
    crop: isObj(v.crop) ? (v.crop as unknown as Video2VmdDoc['crop']) : null,
    downscale: v.downscale === true,
    targetModelId: typeof v.targetModelId === 'string' ? v.targetModelId : null,
    step: typeof v.step === 'string' && steps.includes(v.step) ? (v.step as Video2VmdDoc['step']) : 'import',
  };
}

/** Keep only well-formed string labels (kind → Japanese name → English label). */
export function parseLabels(v: unknown): Record<string, LabelOverrides> | undefined {
  if (!isObj(v)) return undefined;
  const out: Record<string, LabelOverrides> = {};
  for (const [key, model] of Object.entries(v)) {
    if (!isObj(model)) continue;
    const entry: LabelOverrides = {};
    for (const kind of ['bone', 'morph', 'material'] as const) {
      const m = model[kind];
      if (!isObj(m)) continue;
      const clean = Object.fromEntries(
        Object.entries(m).filter(
          (e): e is [string, string] => typeof e[1] === 'string' && e[1].trim() !== '',
        ),
      );
      if (Object.keys(clean).length) entry[kind] = clean;
    }
    if (Object.keys(entry).length) out[key] = entry;
  }
  return Object.keys(out).length ? out : undefined;
}

function parseMotionEditor(v: unknown): MotionEditorDoc | undefined {
  if (!isObj(v)) return undefined;
  const models: MotionEditorDoc['models'] = {};
  if (isObj(v.models)) {
    for (const [id, m] of Object.entries(v.models)) {
      if (isObj(m) && isFileRef(m.base) && isFileRef(m.original)) {
        models[id] = {
          base: m.base,
          original: m.original,
          pins: Array.isArray(m.pins) ? (m.pins as MotionEditorDoc['models'][string]['pins']) : [],
          name: typeof m.name === 'string' ? m.name : 'motion.vmd',
        };
      }
    }
  }
  const cam = isObj(v.camera) && isFileRef(v.camera.base) && isFileRef(v.camera.original) ? v.camera : null;
  return {
    models,
    camera: cam
      ? {
          base: cam.base as FileRef,
          original: cam.original as FileRef,
          name: typeof cam.name === 'string' ? cam.name : 'camera.vmd',
        }
      : null,
    markers: Array.isArray(v.markers) ? (v.markers as MotionEditorDoc['markers']) : [],
    grid: isObj(v.grid)
      ? (v.grid as unknown as MotionEditorDoc['grid'])
      : { bpm: 0, offset: 0, beatsPerBar: 4 },
    shots: Array.isArray(v.shots) ? (v.shots as MotionEditorDoc['shots']) : [],
  };
}
