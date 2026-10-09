// MediaPipe's WASM loader for workers and the main thread. We self-host the ES-module build of the loader.
// On the main thread MediaPipe would inject it as a classic <script>, where its `export` is a syntax error
// and `ModuleFactory` is never set ("ModuleFactory not set" on iOS, whose detection runs on the main thread
// when the WebCodecs worker can't). So we import the module ourselves and hand MediaPipe a fileset with no
// loader path, which makes it skip its own script loading.
//
// MediaPipe clears `self.ModuleFactory` after creating each task, and an ES module only runs once, so the
// global is pinned to the imported factory: later tasks (face / hands in Balanced and up, two hand
// landmarkers, a GPU → CPU retry) still find it.

import { FilesetResolver } from '@mediapipe/tasks-vision';

type Fileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

let loading: Promise<unknown> | null = null;

function pin(factory: unknown): void {
  Object.defineProperty(globalThis, 'ModuleFactory', {
    configurable: true,
    get: () => factory,
    set: () => undefined,
  });
}

export async function visionFileset(wasmBase: string): Promise<Fileset> {
  const fileset = await FilesetResolver.forVisionTasks(wasmBase, true);
  loading ??= import(/* @vite-ignore */ fileset.wasmLoaderPath).then(
    (m: { default?: unknown }) => m.default ?? (globalThis as { ModuleFactory?: unknown }).ModuleFactory,
  );
  let factory: unknown;
  try {
    factory = await loading;
  } catch (e) {
    loading = null;
    throw new Error(
      `Couldn't load the pose runtime (${e instanceof Error ? e.message : String(e)}). Check your connection and try again.`,
      { cause: e },
    );
  }
  if (typeof factory !== 'function') {
    loading = null;
    throw new Error('The pose runtime loaded but did not start. Reload the page and try again.');
  }
  pin(factory);
  return { ...fileset, wasmLoaderPath: '' };
}
