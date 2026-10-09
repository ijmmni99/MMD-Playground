// Look library actions: assign / tweak looks, global quick controls, auto-assign, copy, share as JSON, and
// keeping the engine in sync (also after a WebGL context restore). Changes go through the global undo history.

import { downloadBlob, pickFiles } from '@/features/app/filePickers';
import { autoAssign } from '@/lib/npr/assign';
import {
  cleanModelLooks,
  cleanSettings,
  EMPTY_MODEL_LOOKS,
  looksFromJson,
  looksToJson,
  PRESETS,
  type LookId,
  type LookParams,
  type MaterialLook,
  type ModelLooks,
  type NprSettings,
  type ParamKey,
} from '@/lib/npr/looks';
import { engineOrNull, whenEngine } from '@/store/engineRef';
import { useHistory } from '@/store/history';
import { looksStore, type LooksDoc } from '@/store/looks';
import { markDirty, studio, toast } from '@/store/studio';

const { get, set } = looksStore;

export const modelLooks = (modelId: string): ModelLooks => get().models[modelId] ?? EMPTY_MODEL_LOOKS;

function push(modelId: string): void {
  const looks = get().models[modelId];
  engineOrNull()?.setModelLooks(modelId, looks ?? null);
}

/** Replace a model's looks (one undo step unless `record` is false; `key` coalesces drags). */
export function setModelLooks(
  modelId: string,
  next: ModelLooks,
  label = 'Change look',
  key?: string,
  record = true,
): void {
  const prev = get().models[modelId];
  set((s) => ({ models: { ...s.models, [modelId]: next } }));
  push(modelId);
  markDirty();
  if (record)
    useHistory.getState().push({
      label,
      key,
      undo: () => setModelLooks(modelId, prev ?? EMPTY_MODEL_LOOKS, label, undefined, false),
      redo: () => setModelLooks(modelId, next, label, undefined, false),
    });
}

export function setMaterialLook(modelId: string, material: string, look: LookId): void {
  const cur = modelLooks(modelId);
  const materials = { ...cur.materials };
  if (look === 'default') delete materials[material];
  else materials[material] = { look };
  setModelLooks(modelId, { ...cur, materials }, `Look: ${material}`);
}

/** Override one parameter (drag = live, coalesced into one undo step). */
export function setLookParam<K extends ParamKey>(
  modelId: string,
  material: string,
  key: K,
  value: LookParams[K],
  drag = false,
): void {
  const cur = modelLooks(modelId);
  const m = cur.materials[material];
  if (!m || m.look === 'default') return;
  const params = { ...(m.params ?? {}), [key]: value };
  setModelLooks(
    modelId,
    { ...cur, materials: { ...cur.materials, [material]: { ...m, params } } },
    `${material}: ${key}`,
    drag ? `look:${modelId}:${material}:${key}` : undefined,
  );
}

export function resetLookParam(modelId: string, material: string, key: ParamKey): void {
  const cur = modelLooks(modelId);
  const m = cur.materials[material];
  if (!m?.params || !(key in m.params)) return;
  const params = { ...m.params };
  delete params[key];
  const next: MaterialLook = Object.keys(params).length ? { ...m, params } : { look: m.look };
  setModelLooks(modelId, { ...cur, materials: { ...cur.materials, [material]: next } }, `Reset ${key}`);
}

/** The value shown for a parameter (override or preset). */
export function paramValue<K extends ParamKey>(m: MaterialLook, key: K): LookParams[K] {
  const o = m.params?.[key];
  return (o !== undefined ? o : PRESETS[m.look as Exclude<LookId, 'default'>][key]) as LookParams[K];
}

export function autoAssignLooks(modelId: string, replace = false): number {
  const model = studio.get().models.find((m) => m.id === modelId);
  if (!model) return 0;
  const next = autoAssign(
    model.info.materials.map((m) => ({ name: m.name, nameEn: m.en })),
    get().models[modelId],
    replace,
  );
  setModelLooks(modelId, next, 'Auto-assign looks');
  const n = Object.keys(next.materials).length;
  toast('success', `Looks assigned to ${n} of ${model.info.materials.length} materials`);
  return n;
}

