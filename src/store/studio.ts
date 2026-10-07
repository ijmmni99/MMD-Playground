import { create } from 'zustand';
import { DEFAULT_CAMERA, deviceDefaultSettings } from '@/engine/defaults';
import { isCoarsePointer } from '@/lib/device';
import type {
  AudioInfo,
  CameraMotionInfo,
  CameraState,
  ModelInfo,
  MotionInfo,
  PlaybackState,
  SceneSettings,
  Stats,
  TransformState,
} from '@/engine/types';
import type { GizmoMode } from '@/engine/StudioEngine';
import type { FileRef } from '@/lib/project';

export interface MaterialUIState {
  visible: boolean;
  outline: boolean;
  alpha: number;
}

export interface ModelUI {
  id: string;
  info: ModelInfo;
  name: string;
  visible: boolean;
  physics: boolean;
  transform: TransformState;
  materials: MaterialUIState[];
  morphs: Record<string, number>;
  motion: MotionInfo | null;
  motionRef: FileRef | null;
  mainPath: string;
  files: FileRef[];
}

export type ToastKind = 'info' | 'success' | 'warning' | 'error';
export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

export type DialogId = 'shortcuts' | 'export' | 'projects' | 'about' | 'more' | null;
export type RightTab = 'model' | 'scene' | 'camera' | 'export';
export type AppMode = 'studio' | 'playground';

export interface StudioState {
  engineReady: boolean;
  engineError: string | null;
  physics: { available: boolean; message?: string };

  models: ModelUI[];
  selectedModelId: string | null;
  selectedBone: number | null;
  gizmoMode: GizmoMode;

  settings: SceneSettings;
  camera: CameraState;
  cameraMotion: { info: CameraMotionInfo; ref: FileRef } | null;
  audio: { info: AudioInfo; ref: FileRef } | null;
  audioOffsetMs: number;
  volume: number;
  hdrRef: FileRef | null;

  playback: PlaybackState;
  stats: Stats | null;

  mode: AppMode;
  rightTab: RightTab;
  dialog: DialogId;
  dragActive: boolean;
  toasts: Toast[];
  tasks: Record<string, { label: string; progress: number }>;

  project: {
    id: string;
    name: string;
    createdAt: number;
    dirty: boolean;
    lastSavedAt: number | null;
    restoring: boolean;
  };
}

export const initialPlayback: PlaybackState = {
  playing: false,
  frame: 0,
  duration: 0,
  speed: 1,
  loop: false,
};

export const useStudio = create<StudioState>(() => ({
  engineReady: false,
  engineError: null,
  physics: { available: true },
  models: [],
  selectedModelId: null,
  selectedBone: null,
  gizmoMode: 'rotate',
  settings: deviceDefaultSettings(isCoarsePointer()),
  camera: structuredClone(DEFAULT_CAMERA),
  cameraMotion: null,
  audio: null,
  audioOffsetMs: 0,
  volume: 1,
  hdrRef: null,
  playback: initialPlayback,
  stats: null,
  mode: 'studio',
  rightTab: 'model',
  dialog: null,
  dragActive: false,
  toasts: [],
  tasks: {},
  project: {
    id: '',
    name: 'Untitled project',
    createdAt: Date.now(),
    dirty: false,
    lastSavedAt: null,
    restoring: false,
  },
}));

const set = useStudio.setState;
const get = useStudio.getState;

let toastSeq = 0;
export function toast(kind: ToastKind, message: string, timeout = kind === 'error' ? 8000 : 4500): void {
  const id = ++toastSeq;
  set((s) => ({ toasts: [...s.toasts.slice(-4), { id, kind, message }] }));
  if (timeout > 0) setTimeout(() => dismissToast(id), timeout);
}

export function dismissToast(id: number): void {
  set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

export function setTask(id: string, label: string, progress: number, done: boolean): void {
  set((s) => {
    const tasks = { ...s.tasks };
    if (done) delete tasks[id];
    else tasks[id] = { label, progress };
    return { tasks };
  });
}

export function markDirty(): void {
  if (!get().project.restoring && !get().project.dirty)
    set((s) => ({ project: { ...s.project, dirty: true } }));
}

export function updateModel(id: string, patch: Partial<ModelUI> | ((m: ModelUI) => Partial<ModelUI>)): void {
  set((s) => ({
    models: s.models.map((m) =>
      m.id === id ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) } : m,
    ),
  }));
  markDirty();
}

export function selectedModel(): ModelUI | null {
  const s = get();
  return s.models.find((m) => m.id === s.selectedModelId) ?? null;
}

export const studio = { get, set };
