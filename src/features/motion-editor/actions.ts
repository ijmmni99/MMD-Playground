import { downloadBlob } from '@/features/app/filePickers';
import { getAsset, registerFile, resolveRef } from '@/lib/assets';
import {
  allKeyRefs,
  boneGroup,
  clearTrack,
  copyKeys,
  deleteKeys,
  moveKeys,
  pasteKeys,
  setBoneKey,
  setCameraKey,
  setMorphKey,
  type BoneGroup,
} from '@/lib/motion/edit';
import { clipEndFrame } from '@/lib/motion/evaluate';
import { applyPins } from '@/lib/motion/ik';
import {
  emptyClip,
  keyId,
  parseKeyId,
  type KeyRef,
  type MotionClip,
  type PinRange,
} from '@/lib/motion/types';
import { readVmd, writeVmd, type WriteOptions } from '@/lib/motion/vmd';
import { engineOrNull } from '@/store/engineRef';
import { useHistory } from '@/store/history';
import { me, motionHooks, type MotionEditorDoc } from '@/store/motionEditor';
import { dopeProbe } from './view';
import { markDirty, studio, toast, updateModel } from '@/store/studio';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
let idCounter = 0;
export const newId = (p: string): string => `${p}${Date.now().toString(36)}${(idCounter++).toString(36)}`;

// ---------------------------------------------------------------- loading clips

/** Load (once) the editable clip for a model from its current motion file, or start empty. */
export async function ensureModelClip(modelId: string): Promise<MotionClip | null> {
  const s = me.get();
  if (s.clips[modelId]) return s.clips[modelId];
  const model = studio.get().models.find((m) => m.id === modelId);
  if (!model) return null;
  let clip = emptyClip(model.info.name);
  let name = `${model.name}.vmd`;
  if (model.motionRef) {
    try {
      clip = readVmd(await (await resolveRef(model.motionRef)).blob.arrayBuffer());
      name = model.motionRef.path.split('/').pop() ?? name;
    } catch (e) {
      toast('error', `Could not read the motion for editing: ${errMsg(e)}`);
    }
  }
  me.set((st) => ({
    clips: { ...st.clips, [modelId]: clip },
    originals: { ...st.originals, [modelId]: clip },
    names: { ...st.names, [modelId]: name },
  }));
  return clip;
}

export async function ensureCameraClip(): Promise<MotionClip> {
  const s = me.get();
  if (s.camera) return s.camera;
  const cam = studio.get().cameraMotion;
  let clip = emptyClip('カメラ・照明');
  let name = 'camera.vmd';
  if (cam) {
    try {
      clip = readVmd(await (await resolveRef(cam.ref)).blob.arrayBuffer());
      name = cam.ref.path.split('/').pop() ?? name;
    } catch (e) {
      toast('error', `Could not read the camera motion: ${errMsg(e)}`);
    }
  }
  me.set({ camera: clip, cameraOriginal: clip, cameraName: name });
  return clip;
}

/** Open the editor for the selected performer model (and the camera). */
export async function openEditor(): Promise<void> {
  const st = studio.get();
  const model =
    st.models.find((m) => m.id === st.selectedModelId && !m.stage) ?? st.models.find((m) => !m.stage) ?? null;
  me.set({ open: true, modelId: model?.id ?? null });
  if (model) await ensureModelClip(model.id);
  await ensureCameraClip();
  me.set((s) => ({ revision: s.revision + 1 }));
}

export function closeEditor(): void {
  me.set({ open: false });
}

export async function setEditedModel(modelId: string | null): Promise<void> {
  me.set({ modelId, selection: new Set(), channel: null });
  if (modelId) await ensureModelClip(modelId);
  me.set((s) => ({ revision: s.revision + 1 }));
}

// ---------------------------------------------------------------- engine sync

let applyTimer: ReturnType<typeof setTimeout> | null = null;
const pendingApply = new Set<string>();

/** Effective clip for playback: original (A/B) or edited with pins applied. */
export function effectiveClip(modelId: string): MotionClip | null {
  const s = me.get();
  const base = s.compareOriginal ? s.originals[modelId] : s.clips[modelId];
  if (!base) return null;
  return s.compareOriginal ? base : applyPins(base, s.pins[modelId] ?? []);
}

