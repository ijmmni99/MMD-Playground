// Fonts for 3D text: bundled OFL fonts (fetched on demand), user uploads (stored as project assets),
// with Noto Sans JP as the fallback for characters a font lacks.

import { parse, type Font } from 'opentype.js';
import { pickFiles } from '@/features/app/filePickers';
import { getAsset, registerFile } from '@/lib/assets';
import { fontResolver, type NamedFont } from '@/lib/clips/text/resolver';
import type { GlyphResolver } from '@/lib/clips/text/layout';
import { ct } from '@/store/clipTimeline';
import { toast } from '@/store/studio';

export const FALLBACK_FONT = 'Noto Sans JP';

export const BUNDLED_FONTS: { family: string; file: string; note: string }[] = [
  { family: 'Noto Sans JP', file: 'NotoSansJP-Bold.otf', note: 'Latin, kana, kanji' },
  { family: 'Bungee', file: 'Bungee-Regular.ttf', note: 'Display' },
  { family: 'Pacifico', file: 'Pacifico-Regular.ttf', note: 'Script' },
  { family: 'Press Start 2P', file: 'PressStart2P-Regular.ttf', note: 'Pixel' },
];

const loaded = new Map<string, Promise<NamedFont | null>>();
const ready = new Map<string, NamedFont | null>();

function parseBuffer(buf: ArrayBuffer): Font {
  return parse(buf);
}

async function fetchFont(family: string): Promise<NamedFont | null> {
  const bundled = BUNDLED_FONTS.find((f) => f.family === family);
  if (bundled) {
    const res = await fetch(`${import.meta.env.BASE_URL}fonts/${bundled.file}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { id: family, font: parseBuffer(await res.arrayBuffer()) };
  }
  const user = ct.get().doc.fonts?.find((f) => f.family === family);
  if (!user) return null;
  const blob = await getAsset(user.ref.blobId);
  if (!blob) return null;
  return { id: `user:${user.ref.blobId}`, font: parseBuffer(await blob.arrayBuffer()) };
}

/** Load a font (once); resolves null when it is unknown or broken. */
export function loadFont(family: string): Promise<NamedFont | null> {
  let p = loaded.get(family);
  if (!p) {
    p = fetchFont(family)
      .catch((e: unknown) => {
        toast(
          'warning',
          `Font “${family}” could not be loaded (${(e as Error).message}); using ${FALLBACK_FONT}.`,
        );
        return null;
      })
      .then((f) => {
        ready.set(family, f);
        return f;
      });
    loaded.set(family, p);
  }
  return p;
}

/** Synchronous resolver when the font (and the fallback) are loaded; otherwise starts loading and returns null. */
export function resolverFor(family: string): GlyphResolver | null {
  const fb = ready.get(FALLBACK_FONT);
  if (!ready.has(family) || fb === undefined) {
    void loadFont(family);
    void loadFont(FALLBACK_FONT);
    return null;
  }
  const primary = ready.get(family) ?? null;
  return fontResolver(primary ?? fb, primary && family !== FALLBACK_FONT && fb ? [fb] : []);
}

/** Wait for a family and the fallback. */
export async function fontsReady(family: string): Promise<void> {
  await Promise.all([loadFont(family), loadFont(FALLBACK_FONT)]);
}

/** Families offered in the text panel. */
export function fontFamilies(): string[] {
  return [...BUNDLED_FONTS.map((f) => f.family), ...(ct.get().doc.fonts ?? []).map((f) => f.family)];
}

/** Upload a .ttf / .otf / .woff font; returns its family name (added to the project). */
export async function uploadFont(): Promise<string | null> {
  const [file] = await pickFiles('.ttf,.otf,.woff,font/ttf,font/otf,font/woff');
  if (!file) return null;
  if (/\.woff2$/i.test(file.path)) {
    toast('warning', 'WOFF2 fonts are not supported — use .ttf, .otf or .woff.');
    return null;
  }
  let font: Font;
  try {
    font = parseBuffer(await file.blob.arrayBuffer());
  } catch (e) {
    toast('error', `Not a usable font: ${(e as Error).message}`);
    return null;
  }
  const names = font.names as unknown as Record<string, Record<string, string> | undefined>;
  const base = names.fontFamily?.en ?? file.path.replace(/\.[^.]+$/, '');
  const ref = await registerFile(file);
  const existing = ct.get().doc.fonts ?? [];
  const same = existing.find((f) => f.ref.blobId === ref.blobId);
  if (same) return same.family;
  let family = base;
  for (let i = 2; fontFamilies().includes(family); i++) family = `${base} (${i})`;
  const { commit } = await import('./actions');
  commit(`Add font ${family}`, (doc) => ({ ...doc, fonts: [...(doc.fonts ?? []), { family, ref }] }));
  const named = { id: `user:${ref.blobId}`, font };
  loaded.set(family, Promise.resolve(named));
  ready.set(family, named);
  toast('success', `Font “${family}” added`);
  return family;
}
