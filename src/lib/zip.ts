import JSZip from 'jszip';
import { normalizePath } from './paths';
import { decodeZipName } from './zipNames';

export interface ZipEntry {
  path: string;
  data: ArrayBuffer;
}

/** Extract all file entries from a ZIP buffer, decoding Shift-JIS names when needed. */
export async function unzipBuffer(buffer: ArrayBuffer): Promise<ZipEntry[]> {
  const zip = await JSZip.loadAsync(buffer, {
    decodeFileName: (bytes: string[] | Uint8Array | Buffer) =>
      decodeZipName(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes as string[], (c) => Number(c))),
  });
  const entries: ZipEntry[] = [];
  const files = Object.values(zip.files).filter((f) => !f.dir && !/(^|\/)(__MACOSX|\.DS_Store)/.test(f.name));
  for (const f of files) {
    entries.push({ path: normalizePath(f.name), data: await f.async('arraybuffer') });
  }
  return entries;
}

/** Build a ZIP from path → data. */
export async function zipFiles(files: { path: string; data: Blob | ArrayBuffer | string }[]): Promise<Blob> {
  const zip = new JSZip();
  for (const f of files) zip.file(f.path, f.data);
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (e: ZipEntry[]) => void; reject: (err: Error) => void }>();

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (!worker) {
    worker = new Worker(new URL('./zip.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; entries?: ZipEntry[]; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error));
      else p.resolve(e.data.entries ?? []);
    };
  }
  return worker;
}

/** Unzip off the main thread (falls back to the main thread when workers are unavailable). */
export async function unzipInWorker(blob: Blob): Promise<ZipEntry[]> {
  const buffer = await blob.arrayBuffer();
  const w = getWorker();
  if (!w) return unzipBuffer(buffer);
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, buffer }, [buffer]);
  });
}