function flushApply(): void {
  applyTimer = null;
  const engine = engineOrNull();
  if (!engine) return;
  const s = me.get();
  for (const target of pendingApply) {
    if (target === '__camera__') {
      const cam = s.compareOriginal ? s.cameraOriginal : s.camera;
      const info = engine.setCameraClip(cam, s.cameraName);
      studio.set((st) => ({
        cameraMotion: st.cameraMotion && info ? { ...st.cameraMotion, info } : st.cameraMotion,
      }));
      continue;
    }
    const clip = effectiveClip(target);
    if (!clip) continue;
    const info = engine.setMotionClip(target, clip, s.names[target]);
    updateModel(target, { motion: info });
  }
  pendingApply.clear();
}

/** Push edits to the runtime (debounced; immediate when `now`). */
export function scheduleApply(target: string, now = false): void {
  pendingApply.add(target);
  if (applyTimer) clearTimeout(applyTimer);
  if (now) flushApply();
  else applyTimer = setTimeout(flushApply, 40);
}

// ---------------------------------------------------------------- commands (undo/redo)

type Target = string; // modelId or '__camera__'
const CAMERA = '__camera__';

function getClip(target: Target): MotionClip | null {
  const s = me.get();
  return target === CAMERA ? s.camera : (s.clips[target] ?? null);
}

function putClip(target: Target, clip: MotionClip, selection?: Iterable<string>): void {
  me.set((s) => ({
    ...(target === CAMERA ? { camera: clip } : { clips: { ...s.clips, [target]: clip } }),
    ...(selection ? { selection: new Set(selection) } : {}),
    revision: s.revision + 1,
  }));
  scheduleApply(target);
  scheduleSave();
}

/** Apply an edit as one undoable step. */
export function commit(
  target: Target,
  label: string,
  fn: (clip: MotionClip) => MotionClip | { clip: MotionClip; selection?: string[] },
  coalesceKey?: string,
): void {
  const before = getClip(target);
  if (!before) return;
  const result = fn(before);
  const after = 'bones' in result ? result : result.clip;
  const selection = 'bones' in result ? undefined : result.selection;
  if (after === before) return;
  const selBefore = [...me.get().selection];
  putClip(target, after, selection);
  useHistory.getState().push({
    label,
    key: coalesceKey,
    undo: () => putClip(target, before, selBefore),
    redo: () => putClip(target, after, selection),
  });
}

/** One undo step that may change the edited model's clip and/or the camera clip. */
export function commitClips(
  label: string,
  modelFn: ((clip: MotionClip) => MotionClip) | null,
  cameraFn: ((clip: MotionClip) => MotionClip) | null = null,
): boolean {
  const s = me.get();
  const steps: { target: Target; before: MotionClip; after: MotionClip }[] = [];
  const run = (target: Target, fn: ((clip: MotionClip) => MotionClip) | null): void => {
    const before = fn ? getClip(target) : null;
    if (!before || !fn) return;
    const after = fn(before);
    if (after !== before) steps.push({ target, before, after });
  };
  if (s.modelId) run(s.modelId, modelFn);
  run(CAMERA, cameraFn);
  if (!steps.length) return false;
  const selBefore = [...s.selection];
  const apply = (which: 'before' | 'after'): void => {
    for (const st of steps) putClip(st.target, st[which]);
    me.set({ selection: new Set(which === 'before' ? selBefore : []) });
  };
  apply('after');
  useHistory.getState().push({ label, undo: () => apply('before'), redo: () => apply('after') });
  return true;
}

/** Commit to the current model and/or camera, routing refs by kind. */
export function commitRefs(
  label: string,
  refs: readonly KeyRef[],
  fn: (clip: MotionClip, refs: KeyRef[]) => MotionClip | { clip: MotionClip; refs: KeyRef[] },
): void {
  const s = me.get();
  const modelRefs = refs.filter((r) => r.kind !== 'camera');
  const camRefs = refs.filter((r) => r.kind === 'camera');
  const steps: { target: Target; before: MotionClip; after: MotionClip; sel: KeyRef[] }[] = [];
  const run = (target: Target, rs: KeyRef[]): void => {
    const before = getClip(target);
    if (!before || !rs.length) return;
    const out = fn(before, rs);
    const after = 'refs' in out ? out.clip : out;
    steps.push({ target, before, after, sel: 'refs' in out ? out.refs : rs });
  };
  if (s.modelId) run(s.modelId, modelRefs);
  run(CAMERA, camRefs);
  if (!steps.length) return;
  const selBefore = [...s.selection];
  const selAfter = steps.flatMap((x) => x.sel.map(keyId));
  const apply = (which: 'before' | 'after'): void => {
    for (const st of steps) putClip(st.target, st[which]);
    me.set({ selection: new Set(which === 'before' ? selBefore : selAfter) });
  };
  apply('after');
  useHistory.getState().push({ label, undo: () => apply('before'), redo: () => apply('after') });
}

