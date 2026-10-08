import type { VFile } from '@/engine/types';
import { pickFiles } from '@/features/app/filePickers';
import {
  addClip,
  addSource,
  deleteClips,
  duplicateClip,
  ensureTrack,
  findClip,
  moveClip,
  newClip,
  pasteClips,
  reorderClip,
  setJoin,
  setLoop,
  setMirror,
  setSpeed,
  setText,
  setVolume,
  splitClip,
  trackClips,
  trackEnd,
  trimClip,
} from '@/lib/clips/ops';
import { cueFrames, parseLrc, parseSrt } from '@/lib/clips/subtitles';
import {
  clipEnd,
  DEFAULT_TEXT,
  type Clip,
  type Join,
  type TextSpec,
  type TimelineDoc,
} from '@/lib/clips/types';
import { setAudio } from '@/store/actions';
import { ct } from '@/store/clipTimeline';
import { engineOrNull } from '@/store/engineRef';
import { useHistory } from '@/store/history';
import { markDirty, studio, toast, useStudio } from '@/store/studio';
import './runtime';
import {
  addAudioSource,
  addClipSource,
  addVmdSource,
  facePresetClip,
  FACE_PRESETS,
  type FacePreset,
} from './sources';

export const playhead = (): number => Math.round(engineOrNull()?.getPlayback().frame ?? 0);

function putDoc(doc: TimelineDoc, selection?: string[]): void {
  ct.set({ doc, ...(selection ? { selection } : {}) });
  markDirty();
}

/** Apply an edit as one undoable step (same `key` within a short time = one step, e.g. a drag). */
export function commit(
  label: string,
  fn: (doc: TimelineDoc) => TimelineDoc | { doc: TimelineDoc; selection?: string[] },
  key?: string,
): void {
  const before = ct.get().doc;
  const selBefore = ct.get().selection;
  const r = fn(before);
  const after = 'tracks' in r ? r : r.doc;
  const sel = 'tracks' in r ? undefined : r.selection;
  if (after === before) return;
  putDoc(after, sel);
  const selAfter = sel ?? ct.get().selection;
  useHistory.getState().push({
    label,
    key,
    undo: () => putDoc(before, selBefore),
    redo: () => putDoc(after, selAfter),
  });
}

export function openClips(): void {
  ct.set({ open: true });
  // What's already loaded (dances, camera, music) shows up as clips, so the timeline starts from it.
  void importLoaded().then(() => ct.set((s) => ({ sessionStart: s.sessionStart ?? s.doc })));
  // The keyframe editor and the clip view share the dock.
  void import('@/features/motion-editor/actions').then((a) => a.closeEditor());
}

export function closeClips(): void {
  ct.set({ open: false });
}

/** Back to the document as it was when this session started. */
export function revertTimeline(): void {
  const start = ct.get().sessionStart;
  if (start) commit('Revert timeline', () => ({ doc: start, selection: [] }));
}

/**
 * Put motions loaded outside the timeline onto it: each model's dance (when it has no dance track yet),
 * the camera motion and the music. Not an undo step: it mirrors what is already playing.
 */
