import { create } from 'zustand';
import type { PmxModel } from '@/lib/convert/pmx/types';
import type { ValidationIssue } from '@/lib/model-edit/check';
import { emptyHistory, type EditHistory } from '@/lib/model-edit/history';
import type { ApplyResult, Op } from '@/lib/model-edit/ops';
import type { PartId, ProportionState } from '@/lib/model-edit/proportions';
import type { FileRef } from '@/lib/project';

export type EditorPanel = 'proportions' | 'outfit' | 'materials' | 'bones' | 'morphs' | 'physics' | 'info';

export const PANELS: { id: EditorPanel; label: string }[] = [
  { id: 'proportions', label: 'Proportions' },
  { id: 'outfit', label: 'Outfit' },
  { id: 'materials', label: 'Materials' },
  { id: 'bones', label: 'Bones' },
  { id: 'morphs', label: 'Morphs' },
  { id: 'physics', label: 'Physics' },
  { id: 'info', label: 'Info & save' },
];

/** A clothes donor model (another PMX with the same skeleton). */
export interface DonorRef {
  id: string;
  label: string;
  mainPath: string;
  files: FileRef[];
}

/** Outfit preset: visibility, colours and texture choices. */
export interface OutfitPreset {
  name: string;
  ops: Op[];
}

/** One model's edit session (persisted with the project). */
export interface EditSession {
  modelId: string;
  /** The model's original files (the edits are applied on top). */
  mainPath: string;
  files: FileRef[];
  history: EditHistory;
  /** Added images (recolours, uploads, downscales) by asset id (= blob id). */
  assets: Record<string, FileRef>;
  donors: Record<string, DonorRef>;
  outfitPresets: OutfitPreset[];
}

/** Persisted form (history is not kept, only the op list). */
export interface ModelEditorDoc {
  sessions: {
    modelId: string;
    mainPath: string;
    files: FileRef[];
    ops: Op[];
    assets: FileRef[];
    donors: DonorRef[];
    outfitPresets?: OutfitPreset[];
  }[];
  proportionPresets?: { name: string; state: ProportionState }[];
}

export interface ModelEditorState {
  sessions: Record<string, EditSession>;
  /** Model being edited. */
  modelId: string | null;
  panel: EditorPanel;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  /** Parsed original of the active model (not persisted). */
  original: PmxModel | null;
  /** Last applied result. */
  result: ApplyResult | null;
  issues: ValidationIssue[];
  /** A/B: show the original model instead of the edited one. */
  showOriginal: boolean;
  /** A rebuild is queued or running. */
  building: boolean;
  /** Ops count when the scene model was last rebuilt (for the "saved" indicator). */
  builtVersion: number;
  version: number;
  /** UI selection. */
  part: PartId;
  linkLR: boolean;
  material: number | null;
  bone: string | null;
  morph: string | null;
  body: number | null;
  /** Morph slider values used to build a group morph. */
  morphMix: Record<string, number>;
  physicsOverlay: boolean;
  proportionPresets: { name: string; state: ProportionState }[];
}

export const initialModelEditor = (): ModelEditorState => ({
  sessions: {},
  modelId: null,
  panel: 'proportions',
  status: 'idle',
  error: null,
  original: null,
  result: null,
  issues: [],
  showOriginal: false,
  building: false,
  builtVersion: 0,
  version: 0,
  part: 'head',
  linkLR: true,
  material: null,
  bone: null,
  morph: null,
  body: null,
  morphMix: {},
  physicsOverlay: false,
  proportionPresets: [],
});

export const useModelEditor = create<ModelEditorState>(initialModelEditor);
export const me = { get: useModelEditor.getState, set: useModelEditor.setState };

export const newSession = (
  modelId: string,
  mainPath: string,
  files: FileRef[],
  ops: Op[] = [],
): EditSession => ({
  modelId,
  mainPath,
  files,
  history: emptyHistory(ops),
  assets: {},
  donors: {},
  outfitPresets: [],
});

const NO_OPS: Op[] = [];
/** Current op list of the active session (stable empty list when none). */
export const useOps = (): Op[] =>
  useModelEditor((s) => (s.modelId ? (s.sessions[s.modelId]?.history.ops ?? NO_OPS) : NO_OPS));
