import { create } from 'zustand';
import type { ConversionResult, PartId } from '@/engine/video2vmd/convert';
import {
  DEFAULT_SETTINGS,
  type ConversionSettings,
  type CropBox,
  type PoseFrame,
  type PoseSequence,
  type QualityReport,
  type VideoInfo,
} from '@/engine/video2vmd/types';
import type { FileRef } from '@/lib/project';
import type { Vowel } from '@/lib/video2vmd/face';
import type { FusionStats } from '@/lib/video2vmd/fuse';
import type { SyncResult } from '@/lib/video2vmd/sync';
import type { Calibration, TwoViewSettings, ViewSync } from '@/lib/video2vmd/types';

export type V2VStep = 'import' | 'detect' | 'clean' | 'retarget' | 'preview' | 'export';
export const V2V_STEPS: { id: V2VStep; label: string }[] = [
  { id: 'import', label: 'Import' },
  { id: 'detect', label: 'Detect' },
  { id: 'clean', label: 'Clean' },
  { id: 'retarget', label: 'Retarget' },
  { id: 'preview', label: 'Preview' },
  { id: 'export', label: 'Export' },
];

export interface DetectState {
  status: 'idle' | 'loading' | 'running' | 'done' | 'cancelled' | 'error';
  message: string;
  backend: string;
  done: number;
  total: number;
  eta: number;
  rate: number;
  mode: string;
  error: string | null;
  /** Which view is being analysed (two-view runs them one after the other). */
  view?: ViewId;
}

export interface ViewSlot {
  blob: Blob;
  url: string;
  info: VideoInfo;
  ref: FileRef | null;
}

export type ViewId = 'front' | 'side';

export interface Video2VmdState {
  step: V2VStep;
  video: ViewSlot | null;
  trim: [number, number];
  crop: CropBox | null;
  /** Analyse at 720p (long edge) instead of up to 1280. */
  downscale: boolean;
  detect: DetectState;
  /** Latest frame during detection (live overlay). */
  live: { frame: PoseFrame | null; thumbnail: ImageBitmap | null };
  pose: PoseSequence | null;
  poseRef: FileRef | null;
  settings: ConversionSettings;
  /** Model whose skeleton is used for retargeting (null = standard skeleton). */
  targetModelId: string | null;
  result: (ConversionResult & { skeletonName: string; vmdBlob: Blob }) | null;
  converting: boolean;
  convertError: string | null;
  /** Model the generated motion was applied to. */
  appliedTo: string | null;

  // ---- two-view
  side: ViewSlot | null;
  sideTrim: [number, number];
  sideCrop: CropBox | null;
  sidePose: PoseSequence | null;
  sidePoseRef: FileRef | null;
  twoView: TwoViewSettings;
  /** Auto sync results (audio and motion); the effective offset is `sync`. */
  autoSync: { audio: SyncResult | null; motion: SyncResult | null } | null;
  sync: ViewSync | null;
  calibration: Calibration | null;
  fusion: { sequence: PoseSequence; stats: FusionStats } | null;
  /** Which result the preview / export uses when two-view is on. */
  ab: 'two' | 'single';
  /** Reports of both results for the A/B comparison (two-view only). */
  abReports: { two: QualityReport; single: QualityReport } | null;
  /** Latest frame of the side view during detection. */
  liveSide: { frame: PoseFrame | null; thumbnail: ImageBitmap | null };
  /** Audio lip-sync vowels sampled at `fps` in video time. */
  lipSync: { fps: number; vowels: Record<Vowel, number[]> } | null;
  /** Export: which parts go into the .vmd. */
  exportParts: Record<PartId, boolean>;
  /** Source-preview overlays. */
  overlays: { body: boolean; face: boolean; hands: boolean; crops: boolean };
}

export const DEFAULT_TWO_VIEW: TwoViewSettings = {
  angleDeg: 90,
  manualOffset: null,
  fovDeg: 60,
  triangulate: true,
};

export const ALL_PARTS: Record<PartId, boolean> = { body: true, fingers: true, face: true, eyes: true };

export const initialDetect: DetectState = {
  status: 'idle',
  message: '',
  backend: '',
  done: 0,
  total: 0,
  eta: 0,
  rate: 0,
  mode: '',
  error: null,
};

export const useV2V = create<Video2VmdState>(() => ({
  step: 'import',
  video: null,
  trim: [0, 0],
  crop: null,
  downscale: false,
  detect: initialDetect,
  live: { frame: null, thumbnail: null },
  pose: null,
  poseRef: null,
  settings: { ...DEFAULT_SETTINGS },
  targetModelId: null,
  result: null,
  converting: false,
  convertError: null,
  appliedTo: null,
  side: null,
  sideTrim: [0, 0],
  sideCrop: null,
  sidePose: null,
  sidePoseRef: null,
  twoView: { ...DEFAULT_TWO_VIEW },
  autoSync: null,
  sync: null,
  calibration: null,
  fusion: null,
  ab: 'two',
  abReports: null,
  liveSide: { frame: null, thumbnail: null },
  lipSync: null,
  exportParts: { ...ALL_PARTS },
  overlays: { body: true, face: true, hands: true, crops: false },
}));

export const v2v = { get: useV2V.getState, set: useV2V.setState };

/** Saved with the project (blobs are content-addressed assets). */
export interface Video2VmdDoc {
  video: FileRef | null;
  videoInfo: VideoInfo | null;
  pose: FileRef | null;
  settings: ConversionSettings;
  trim: [number, number];
  crop: CropBox | null;
  downscale: boolean;
  targetModelId: string | null;
  step: V2VStep;
  // v2 (optional for older projects)
  side?: FileRef | null;
  sideInfo?: VideoInfo | null;
  sidePose?: FileRef | null;
  sideTrim?: [number, number];
  sideCrop?: CropBox | null;
  twoView?: TwoViewSettings;
  sync?: ViewSync | null;
  exportParts?: Record<PartId, boolean>;
}
