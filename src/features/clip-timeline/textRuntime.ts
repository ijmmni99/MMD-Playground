// Text clips → engine text items: layout per clip (cached while its inputs are unchanged, so the
// engine keeps the mesh), fonts loaded on demand, detail from the render quality (adaptive).

import type { TextItem } from '@/engine/StudioEngine';
import { layoutText, type TextMesh, type TextQuality } from '@/lib/clips/text/layout';
import { clipLength, type Clip, type TextSpec } from '@/lib/clips/types';
import { ct, useClipTimeline } from '@/store/clipTimeline';
import { engineOrNull, whenEngine } from '@/store/engineRef';
import { studio, useStudio } from '@/store/studio';
import { fontsReady, resolverFor } from './fonts';

const layouts = new Map<string, { key: string; mesh: TextMesh }>();
/** Adaptive step-down (0 = as configured). */
let degrade = 0;

const LEVELS: TextQuality[] = ['low', 'medium', 'high'];

export function textQuality(): TextQuality {
  const q = ct.get().textQuality;
  const base: TextQuality = q === 'auto' ? studio.get().settings.viewport.quality : q;
  if (q !== 'auto') return base;
  return LEVELS[Math.max(0, LEVELS.indexOf(base) - degrade)];
}

const layoutKey = (t: TextSpec, q: TextQuality): string =>
  JSON.stringify([t.content, t.font, t.size, t.letterSpacing, t.lineSpacing, t.align, t.depth, t.bevel, q]);

function layoutFor(clip: Clip, q: TextQuality): TextMesh | null {
  const t = clip.text!;
  const key = layoutKey(t, q);
  const hit = layouts.get(clip.id);
  if (hit?.key === key) return hit.mesh;
  const resolve = resolverFor(t.font);
  if (!resolve) {
    void fontsReady(t.font).then(() => schedule());
    return hit?.mesh ?? null;
  }
  const mesh = layoutText(t.content, resolve, {
    size: t.size,
    letterSpacing: t.letterSpacing,
    lineSpacing: t.lineSpacing,
    align: t.align,
    depth: t.depth,
    bevel: t.bevel,
    quality: q,
  });
  layouts.set(clip.id, { key, mesh });
  return mesh;
}

let timer: ReturnType<typeof setTimeout> | null = null;
function schedule(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    syncText();
  }, 30);
}

/** Push every text clip to the engine. */
export function syncText(): void {
  const engine = engineOrNull();
  if (!engine) return;
  const { doc } = ct.get();
  const q = textQuality();
  const items: TextItem[] = [];
  const missing: Record<string, string[]> = {};
  const live = new Set<string>();
  for (const c of doc.clips) {
    if (!c.text) continue;
    live.add(c.id);
    const mesh = layoutFor(c, q);
    if (!mesh) continue;
    if (mesh.missing.length) missing[c.id] = mesh.missing;
    items.push({ id: c.id, mesh, spec: c.text, start: c.startFrame, length: clipLength(c) });
  }
  for (const id of layouts.keys()) if (!live.has(id)) layouts.delete(id);
  engine.setTextItems(items);
  const prev = ct.get().textMissing;
  if (JSON.stringify(prev) !== JSON.stringify(missing)) ct.set({ textMissing: missing });
}

useClipTimeline.subscribe((s, p) => {
  if (s.doc !== p.doc || s.textQuality !== p.textQuality) schedule();
});
useStudio.subscribe((s, p) => {
  if (s.settings.viewport.quality !== p.settings.viewport.quality) {
    degrade = 0;
    schedule();
  }
  // Models appearing / going away change bone-attached text.
  if (s.models !== p.models) schedule();
});

// Adaptive detail: sustained low frame rates while text is showing step the detail down.
void whenEngine().then((engine) => {
  let slow = 0;
  setInterval(() => {
    if (ct.get().textQuality !== 'auto' || !engine.textStats().entries || !engine.getPlayback().playing)
      return;
    slow = engine.getFps() < 26 ? slow + 1 : 0;
    if (slow >= 4 && degrade < 2 && textQuality() !== 'low') {
      degrade++;
      slow = 0;
      layouts.clear();
      schedule();
    }
  }, 1000);
});
