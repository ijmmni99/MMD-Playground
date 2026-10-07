// Orchestration layer: every user intent goes through here. It talks to the engine (via the typed
// StudioEngine interface), keeps the Zustand store in sync, records undo history and marks the
// project dirty for autosave.
import type {
  CameraMode,
  CameraPreset,
  PoseData,
  SceneSettings,
  TransformState,
  VFile,
} from '@/engine/types';
import type { BoneLocalTransform, GizmoMode } from '@/engine/StudioEngine';
import { registerFile, registerFiles, resolveRef, resolveRefs } from '@/lib/assets';
import { collectFromDataTransfer, collectFromFileList, expandZips, planImport } from '@/lib/ingest';
import { basename, stripExt } from '@/lib/paths';
import { isLowMemoryDevice, LARGE_MODEL_BYTES } from '@/lib/device';
import type { FileRef, ProjectModel } from '@/lib/project';
import { engineOrNull, whenEngine } from './engineRef';
import { useHistory } from './history';
import { markDirty, selectedModel, setTask, studio, toast, updateModel, type ModelUI } from './studio';

const { get, set } = studio;
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Map low-level failures (allocation errors on phones) to actionable messages. */
export function friendlyError(e: unknown): string {
  const msg = errMsg(e);
  if (e instanceof RangeError || /out of memory|allocation failed|array buffer allocation/i.test(msg)) {
    return 'the device ran out of memory. Try Low quality, close other tabs, or use a smaller model.';
  }
  return msg;
}

// ---------------------------------------------------------------- import

/** Registered by the persistence module (avoids an import cycle). */
let projectArchiveImporter: ((blob: Blob) => Promise<void>) | null = null;
export function registerProjectImporter(fn: (blob: Blob) => Promise<void>): void {
  projectArchiveImporter = fn;
}

export async function importDataTransfer(dt: DataTransfer): Promise<void> {
  const files = await collectFromDataTransfer(dt);
  await importFiles(files);
}

export async function importFileList(list: FileList | File[]): Promise<void> {
  await importFiles(collectFromFileList(list));
}

/** Import an arbitrary set of files: models, motions, camera motions, audio, HDRs, projects, poses. */
/** Stage-like names (stage, ステージ, 舞台, ...) are loaded as scenery automatically. */
const STAGE_NAME = /stage|ステージ|舞台|背景/i;
export const looksLikeStage = (...names: string[]): boolean => names.some((n) => STAGE_NAME.test(n));

/** The model new motions and poses go to: the selected one unless it's a stage, else the first performer. */
function performerId(): string | undefined {
  const { models, selectedModelId } = get();
  const selected = models.find((m) => m.id === selectedModelId);
  if (selected && !selected.stage) return selected.id;
  return models.find((m) => !m.stage)?.id;
}