let importing: Promise<void> | null = null;
export function importLoaded(): Promise<void> {
  importing ??= (async () => {
    const st = studio.get();
    const { resolveRef } = await import('@/lib/assets');
    let doc = ct.get().doc;
    const has = (kind: string, modelId?: string): boolean =>
      doc.tracks.some((t) => t.kind === kind && (modelId === undefined || t.modelId === modelId));
    for (const m of st.models) {
      if (m.stage || !m.motionRef || has('dance', m.id)) continue;
      try {
        const src = await addVmdSource(await resolveRef(m.motionRef));
        if (src.kind !== 'motion') continue;
        const t = ensureTrack(addSource(doc, src), 'dance', m.id, trackName('dance', m.id));
        doc = addClip(t.doc, newClip(t.track.id, src, 0));
      } catch {
        /* unreadable: leave it off the timeline */
      }
    }
    if (st.cameraMotion && !has('camera')) {
      try {
        const src = await addVmdSource(await resolveRef(st.cameraMotion.ref));
        const t = ensureTrack(addSource(doc, src), 'camera');
        doc = addClip(t.doc, newClip(t.track.id, src, 0));
      } catch {
        /* ignore */
      }
    }
    if (st.audio && !has('audio')) {
      try {
        const src = await addAudioSource(await resolveRef(st.audio.ref), st.audio.info.duration);
        const t = ensureTrack(addSource(doc, src), 'audio');
        doc = addClip(
          t.doc,
          newClip(t.track.id, src, Math.round((st.audioOffsetMs / 1000) * 30), { volume: 1 }),
        );
      } catch {
        /* ignore */
      }
    }
    if (doc !== ct.get().doc) {
      // Keep edits made meanwhile: only add tracks / clips / sources that aren't there yet.
      const cur = ct.get().doc;
      const ids = (xs: { id: string }[]) => new Set(xs.map((x) => x.id));
      const [tIds, cIds, sIds] = [ids(cur.tracks), ids(cur.clips), ids(cur.sources)];
      putDoc({
        ...cur,
        tracks: [...cur.tracks, ...doc.tracks.filter((x) => !tIds.has(x.id))],
        clips: [...cur.clips, ...doc.clips.filter((x) => !cIds.has(x.id))],
        sources: [...cur.sources, ...doc.sources.filter((x) => !sIds.has(x.id))],
      });
    }
  })().finally(() => {
    importing = null;
  });
  return importing;
}

/** Face clips drive standard MMD morphs; warn when the model has none of them. */
function warnNoFaceMorphs(modelId: string, names: string[]): void {
  const model = studio.get().models.find((m) => m.id === modelId);
  if (!model) return;
  const have = new Set(model.info.morphs.map((x) => x.name));
  if (!names.some((n) => have.has(n)))
    toast(
      'warning',
      `${model.name} has no matching facial morphs (${names.slice(0, 3).join(', ')}…), so face clips won't change it.`,
      8000,
    );
}

const selectedModelId = (): string | null => {
  const st = studio.get();
  const m = st.models.find((x) => x.id === st.selectedModelId && !x.stage) ?? st.models.find((x) => !x.stage);
  return m?.id ?? null;
};

// ---------------------------------------------------------------- adding

/** Add VMD files: body motions → the model's dance track, camera → camera track, face → face track. */
export async function addMotionFiles(files: VFile[], modelId = selectedModelId()): Promise<void> {
  await importLoaded();
  for (const file of files) {
    try {
      const src = await addVmdSource(file);
      commit(`Add ${src.name}`, (doc) => {
        let d = addSource(doc, src);
        const kind = src.kind === 'camera' ? 'camera' : src.kind === 'face' ? 'face' : 'dance';
        if (kind !== 'camera' && !modelId) {
          toast('warning', 'Load a model first, then add its dances.');
          return doc;
        }
        const t = ensureTrack(d, kind, kind === 'camera' ? undefined : modelId!, trackName(kind, modelId));
        d = t.doc;
        const clip = newClip(t.track.id, src, trackEnd(d, t.track.id));
        return { doc: addClip(d, clip), selection: [clip.id] };
      });
    } catch (e) {
      toast('error', `Could not read ${file.path}: ${(e as Error).message}`);
    }
  }
}

function trackName(kind: string, modelId: string | null | undefined): string {
  const model = studio.get().models.find((m) => m.id === modelId)?.name;
  const base = { dance: 'Dance', face: 'Face', camera: 'Camera', audio: 'Audio', text: 'Text' }[kind] ?? kind;
  return model && (kind === 'dance' || kind === 'face') ? `${base} · ${model}` : base;
}

export async function pickAndAddMotion(): Promise<void> {
  const files = await pickFiles('motion', true);
  if (files.length) await addMotionFiles(files);
}

