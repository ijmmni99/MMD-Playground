import type { VFile } from '@/engine/types';
import { importFileList, importFiles, setAudio } from '@/store/actions';
import { studio, toast } from '@/store/studio';

export const ACCEPT =
  '.pmx,.pmd,.bpmx,.vmd,.mp3,.wav,.ogg,.m4a,.flac,.zip,.hdr,.env,.json,.png,.jpg,.jpeg,.bmp,.tga,.dds,.sph,.spa';

/** iOS/iPadOS: no folder picking, and `accept` greys out unknown extensions like .pmx/.vmd. */
export const isIOS =
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

const isCoarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;

/** Folder pickers are unreliable on touch devices; ZIP is the recommended path there. */
export const folderPickSupported =
  !isIOS &&
  !isCoarse &&
  typeof document !== 'undefined' &&
  'webkitdirectory' in document.createElement('input');

export type PickKind = 'any' | 'model' | 'motion' | 'audio' | 'zip' | 'hdr' | 'pose';

/**
 * `accept` lists per purpose. iOS maps `accept` to UTIs and greys out unknown extensions
 * (.pmx/.vmd/.hdr), so for those only MIME types it understands are used — or no filter at all.
 */
export function acceptFor(kind: PickKind, ios = isIOS): string {
  switch (kind) {
    case 'audio':
      return ios ? 'audio/*' : 'audio/*,.mp3,.wav,.ogg,.m4a,.flac';
    case 'zip':
      return '.zip,application/zip,application/x-zip-compressed';
    case 'pose':
      return ios ? 'application/json' : '.json,application/json';
    case 'model':
      return ios ? '' : '.pmx,.pmd,.bpmx,.zip,image/*,.tga,.dds,.sph,.spa';
    case 'motion':
      return ios ? '' : '.vmd';
    case 'hdr':
      return ios ? '' : '.hdr,.env';
    case 'any':
      return ios ? '' : ACCEPT;
  }
}

function pick(configure: (input: HTMLInputElement) => void): Promise<FileList | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    configure(input);
    if (!input.accept) input.removeAttribute('accept');
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

export async function openFilePicker(accept = acceptFor('any')): Promise<void> {
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
export async function pickFiles(accept: string | PickKind, multiple = false): Promise<VFile[]> {
  const kinds: PickKind[] = ['any', 'model', 'motion', 'audio', 'zip', 'hdr', 'pose'];
  const resolved = (kinds as string[]).includes(accept) ? acceptFor(accept as PickKind) : isIOS ? '' : accept;
  const files = await pick((i) => {
    i.multiple = multiple;
    i.accept = resolved;
  });
  return files ? Array.from(files, (f) => ({ path: f.name, blob: f })) : [];
}

// ---------------------------------------------------------------- purpose-built pickers (mobile)

/** Model files: a ZIP, or the .pmx together with its textures. */
export async function addModelPicker(): Promise<void> {
  const files = await pickFiles('model', true);
  if (files.length) await importFiles(files);
}

export async function addMotionPicker(): Promise<void> {
  const [file] = await pickFiles('motion');
  if (!file) return;
  if (!file.path.toLowerCase().endsWith('.vmd')) {
    toast('warning', `${file.path} is not a .vmd motion file`);
    return;
  }
  if (!studio.get().models.length)
    toast('info', 'Tip: add a model first — motions attach to the selected model.');
  // The import planner attaches model motions to the selected model and detects camera VMDs.
  await importFiles([file]);
}

export async function addAudioPicker(): Promise<void> {
  const [file] = await pickFiles('audio');
  if (file) await setAudio(file);
}

export async function importZipPicker(): Promise<void> {
  const files = await pickFiles('zip', true);
  if (files.length) await importFiles(files);
}

export async function importProjectPicker(): Promise<void> {
  const [file] = await pickFiles('zip');
  if (!file) return;
  // Project archives are recognised by name; accept any .zip picked here as a project.
  const path = file.path.toLowerCase().endsWith('.mmdstudio.zip')
    ? file.path
    : file.path.replace(/\.zip$/i, '') + '.mmdstudio.zip';
  await importFiles([{ path, blob: file.blob }]);
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

/**
 * Save a generated file: on touch devices prefer the native share sheet (Save to Photos/Files),
 * otherwise download.
 */
export async function saveOrShare(blob: Blob, fileName: string): Promise<void> {
  if (isCoarse && typeof navigator.share === 'function' && typeof navigator.canShare === 'function') {
    const file = new File([blob], fileName, { type: blob.type });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: fileName });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
  }
  downloadBlob(blob, fileName);
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