export async function importFiles(raw: VFile[], opts: { asStage?: boolean } = {}): Promise<void> {
  if (!raw.length) return;
  const taskId = `import-${Date.now()}`;
  setTask(
    taskId,
    raw.length === 1 ? `Reading ${basename(raw[0].path)}…` : `Reading ${raw.length} files…`,
    0,
    false,
  );
  try {
    const projectFiles = raw.filter((f) => f.path.toLowerCase().endsWith('.mmdstudio.zip'));
    if (projectFiles.length) {
      if (!projectArchiveImporter) throw new Error('Project import is not available yet');
      await projectArchiveImporter(projectFiles[0].blob);
      return;
    }
    const files = await expandZips(raw);
    const plan = await planImport(files);
    const engine = await whenEngine();
    const newModelIds: string[] = [];
    // Memory safety: very large models can crash a phone tab, so ask first on constrained devices.
    if (isLowMemoryDevice()) {
      const large = plan.models.filter(
        (m) => (m.files.find((f) => f.path === m.mainPath)?.blob.size ?? 0) > LARGE_MODEL_BYTES,
      );
      for (const m of large) {
        const size = ((m.files.find((f) => f.path === m.mainPath)?.blob.size ?? 0) / 1024 / 1024).toFixed(0);
        const ok = window.confirm(
          `${basename(m.mainPath)} is ${size} MB. Large models may run out of memory on this device and close the tab. Load it anyway?\n\nTip: use Low quality (textures are downscaled).`,
        );
        if (!ok) plan.models.splice(plan.models.indexOf(m), 1);
      }
    }
    for (const [i, m] of plan.models.entries()) {
      setTask(
        taskId,
        `Loading model ${i + 1}/${plan.models.length}`,
        i / Math.max(1, plan.models.length),
        false,
      );
      try {
        const id = await addModel(m.files, m.mainPath, { stage: opts.asStage });
        newModelIds.push(id);
      } catch (e) {
        toast('error', `Failed to load ${basename(m.mainPath)}: ${friendlyError(e)}`);
      }
    }
    // Motions: pair with new models in order, otherwise go to the selected performer (never a stage).
    for (const [i, motion] of plan.motions.entries()) {
      const target = newModelIds[i] ?? newModelIds[0] ?? performerId();
      if (!target) {
        toast('warning', `Load a model before adding motion ${basename(motion.path)}`);
        continue;
      }
      await assignMotion(target, motion);
    }
    if (plan.cameraMotions[0]) await setCameraMotion(plan.cameraMotions[0]);
    if (plan.audio[0]) await setAudio(plan.audio[0]);
    if (plan.hdr[0]) await setHdr(plan.hdr[0]);
    for (const p of plan.poses) {
      const target = performerId() ?? newModelIds[0];
      if (target) await loadPoseFile(target, p.blob);
    }
    if (newModelIds.length && !get().cameraMotion) {
      // Let the runtime compute bone positions for a frame before framing the model.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      engine.focusModel();
    }
    if (plan.ignored.length) toast('info', `Skipped ${plan.ignored.length} unsupported file(s)`);
    if (
      !plan.models.length &&
      !plan.motions.length &&
      !plan.cameraMotions.length &&
      !plan.audio.length &&
      !plan.hdr.length &&
      !plan.poses.length
    ) {
      const seen = files
        .slice(0, 5)
        .map((f) => basename(f.path))
        .join(', ');
      toast(
        'warning',
        `No PMX/PMD model, VMD, audio or HDR found in: ${seen}${files.length > 5 ? '…' : ''}`,
        9000,
      );
    }
  } catch (e) {
    toast('error', `Import failed: ${errMsg(e)}`);
  } finally {
    setTask(taskId, '', 1, true);
  }
}

// ---------------------------------------------------------------- models

export async function addModel(
  files: VFile[],
  mainPath: string,
  opts: { name?: string; select?: boolean; stage?: boolean } = {},
): Promise<string> {
  const engine = await whenEngine();
  const refs = await registerFiles(files);
  const info = await engine.loadModel(files, mainPath, { name: opts.name });
  const stage = opts.stage ?? looksLikeStage(info.name, info.fileName, mainPath);
  if (stage) {
    // Scenery: no hair/cloth simulation needed, and it must never steal the selection.
    engine.setModelStage(info.id, true);
    engine.setModelPhysics(info.id, false);
  }
  const state = engine.getModelState(info.id)!;
  const model: ModelUI = {
    id: info.id,
    info,
    name: info.name,
    visible: true,
    physics: !stage,
    stage,
    transform: state.transform,
    materials: state.materials,
    morphs: {},
    motion: null,
    motionRef: null,
    mainPath,
    files: refs,
  };
  set((s) => ({
    models: [...s.models, model],
    selectedModelId: opts.select === false || stage ? s.selectedModelId : info.id,
    selectedBone: null,
  }));
  engine.setActiveModel(get().selectedModelId);
  markDirty();
  toast(
    'success',
    stage
      ? `Loaded ${info.name} as a stage (switch off “Stage” in its panel if it's a character)`
      : `Loaded ${info.name}`,
  );
  return info.id;
}

/** Re-create a model from a saved project entry. */
export async function restoreModel(pm: ProjectModel): Promise<void> {
  const engine = await whenEngine();
  const files = await resolveRefs(pm.files);
  const info = await engine.loadModel(files, pm.mainPath, { id: pm.id, name: pm.name, state: pm.state });
  const state = engine.getModelState(info.id)!;
  const model: ModelUI = {
    id: info.id,
    info,
    name: pm.name,
    visible: pm.state.visible,
    physics: pm.state.physics,
    stage: !!pm.state.stage,
    transform: state.transform,
    materials: state.materials,
    morphs: { ...pm.state.morphs },
    motion: null,
    motionRef: null,
    mainPath: pm.mainPath,
    files: pm.files,
  };
  set((s) => ({ models: [...s.models, model] }));
  engine.setModelPhysics(info.id, pm.state.physics);
  if (pm.motion) {
    const motion = await engine.loadMotion(info.id, await resolveRef(pm.motion));
    updateModel(info.id, { motion, motionRef: pm.motion });
  }
}

