import type { StudioEngine } from '@/engine/StudioEngine';
import { recordBoneEdit, syncMorphsFromEngine } from '@/store/actions';
import { setTask, studio, toast } from '@/store/studio';

/** Forward engine events into the store. Returns an unsubscribe function. */
export function connectEngine(engine: StudioEngine): () => void {
  const { set, get } = studio;
  const offs = [
    engine.events.on('playback', (p) => set({ playback: p })),
    engine.events.on('stats', (s) => set({ stats: s })),
    engine.events.on('warning', (m) => toast('warning', m, 7000)),
    engine.events.on('error', (m) => toast('error', m)),
    engine.events.on('progress', (p) => setTask(p.id, p.label, p.progress, p.done)),
    engine.events.on('physicsStatus', (p) => set({ physics: p })),
    engine.events.on('cameraChanged', (c) => {
      const prev = get().camera;
      set({ camera: c });
      if (
        prev.mode !== c.mode ||
        Math.abs(prev.radius - c.radius) > 1e-3 ||
        prev.alpha !== c.alpha ||
        prev.beta !== c.beta
      ) {
        if (!get().project.restoring && get().models.length)
          set((s) => ({ project: { ...s.project, dirty: true } }));
      }
    }),
    engine.events.on('boneEdited', (e) => recordBoneEdit(e.modelId, e.bone, e.before, e.after)),
    engine.events.on('morphsChanged', (e) => syncMorphsFromEngine(e.modelId)),
    engine.events.on('boneSelected', (b) => {
      if (!b) set({ selectedBone: null });
    }),
  ];
  set({ physics: { available: engine.physicsAvailable } });
  return () => offs.forEach((off) => off());
}
