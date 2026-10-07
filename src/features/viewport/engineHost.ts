// The 3D engine and its canvas live for the whole page lifetime, independent of React layout.
// Shells re-parent the canvas into whichever viewport container is mounted, so rotating a phone
// or crossing a breakpoint never recreates the engine or loses the scene.
import { createStudioEngine, type StudioEngine } from '@/engine/StudioEngine';
import { connectEngine } from '@/features/app/bridge';
import { restoreLastProject, startAutosave } from '@/features/project/persistence';
import { setEngine } from '@/store/engineRef';
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