export function removeModel(id: string): void {
  engineOrNull()?.removeModel(id);
  set((s) => {
    const models = s.models.filter((m) => m.id !== id);
    return {
      models,
      selectedModelId: s.selectedModelId === id ? (models[0]?.id ?? null) : s.selectedModelId,
      selectedBone: s.selectedModelId === id ? null : s.selectedBone,
    };
  });
  useHistory.getState().clear();
  markDirty();
}

export async function duplicateModel(id: string): Promise<void> {
  const src = get().models.find((m) => m.id === id);
  const engine = engineOrNull();
  if (!src || !engine) return;
  const files = await resolveRefs(src.files);
  const newId = await addModel(files, src.mainPath, { name: `${src.name} (copy)`, stage: src.stage });
  const t = src.transform;
  setTransform(newId, { ...t, position: [t.position[0] + 8, t.position[1], t.position[2]] }, false);
  setModelPhysics(newId, src.physics);
  if (src.motionRef) {
    const motion = await engine.loadMotion(newId, await resolveRef(src.motionRef));
    updateModel(newId, { motion, motionRef: src.motionRef });
  }
}

export function renameModel(id: string, name: string): void {
  updateModel(id, { name: name.trim() || 'Model' });
}

export function selectModel(id: string | null): void {
  if (get().selectedModelId === id) return;
  engineOrNull()?.selectBone(null, null);
  engineOrNull()?.setActiveModel(id);
  set({ selectedModelId: id, selectedBone: null });
}

/** Tap in the viewport: select the bone/model under the finger (or clear the bone selection). */
export function tapSelect(x: number, y: number, allowDeselect = true): void {
  const engine = engineOrNull();
  if (!engine) return;
  const hit = engine.pickAt(x, y);
  if (!hit) {
    if (allowDeselect && get().selectedBone !== null) selectBone(null);
    return;
  }
  if (!hit.modelId) return; // gizmo handle
  if (hit.modelId !== get().selectedModelId) selectModel(hit.modelId);
  if (hit.bone !== null) {
    selectBone(hit.bone);
    const name = get().models.find((m) => m.id === hit.modelId)?.info.bones[hit.bone]?.name;
    if (name) toast('info', `Bone: ${name}`, 1200);
  }
}

/** Undo entry for model transforms changed by the on-screen scale gizmo. */
export function recordTransformEdit(modelId: string, before: TransformState, after: TransformState): void {
  updateModel(modelId, { transform: after });
  useHistory.getState().push({
    label: 'Scale model',
    undo: () => setTransform(modelId, before, false),
    redo: () => setTransform(modelId, after, false),
  });
}

export function setModelVisible(id: string, visible: boolean): void {
  engineOrNull()?.setModelVisible(id, visible);
  updateModel(id, { visible });
}

/** Turn a model into stage scenery or back into a performer. */
export function setModelStage(id: string, stage: boolean): void {
  const engine = engineOrNull();
  engine?.setModelStage(id, stage);
  updateModel(id, { stage });
  if (stage) {
    setModelPhysics(id, false);
    if (get().selectedModelId === id) selectModel(performerId() ?? null);
  }
  markDirty();
}

export function setModelPhysics(id: string, physics: boolean): void {
  engineOrNull()?.setModelPhysics(id, physics);
  updateModel(id, { physics });
}

export function setTransform(id: string, transform: TransformState, record = true): void {
  const prev = get().models.find((m) => m.id === id)?.transform;
  engineOrNull()?.setModelTransform(id, transform);
  updateModel(id, { transform });
  if (record && prev) {
    useHistory.getState().push({
      label: 'Transform',
      key: `transform:${id}`,
      undo: () => setTransform(id, prev, false),
      redo: () => setTransform(id, transform, false),
    });
  }
}

export function setMaterial(
  id: string,
  index: number,
  patch: Partial<{ visible: boolean; outline: boolean; alpha: number }>,
): void {
  engineOrNull()?.setMaterialState(id, index, patch);
  updateModel(id, (m) => ({ materials: m.materials.map((x, i) => (i === index ? { ...x, ...patch } : x)) }));
}

