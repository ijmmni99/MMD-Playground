// Model Editor orchestration: edit sessions per model, the op list with undo / redo (mirrored into the global
// history), debounced rebuilds that swap the scene model in place, live previews during drags, textures,
// clothes donors, and output (Apply to scene, PMX ZIP, edit list JSON).

import type { VFile } from '@/engine/types';
import { downloadBlob, pickFiles } from '@/features/app/filePickers';
import { testDance } from '@/lib/convert/testDance';
import type { PmxModel } from '@/lib/convert/pmx/types';
import { writePmx } from '@/lib/convert/pmx/writer';
import { registerFile, registerFiles, resolveRefs } from '@/lib/assets';
import { expandZips } from '@/lib/ingest';
import { checkModel, hasErrors } from '@/lib/model-edit/check';
import {
  commit as commitHistory,
  endCoalesce,
  redo as redoHistory,
  replaceAll,
  undo as undoHistory,
} from '@/lib/model-edit/history';
import { checkMerge, type DonorModel } from '@/lib/model-edit/merge';
import {
  applyOps,
  describeOp,
  materialVertices,
  type ApplyResult,
  type MaterialPatch,
  type Op,
} from '@/lib/model-edit/ops';
import { EMPTY_OUTFIT, guessGroup, materialGroups, type OutfitState } from '@/lib/model-edit/outfit';
import { fromPmxObject, readPmx } from '@/lib/model-edit/pmxRead';
import {
  IDENTITY,
  mirrorPart,
  type PartId,
  type PartScale,
  type ProportionState,
} from '@/lib/model-edit/proportions';
import { compositeImage, recolorImage, type Overlay, type Recolor } from '@/lib/model-edit/texture';
import { basename, dirname, extname, joinPath, PathResolver, stripExt } from '@/lib/paths';
import type { FileRef } from '@/lib/project';
import { downscaleImage } from '@/lib/textureScale';
import { zipFiles } from '@/lib/zip';
import { engineOrNull, whenEngine } from '@/store/engineRef';
import { useHistory } from '@/store/history';
import { me, newSession, type DonorRef, type EditSession } from '@/store/modelEditor';
import { markDirty, studio, toast, updateModel, useStudio } from '@/store/studio';

// ---------------------------------------------------------------- caches (not persisted)

const originals = new Map<string, PmxModel>();
const donorModels = new Map<string, PmxModel>();
const fileCache = new Map<string, VFile[]>();

async function filesOf(refs: FileRef[]): Promise<VFile[]> {
  const key = refs.map((r) => r.blobId).join(',');
  let f = fileCache.get(key);
  if (!f) {
    f = await resolveRefs(refs);
    fileCache.set(key, f);
  }
  return f;
}

/** Parse a PMX or PMD into a PmxModel. */
export async function parseModelFile(file: VFile): Promise<PmxModel> {
  const buf = await file.blob.arrayBuffer();
  if (extname(file.path) === 'pmd') {
    const { PmdReader } = await import('babylon-mmd/esm/Loader/Parser/pmdReader');
    return fromPmxObject(await PmdReader.ParseAsync(buf));
  }
  return readPmx(buf);
}

async function originalOf(s: EditSession): Promise<PmxModel> {
  let o = originals.get(s.modelId);
  if (!o) {
    const files = await filesOf(s.files);
    const main = files.find((f) => f.path === s.mainPath);
    if (!main) throw new Error('The model file is missing from storage');
    o = await parseModelFile(main);
    originals.set(s.modelId, o);
  }
  return o;
}

async function donorsOf(s: EditSession): Promise<Record<string, DonorModel>> {
  const out: Record<string, DonorModel> = {};
  for (const d of Object.values(s.donors)) {
    let pmx = donorModels.get(d.id);
    if (!pmx) {
      const files = await filesOf(d.files);
      const main = files.find((f) => f.path === d.mainPath);
      if (!main) continue;
      pmx = await parseModelFile(main);
      donorModels.set(d.id, pmx);
    }
    out[d.id] = { pmx, label: d.label };
  }
  return out;
}

// ---------------------------------------------------------------- session access

const active = (): EditSession | null => {
  const { modelId, sessions } = me.get();
  return modelId ? (sessions[modelId] ?? null) : null;
};

export const currentOps = (): Op[] => active()?.history.ops ?? [];

function putSession(s: EditSession): void {
  me.set((st) => ({ sessions: { ...st.sessions, [s.modelId]: s } }));
}