export async function addFacePreset(preset: FacePreset, modelId = selectedModelId()): Promise<void> {
  if (!modelId) {
    toast('warning', 'Load a model first.');
    return;
  }
  await importLoaded();
  const label = FACE_PRESETS.find((p) => p.id === preset)!.label;
  const faceClip = facePresetClip(preset);
  warnNoFaceMorphs(
    modelId,
    faceClip.morphs.map((m) => m.name),
  );
  const src = await addClipSource(faceClip, `${label}.vmd`, 'face');
  commit(`Add face: ${label}`, (doc) => {
    const t = ensureTrack(addSource(doc, src), 'face', modelId, trackName('face', modelId));
    const clip = newClip(t.track.id, src, playhead(), { join: { fade: 4, root: 'origin', cut: true } });
    return { doc: addClip(t.doc, clip), selection: [clip.id] };
  });
}

/** Add an audio file: it becomes the studio's audio, and a clip on the audio track. */
export async function addAudioFile(file?: VFile): Promise<void> {
  const f = file ?? (await pickFiles('audio'))[0];
  if (!f) return;
  await setAudio(f);
  const info = studio.get().audio?.info;
  if (!info) return;
  const src = await addAudioSource(f, info.duration);
  commit(`Add ${src.name}`, (doc) => {
    const t = ensureTrack(addSource(doc, src), 'audio');
    // One audio file plays at a time: earlier audio clips are replaced.
    const d = { ...t.doc, clips: t.doc.clips.filter((c) => c.trackId !== t.track.id) };
    const clip = newClip(t.track.id, src, 0, { volume: 1 });
    return { doc: addClip(d, clip), selection: [clip.id] };
  });
}

const HEAD_BONES = ['頭', 'head', 'Head'];

/** Offset from the head bone that clears the top of the head (bones stop below the skull). */
function aboveHead(modelId: string, head: string): number {
  const pos = engineOrNull()?.getBoneWorldPositions(modelId);
  const h = pos?.[head];
  if (!pos || !h) return 3.5;
  const ys = Object.values(pos).map((p) => p[1]);
  const height = Math.max(...ys) - Math.min(...ys);
  return Math.round(Math.max(3, Math.max(...ys) - h[1] + height * 0.12 + DEFAULT_TEXT.size * 0.6) * 10) / 10;
}

export function addTextClip(spec: Partial<TextSpec> = {}, at = playhead(), length = 120): string {
  let id = '';
  commit('Add text', (doc) => {
    const t = ensureTrack(doc, 'text');
    const modelId = selectedModelId() ?? undefined;
    // With a model: float above its head (bone-attached, facing the camera).
    const head = modelId
      ? studio
          .get()
          .models.find((m) => m.id === modelId)
          ?.info.bones.find((b) => HEAD_BONES.includes(b.name))?.name
      : undefined;
    const attach: Partial<TextSpec> = head
      ? { modelId, bone: head, placement: 'bone', position: [0, aboveHead(modelId!, head), 0] }
      : {};
    const clip = newClip(t.track.id, null, at, {
      length,
      text: { ...DEFAULT_TEXT, ...attach, ...spec },
      join: { fade: 0, root: 'origin', cut: true },
    });
    id = clip.id;
    return { doc: addClip(t.doc, clip), selection: [clip.id] };
  });
  return id;
}