// ---------------------------------------------------------------- drag sessions (one undo step)

let drag: {
  refs: KeyRef[];
  model: MotionClip | null;
  camera: MotionClip | null;
  selection: string[];
} | null = null;

export function beginKeyDrag(): void {
  const s = me.get();
  const refs = [...s.selection].map(parseKeyId);
  drag = {
    refs,
    model: s.modelId ? (s.clips[s.modelId] ?? null) : null,
    camera: s.camera,
    selection: [...s.selection],
  };
}

/** Preview a drag by `delta` frames from the drag start (copy = Alt). */
export function updateKeyDrag(delta: number, copy: boolean): void {
  if (!drag) return;
  const s = me.get();
  const sel: string[] = [];
  if (s.modelId && drag.model) {
    const r = moveKeys(
      drag.model,
      drag.refs.filter((x) => x.kind !== 'camera'),
      delta,
      { copy },
    );
    sel.push(...r.refs.map(keyId));
    me.set((st) => ({ clips: { ...st.clips, [s.modelId!]: r.clip } }));
    scheduleApply(s.modelId);
  }
  if (drag.camera) {
    const r = moveKeys(
      drag.camera,
      drag.refs.filter((x) => x.kind === 'camera'),
      delta,
      { copy },
    );
    sel.push(...r.refs.map(keyId));
    me.set({ camera: r.clip });
    scheduleApply(CAMERA);
  }
  me.set((st) => ({ selection: new Set(sel), revision: st.revision + 1 }));
}

export function endKeyDrag(label = 'Move keys'): void {
  if (!drag) return;
  const d = drag;
  drag = null;
  const s = me.get();
  const modelId = s.modelId;
  const after = { model: modelId ? s.clips[modelId] : null, camera: s.camera, selection: [...s.selection] };
  if (after.model === d.model && after.camera === d.camera) return;
  const restore = (state: typeof after): void => {
    if (modelId && state.model) putClip(modelId, state.model);
    if (state.camera) putClip(CAMERA, state.camera);
    me.set({ selection: new Set(state.selection) });
  };
  scheduleSave();
  useHistory.getState().push({
    label,
    undo: () => restore({ model: d.model, camera: d.camera, selection: d.selection }),
    redo: () => restore(after),
  });
}

// ---------------------------------------------------------------- selection

export const selectedRefs = (): KeyRef[] => [...me.get().selection].map(parseKeyId);

export function setSelection(ids: Iterable<string>): void {
  me.set({ selection: new Set(ids) });
}

export function selectAll(range?: [number, number]): void {
  const s = me.get();
  const refs = [
    ...(s.modelId && s.clips[s.modelId] ? allKeyRefs(s.clips[s.modelId], range?.[0], range?.[1]) : []),
    ...(s.camera ? allKeyRefs({ ...emptyClip(), camera: s.camera.camera }, range?.[0], range?.[1]) : []),
  ];
  setSelection(refs.map(keyId));
}

export function selectGroup(group: BoneGroup | 'morph' | 'camera'): void {
  const s = me.get();
  const clip = s.modelId ? s.clips[s.modelId] : null;
  const refs: KeyRef[] = [];
  if (group === 'camera') refs.push(...allKeyRefs({ ...emptyClip(), camera: s.camera?.camera ?? [] }));
  else if (clip) {
    for (const r of allKeyRefs(clip)) {
      if (group === 'morph' ? r.kind === 'morph' : r.kind === 'bone' && boneGroup(r.track) === group)
        refs.push(r);
    }
  }
  setSelection(refs.map(keyId));
}

// ---------------------------------------------------------------- keying

const playheadFrame = (): number => Math.max(0, Math.round(engineOrNull()?.getPlayback().frame ?? 0));