/** Start (or resume) editing a model. */
export async function openEditor(modelId?: string | null): Promise<void> {
  const st = studio.get();
  const id = modelId ?? st.selectedModelId ?? st.models.find((m) => !m.stage)?.id ?? null;
  const model = st.models.find((m) => m.id === id);
  if (!model) {
    me.set({ modelId: null, status: 'idle', original: null, result: null });
    return;
  }
  if (!/\.(pmx|pmd)$/i.test(model.mainPath)) {
    me.set({ modelId: model.id, status: 'error', error: 'Only PMX / PMD models can be edited.' });
    return;
  }
  me.set({ modelId: model.id, status: 'loading', error: null });
  try {
    let s = me.get().sessions[model.id];
    if (!s) {
      s = newSession(model.id, model.mainPath, model.files);
      putSession(s);
    }
    const original = await originalOf(s);
    if (me.get().modelId !== model.id) return;
    me.set({ original, status: 'ready' });
    await rebuild(model.id, { force: true });
  } catch (e) {
    me.set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
  }
}

/** Stop editing (the edited model stays in the scene, edits stay in the session). */
export function closeEditor(): void {
  setPhysicsOverlay(false);
  me.set({ modelId: null, status: 'idle', original: null, result: null, issues: [] });
}

// ---------------------------------------------------------------- ops / history

function setHistory(s: EditSession, history: EditSession['history']): void {
  putSession({ ...s, history });
  me.set((st) => ({ version: st.version + 1 }));
  markDirty();
}

/**
 * Add an op. A `coalesce` key (slider drags) replaces the previous op while it repeats; `live` skips the
 * immediate rebuild (the caller previewed it) and only schedules one.
 */
export function commitOp(op: Op, opts: { coalesce?: string; label?: string } = {}): void {
  const s = active();
  if (!s) return;
  const before = s.history;
  const next = commitHistory(before, op, opts.coalesce);
  setHistory(s, next);
  if (next.past !== before.past) {
    const modelId = s.modelId;
    useHistory.getState().push({
      label: opts.label ?? describeOp(op),
      undo: () => stepHistory(modelId, 'undo'),
      redo: () => stepHistory(modelId, 'redo'),
    });
  }
  scheduleRebuild();
}

/** Replace the whole list as one undoable step (revert, import, presets). */
export function setOps(ops: Op[], label: string): void {
  const s = active();
  if (!s) return;
  setHistory(s, replaceAll(s.history, ops));
  const modelId = s.modelId;
  useHistory.getState().push({
    label,
    undo: () => stepHistory(modelId, 'undo'),
    redo: () => stepHistory(modelId, 'redo'),
  });
  scheduleRebuild();
}

function stepHistory(modelId: string, dir: 'undo' | 'redo'): void {
  const s = me.get().sessions[modelId];
  if (!s) return;
  setHistory(s, dir === 'undo' ? undoHistory(s.history) : redoHistory(s.history));
  if (me.get().modelId === modelId) scheduleRebuild();
  else void rebuild(modelId);
}

/** Pointer up after a drag: the next change is a new undo step; rebuild now. */
export function endDrag(): void {
  const s = active();
  if (!s) return;
  putSession({ ...s, history: endCoalesce(s.history) });
  scheduleRebuild(50);
}

export const editorUndo = (): void => void useHistory.getState().undo();
export const editorRedo = (): void => void useHistory.getState().redo();

export function revertAll(): void {
  if (!currentOps().length) return;
  setOps([], 'Revert to original');
  toast('info', 'All edits reverted (Undo brings them back).');
}

// ---------------------------------------------------------------- rebuild

let timer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<void> | null = null;
let again = false;

export function scheduleRebuild(delay = 400): void {
  me.set({ building: true });
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const id = me.get().modelId;
    if (id) void rebuild(id);
  }, delay);
}

