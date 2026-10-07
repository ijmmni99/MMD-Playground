import type { VFile } from '@/engine/types';
import { basename, classify, dirname, normalizePath, stripExt } from './paths';
import { summarizeVmd } from './vmd';
import type { ZipEntry } from './zip';

const lazyUnzip = async (blob: Blob): Promise<ZipEntry[]> => (await import('./zip')).unzipInWorker(blob);

// ---------------------------------------------------------------- collection

interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
}
interface FsFileEntry extends FsEntry {
  file(success: (f: File) => void, error?: (e: unknown) => void): void;
}
interface FsDirEntry extends FsEntry {
  createReader(): { readEntries(success: (entries: FsEntry[]) => void, error?: (e: unknown) => void): void };
}

async function walkEntry(entry: FsEntry, out: VFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FsFileEntry).file(resolve, reject));
    out.push({ path: normalizePath(entry.fullPath), blob: file });
  } else if (entry.isDirectory) {
    const reader = (entry as FsDirEntry).createReader();
    // readEntries returns results in batches; keep reading until empty.
    for (;;) {
      const batch = await new Promise<FsEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) break;
      for (const child of batch) await walkEntry(child, out);
    }
  }
}

/** Collect files (recursing into dropped folders) from a drop event. */
export async function collectFromDataTransfer(dt: DataTransfer): Promise<VFile[]> {
  const out: VFile[] = [];
  const items = Array.from(dt.items ?? []);
  const entries = items
    .map((it) =>
      it.kind === 'file' && 'webkitGetAsEntry' in it ? (it.webkitGetAsEntry() as FsEntry | null) : null,
    )
    .filter((e): e is FsEntry => e !== null);
  if (entries.length) {
    for (const e of entries) await walkEntry(e, out);
    return out;
  }
  return collectFromFileList(dt.files);
}

/** Collect files from an <input type=file> (supports webkitdirectory). */
export function collectFromFileList(list: FileList | File[]): VFile[] {
  return Array.from(list).map((f) => ({ path: normalizePath(f.webkitRelativePath || f.name), blob: f }));
}

/** Replace each non-project ZIP with its entries, placed under a folder named after the archive. */
export async function expandZips(
  files: VFile[],
  unzip: (blob: Blob) => Promise<ZipEntry[]> = lazyUnzip,
  depth = 0,
): Promise<VFile[]> {
  const out: VFile[] = [];
  for (const f of files) {
    if (classify(f.path) !== 'zip') {
      out.push(f);
      continue;
    }
    const entries = await unzip(f.blob);
    const prefix = normalizePath(`${dirname(f.path)}/${stripExt(basename(f.path))}`);
    const inner = entries.map((e) => ({
      path: normalizePath(`${prefix}/${e.path}`),
      blob: new Blob([e.data]),
    }));
    // Download packs often nest the real archive inside another ZIP.
    out.push(...(depth < 2 ? await expandZips(inner, unzip, depth + 1) : inner));
  }
  return out;
}

// ---------------------------------------------------------------- planning

export interface ImportPlan {
  models: { mainPath: string; files: VFile[] }[];
  motions: VFile[];
  cameraMotions: VFile[];
  audio: VFile[];
  hdr: VFile[];
  projects: VFile[];
  poses: VFile[];
  ignored: string[];
}

/** Top-level folder of a path ("" when the file is at the root). */
const topDir = (p: string): string => (p.includes('/') ? p.slice(0, p.indexOf('/')) : '');

/** Decide what to do with a set of dropped files. */
export async function planImport(files: VFile[]): Promise<ImportPlan> {
  const plan: ImportPlan = {
    models: [],
    motions: [],
    cameraMotions: [],
    audio: [],
    hdr: [],
    projects: [],
    poses: [],
    ignored: [],
  };
  const modelFiles = files.filter((f) => classify(f.path) === 'model');
  for (const m of modelFiles) {
    const dir = dirname(m.path);
    const root = topDir(m.path);
    // Textures may live next to the model, in sub-folders, or (badly packed) elsewhere in the same archive.
    const scope = files.filter((f) => {
      const kind = classify(f.path);
      if (kind === 'model' || kind === 'motion' || kind === 'audio' || kind === 'project') return f === m;
      if (root === '') return true;
      return f.path.startsWith(root + '/') || (dir === '' && !f.path.includes('/'));
    });
    plan.models.push({ mainPath: m.path, files: scope });
  }
  for (const f of files) {
    switch (classify(f.path)) {
      case 'motion': {
        try {
          const summary = summarizeVmd(await f.blob.arrayBuffer());
          (summary.isCamera ? plan.cameraMotions : plan.motions).push(f);
        } catch {
          plan.ignored.push(f.path);
        }
        break;
      }
      case 'audio':
        plan.audio.push(f);
        break;
      case 'hdr':
        plan.hdr.push(f);
        break;
      case 'project':
        plan.projects.push(f);
        break;
      case 'pose':
        plan.poses.push(f);
        break;
      case 'model':
      case 'texture':
        break;
      default:
        if (!/\.(txt|md|url|ini|db|psd|x|vac|vpd|csv|pdf|html?)$/i.test(f.path)) plan.ignored.push(f.path);
    }
  }
  // Sort motions so assignment order matches model order when names correspond.
  plan.motions.sort((a, b) => a.path.localeCompare(b.path));
  return plan;
}
