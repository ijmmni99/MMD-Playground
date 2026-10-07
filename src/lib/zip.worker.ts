/// <reference lib="webworker" />
import { unzipBuffer } from './zip';

self.onmessage = async (e: MessageEvent<{ id: number; buffer: ArrayBuffer }>) => {
  const { id, buffer } = e.data;
  try {
    const entries = await unzipBuffer(buffer);
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(
      { id, entries },
      entries.map((x) => x.data),
    );
  } catch (err) {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
