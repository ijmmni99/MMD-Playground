// MediaPipe's WASM loader for workers and the main thread. We self-host the ES-module build of the loader.
// On the main thread MediaPipe would inject it as a classic <script>, where its `export` is a syntax error
// and `ModuleFactory` is never set ("ModuleFactory not set" on iOS, whose detection runs on the main thread
// when the WebCodecs worker can't). So we import the module ourselves (it sets globalThis.ModuleFactory)
// and hand MediaPipe a fileset with no loader path, which makes it skip its own script loading.

import { FilesetResolver } from '@mediapipe/tasks-vision';

type Fileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

let loading: Promise<void> | null = null;

export async function visionFileset(wasmBase: string): Promise<Fileset> {
  const fileset = await FilesetResolver.forVisionTasks(wasmBase, true);
  const g = globalThis as { ModuleFactory?: unknown };
  if (!g.ModuleFactory) {
    loading ??= import(/* @vite-ignore */ fileset.wasmLoaderPath).then(() => undefined);
    try {
      await loading;
    } catch (e) {
      loading = null;
      throw new Error(
        `Couldn't load the pose runtime (${e instanceof Error ? e.message : String(e)}). Check your connection and try again.`,
        { cause: e },
      );
    }
    if (!g.ModuleFactory)
      throw new Error('The pose runtime loaded but did not start. Reload the page and try again.');
  }
  return { ...fileset, wasmLoaderPath: '' };
}
