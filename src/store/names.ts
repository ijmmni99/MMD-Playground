import { create } from 'zustand';
import type { ModelInfo } from '@/engine/types';
import { modelLabelKey, nameTable, type LabelOverrides, type NameKind, type NameTable } from '@/lib/names';
import { markDirty, studio, useStudio } from './studio';

/** User labels (display only), keyed by `modelLabelKey` so they follow the model, not the project slot. */
export interface NamesState {
  labels: Record<string, LabelOverrides>;
  /** The name being renamed (rename dialog). */
  renaming: { modelId: string; kind: NameKind; ja: string } | null;
  /** Context menu for a name (right-click / long-press). */
  menu: { modelId: string; kind: NameKind; ja: string; x: number; y: number } | null;
}

export const useNames = create<NamesState>(() => ({ labels: {}, renaming: null, menu: null }));

const keys = new WeakMap<ModelInfo, string>();
/** Stable label key for a model (memoised per info object). */
export function labelKeyFor(info: ModelInfo): string {
  let k = keys.get(info);
  if (!k) {
    k = modelLabelKey(
      info.name,
      info.bones.map((b) => b.name),
      info.morphs.map((m) => m.name),
    );
    keys.set(info, k);
  }
  return k;
}

const infoOf = (modelId: string | null | undefined): ModelInfo | null =>
  modelId ? (studio.get().models.find((m) => m.id === modelId)?.info ?? null) : null;

/** Name table for a model (non-React callers, e.g. canvas drawing). */
export function getNameTable(modelId: string | null | undefined): NameTable {
  const info = infoOf(modelId);
  return nameTable(info, info ? useNames.getState().labels[labelKeyFor(info)] : undefined);
}

/** Name table for a model; re-renders when its labels change. */
export function useNameTable(modelId: string | null | undefined): NameTable {
  const info = useStudio((s) => (modelId ? (s.models.find((m) => m.id === modelId)?.info ?? null) : null));
  const overrides = useNames((s) => (info ? s.labels[labelKeyFor(info)] : undefined));
  return nameTable(info, overrides);
}

function putLabels(key: string, next: LabelOverrides | null): void {
  useNames.setState((s) => {
    const labels = { ...s.labels };
    if (next && Object.values(next).some((m) => m && Object.keys(m).length)) labels[key] = next;
    else delete labels[key];
    return { labels };
  });
  markDirty();
}

/** Set (or clear, with an empty label) a user label. */
export function setLabel(modelId: string, kind: NameKind, ja: string, en: string): void {
  const info = infoOf(modelId);
  if (!info) return;
  const key = labelKeyFor(info);
  const cur = useNames.getState().labels[key] ?? {};
  const map = { ...(cur[kind] ?? {}) };
  if (en.trim()) map[ja] = en.trim();
  else delete map[ja];
  putLabels(key, { ...cur, [kind]: map });
}

export const resetLabel = (modelId: string, kind: NameKind, ja: string): void => setLabel(modelId, kind, ja, '');

export function resetAllLabels(modelId: string): void {
  const info = infoOf(modelId);
  if (info) putLabels(labelKeyFor(info), null);
}

export function getLabels(modelId: string): LabelOverrides {
  const info = infoOf(modelId);
  return (info && useNames.getState().labels[labelKeyFor(info)]) || {};
}

/** Merge labels (e.g. an imported JSON file) into a model's labels. */
export function importLabels(modelId: string, labels: LabelOverrides): number {
  const info = infoOf(modelId);
  if (!info) return 0;
  const key = labelKeyFor(info);
  const cur = useNames.getState().labels[key] ?? {};
  const next: LabelOverrides = { ...cur };
  let n = 0;
  for (const kind of ['bone', 'morph', 'material'] as NameKind[]) {
    const add = labels[kind];
    if (!add || typeof add !== 'object') continue;
    const map = { ...(cur[kind] ?? {}) };
    for (const [ja, en] of Object.entries(add)) {
      if (typeof en === 'string' && en.trim()) {
        map[ja] = en.trim();
        n++;
      }
    }
    next[kind] = map;
  }
  putLabels(key, next);
  return n;
}

export const openRename = (modelId: string, kind: NameKind, ja: string): void =>
  useNames.setState({ renaming: { modelId, kind, ja }, menu: null });

export const openNameMenu = (modelId: string, kind: NameKind, ja: string, x: number, y: number): void =>
  useNames.setState({ menu: { modelId, kind, ja, x, y } });