/** Key bones at the playhead from the current pose (gizmo edits included). */
export function keyBones(names: string[], label = 'Key pose'): void {
  const s = me.get();
  const engine = engineOrNull();
  if (!s.modelId || !engine || !names.length) return;
  const modelId = s.modelId;
  const f = playheadFrame();
  const values = engine.getBoneKeyValues(modelId, names);
  // IK bones: optionally bake the solved chain to FK as well.
  const chains = s.bakeFk ? engine.getIkChains(modelId).filter((c) => names.includes(c.bone)) : [];
  const fkNames = chains.flatMap((c) => c.links);
  const solved = fkNames.length ? engine.getSolvedLocalRotations(modelId, fkNames) : {};
  commit(modelId, label, (clip) => {
    let out = clip;
    for (const name of names) if (values[name]) out = setBoneKey(out, name, { f, ...values[name] });
    for (const name of fkNames) {
      const r = solved[name];
      if (r) out = setBoneKey(out, name, { f, p: values[name]?.p ?? [0, 0, 0], r });
    }
    return { clip: out, selection: [...names, ...fkNames].map((n) => keyId({ kind: 'bone', track: n, f })) };
  });
}

/** Key the selected bone (K). */
export function keySelected(): void {
  const st = studio.get();
  const model = st.models.find((m) => m.id === me.get().modelId);
  if (!model) {
    toast('info', 'Load a model to key poses.');
    return;
  }
  if (st.selectedBone !== null && model.id === st.selectedModelId) {
    keyBones([model.info.bones[st.selectedBone].name], 'Key bone');
    return;
  }
  // No bone selected: key every bone the current clip already animates.
  const clip = me.get().clips[model.id];
  const names = clip?.bones.map((t) => t.name) ?? [];
  if (names.length) keyBones(names, 'Key all animated bones');
  else toast('info', 'Select a bone (viewport or Inspector → Bones) to key it.');
}

/** Key morph weights at the playhead (all = every morph with a slider value or track). */
export function keyMorphs(names?: string[]): void {
  const s = me.get();
  const engine = engineOrNull();
  if (!s.modelId || !engine) return;
  const weights = engine.getMorphWeights(s.modelId);
  const clip = s.clips[s.modelId];
  const list = names ?? [
    ...new Set([
      ...Object.keys(weights).filter((k) => weights[k] !== 0),
      ...(clip?.morphs.map((m) => m.name) ?? []),
    ]),
  ];
  const f = playheadFrame();
  commit(s.modelId, names?.length === 1 ? `Key ${names[0]}` : 'Key morphs', (c) => {
    let out = c;
    for (const n of list) out = setMorphKey(out, n, f, weights[n] ?? 0);
    return { clip: out, selection: list.map((n) => keyId({ kind: 'morph', track: n, f })) };
  });
}

export function deleteSelected(): void {
  commitRefs('Delete keys', selectedRefs(), (clip, refs) => deleteKeys(clip, refs));
  me.set({ selection: new Set() });
}

export function clearChannel(kind: KeyRef['kind'], track: string): void {
  const s = me.get();
  const target = kind === 'camera' ? CAMERA : s.modelId;
  if (!target) return;
  commit(target, `Clear ${track}`, (c) => clearTrack(c, kind, track));
}

export function nudge(delta: number): void {
  commitRefs(delta > 0 ? 'Nudge right' : 'Nudge left', selectedRefs(), (clip, refs) =>
    moveKeys(clip, refs, delta),
  );
}

export function copySelection(): void {
  const s = me.get();
  const refs = selectedRefs();
  const clip = s.modelId ? s.clips[s.modelId] : null;
  const merged: MotionClip = { ...(clip ?? emptyClip()), camera: s.camera?.camera ?? [] };
  const cb = copyKeys(merged, refs);
  me.set({ clipboard: cb });
  if (cb) toast('info', `Copied ${refs.length} key${refs.length === 1 ? '' : 's'}`, 1500);
}

/** Paste at the playhead (+ offset frames). */
export function pasteClipboard(offset = 0): void {
  const s = me.get();
  const cb = s.clipboard;
  if (!cb) return;
  const at = playheadFrame() + offset;
  const steps: (() => void)[] = [];
  if (s.modelId && (cb.bones.length || cb.morphs.length)) {
    const target = s.modelId;
    commit(target, 'Paste keys', (c) => {
      const r = pasteKeys(c, { ...cb, camera: [] }, at);
      return { clip: r.clip, selection: r.refs.map(keyId) };
    });
  }
  if (cb.camera.length && s.camera) {
    commit(CAMERA, 'Paste camera keys', (c) => {
      const r = pasteKeys(c, { bones: [], morphs: [], camera: cb.camera, span: cb.span }, at);
      return { clip: r.clip, selection: r.refs.map(keyId) };
    });
  }
  void steps;
}

