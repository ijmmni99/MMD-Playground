import { DEFAULT_CAMERA, deviceDefaultSettings } from '@/engine/defaults';
import { isCoarsePointer } from '@/lib/device';
import { cacheBlob, getAsset, resolveRef } from '@/lib/assets';
import * as store from '@/lib/db';
import {
  createEmptyProject,
  exportProjectZip,
  importProjectZip,
  PROJECT_VERSION,
  type ProjectDoc,
  type ProjectModel,
} from '@/lib/project';
import { engineOrNull, whenEngine } from '@/store/engineRef';
import { useHistory } from '@/store/history';
import { initialPlayback, studio, toast, useStudio } from '@/store/studio';
import { registerProjectImporter, restoreModel } from '@/store/actions';
import { buildVideo2VmdDoc, restoreVideo2Vmd } from '@/features/video2vmd/actions';
import { buildMotionEditorDoc, restoreMotionEditor } from '@/features/motion-editor/persist';

const { get, set } = studio;
const LAST_PROJECT = 'lastProjectId';
const AUTOSAVE_MS = 1500;

/** Snapshot the current studio state as a project document. */
export function buildProjectDoc(): ProjectDoc {
  const s = get();
  const engine = engineOrNull();
  const pb = engine?.getPlayback() ?? s.playback;
  const models: ProjectModel[] = s.models.map((m) => {
    const rt = engine?.getModelState(m.id);
    return {
      id: m.id,
      name: m.name,
      mainPath: m.mainPath,
      files: m.files,
      motion: m.motionRef,
      state: {
        visible: m.visible,
        physics: m.physics,
        stage: m.stage,
        transform: m.transform,
        materials: m.materials,
        morphs: rt?.morphs ?? m.morphs,
      },
    };
  });
  return {
    version: PROJECT_VERSION,
    id: s.project.id,
    name: s.project.name,
    createdAt: s.project.createdAt,
    updatedAt: Date.now(),
    settings: s.settings,
    camera: { ...(engine?.getCameraState() ?? s.camera), follow: null },
    playback: { frame: pb.frame, speed: pb.speed, loop: pb.loop },
    audio: s.audio ? { file: s.audio.ref, offsetMs: s.audioOffsetMs, volume: s.volume } : null,
    cameraMotion: s.cameraMotion?.ref ?? null,
    hdr: s.hdrRef,
    models,
    video2vmd: buildVideo2VmdDoc(),
    motionEditor: buildMotionEditorDoc(),
  };
}

let saving: Promise<void> | null = null;

export async function saveNow(opts: { thumbnail?: boolean; announce?: boolean } = {}): Promise<void> {
  if (saving) await saving;
  const run = async (): Promise<void> => {
    const doc = buildProjectDoc();
    const existing = await store.loadProject(doc.id);
    doc.thumbnail = existing?.thumbnail;
    if (opts.thumbnail && doc.models.length) {
      try {
        const blob = await engineOrNull()?.screenshot({ width: 320, height: 180, transparent: false });
        if (blob) doc.thumbnail = await blobToDataUrl(blob);
      } catch {
        /* thumbnail is optional */
      }
    }
    await store.saveProject(doc);
    await store.setMeta(LAST_PROJECT, doc.id);
    set((s) => ({ project: { ...s.project, dirty: false, lastSavedAt: Date.now() } }));
    if (opts.announce) toast('success', 'Project saved');
  };
  saving = run().finally(() => (saving = null));
  return saving;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Debounced autosave whenever the project is dirty. */
export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsub = useStudio.subscribe((s, prev) => {
    if (s.project.dirty && (!prev.project.dirty || s !== prev)) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (get().project.dirty && !get().project.restoring) {
          saveNow().catch((e) =>
            toast('error', `Autosave failed: ${e instanceof Error ? e.message : String(e)}`),
          );
        }
      }, AUTOSAVE_MS);
    }
  });
  const onHide = (): void => {
    if (get().project.dirty) void saveNow();
  };
  window.addEventListener('pagehide', onHide);
  return () => {
    unsub();
    window.removeEventListener('pagehide', onHide);
    if (timer) clearTimeout(timer);
  };
}

/** Remove every model and media item from the scene. */
async function clearScene(): Promise<void> {
  const engine = await whenEngine();
  engine.pause();
  for (const id of engine.listModels()) engine.removeModel(id);
  await engine.loadCameraMotion(null);
  await engine.loadAudio(null);
  await engine.setHdrEnvironment(null);
  engine.selectBone(null, null);
  useHistory.getState().clear();
  set({
    models: [],
    selectedModelId: null,
    selectedBone: null,
    cameraMotion: null,
    audio: null,
    hdrRef: null,
    audioOffsetMs: 0,
    volume: 1,
    playback: initialPlayback,
  });
}

