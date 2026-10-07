import type { VFile } from '@/engine/types';
import { importFileList, importFiles } from '@/store/actions';
import { toast } from '@/store/studio';

export const ACCEPT =
  '.pmx,.pmd,.bpmx,.vmd,.mp3,.wav,.ogg,.m4a,.flac,.zip,.hdr,.env,.json,.png,.jpg,.jpeg,.bmp,.tga,.dds,.sph,.spa';

function pick(configure: (input: HTMLInputElement) => void): Promise<FileList | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    configure(input);
    input.onchange = () => resolve(input.files);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export async function openFilePicker(accept = ACCEPT): Promise<void> {
  const files = await pick((i) => {
    i.multiple = true;
    i.accept = accept;
  });
  if (files?.length) await importFileList(files);
}

export async function openFolderPicker(): Promise<void> {
  const files = await pick((i) => {
    i.webkitdirectory = true;
    i.multiple = true;
  });
  if (files?.length) await importFileList(files);
}

/** Pick files and return them without importing (for targeted assignments). */
export async function pickFiles(accept: string, multiple = false): Promise<VFile[]> {
  const files = await pick((i) => {
    i.multiple = multiple;
    i.accept = accept;
  });
  return files ? Array.from(files, (f) => ({ path: f.name, blob: f })) : [];
}

const SAMPLE_FILES = [
  'Blocky/blocky.pmx',
  'Blocky/tex/skin.png',
  'Blocky/tex/hair.png',
  'dance.vmd',
  'camera.vmd',
  'beat.wav',
];

/** Load the procedurally generated sample shipped with the app. */
export async function loadSample(): Promise<void> {
  try {
    const base = `${import.meta.env.BASE_URL}sample/`;
    const files: VFile[] = await Promise.all(
      SAMPLE_FILES.map(async (p) => {
        const res = await fetch(base + p);
        if (!res.ok) throw new Error(`${p}: HTTP ${res.status}`);
        return { path: `sample/${p}`, blob: await res.blob() };
      }),
    );
    await importFiles(files);
  } catch (e) {
    toast('error', `Could not load sample: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