/** Duplicate the selection right after itself. */
export function duplicateSelection(): void {
  const refs = selectedRefs();
  if (!refs.length) return;
  const min = Math.min(...refs.map((r) => r.f));
  const max = Math.max(...refs.map((r) => r.f));
  commitRefs('Duplicate keys', refs, (clip, rs) => moveKeys(clip, rs, max - min + 1, { copy: true }));
}

/** Capture a camera key at the playhead from explicit values. */
export function keyCamera(values: {
  t: [number, number, number];
  r: [number, number, number];
  d: number;
  fov: number;
}): void {
  const f = playheadFrame();
  commit(CAMERA, 'Key camera', (c) => ({
    clip: setCameraKey(c, { f, ...values, persp: true }),
    selection: [keyId({ kind: 'camera', track: '__camera__', f })],
  }));
}

// ---------------------------------------------------------------- revert / compare / pins

export function revertToOriginal(): void {
  const s = me.get();
  if (s.modelId && s.originals[s.modelId])
    commit(s.modelId, 'Revert to original', () => s.originals[s.modelId!]);
  if (s.cameraOriginal) commit(CAMERA, 'Revert camera', () => s.cameraOriginal!);
}

export function setCompareOriginal(on: boolean): void {
  me.set({ compareOriginal: on });
  const s = me.get();
  if (s.modelId) scheduleApply(s.modelId, true);
  scheduleApply(CAMERA, true);
}

export function setPins(modelId: string, pins: PinRange[], label = 'Edit pins'): void {
  const before = me.get().pins[modelId] ?? [];
  const apply = (p: PinRange[]): void => {
    me.set((s) => ({ pins: { ...s.pins, [modelId]: p }, revision: s.revision + 1 }));
    scheduleApply(modelId);
    scheduleSave();
  };
  apply(pins);
  useHistory.getState().push({ label, undo: () => apply(before), redo: () => apply(pins) });
}

// ---------------------------------------------------------------- export

export function exportMotion(opts: WriteOptions = {}): void {
  const s = me.get();
  if (!s.modelId) return;
  const clip = effectiveClip(s.modelId);
  if (!clip) return;
  const name = (s.names[s.modelId] ?? 'motion.vmd').replace(/\.vmd$/i, '') + '_edited.vmd';
  downloadBlob(new Blob([writeVmd({ ...clip, camera: [] }, opts)]), name);
}

export function exportCamera(): void {
  const s = me.get();
  if (!s.camera?.camera.length) {
    toast('info', 'There is no camera motion to export yet.');
    return;
  }
  const clip: MotionClip = {
    ...emptyClip('カメラ・照明'),
    camera: s.camera.camera,
    lights: s.camera.lights,
    shadows: s.camera.shadows,
  };
  downloadBlob(new Blob([writeVmd(clip)]), s.cameraName.replace(/\.vmd$/i, '') + '_edited.vmd');
}

/** Markers, BPM, shots and pins as a sidecar JSON. */
export function exportSidecar(): void {
  const s = me.get();
  const json = JSON.stringify(
    {
      format: 'mmd-studio-motion-sidecar',
      version: 1,
      markers: s.markers,
      grid: s.grid,
      shots: s.shots,
      pins: s.pins,
    },
    null,
    2,
  );
  downloadBlob(new Blob([json], { type: 'application/json' }), 'motion-editor.json');
}

// ---------------------------------------------------------------- persistence (autosave)

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced: store edited clips as VMD assets, point the studio at the effective motion, mark dirty. */
export function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveClips(), 700);
}

async function vmdRef(clip: MotionClip, name: string) {
  return registerFile({ path: name, blob: new Blob([writeVmd(clip)], { type: 'application/octet-stream' }) });
}

export async function saveClips(): Promise<void> {
  saveTimer = null;
  const s = me.get();
  const saved: typeof s.saved = { models: { ...s.saved.models }, camera: s.saved.camera };
  for (const [modelId, clip] of Object.entries(s.clips)) {
    if (clip === s.originals[modelId] && !s.pins[modelId]?.length && !saved.models[modelId]) continue;
    if (!studio.get().models.some((m) => m.id === modelId)) continue;
    const name = s.names[modelId] ?? 'motion.vmd';
    const base = await vmdRef(clip, name);
    const original = saved.models[modelId]?.original ?? (await vmdRef(s.originals[modelId] ?? clip, name));
    saved.models[modelId] = { base, original };
    const eff = applyPins(clip, s.pins[modelId] ?? []);
    const effRef = eff === clip ? base : await vmdRef(eff, name);
    updateModel(modelId, { motionRef: effRef });
  }
  if (s.camera && (s.camera !== s.cameraOriginal || saved.camera)) {
    const base = await vmdRef(s.camera, s.cameraName);
    const original = saved.camera?.original ?? (await vmdRef(s.cameraOriginal ?? s.camera, s.cameraName));
    saved.camera = { base, original };
    studio.set((st) => ({
      cameraMotion: st.cameraMotion ? { ...st.cameraMotion, ref: base } : st.cameraMotion,
    }));
    if (!studio.get().cameraMotion && s.camera.camera.length) {
      const info = engineOrNull()?.setCameraClip(s.camera, s.cameraName);
      if (info) studio.set({ cameraMotion: { info, ref: base } });
    }
  }
  me.set({ saved });
  markDirty();
}

