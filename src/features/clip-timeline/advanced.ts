// Advanced view: open one clip's processed motion (trim / mirror / speed / loops applied) in the
// keyframe Motion Editor at its place on the timeline; "Back to clips" stores the edit as a new source
// for that clip (the original file is never changed) and rebakes.

import { segment } from '@/lib/clips/bake';
import { findClip } from '@/lib/clips/ops';
import { clipLength, type Clip } from '@/lib/clips/types';
import { clipEndFrame } from '@/lib/motion/evaluate';
import { insertTime, trim } from '@/lib/motion/tools';
import type { MotionClip } from '@/lib/motion/types';
import { ct } from '@/store/clipTimeline';
import { engineOrNull } from '@/store/engineRef';
import { me } from '@/store/motionEditor';
import { toast } from '@/store/studio';
import { commit } from './actions';
import { addClipSource, getSourceClip } from './sources';

const CAMERA = '__camera__';
/** The motion handed to the editor (unchanged on return = nothing to store). */
let openedWith: MotionClip | null = null;

export async function openAdvanced(clipId: string): Promise<void> {
  const { doc } = ct.get();
  const clip = findClip(doc, clipId);
  const track = clip && doc.tracks.find((t) => t.id === clip.trackId);
  const source = clip?.sourceId ? getSourceClip(clip.sourceId) : undefined;
  if (!clip || !track || !source || track.kind === 'text' || track.kind === 'audio') {
    toast('info', 'Only dance, face and camera clips open in the keyframe editor.');
    return;
  }
  const camera = track.kind === 'camera';
  const modelId = camera ? CAMERA : track.modelId;
  if (!modelId) return;
  // The clip as it plays, placed at its timeline position.
  const seg = insertTime(segment(source, clip), 0, clip.startFrame);
  const editor = await import('@/features/motion-editor/actions');
  ct.set({ editing: { clipId, sourceId: clip.sourceId!, modelId }, open: false });
  if (camera) {
    me.set({ camera: seg, cameraOriginal: seg, cameraName: `${sourceName(clip)} (clip)` });
    await editor.openEditor();
    editor.scheduleApply(CAMERA, true);
    openedWith = seg;
  } else {
    me.set((s) => ({
      clips: { ...s.clips, [modelId]: seg },
      originals: { ...s.originals, [modelId]: seg },
      names: { ...s.names, [modelId]: `${sourceName(clip)} (clip)` },
      modelId,
    }));
    await editor.openEditor();
    await editor.setEditedModel(modelId);
    editor.scheduleApply(modelId, true);
  }
  openedWith = seg;
  engineOrNull()?.seek(clip.startFrame);
}

function sourceName(clip: Clip): string {
  return (
    ct
      .get()
      .doc.sources.find((s) => s.id === clip.sourceId)
      ?.name.replace(/\.vmd$/i, '') ?? 'clip'
  );
}

/** Leave the keyframe editor: the edited range becomes the clip's new source. */
export async function backToClips(): Promise<void> {
  const editing = ct.get().editing;
  if (!editing) return;
  const s = me.get();
  const target = editing.modelId ?? CAMERA;
  const edited: MotionClip | null = target === CAMERA ? s.camera : (s.clips[target] ?? null);
  const clip = findClip(ct.get().doc, editing.clipId);
  const editor = await import('@/features/motion-editor/actions');
  if (clip && edited && edited !== openedWith) {
    const start = clip.startFrame;
    // Keep what was edited inside the clip and anything keyed after its end.
    const end = Math.max(start + clipLength(clip), clipEndFrame(edited));
    const local = trim(edited, start, end);
    const name = `${sourceName(clip)} (edited).vmd`;
    const src = await addClipSource(
      local,
      name,
      ct.get().doc.sources.find((x) => x.id === clip.sourceId)?.kind ?? 'motion',
    );
    commit('Edit clip keyframes', (doc) => ({
      doc: {
        ...doc,
        sources: [...doc.sources, src],
        clips: doc.clips.map((c) =>
          c.id === clip.id
            ? {
                ...c,
                sourceId: src.id,
                sourceIn: 0,
                sourceOut: Math.max(1, end - start),
                speed: 1,
                mirror: false,
                loopCount: 1,
              }
            : c,
        ),
      },
      selection: [clip.id],
    }));
  }
  // The editor's copy belonged to the clip; forget it.
  me.set((st) => {
    if (target === CAMERA) return { camera: null, cameraOriginal: null };
    const clips = { ...st.clips };
    const originals = { ...st.originals };
    delete clips[target];
    delete originals[target];
    return { clips, originals };
  });
  openedWith = null;
  editor.closeEditor();
  ct.set({ editing: null, open: true });
}
