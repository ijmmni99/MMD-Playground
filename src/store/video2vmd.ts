import { create } from 'zustand';
import type { ConversionResult } from '@/engine/video2vmd/convert';
import {
  DEFAULT_SETTINGS,
  type ConversionSettings,
  type CropBox,
  type PoseFrame,
  type PoseSequence,
  type VideoInfo,
} from '@/engine/video2vmd/types';
import type { FileRef } from '@/lib/project';

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
}

export interface Video2VmdState {
  step: V2VStep;
  video: { blob: Blob; url: string; info: VideoInfo; ref: FileRef | null } | null;
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
}

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
}