export async function restoreMotionEditorImpl(doc: MotionEditorDoc | undefined): Promise<void> {
  me.set({
    clips: {},
    originals: {},
    names: {},
    camera: null,
    cameraOriginal: null,
    pins: {},
    markers: doc?.markers ?? [],
    grid: doc?.grid ?? me.get().grid,
    shots: doc?.shots ?? [],
    selection: new Set(),
    saved: { models: {}, camera: null },
    compareOriginal: false,
  });
  if (!doc) return;
  const read = async (blobId: string): Promise<MotionClip | null> => {
    const blob = await getAsset(blobId);
    return blob ? readVmd(await blob.arrayBuffer()) : null;
  };
  for (const [id, m] of Object.entries(doc.models)) {
    const base = await read(m.base.blobId);
    const original = (await read(m.original.blobId)) ?? base;
    if (!base) continue;
    me.set((s) => ({
      clips: { ...s.clips, [id]: base },
      originals: { ...s.originals, [id]: original! },
      names: { ...s.names, [id]: m.name },
      pins: { ...s.pins, [id]: m.pins },
      saved: { ...s.saved, models: { ...s.saved.models, [id]: { base: m.base, original: m.original } } },
    }));
    scheduleApply(id, true);
  }
  if (doc.camera) {
    const base = await read(doc.camera.base.blobId);
    const original = (await read(doc.camera.original.blobId)) ?? base;
    if (base) {
      me.set((s) => ({
        camera: base,
        cameraOriginal: original,
        cameraName: doc.camera!.name,
        saved: { ...s.saved, camera: { base: doc.camera!.base, original: doc.camera!.original } },
      }));
      scheduleApply(CAMERA, true);
    }
  }
  me.set((s) => ({ revision: s.revision + 1 }));
}

/** A new motion was loaded onto a model (or camera): drop edits for it. */
function onMotionReplaced(target: string): void {
  me.set((s) => {
    if (target === CAMERA) return { camera: null, cameraOriginal: null, saved: { ...s.saved, camera: null } };
    const clips = { ...s.clips };
    const originals = { ...s.originals };
    const saved = { ...s.saved.models };
    delete clips[target];
    delete originals[target];
    delete saved[target];
    return { clips, originals, saved: { ...s.saved, models: saved } };
  });
  if (me.get().open) void openEditor();
}

// ---------------------------------------------------------------- auto-key hooks

motionHooks.boneEdited = (modelId, bone) => {
  const s = me.get();
  if (!s.open || !s.autoKey || modelId !== s.modelId) return;
  const name = studio.get().models.find((m) => m.id === modelId)?.info.bones[bone]?.name;
  if (name) keyBones([name], 'Auto-key bone');
};
motionHooks.morphChanged = (modelId, name) => {
  const s = me.get();
  if (!s.open || !s.autoKey || modelId !== s.modelId) return;
  keyMorphs([name]);
};
motionHooks.motionReplaced = onMotionReplaced;

// Automation hook (e2e tests drive and inspect the editor through it).
(window as unknown as { __motionEditor?: unknown }).__motionEditor = {
  state: me.get,
  keyPoint: (track: string, f: number) => dopeProbe.keyPoint?.(track, f) ?? null,
  drawMs: () => dopeProbe.drawMs ?? -1,
  history: () => ({ past: useHistory.getState().past.length, future: useHistory.getState().future.length }),
};

/** Length of the edited content (frames). */
export function editedEndFrame(): number {
  const s = me.get();
  const clip = s.modelId ? s.clips[s.modelId] : null;
  return Math.max(clip ? clipEndFrame(clip) : 0, s.camera ? clipEndFrame(s.camera) : 0);
}