export function setMorph(id: string, name: string, weight: number, record = true): void {
  const prev = get().models.find((m) => m.id === id)?.morphs[name] ?? 0;
  engineOrNull()?.setMorph(id, name, weight);
  updateModel(id, (m) => ({ morphs: { ...m.morphs, [name]: weight } }));
  if (record) {
    useHistory.getState().push({
      label: `Morph ${name}`,
      key: `morph:${id}:${name}`,
      undo: () => setMorph(id, name, prev, false),
      redo: () => setMorph(id, name, weight, false),
    });
  }
}

export function resetMorphs(id: string): void {
  const prev = { ...(get().models.find((m) => m.id === id)?.morphs ?? {}) };
  const apply = (weights: Record<string, number>): void => {
    const e = engineOrNull();
    e?.resetMorphs(id);
    for (const [k, v] of Object.entries(weights)) e?.setMorph(id, k, v);
    updateModel(id, { morphs: { ...weights } });
  };
  apply({});
  useHistory.getState().push({ label: 'Reset morphs', undo: () => apply(prev), redo: () => apply({}) });
}

/** Re-read morph weights from the engine (after scripts or pose loads change them). */
export function syncMorphsFromEngine(id: string): void {
  const weights = engineOrNull()?.getMorphWeights(id);
  if (!weights) return;
  updateModel(id, { morphs: Object.fromEntries(Object.entries(weights).filter(([, v]) => v !== 0)) });
}

// ---------------------------------------------------------------- bones / pose

export function selectBone(bone: number | null): void {
  const id = get().selectedModelId;
  engineOrNull()?.selectBone(id, bone);
  set({ selectedBone: bone });
}

export function setGizmoMode(mode: GizmoMode): void {
  engineOrNull()?.setGizmoMode(mode);
  set({ gizmoMode: mode });
}

export function recordBoneEdit(
  modelId: string,
  bone: number,
  before: BoneLocalTransform,
  after: BoneLocalTransform,
): void {
  useHistory.getState().push({
    label: 'Pose bone',
    undo: () => engineOrNull()?.setBoneTransform(modelId, bone, before),
    redo: () => engineOrNull()?.setBoneTransform(modelId, bone, after),
  });
  markDirty();
}

function poseSnapshot(id: string): PoseData | null {
  return engineOrNull()?.getPose(id) ?? null;
}

export function resetPose(id: string): void {
  const before = poseSnapshot(id);
  engineOrNull()?.resetPose(id);
  syncMorphsFromEngine(id);
  if (before) {
    useHistory.getState().push({
      label: 'Reset pose',
      undo: () => {
        engineOrNull()?.applyPose(id, before);
        syncMorphsFromEngine(id);
      },
      redo: () => {
        engineOrNull()?.resetPose(id);
        syncMorphsFromEngine(id);
      },
    });
  }
}

export function applyPose(id: string, pose: PoseData): void {
  const before = poseSnapshot(id);
  engineOrNull()?.pause();
  engineOrNull()?.applyPose(id, pose);
  syncMorphsFromEngine(id);
  if (before) {
    useHistory.getState().push({
      label: 'Load pose',
      undo: () => {
        engineOrNull()?.applyPose(id, before);
        syncMorphsFromEngine(id);
      },
      redo: () => {
        engineOrNull()?.applyPose(id, pose);
        syncMorphsFromEngine(id);
      },
    });
  }
}

export function isPoseData(v: unknown): v is PoseData {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Partial<PoseData>;
  return p.version === 1 && Array.isArray(p.bones) && typeof p.morphs === 'object' && p.morphs !== null;
}

export async function loadPoseFile(id: string, blob: Blob): Promise<void> {
  try {
    const json: unknown = JSON.parse(await blob.text());
    if (!isPoseData(json)) throw new Error('Not an MMD Studio pose file');
    applyPose(id, json);
    toast('success', `Applied pose (${json.bones.length} bones)`);
  } catch (e) {
    toast('error', `Could not load pose: ${errMsg(e)}`);
  }
}

export function exportPose(id: string): Blob | null {
  const pose = poseSnapshot(id);
  return pose ? new Blob([JSON.stringify(pose, null, 2)], { type: 'application/json' }) : null;
}

// ---------------------------------------------------------------- motion & media