/** Files for an edited model: the original files with model.pmx replaced and new textures added. */
async function editedFiles(s: EditSession, res: ApplyResult): Promise<VFile[]> {
  const base = await filesOf(s.files);
  const dir = dirname(s.mainPath);
  const pmx = new Blob([writePmx(res.pmx)]);
  const out: VFile[] = base.map((f) => (f.path === s.mainPath ? { path: f.path, blob: pmx } : f));
  for (const [path, assetId] of Object.entries(res.assets)) {
    const ref = s.assets[assetId];
    if (!ref) continue;
    const [f] = await filesOf([ref]);
    out.push({ path: joinPath(dir, path), blob: f.blob });
  }
  for (const [path, src] of Object.entries(res.donorFiles)) {
    const d = s.donors[src.donor];
    if (!d) continue;
    const files = await filesOf(d.files);
    const hit = new PathResolver(files).resolve(src.path, dirname(d.mainPath)).file;
    if (hit) out.push({ path: joinPath(dir, path), blob: hit.blob });
  }
  return out;
}

export async function computeResult(s: EditSession): Promise<ApplyResult> {
  const original = await originalOf(s);
  return applyOps(original, s.history.ops, { donors: await donorsOf(s) });
}

/** Rebuild a model from its session and swap it into the scene (same id, state kept). */
export async function rebuild(modelId: string, opts: { force?: boolean } = {}): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  const run = async (): Promise<void> => {
    const s = me.get().sessions[modelId];
    const engine = await whenEngine();
    if (!s || !studio.get().models.some((m) => m.id === modelId)) return;
    const version = me.get().version;
    const res = await computeResult(s);
    const files =
      me.get().showOriginal && me.get().modelId === modelId
        ? await filesOf(s.files)
        : await editedFiles(s, res);
    const names = new Set(
      files.map((f) =>
        f.path.slice(dirname(s.mainPath).length + (dirname(s.mainPath) ? 1 : 0)).toLowerCase(),
      ),
    );
    const issues = checkModel(res.pmx, new Set([...names]));
    // Texture paths are matched loosely by the loader: only flag files that are really absent.
    const resolver = new PathResolver(files);
    const filtered = issues.filter((i) => {
      const m = /^Texture file missing: (.+)$/.exec(i.message);
      return !m || !resolver.resolve(m[1], dirname(s.mainPath)).file;
    });
    if (me.get().modelId === modelId) me.set({ result: res, issues: filtered });
    if (!opts.force && hasErrors(filtered)) {
      if (me.get().modelId === modelId) me.set({ building: false });
      return;
    }
    const info = await engine.replaceModel(modelId, files, s.mainPath, { singleMesh: true });
    const state = engine.getModelState(modelId);
    // Derived from the session: no project change of its own.
    studio.set((st) => ({
      models: st.models.map((m) =>
        m.id === modelId ? { ...m, info, materials: state?.materials ?? m.materials } : m,
      ),
    }));
    if (me.get().modelId === modelId) me.set({ builtVersion: version, building: !!timer });
    refreshOverlay();
  };
  running = run()
    .catch((e) => {
      toast('error', `Model rebuild failed: ${e instanceof Error ? e.message : String(e)}`);
      me.set({ building: false });
    })
    .finally(() => {
      running = null;
      if (again) {
        again = false;
        void rebuild(modelId);
      }
    });
  return running;
}

/** A/B: show the original model, or the edited one. */
export function setShowOriginal(on: boolean): void {
  me.set({ showOriginal: on });
  const id = me.get().modelId;
  if (id) void rebuild(id, { force: true });
}

// ---------------------------------------------------------------- live previews

let liveFrame = 0;
let livePending: Op | null = null;

/** Rewrite vertex positions in place from a would-be op list (proportions drags). */
function livePreview(op: Op): void {
  livePending = op;
  if (liveFrame) return;
  liveFrame = requestAnimationFrame(() => {
    liveFrame = 0;
    const s = active();
    const original = me.get().original;
    const engine = engineOrNull();
    if (!s || !original || !engine || !livePending) return;
    const ops = s.history.ops;
    const res = applyOps(original, ops, {});
    livePending = null;
    if (res.pmx.vertices.length !== me.get().result?.pmx.vertices.length) return;
    const n = res.pmx.vertices.length;
    const pos = new Float32Array(n * 3);
    const nrm = new Float32Array(n * 3);
    res.pmx.vertices.forEach((v, i) => {
      pos.set(v.position, i * 3);
      nrm.set(v.normal, i * 3);
    });
    // PMX is left-handed like the scene; babylon-mmd keeps PMX vertex order for single-mesh loads.
    engine.setModelVertices(s.modelId, pos, nrm);
  });
}

// ---------------------------------------------------------------- proportions

