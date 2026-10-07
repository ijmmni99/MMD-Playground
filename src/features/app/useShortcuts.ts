import { useEffect } from 'react';
import { engineOrNull } from '@/store/engineRef';
import { focusSelected, redo, setGizmoMode, togglePlay, undo } from '@/store/actions';
import { saveNow } from '@/features/project/persistence';
import { studio } from '@/store/studio';

export const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'Space', action: 'Play / pause' },
  { keys: '← / →', action: 'Step one frame (Shift: 10 frames)' },
  { keys: 'Home / End', action: 'Jump to start / end' },
  { keys: 'L', action: 'Toggle loop' },
  { keys: 'F', action: 'Focus selected model' },
  { keys: 'R / T', action: 'Bone gizmo: rotate / move' },
  { keys: 'Esc', action: 'Deselect bone / close dialog' },
  { keys: 'Ctrl+S', action: 'Save project' },
  { keys: 'Ctrl+Z', action: 'Undo (pose, morph, transform)' },
  { keys: 'Ctrl+Shift+Z / Ctrl+Y', action: 'Redo' },
  { keys: '?', action: 'Show this cheat sheet' },
  { keys: 'W A S D Q E', action: 'Move in free-fly camera mode' },
];

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return !['checkbox', 'radio', 'range', 'button', 'color'].includes(type);
  }
  return target.closest('.monaco-editor') !== null;
}

export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveNow({ thumbnail: true, announce: true });
        return;
      }
      if (isTyping(e.target)) return;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (mod || e.altKey) return;
      const engine = engineOrNull();
      const flyMode = studio.get().camera.mode === 'fly';
      switch (e.key) {
        case ' ':
          // Let buttons/switches handle their own Space activation.
          if (
            e.target instanceof HTMLButtonElement ||
            (e.target as HTMLElement)?.getAttribute?.('role') === 'switch'
          )
            return;
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
        case 'ArrowRight':
          if ((e.target as HTMLElement)?.closest?.('[role="slider"],[role="listbox"],[role="tree"]')) return;
          e.preventDefault();
          engine?.stepFrames((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1));
          break;
        case 'Home':
          e.preventDefault();
          engine?.seek(0);
          break;
        case 'End':
          e.preventDefault();
          if (engine) engine.seek(engine.getPlayback().duration);
          break;
        case 'f':
        case 'F':
          if (flyMode) return;
          focusSelected();
          break;
        case 'l':
        case 'L':
          if (engine) engine.setLoop(!engine.getPlayback().loop);
          break;
        case 'r':
        case 'R':
          if (studio.get().selectedBone !== null) setGizmoMode('rotate');
          break;
        case 't':
        case 'T':
          if (studio.get().selectedBone !== null) setGizmoMode('translate');
          break;
        case 'Escape':
          if (studio.get().selectedBone !== null) {
            engine?.selectBone(null, null);
            studio.set({ selectedBone: null });
          }
          break;
        case '?':
          studio.set({ dialog: 'shortcuts' });
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
