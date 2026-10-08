import { lookupDictionary } from './dictionary';
import { searchKey } from './normalize';
import { guessName } from './patterns';
import type { LabelOverrides, NameDisplay, NameKind, ResolvedName } from './types';

/**
 * English label for a Japanese name. First hit wins: user override → built-in dictionary → pattern
 * rules → the PMX English name field → the original name.
 */
export function resolveName(
  kind: NameKind,
  ja: string,
  opts: { override?: string; pmxEn?: string } = {},
): ResolvedName {
  const override = opts.override?.trim();
  const entry = lookupDictionary(kind, ja);
  const category = entry?.category;
  const base = category ? { category } : {};
  if (override) return { ja, en: override, source: 'override', ...base };
  if (entry) return { ja, en: entry.en, source: 'dictionary', ...base };
  const guess = guessName(ja);
  if (guess) return { ja, en: guess, source: 'pattern' };
  const pmx = opts.pmxEn?.trim();
  if (pmx && pmx !== ja.trim()) return { ja, en: pmx, source: 'pmx' };
  return { ja, en: ja, source: 'original' };
}

/** The label to show for a display mode ("Left Arm (左腕)" for both). */
export function formatName(r: ResolvedName, mode: NameDisplay): string {
  if (!r.ja) return r.en || '';
  if (mode === 'ja' || r.source === 'original' || r.en === r.ja) return r.ja;
  if (mode === 'en') return r.en;
  return `${r.en} (${r.ja})`;
}

/** Case-insensitive, width- and kana-insensitive match on the English or the Japanese name. */
export function matchesName(query: string, r: ResolvedName): boolean {
  const q = searchKey(query);
  if (!q) return true;
  return searchKey(r.en).includes(q) || searchKey(r.ja).includes(q);
}

/** FNV-1a (32-bit) as hex. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Stable key for a model's labels: its name plus a hash of its bone and morph names, so the same PMX
 * shares labels across projects and a different model with the same name doesn't.
 */
export function modelLabelKey(name: string, bones: readonly string[], morphs: readonly string[]): string {
  return `${name}#${fnv1a(`${bones.join('\u0000')}\u0001${morphs.join('\u0000')}`)}`;
}

export interface NameSourceInfo {
  bones: readonly { name: string; en?: string }[];
  morphs: readonly { name: string; en?: string }[];
  materials: readonly { name: string; en?: string }[];
}

/** Precomputed labels for one model (resolved lazily, cached per name). */
export class NameTable {
  private readonly pmx: Record<NameKind, Map<string, string>>;
  private readonly cache: Record<NameKind, Map<string, ResolvedName>> = {
    bone: new Map(),
    morph: new Map(),
    material: new Map(),
  };

  constructor(
    info: NameSourceInfo | null,
    private readonly overrides: LabelOverrides = {},
  ) {
    const map = (list: readonly { name: string; en?: string }[] | undefined): Map<string, string> =>
      new Map((list ?? []).filter((x) => x.en).map((x) => [x.name, x.en!]));
    this.pmx = { bone: map(info?.bones), morph: map(info?.morphs), material: map(info?.materials) };
  }

  get(kind: NameKind, ja: string): ResolvedName {
    const c = this.cache[kind];
    let r = c.get(ja);
    if (!r) {
      r = resolveName(kind, ja, { override: this.overrides[kind]?.[ja], pmxEn: this.pmx[kind].get(ja) });
      c.set(ja, r);
    }
    return r;
  }
}

const tables = new WeakMap<object, WeakMap<object, NameTable>>();
const NO_INFO = {};
const NO_OVERRIDES: LabelOverrides = {};

/** Memoised table per (model info, overrides) object pair. */
export function nameTable(info: NameSourceInfo | null, overrides: LabelOverrides | undefined): NameTable {
  const k1 = info ?? NO_INFO;
  const k2 = overrides ?? NO_OVERRIDES;
  let inner = tables.get(k1);
  if (!inner) tables.set(k1, (inner = new WeakMap()));
  let t = inner.get(k2);
  if (!t) inner.set(k2, (t = new NameTable(info, k2)));
  return t;
}