const NO_PROPS: ProportionState = { parts: {} };
export function proportionState(ops: readonly Op[] = currentOps()): ProportionState {
  for (let i = ops.length - 1; i >= 0; i--) {
    const o = ops[i];
    if (o.type === 'proportions') return o.state;
  }
  return NO_PROPS;
}

/** Change one part's scale (drag = live preview; `linkLR` mirrors to the other side). */
export function setPartScale(part: PartId, patch: Partial<PartScale>, drag = false): void {
  const st = proportionState();
  const parts = { ...st.parts };
  const cur = parts[part] ?? IDENTITY;
  parts[part] = { ...cur, ...patch };
  const mirror = me.get().linkLR ? mirrorPart(part) : null;
  if (mirror) parts[mirror] = { ...(parts[mirror] ?? IDENTITY), ...patch };
  const op: Op = { type: 'proportions', state: { ...st, parts } };
  commitOp(op, {
    coalesce: drag ? `prop:${part}:${Object.keys(patch).join()}` : undefined,
    label: 'Proportions',
  });
  if (drag) livePreview(op);
}

export function resetPart(part: PartId): void {
  const st = proportionState();
  const parts = { ...st.parts };
  delete parts[part];
  const mirror = me.get().linkLR ? mirrorPart(part) : null;
  if (mirror) delete parts[mirror];
  commitOp({ type: 'proportions', state: { ...st, parts } }, { label: 'Reset part' });
}

export function applyProportionPreset(state: ProportionState, name: string): void {
  commitOp({ type: 'proportions', state: structuredClone(state) }, { label: `Preset: ${name}` });
}

export function saveProportionPreset(name: string): void {
  const state = structuredClone(proportionState());
  me.set((s) => ({
    proportionPresets: [...s.proportionPresets.filter((p) => p.name !== name), { name, state }],
  }));
  markDirty();
}

export function exportProportionPreset(): void {
  const blob = new Blob(
    [JSON.stringify({ type: 'mmd-studio-proportions', version: 1, state: proportionState() }, null, 2)],
    {
      type: 'application/json',
    },
  );
  downloadBlob(blob, 'proportions.json');
}

