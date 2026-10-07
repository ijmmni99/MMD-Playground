// Light persistence entry points (no VMD/Shift-JIS code): the heavy restore path is loaded on demand.
import { me, type MotionEditorDoc } from '@/store/motionEditor';
import { studio } from '@/store/studio';

export function buildMotionEditorDoc(): MotionEditorDoc | undefined {
  const s = me.get();
  const models: MotionEditorDoc['models'] = {};
  for (const [id, refs] of Object.entries(s.saved.models)) {
    if (!studio.get().models.some((m) => m.id === id)) continue;
    models[id] = { ...refs, pins: s.pins[id] ?? [], name: s.names[id] ?? 'motion.vmd' };
  }
  const empty =
    !Object.keys(models).length && !s.saved.camera && !s.markers.length && !s.shots.length && !s.grid.bpm;
  if (empty) return undefined;
  return {
    models,
    camera: s.saved.camera ? { ...s.saved.camera, name: s.cameraName } : null,
    markers: s.markers,
    grid: s.grid,
    shots: s.shots,
  };
}

export async function restoreMotionEditor(doc: MotionEditorDoc | undefined): Promise<void> {
  const s = me.get();
  const loaded = Object.keys(s.clips).length || s.camera;
  if (!doc && !loaded) {
    me.set({ markers: [], shots: [], pins: {}, saved: { models: {}, camera: null } });
    return;
  }
  const { restoreMotionEditorImpl } = await import('./actions');
  await restoreMotionEditorImpl(doc);
}
