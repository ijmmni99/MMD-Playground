import type { VFile } from '@/engine/types';
import { importFileList, importFiles } from '@/store/actions';
import { toast } from '@/store/studio';

export const ACCEPT =
  '.pmx,.pmd,.bpmx,.vmd,.mp3,.wav,.ogg,.m4a,.flac,.zip,.hdr,.env,.json,.png,.jpg,.jpeg,.bmp,.tga,.dds,.sph,.spa';

/** iOS/iPadOS: no folder picking, and `accept` greys out unknown extensions like .pmx/.vmd. */
export const isIOS =
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export const folderPickSupported =
  !isIOS && typeof document !== 'undefined' && 'webkitdirectory' in document.createElement('input');

function pick(configure: (input: HTMLInputElement) => void): Promise<FileList | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    configure(input);
    if (isIOS) input.removeAttribute('accept');
    // Some browsers (iOS Safari) only fire change events for inputs attached to the document.
    input.style.display = 'none';
    document.body.appendChild(input);
    const done = (files: FileList | null): void => {
      input.remove();
      resolve(files);
    };
    input.onchange = () => done(input.files);
    input.oncancel = () => done(null);
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
  if (!folderPickSupported) {
    toast(
      'info',
      'Folder picking is not supported on this device — upload a .zip of the model folder instead.',
    );
    return openFilePicker();
  }
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
