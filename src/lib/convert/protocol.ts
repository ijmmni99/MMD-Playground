// Messages between the UI and the converter worker.

import type { ConversionReport, ConvertOptions } from './pipeline';
import type { HumanMap } from './humanoid';
import type { MorphPlanEntry } from './morphs';
import type { PhysicsChain } from './physics';
import type { HumanSlot, SourceLicense, SourceModel } from './types';

export interface InputFile {
  path: string;
  data: Blob;
}

export interface SourceSummary {
  name: string;
  format: SourceModel['format'];
  file: string;
  bones: { name: string; parent: number }[];
  vertices: number;
  triangles: number;
  materials: number;
  textures: { name: string; bytes: number }[];
  license?: SourceLicense;
  warnings: string[];
  /** Total input size in bytes. */
  bytes: number;
}

export interface ConvertedPayload {
  report: ConversionReport;
  map: HumanMap;
  weak: HumanSlot[];
  humanoid: boolean;
  morphEntries: MorphPlanEntry[];
  /** Source morph key → original name. */
  morphNames: Record<string, string>;
  chains: Omit<PhysicsChain, 'vrm'>[];
  boneNames: string[];
  pmx: ArrayBuffer;
  textures: { path: string; mime: string; data: ArrayBuffer }[];
  errors: string[];
}

export interface WorkerOptions extends Partial<ConvertOptions> {
  /** Longest texture edge (px); 0 keeps the originals. */
  maxTexture?: number;
}

export type ToWorker =
  | { type: 'parse'; files: InputFile[] }
  | { type: 'convert'; id: number; options: WorkerOptions }
  | { type: 'original'; id: number };

export type FromWorker =
  | { type: 'progress'; stage: string; progress: number }
  | { type: 'parsed'; summary: SourceSummary }
  | { type: 'converted'; id: number; payload: ConvertedPayload }
  | { type: 'original'; id: number; mesh: { positions: Float32Array; indices: Uint32Array; colors: Float32Array } }
  | { type: 'error'; message: string; id?: number };
