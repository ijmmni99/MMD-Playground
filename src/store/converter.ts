import { create } from 'zustand';
import type { ConvertedPayload, SourceSummary, WorkerOptions } from '@/lib/convert/protocol';

export type ConverterStep = 'import' | 'check' | 'pose' | 'face' | 'physics' | 'preview' | 'export';

export const STEPS: { id: ConverterStep; label: string }[] = [
  { id: 'import', label: 'Import' },
  { id: 'check', label: 'Check' },
  { id: 'pose', label: 'Pose & scale' },
  { id: 'face', label: 'Face' },
  { id: 'physics', label: 'Physics' },
  { id: 'preview', label: 'Preview' },
  { id: 'export', label: 'Export' },
];

export interface ConverterState {
  step: ConverterStep;
  status: 'idle' | 'parsing' | 'converting' | 'ready' | 'error';
  progress: { stage: string; value: number } | null;
  error: string | null;
  summary: SourceSummary | null;
  options: WorkerOptions;
  result: ConvertedPayload | null;
  /** Converted model shown in the viewport (a studio model, removed unless kept). */
  previewModelId: string | null;
  showOriginal: boolean;
  licenseAck: boolean;
  /** Manual mapping screen open. */
  mappingOpen: boolean;
  /** Model loaded into the studio from this conversion. */
  loadedModelId: string | null;
}

export const initialConverter = (): ConverterState => ({
  step: 'import',
  status: 'idle',
  progress: null,
  error: null,
  summary: null,
  options: {},
  result: null,
  previewModelId: null,
  showOriginal: false,
  licenseAck: false,
  mappingOpen: false,
  loadedModelId: null,
});

export const useConverter = create<ConverterState>(initialConverter);
export const cv = { get: useConverter.getState, set: useConverter.setState };