/** Import .srt / .lrc: one caption clip per line with the shared subtitle style. */
export async function importSubtitles(file?: VFile): Promise<number> {
  const f = file ?? (await pickFiles('.srt,.lrc,text/plain'))[0];
  if (!f) return 0;
  const text = await f.blob.text();
  const cues = /\.lrc$/i.test(f.path) || /^\s*\[\d+:\d/m.test(text) ? parseLrc(text) : parseSrt(text);
  if (!cues.length) {
    toast('warning', 'No timed lines found in that file.');
    return 0;
  }
  commit(`Import ${cues.length} subtitles`, (doc) => {
    let d = doc;
    // Subtitles get their own text track.
    const track = {
      id: `t${Date.now().toString(36)}`,
      kind: 'text' as const,
      name: `Subtitles · ${f.path.split('/').pop()}`,
    };
    d = { ...d, tracks: [...d.tracks, track] };
    const ids: string[] = [];
    for (const c of cues) {
      const { start, length } = cueFrames(c);
      const clip = newClip(track.id, null, start, {
        length,
        text: { ...d.textStyle, content: c.text },
        join: { fade: 0, root: 'origin', cut: true },
      });
      ids.push(clip.id);
      d = addClip(d, clip);
    }
    return { doc: d, selection: ids.slice(0, 1) };
  });
  toast('success', `Imported ${cues.length} timed lines`);
  return cues.length;
}

/** Restyle every subtitle clip (and the shared style). */
export function setSubtitleStyle(patch: Partial<TextSpec>): void {
  commit('Subtitle style', (doc) => {
    const subTracks = new Set(doc.tracks.filter((t) => t.name.startsWith('Subtitles')).map((t) => t.id));
    return {
      ...doc,
      textStyle: { ...doc.textStyle, ...patch },
      clips: doc.clips.map((c) =>
        c.text && subTracks.has(c.trackId) ? { ...c, text: { ...c.text, ...patch } } : c,
      ),
    };
  });
}

// ---------------------------------------------------------------- clip operations

const sel = (): string[] => ct.get().selection;
const one = (): Clip | undefined => findClip(ct.get().doc, sel()[0] ?? '');

export function select(ids: string[]): void {
  ct.set({ selection: ids });
}

export function splitAtPlayhead(): void {
  const f = playhead();
  const doc = ct.get().doc;
  const under = (c: Clip): boolean => f > c.startFrame && f < clipEnd(c);
  // Selected clips under the playhead; with none of those, every clip under it.
  const picked = sel()
    .map((id) => findClip(doc, id))
    .filter((c): c is Clip => !!c && under(c));
  const targets = (picked.length ? picked : doc.clips.filter(under)).map((c) => c.id);
  if (!targets.length) return toast('info', 'Put the playhead over a clip to split it.');
  commit('Split', (d) => {
    let out = d;
    const ids: string[] = [];
    for (const id of targets) {
      const r = splitClip(out, id, f);
      out = r.doc;
      ids.push(r.ids[r.ids.length - 1]);
    }
    return { doc: out, selection: ids };
  });
}

export function deleteSelected(): void {
  const ids = sel();
  if (ids.length) commit('Delete clips', (d) => ({ doc: deleteClips(d, ids), selection: [] }));
}

export function duplicateSelected(): void {
  const ids = sel();
  if (!ids.length) return;
  commit('Duplicate', (d) => {
    let out = d;
    const copies: string[] = [];
    for (const id of ids) {
      const r = duplicateClip(out, id);
      out = r.doc;
      if (r.id) copies.push(r.id);
    }
    return { doc: out, selection: copies };
  });
}

export function copySelected(): void {
  const doc = ct.get().doc;
  ct.set({
    clipboard: sel()
      .map((id) => findClip(doc, id))
      .filter((c): c is Clip => !!c),
  });
}

export function pasteAtPlayhead(): void {
  const cb = ct.get().clipboard;
  if (cb.length) commit('Paste', (d) => pasteClips(d, cb, playhead()).doc);
}

const forSelected = (label: string, fn: (d: TimelineDoc, id: string) => TimelineDoc): void => {
  const ids = sel();
  if (ids.length) commit(label, (d) => ids.reduce(fn, d), `${label}:${ids.join()}`);
};

export const setClipSpeed = (speed: number): void => forSelected('Retime', (d, id) => setSpeed(d, id, speed));
export const toggleMirror = (): void => {
  const c = one();
  if (c) forSelected('Mirror', (d, id) => setMirror(d, id, !c.mirror));
};
export const setClipLoop = (n: number): void => forSelected('Loop', (d, id) => setLoop(d, id, n));
export const setClipJoin = (j: Partial<Join>): void => forSelected('Join', (d, id) => setJoin(d, id, j));
export const setClipVolume = (v: number): void => forSelected('Volume', (d, id) => setVolume(d, id, v));
export const setClipText = (id: string, patch: Partial<TextSpec>): void =>
  commit('Edit text', (d) => setText(d, id, patch), `text:${id}:${Object.keys(patch).join()}`);

/** Drag gestures commit with a per-drag key so a whole drag is one undo step. */
export function moveTo(id: string, start: number, trackId: string | undefined, dragKey: string): void {
  commit('Move clip', (d) => moveClip(d, id, start, trackId), dragKey);
}

export function trimTo(id: string, edge: 'start' | 'end', frame: number, dragKey: string): void {
  const c = findClip(ct.get().doc, id);
  const src = c?.sourceId ? ct.get().doc.sources.find((s) => s.id === c.sourceId) : undefined;
  commit('Trim clip', (d) => trimClip(d, id, edge, frame, src?.length), dragKey);
}

export function reorderTo(id: string, index: number): void {
  commit('Reorder clips', (d) => reorderClip(d, id, index));
}

export const clipsOfTrack = (trackId: string): Clip[] => trackClips(ct.get().doc, trackId);

// Automation probe (e2e tests drive the timeline through it).
(window as unknown as { __clipTimeline?: unknown }).__clipTimeline = {
  get: () => ct.get(),
  set: ct.set,
  addMotionFiles,
  addTextClip,
  importSubtitles,
  splitAtPlayhead,
  duplicateSelected,
  deleteSelected,
  reorderTo,
  select,
};

// ---------------------------------------------------------------- export

/** Download the baked timeline: one VMD per model with dance / face clips, and the camera. */
export async function exportTimelineVmd(): Promise<number> {
  const [{ baked, bakeNow }, { writeVmd }, { downloadBlob }, { emptyClip }] = await Promise.all([
    import('./runtime'),
    import('@/lib/motion/vmd'),
    import('@/features/app/filePickers'),
    import('@/lib/motion/types'),
  ]);
  bakeNow();
  const doc = ct.get().doc;
  let n = 0;
  for (const [modelId, clip] of baked.models) {
    const model = studio.get().models.find((m) => m.id === modelId);
    // The model file's name (display names are often Japanese, which some download paths mangle).
    const name =
      model?.mainPath
        .split('/')
        .pop()
        ?.replace(/\.[^.]+$/, '') ||
      model?.name ||
      'model';
    downloadBlob(new Blob([writeVmd({ ...clip, camera: [] })]), `${name}-timeline.vmd`);
    n++;
  }
  if (baked.camera?.camera.length) {
    // Browsers drop / rename back-to-back downloads.
    if (n) await new Promise((r) => setTimeout(r, 400));
    const cam = {
      ...emptyClip('カメラ・照明'),
      camera: baked.camera.camera,
      lights: baked.camera.lights,
      shadows: baked.camera.shadows,
    };
    downloadBlob(new Blob([writeVmd(cam)]), 'camera-timeline.vmd');
    n++;
  }
  if (!n) toast('info', 'Add dance, face or camera clips to export a VMD.');
  else if (
    doc.clips.some((c) => c.text) ||
    doc.clips.some((c) => doc.tracks.find((t) => t.id === c.trackId)?.kind === 'audio')
  )
    toast(
      'info',
      'VMD files hold motion only — 3D text and audio are left out. Export a video to keep them.',
      8000,
    );
  return n;
}

// A motion loaded onto a model from outside the timeline (Models panel, drag & drop) joins the
// timeline: a model without a dance track gets one; otherwise it is appended to the model's track.
useStudio.subscribe((s, prev) => {
  if (s.models === prev.models || s.project.restoring) return;
  for (const m of s.models) {
    const before = prev.models.find((x) => x.id === m.id);
    if (!m.motionRef || m.stage || before?.motionRef?.blobId === m.motionRef.blobId) continue;
    const doc = ct.get().doc;
    if (!doc.tracks.length) continue; // No timeline in use: nothing to keep in step.
    const known = doc.sources.some((x) => x.ref?.blobId === m.motionRef!.blobId);
    if (known) continue;
    const track = doc.tracks.find((t) => t.kind === 'dance' && t.modelId === m.id);
    if (!track) {
      void importLoaded();
      continue;
    }
    const ref = m.motionRef;
    void import('@/lib/assets')
      .then((a) => a.resolveRef(ref))
      .then((f) => addMotionFiles([f], m.id))
      .then(() => toast('info', `Added ${ref.path.split('/').pop()} to the end of the timeline.`))
      .catch(() => undefined);
  }
});