/** Load a project document into the studio. */
export async function openProject(doc: ProjectDoc): Promise<void> {
  const engine = await whenEngine();
  set((s) => ({ project: { ...s.project, restoring: true } }));
  const taskId = `open-${doc.id}`;
  set((s) => ({ tasks: { ...s.tasks, [taskId]: { label: `Opening ${doc.name}…`, progress: 0 } } }));
  try {
    await clearScene();
    set({ settings: doc.settings, camera: doc.camera });
    engine.applySettings(doc.settings);
    const failures: string[] = [];
    for (const [i, m] of doc.models.entries()) {
      set((s) => ({
        tasks: {
          ...s.tasks,
          [taskId]: { label: `Restoring ${m.name}…`, progress: i / Math.max(1, doc.models.length) },
        },
      }));
      try {
        await restoreModel(m);
      } catch (e) {
        failures.push(`${m.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (doc.cameraMotion) {
      try {
        const info = await engine.loadCameraMotion(await resolveRef(doc.cameraMotion));
        if (info) set({ cameraMotion: { info, ref: doc.cameraMotion } });
      } catch (e) {
        failures.push(`camera motion: ${String(e)}`);
      }
    }
    if (doc.audio) {
      try {
        const info = await engine.loadAudio(await resolveRef(doc.audio.file));
        engine.setAudioOffset(doc.audio.offsetMs);
        engine.setVolume(doc.audio.volume);
        if (info)
          set({
            audio: { info, ref: doc.audio.file },
            audioOffsetMs: doc.audio.offsetMs,
            volume: doc.audio.volume,
          });
      } catch (e) {
        failures.push(`audio: ${String(e)}`);
      }
    }
    if (doc.hdr) {
      try {
        await engine.setHdrEnvironment(await resolveRef(doc.hdr));
        set({ hdrRef: doc.hdr });
      } catch (e) {
        failures.push(`environment: ${String(e)}`);
      }
    }
    engine.applySettings(doc.settings);
    engine.setCameraState(doc.camera);
    engine.setSpeed(doc.playback.speed);
    engine.setLoop(doc.playback.loop);
    engine.seek(doc.playback.frame);
    set({
      selectedModelId: get().models[0]?.id ?? null,
      camera: engine.getCameraState(),
      project: {
        id: doc.id,
        name: doc.name,
        createdAt: doc.createdAt,
        dirty: false,
        lastSavedAt: doc.updatedAt,
        restoring: false,
      },
    });
    engine.setActiveModel(get().selectedModelId);
    try {
      await restoreMotionEditor(doc.motionEditor);
    } catch (e) {
      failures.push(`motion editor: ${String(e)}`);
    }
    try {
      await restoreVideo2Vmd(doc.video2vmd);
    } catch (e) {
      failures.push(`video to VMD: ${String(e)}`);
    }
    set((s) => ({ project: { ...s.project, dirty: false } }));
    await store.setMeta(LAST_PROJECT, doc.id);
    if (failures.length) toast('warning', `Some items could not be restored: ${failures.join('; ')}`, 10000);
  } finally {
    set((s) => {
      const tasks = { ...s.tasks };
      delete tasks[taskId];
      return { tasks, project: { ...s.project, restoring: false } };
    });
  }
}

export async function newProject(): Promise<void> {
  if (get().project.dirty) await saveNow();
  const doc = createEmptyProject();
  await openProject({
    ...doc,
    settings: deviceDefaultSettings(isCoarsePointer()),
    camera: structuredClone(DEFAULT_CAMERA),
  });
  await store.saveProject(doc);
}

export async function openProjectById(id: string): Promise<void> {
  if (get().project.dirty) await saveNow();
  const doc = await store.loadProject(id);
  if (!doc) {
    toast('error', 'Project not found');
    return;
  }
  await openProject(doc);
  toast('success', `Opened ${doc.name}`);
}

export function renameProject(name: string): void {
  set((s) => ({ project: { ...s.project, name: name.trim() || 'Untitled project', dirty: true } }));
}

export async function deleteProjectById(id: string): Promise<void> {
  await store.deleteProject(id);
  if (id === get().project.id) await newProject();
}

/** Restore the last opened project on startup (or start a fresh one). */
/** True when the last session left a project with content worth restoring right away. */
export async function hasRestorableProject(): Promise<boolean> {
  try {
    const id = await store.getMeta<string>(LAST_PROJECT);
    const doc = id ? await store.loadProject(id) : undefined;
    return !!doc && (doc.models.length > 0 || !!doc.audio || !!doc.cameraMotion || !!doc.video2vmd?.pose);
  } catch {
    return false;
  }
}

export async function restoreLastProject(): Promise<void> {
  try {
    const id = await store.getMeta<string>(LAST_PROJECT);
    const doc = id ? await store.loadProject(id) : undefined;
    if (doc) {
      await openProject(doc);
      if (doc.models.length) toast('info', `Restored “${doc.name}”`);
      return;
    }
  } catch (e) {
    toast('warning', `Could not restore last project: ${e instanceof Error ? e.message : String(e)}`);
  }
  const doc = createEmptyProject();
  set((s) => ({ project: { ...s.project, id: doc.id, name: doc.name, createdAt: doc.createdAt } }));
}

export async function exportProjectArchive(): Promise<{ blob: Blob; fileName: string }> {
  await saveNow();
  const doc = buildProjectDoc();
  const blob = await exportProjectZip(doc, getAsset);
  const safe = doc.name.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60) || 'project';
  return { blob, fileName: `${safe}.mmdstudio.zip` };
}

export async function importProjectArchive(blob: Blob): Promise<void> {
  const { doc, blobs } = await importProjectZip(blob);
  for (const [id, b] of blobs) {
    cacheBlob(id, b);
    await store.putBlob(id, b);
  }
  if (get().project.dirty) await saveNow();
  await store.saveProject(doc);
  await openProject(doc);
  toast('success', `Imported project “${doc.name}”`);
}

registerProjectImporter(importProjectArchive);