export async function assignMotion(modelId: string, file: VFile | null): Promise<void> {
  const engine = await whenEngine();
  try {
    const ref = file ? await registerFile(file) : null;
    const motion = await engine.loadMotion(modelId, file);
    updateModel(modelId, { motion, motionRef: ref });
    if (file)
      toast(
        'success',
        `Motion ${basename(file.path)} → ${get().models.find((m) => m.id === modelId)?.name ?? 'model'}`,
      );
  } catch (e) {
    toast('error', `Motion failed: ${errMsg(e)}`);
  }
}

export async function setCameraMotion(file: VFile | null): Promise<void> {
  const engine = await whenEngine();
  try {
    const ref = file ? await registerFile(file) : null;
    const info = await engine.loadCameraMotion(file);
    set({ cameraMotion: info && ref ? { info, ref } : null });
    if (info) setCameraMode('vmd');
    markDirty();
  } catch (e) {
    toast('error', `Camera motion failed: ${errMsg(e)}`);
  }
}

export async function setAudio(file: VFile | null): Promise<void> {
  const engine = await whenEngine();
  try {
    const ref = file ? await registerFile(file) : null;
    const info = await engine.loadAudio(file);
    set({ audio: info && ref ? { info, ref } : null });
    if (info) toast('success', `Audio ${info.name} (${info.duration.toFixed(1)}s)`);
    markDirty();
  } catch (e) {
    toast('error', `Audio failed: ${errMsg(e)}`);
  }
}

export function setAudioOffset(ms: number): void {
  engineOrNull()?.setAudioOffset(ms);
  set({ audioOffsetMs: ms });
  markDirty();
}

export function setVolume(v: number): void {
  engineOrNull()?.setVolume(v);
  set({ volume: v });
  markDirty();
}

export async function setHdr(file: VFile | null): Promise<void> {
  const engine = await whenEngine();
  try {
    const ref: FileRef | null = file ? await registerFile(file) : null;
    await engine.setHdrEnvironment(file);
    set({ hdrRef: ref });
    if (file)
      updateSettings((s) => {
        s.background.mode = 'hdr';
        s.background.hdrName = stripExt(basename(file.path));
      });
    else
      updateSettings((s) => {
        s.background.hdrName = null;
        if (s.background.mode === 'hdr') s.background.mode = 'gradient';
      });
  } catch (e) {
    toast('error', `Environment failed: ${errMsg(e)}`);
  }
}

// ---------------------------------------------------------------- playback

export function togglePlay(): void {
  const e = engineOrNull();
  if (!e) return;
  if (e.getPlayback().playing) e.pause();
  else void e.play();
}

export function setSpeed(speed: number): void {
  engineOrNull()?.setSpeed(speed);
  markDirty();
}

export function setLoop(loop: boolean): void {
  engineOrNull()?.setLoop(loop);
  markDirty();
}

// ---------------------------------------------------------------- scene & camera

/** Mutate settings through an updater (receives a draft copy) and push them to the engine. */
export function updateSettings(updater: (draft: SceneSettings) => void): void {
  const draft = structuredClone(get().settings);
  updater(draft);
  set({ settings: draft });
  engineOrNull()?.applySettings(draft);
  markDirty();
}

export function setCameraMode(mode: CameraMode): void {
  const e = engineOrNull();
  if (!e) return;
  e.setCameraMode(mode);
  set({ camera: e.getCameraState() });
}

export function setFov(fov: number): void {
  const e = engineOrNull();
  if (!e) return;
  e.setFov(fov);
  set({ camera: { ...get().camera, fov } });
}

export function cameraPreset(p: CameraPreset): void {
  engineOrNull()?.applyCameraPreset(p, get().selectedModelId ?? undefined);
}

export function setFollow(follow: { modelId: string; bone: string } | null): void {
  engineOrNull()?.setFollow(follow);
  set({ camera: { ...get().camera, follow } });
}

export function focusSelected(): void {
  engineOrNull()?.focusModel(selectedModel()?.id);
}

export function focusDofOnHead(): void {
  const d = engineOrNull()?.focusDofOnHead(get().selectedModelId ?? undefined);
  if (d === null || d === undefined) {
    toast('info', 'Load a model to focus on.');
    return;
  }
  updateSettings((s) => {
    s.postfx.dof = true;
    s.postfx.dofFocusDistance = d;
  });
}

export function undo(): void {
  const e = useHistory.getState().undo();
  if (e) toast('info', `Undo: ${e.label}`, 1500);
}

export function redo(): void {
  const e = useHistory.getState().redo();
  if (e) toast('info', `Redo: ${e.label}`, 1500);
}
