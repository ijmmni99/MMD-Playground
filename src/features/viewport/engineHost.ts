// The 3D engine and its canvas live for the whole page lifetime, independent of React layout.
// Shells re-parent the canvas into whichever viewport container is mounted, so rotating a phone
// or crossing a breakpoint never recreates the engine or loses the scene.
import { createStudioEngine, type StudioEngine } from '@/engine/StudioEngine';
import { connectEngine } from '@/features/app/bridge';
import { hasRestorableProject, restoreLastProject, startAutosave } from '@/features/project/persistence';
import { setEngine, setEngineBooter } from '@/store/engineRef';
import { studio } from '@/store/studio';

let canvas: HTMLCanvasElement | null = null;
let booting: Promise<StudioEngine | null> | null = null;

export function getCanvas(): HTMLCanvasElement {
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'block h-full w-full outline-none touch-none select-none';
    canvas.tabIndex = 0;
    canvas.dataset.testid = 'viewport-canvas';
    canvas.setAttribute(
      'aria-label',
      '3D viewport. Drag to orbit, two fingers or right-drag to pan, pinch or scroll to zoom.',
    );
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  return canvas;
}

/** Start the engine once. Safe to call repeatedly. */
export function bootEngine(): Promise<StudioEngine | null> {
  if (!booting) studio.set({ engineBooting: true });
  booting ??= createStudioEngine(getCanvas())
    .then(async (engine) => {
      connectEngine(engine);
      setEngine(engine);
      engine.applySettings(studio.get().settings);
      studio.set({ engineReady: true });
      (window as unknown as { __studio?: unknown }).__studio = engine;
      await restoreLastProject();
      startAutosave();
      return engine;
    })
    .catch((e: unknown) => {
      console.error(e);
      studio.set({ engineError: e instanceof Error ? e.message : String(e) });
      return null;
    });
  return booting;
}

setEngineBooter(() => void bootEngine());

let scheduled = false;
/**
 * The engine bundle is several MB, so a first visit only downloads it once the user interacts
 * (or an action needs it). Returning users with a saved scene get it immediately.
 */
export function scheduleEngineBoot(): void {
  if (scheduled) return;
  scheduled = true;
  const events = ['pointerdown', 'keydown', 'dragenter', 'touchstart'] as const;
  const start = (): void => {
    events.forEach((t) => window.removeEventListener(t, start, true));
    void bootEngine();
  };
  events.forEach((t) => window.addEventListener(t, start, { capture: true, passive: true }));
  const params = new URLSearchParams(location.search);
  if (params.has('shared') || params.has('engine')) return start();
  void hasRestorableProject().then((restore) => {
    if (restore) start();
  });
}