export async function importProportionPreset(): Promise<void> {
  const [f] = await pickFiles('.json,application/json');
  if (!f) return;
  try {
    const json = JSON.parse(await f.blob.text()) as { state?: ProportionState };
    if (!json.state || typeof json.state.parts !== 'object') throw new Error('not a proportions preset');
    applyProportionPreset(json.state, stripExt(basename(f.path)));
  } catch (e) {
    toast('error', `Couldn't read the preset: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Play the converter's test dance on the edited model (quick proportion / IK check). */
export function playTestPose(): void {
  const id = me.get().modelId;
  const engine = engineOrNull();
  if (!id || !engine) return;
  const info = engine.setMotionClip(id, testDance(), 'Test dance');
  updateModel(id, { motion: info, motionRef: null });
  engine.seek(0);
  void engine.play();
}

// ---------------------------------------------------------------- materials

/** Change material fields (drag = live colour preview). */
export function patchMaterial(index: number, patch: MaterialPatch, drag = false): void {
  const key = `mat:${index}:${Object.keys(patch).sort().join()}`;
  commitOp({ type: 'material', index, patch }, { coalesce: drag ? key : undefined });
  const id = me.get().modelId;
  if (id && drag) engineOrNull()?.setMaterialLive(id, index, patch);
}

export function outfitState(ops: readonly Op[] = currentOps()): OutfitState {
  for (let i = ops.length - 1; i >= 0; i--) {
    const o = ops[i];
    if (o.type === 'outfit') return o.state;
  }
  return EMPTY_OUTFIT;
}

export function setOutfit(patch: Partial<OutfitState>, label = 'Outfit'): void {
  commitOp({ type: 'outfit', state: { ...outfitState(), ...patch } }, { label });
}

export function setMaterialVisible(index: number, visible: boolean): void {
  const st = outfitState();
  const hidden = new Set(st.hiddenMaterials);
  if (visible) hidden.delete(index);
  else hidden.add(index);
  setOutfit(
    { hiddenMaterials: [...hidden].sort((a, b) => a - b) },
    visible ? 'Show material' : 'Hide material',
  );
}

/** Show only one material (or everything again with null). */
export function soloMaterial(index: number | null): void {
  const n = me.get().result?.pmx.materials.length ?? 0;
  setOutfit(
    {
      hiddenMaterials:
        index === null ? [] : Array.from({ length: n }, (_, i) => i).filter((i) => i !== index),
    },
    index === null ? 'Show all materials' : 'Solo material',
  );
}

// ---------------------------------------------------------------- textures

const texKey = (s: string): string =>
  s
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32) || 'tex';

/** The current image file for a texture path of the edited model (asset, donor or original file). */
export async function textureBlob(path: string): Promise<Blob | null> {
  const s = active();
  const res = me.get().result;
  if (!s || !res) return null;
  const asset = res.assets[path];
  if (asset && s.assets[asset]) return (await filesOf([s.assets[asset]]))[0].blob;
  const donor = res.donorFiles[path];
  if (donor && s.donors[donor.donor]) {
    const d = s.donors[donor.donor];
    return (
      new PathResolver(await filesOf(d.files)).resolve(donor.path, dirname(d.mainPath)).file?.blob ?? null
    );
  }
  return new PathResolver(await filesOf(s.files)).resolve(path, dirname(s.mainPath)).file?.blob ?? null;
}

async function addAsset(blob: Blob, path: string): Promise<string> {
  const s = active();
  if (!s) throw new Error('No model is being edited');
  const ref = await registerFile({ path, blob });
  putSession({ ...s, assets: { ...s.assets, [ref.blobId]: ref } });
  return ref.blobId;
}

function newTexturePath(from: string, suffix: string, hash: string): string {
  return `tex/edit/${texKey(stripExt(basename(from || 'texture')))}_${suffix}_${hash.slice(0, 8)}.png`;
}

/** Recolour a material's texture (new file; the original is kept). */
export async function recolorTexture(index: number, recolor: Recolor): Promise<void> {
  const res = me.get().result;
  const mat = res?.pmx.materials[index];
  if (!res || !mat || mat.texture < 0)
    return toast('warning', 'This material has no texture — change its colour instead.');
  const path = res.pmx.textures[mat.texture];
  const blob = await textureBlob(path);
  if (!blob) return toast('error', `Texture ${path} is missing`);
  try {
    const out = await recolorImage(blob, recolor);
    const id = await addAsset(out, 'recolor.png');
    const np = newTexturePath(path, 'recolor', id);
    commitOp(
      { type: 'materialTexture', index, slot: 'texture', path: np, asset: id },
      { label: 'Recolour texture' },
    );
  } catch {
    toast('error', `Can't decode ${basename(path)} in the browser (TGA / DDS) — use “Replace” with a PNG.`);
  }
}

/** Upload an image as a material's texture, or as a logo / pattern composited into it. */
export async function uploadTexture(index: number, overlay?: Overlay): Promise<void> {
  const [f] = await pickFiles('image/*,.png,.jpg,.jpeg,.webp,.bmp');
  if (!f) return;
  const res = me.get().result;
  const mat = res?.pmx.materials[index];
  if (!res || !mat) return;
  try {
    let blob: Blob = f.blob;
    if (overlay) {
      const base = mat.texture >= 0 ? await textureBlob(res.pmx.textures[mat.texture]) : null;
      blob = await compositeImage(base, f.blob, overlay);
    }
    const id = await addAsset(blob, f.path);
    const from = mat.texture >= 0 ? res.pmx.textures[mat.texture] : mat.name;
    const np = overlay
      ? newTexturePath(from, 'logo', id)
      : `tex/edit/${texKey(stripExt(basename(f.path)))}_${id.slice(0, 8)}.${extname(f.path) || 'png'}`;
    commitOp(
      { type: 'materialTexture', index, slot: 'texture', path: np, asset: id },
      { label: overlay ? 'Add logo / pattern' : 'Replace texture' },
    );
  } catch (e) {
    toast('error', `Couldn't use that image: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Replace a texture file everywhere it's used. */
export async function replaceTextureFile(path: string): Promise<void> {
  const [f] = await pickFiles('image/*,.png,.jpg,.jpeg,.webp,.bmp,.tga');
  if (!f) return;
  const id = await addAsset(f.blob, f.path);
  const to = `tex/edit/${texKey(stripExt(basename(path)))}_${id.slice(0, 8)}.${extname(f.path) || 'png'}`;
  commitOp({ type: 'textureReplace', from: path, to, asset: id }, { label: `Replace ${basename(path)}` });
}

/** Downscale textures larger than `cap` (all, or the given paths), as one undo step. */
export async function downscaleTextures(cap: number, paths?: string[]): Promise<number> {
  const res = me.get().result;
  if (!res) return 0;
  const ops: Op[] = [];
  for (const p of paths ?? res.pmx.textures) {
    const blob = await textureBlob(p);
    if (!blob) continue;
    const small = await downscaleImage(blob, `${basename(p)}`, cap);
    if (small === blob) continue;
    const id = await addAsset(small, p);
    ops.push({ type: 'textureReplace', from: p, to: newTexturePath(p, String(cap), id), asset: id });
  }
  if (ops.length) setOps([...currentOps(), ...ops], `Downscale ${ops.length} texture(s) to ${cap}`);
  else toast('info', `No texture is larger than ${cap}px (or they can't be decoded).`);
  return ops.length;
}

// ---------------------------------------------------------------- outfit presets

const PRESET_OPS = new Set<Op['type']>(['outfit', 'material', 'materialTexture']);

export function saveOutfitPreset(name: string): void {
  const s = active();
  if (!s) return;
  const ops = s.history.ops.filter((o) => PRESET_OPS.has(o.type));
  putSession({
    ...s,
    outfitPresets: [...s.outfitPresets.filter((p) => p.name !== name), { name, ops: structuredClone(ops) }],
  });
  markDirty();
  toast('success', `Outfit preset “${name}” saved`);
}

export function applyOutfitPreset(name: string): void {
  const s = active();
  const p = s?.outfitPresets.find((x) => x.name === name);
  if (!s || !p) return;
  setOps(
    [...s.history.ops.filter((o) => !PRESET_OPS.has(o.type)), ...structuredClone(p.ops)],
    `Outfit preset: ${name}`,
  );
}

export function deleteOutfitPreset(name: string): void {
  const s = active();
  if (!s) return;
  putSession({ ...s, outfitPresets: s.outfitPresets.filter((p) => p.name !== name) });
  markDirty();
}

// ---------------------------------------------------------------- clothes swap

/** Load another PMX (files or ZIP) as a clothes source. */
export async function addDonor(picked?: VFile[]): Promise<string | null> {
  const s = active();
  if (!s) return null;
  const raw = picked ?? (await pickFiles('.zip,.pmx,.png,.jpg,.jpeg,.bmp,.tga,.webp,.spa,.sph', true));
  if (!raw.length) return null;
  const files = await expandZips(raw);
  const main = files.find((f) => /\.pmx$/i.test(f.path));
  if (!main) {
    toast('warning', 'No .pmx model found in those files.');
    return null;
  }
  const pmx = await parseModelFile(main);
  const refs = await registerFiles(files);
  const id = `d${Date.now().toString(36)}`;
  donorModels.set(id, pmx);
  const donor: DonorRef = {
    id,
    label: pmx.nameEn || pmx.name || stripExt(basename(main.path)),
    mainPath: main.path,
    files: refs,
  };
  putSession({ ...active()!, donors: { ...active()!.donors, [id]: donor } });
  markDirty();
  return id;
}

export function donorModel(id: string): PmxModel | null {
  return donorModels.get(id) ?? null;
}

export function mergeProblem(donorId: string, materials: number[]): string | null {
  const donor = donorModels.get(donorId);
  const res = me.get().result;
  if (!donor || !res) return 'The clothes source is not loaded';
  return checkMerge(res.pmx, donor, materials);
}

/** Add a donor's materials; hide the body under them and (optionally) the outfit group they replace. */
export function mergeClothes(donorId: string, materials: number[], hideReplaced = true): void {
  const s = active();
  const res = me.get().result;
  const donor = s?.donors[donorId];
  const dm = donorModels.get(donorId);
  if (!s || !res || !donor || !dm) return;
  const problem = checkMerge(res.pmx, dm, materials);
  if (problem) return toast('error', problem, 10000);
  const first = res.pmx.materials.length;
  const groups = materials.map((k) => guessGroup(dm.materials[k].name, dm.materials[k].nameEn));
  const st = outfitState();
  const assign = { ...st.assign };
  materials.forEach((_, i) => (assign[first + i] = groups[i]));
  const clothing: string[] = [
    ...new Set(groups.filter((g) => g !== 'other' && g !== 'accessories' && g !== 'body')),
  ];
  const replaced = hideReplaced
    ? materialGroups(res.pmx, st)
        .map((g, i) => (clothing.includes(g) ? i : -1))
        .filter((i) => i >= 0)
    : [];
  const merge: Op = { type: 'merge', donor: donorId, materials, label: donor.label };
  const outfit: Op = {
    type: 'outfit',
    state: {
      ...st,
      assign,
      hiddenMaterials: [...new Set([...st.hiddenMaterials, ...replaced])],
      hideBodyUnder: [...new Set([...st.hideBodyUnder, ...clothing])],
    },
  };
  setOps([...s.history.ops.filter((o) => o.type !== 'outfit'), merge, outfit], `Clothes from ${donor.label}`);
}

// ---------------------------------------------------------------- physics overlay

export function setPhysicsOverlay(on: boolean): void {
  me.set({ physicsOverlay: on });
  refreshOverlay();
}

export function refreshOverlay(): void {
  const engine = engineOrNull();
  if (!engine) return;
  const { physicsOverlay, result, modelId, body } = me.get();
  if (!physicsOverlay || !result || !modelId) {
    engine.setOverlayLines('model-editor-physics', null);
    return;
  }
  void import('@/lib/model-edit/overlay').then(({ physicsLines }) => {
    const t = studio.get().models.find((m) => m.id === modelId)?.transform;
    engine.setOverlayLines('model-editor-physics', physicsLines(result.pmx, t, body));
  });
}

// ---------------------------------------------------------------- output

const safeName = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'model';

function readme(s: EditSession, res: ApplyResult): string {
  const o = originals.get(s.modelId);
  const donors = Object.values(s.donors).filter((d) =>
    s.history.ops.some((op) => op.type === 'merge' && op.donor === d.id),
  );
  return [
    `${res.pmx.name} — edited with MMD Studio (Model Editor)`,
    '',
    `Source model: ${o?.name ?? ''} ${o?.nameEn ? `(${o.nameEn})` : ''} — ${basename(s.mainPath)}`,
    `Edited: ${new Date().toISOString()}`,
    '',
    'LICENSE: this is a modified version of the source model. Its original terms still apply, including',
    'whether modification and redistribution are allowed. The original comment / license text is kept below.',
    '',
    '--- Original comment ---',
    o?.comment ?? '',
    o?.commentEn ? `\n${o.commentEn}` : '',
    ...(donors.length
      ? [
          '',
          'Clothes were taken from these models (their licenses apply to those parts too):',
          ...donors.map((d) => `  - ${d.label} (${basename(d.mainPath)})`),
        ]
      : []),
    '',
    'Edit history:',
    ...s.history.ops.map((op, i) => `  ${i + 1}. ${describeOp(op)}`),
    ...(res.warnings.length ? ['', 'Notes:', ...res.warnings.map((w) => `  - ${w}`)] : []),
    '',
    'Files: model.pmx, textures (original paths + tex/edit/ for new ones), edit-report.json',
  ].join('\r\n');
}

/** Files for output: model.pmx at the root plus every texture it references (original relative paths). */
async function outputFiles(s: EditSession, res: ApplyResult): Promise<{ path: string; data: Blob }[]> {
  const files = await editedFiles(s, res);
  const dir = dirname(s.mainPath);
  const resolver = new PathResolver(files);
  const out: { path: string; data: Blob }[] = [{ path: 'model.pmx', data: new Blob([writePmx(res.pmx)]) }];
  const seen = new Set<string>();
  for (const t of res.pmx.textures) {
    const hit = resolver.resolve(t, dir).file;
    const p = t.replace(/\\/g, '/');
    if (!hit || seen.has(p.toLowerCase()) || /^toon(0[0-9]|10)\.bmp$/i.test(basename(p))) continue;
    seen.add(p.toLowerCase());
    out.push({ path: p, data: hit.blob });
  }
  return out;
}

export async function saveZip(): Promise<void> {
  const s = active();
  if (!s) return;
  const res = await computeResult(s);
  const issues = checkModel(res.pmx);
  if (hasErrors(issues)) {
    toast('error', `Fix these first: ${issues.filter((i) => i.level === 'error')[0].message}`, 9000);
    return;
  }
  const files = await outputFiles(s, res);
  files.push({ path: 'README.txt', data: new Blob([`\uFEFF${readme(s, res)}`]) });
  files.push({
    path: 'edit-report.json',
    data: new Blob([
      JSON.stringify(
        {
          tool: 'MMD Studio Model Editor',
          source: basename(s.mainPath),
          edited: new Date().toISOString(),
          ops: s.history.ops,
          history: s.history.ops.map(describeOp),
          warnings: res.warnings,
          issues,
          counts: {
            vertices: res.pmx.vertices.length,
            materials: res.pmx.materials.length,
            bones: res.pmx.bones.length,
            morphs: res.pmx.morphs.length,
            rigidBodies: res.pmx.rigidBodies.length,
            joints: res.pmx.joints.length,
          },
        },
        null,
        2,
      ),
    ]),
  });
  downloadBlob(await zipFiles(files), `${safeName(res.pmx.nameEn || res.pmx.name)}_edited.zip`);
  toast('success', 'PMX ZIP downloaded');
}

/** Bake the edits into the scene model (its files become the edited PMX; the edit list starts fresh). */
export async function applyToScene(): Promise<void> {
  const s = active();
  if (!s) return;
  const res = await computeResult(s);
  if (hasErrors(checkModel(res.pmx)))
    return toast('error', 'The edited model has errors — see the checks in Info & save.');
  const folder = `edited/${safeName(res.pmx.nameEn || res.pmx.name)}_${Date.now().toString(36)}`;
  const vfiles = (await outputFiles(s, res)).map((f) => ({ path: `${folder}/${f.path}`, blob: f.data }));
  const refs = await registerFiles(vfiles);
  const mainPath = `${folder}/model.pmx`;
  updateModel(s.modelId, {
    files: refs,
    mainPath,
    name: res.pmx.name || studio.get().models.find((m) => m.id === s.modelId)?.name,
  });
  originals.set(s.modelId, res.pmx);
  putSession(newSession(s.modelId, mainPath, refs));
  useHistory.getState().clear();
  me.set((st) => ({ version: st.version + 1 }));
  await rebuild(s.modelId, { force: true });
  toast('success', 'Edits applied — the model in the scene (and the project) now uses the edited PMX.');
}

export function exportEditList(): void {
  const s = active();
  if (!s) return;
  const doc = { type: 'mmd-studio-edits', version: 1, source: basename(s.mainPath), ops: s.history.ops };
  downloadBlob(
    new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }),
    `${safeName(stripExt(basename(s.mainPath)))}_edits.json`,
  );
}

export async function importEditList(): Promise<void> {
  const [f] = await pickFiles('.json,application/json');
  if (!f) return;
  try {
    const json = JSON.parse(await f.blob.text()) as { type?: string; ops?: Op[] };
    if (json.type !== 'mmd-studio-edits' || !Array.isArray(json.ops))
      throw new Error('not an MMD Studio edit list');
    const merges = json.ops.filter((o) => o.type === 'merge' && !active()?.donors[o.donor]);
    setOps(json.ops, 'Import edit list');
    if (merges.length)
      toast(
        'warning',
        `${merges.length} clothes merge(s) need their source model — load it again in Outfit.`,
      );
    else toast('success', `Imported ${json.ops.length} edit(s)`);
  } catch (e) {
    toast('error', `Couldn't import: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ---------------------------------------------------------------- persistence

export function sessionsForDoc(): EditSession[] {
  return Object.values(me.get().sessions).filter((s) => studio.get().models.some((m) => m.id === s.modelId));
}

/** Restore sessions and rebuild their models (after the scene's models are back). */
export async function restoreSessions(
  list: EditSession[],
  presets: { name: string; state: ProportionState }[] = [],
): Promise<void> {
  originals.clear();
  me.set({
    sessions: Object.fromEntries(list.map((s) => [s.modelId, s])),
    proportionPresets: presets,
    modelId: null,
  });
  for (const s of list) if (s.history.ops.length) await rebuild(s.modelId, { force: true });
  if (studio.get().mode === 'modeledit') await openEditor();
}

/** Vertices of a material (for "attach to bone" and tests). */
export function verticesOfMaterial(index: number): number {
  const res = me.get().result;
  return res ? materialVertices(res.pmx, [index]).size : 0;
}

// Leaving the editor hides its overlays.
useStudio.subscribe((s, prev) => {
  if (prev.mode === 'modeledit' && s.mode !== 'modeledit') {
    setPhysicsOverlay(false);
    engineOrNull()?.setPointGizmo(null);
  }
});

// Test / debugging hook.
(window as unknown as { __modelEditor?: unknown }).__modelEditor = {
  state: () => me.get(),
  ops: currentOps,
  result: () => me.get().result,
};