export function copyLook(modelId: string, from: string, to: string[]): void {
  const cur = modelLooks(modelId);
  const src = cur.materials[from];
  const materials = { ...cur.materials };
  for (const t of to) {
    if (src) materials[t] = structuredClone(src);
    else delete materials[t];
  }
  setModelLooks(modelId, { ...cur, materials }, `Copy look to ${to.length} material(s)`);
}

export function setSeeThroughEyes(modelId: string, on: boolean): void {
  setModelLooks(modelId, { ...modelLooks(modelId), seeThroughEyes: on }, 'See-through hair over eyes');
}

export function clearLooks(modelId: string): void {
  setModelLooks(modelId, { ...modelLooks(modelId), materials: {} }, 'Clear looks');
}

/** Global options (tier, before / after, quick controls, outline). */
export function setNprSettings(patch: Partial<NprSettings>, drag = false): void {
  const prev = get().settings;
  const next = { ...prev, ...patch };
  const apply = (s: NprSettings): void => {
    set({ settings: s });
    engineOrNull()?.setNprSettings(s);
    markDirty();
  };
  apply(next);
  if (Object.keys(patch).every((k) => k === 'showOriginal')) return; // before / after is a view toggle
  useHistory.getState().push({
    label: 'Look settings',
    key: drag ? `looks:${Object.keys(patch).join()}` : undefined,
    undo: () => apply(prev),
    redo: () => apply(next),
  });
}

export function exportLooks(modelId: string): void {
  const name = studio.get().models.find((m) => m.id === modelId)?.name ?? 'model';
  downloadBlob(
    new Blob([looksToJson(modelLooks(modelId), name)], { type: 'application/json' }),
    `${name.replace(/[^\p{L}\p{N}_-]+/gu, '_')}_looks.json`,
  );
}

export async function importLooks(modelId: string): Promise<void> {
  const [f] = await pickFiles('.json,application/json');
  if (!f) return;
  try {
    const looks = looksFromJson(await f.blob.text());
    const names = new Set(
      studio
        .get()
        .models.find((m) => m.id === modelId)
        ?.info.materials.map((m) => m.name) ?? [],
    );
    const hits = Object.keys(looks.materials).filter((n) => names.has(n)).length;
    setModelLooks(modelId, looks, 'Import looks');
    toast(
      hits ? 'success' : 'warning',
      `Imported looks: ${hits} of ${Object.keys(looks.materials).length} materials match this model`,
    );
  } catch (e) {
    toast('error', `Couldn't import looks: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ---------------------------------------------------------------- persistence / engine sync

export function buildLooksDoc(): LooksDoc | undefined {
  const ids = new Set(studio.get().models.map((m) => m.id));
  const models = Object.fromEntries(
    Object.entries(get().models).filter(([id, l]) => ids.has(id) && Object.keys(l.materials).length),
  );
  const s = get().settings;
  const changed = JSON.stringify(s) !== JSON.stringify(cleanSettings({}));
  if (!Object.keys(models).length && !changed) return undefined;
  return { models, settings: s };
}

export async function restoreLooks(doc: unknown): Promise<void> {
  const d = (typeof doc === 'object' && doc !== null ? doc : {}) as Partial<LooksDoc>;
  const models: Record<string, ModelLooks> = {};
  for (const [id, l] of Object.entries(d.models ?? {})) {
    const c = cleanModelLooks(l);
    if (c) models[id] = c;
  }
  set({ models, settings: { ...cleanSettings(d.settings), showOriginal: false }, open: null });
  await syncEngine();
}

/** Push every model's looks and the settings to the engine. */
export async function syncEngine(): Promise<void> {
  const engine = await whenEngine();
  engine.setNprSettings(get().settings);
  for (const m of studio.get().models) engine.setModelLooks(m.id, get().models[m.id] ?? null);
}

// A model that is loaded later (or re-added) picks up its looks; a context restore re-applies everything.
let wired = false;
export function wireLooks(): void {
  if (wired) return;
  wired = true;
  void whenEngine().then((engine) => {
    engine.setNprSettings(get().settings);
    engine.events.on('modelAdded', (info) => {
      const looks = get().models[info.id];
      if (looks) engine.setModelLooks(info.id, looks);
    });
    engine.events.on('contextRestored', () => void syncEngine());
  });
}

// Test / debugging hook.
(window as unknown as { __looks?: unknown }).__looks = { setModelLooks, setNprSettings, state: () => get() };
