import bonesFile from './bones.json';
import materialsFile from './materials.json';
import morphsFile from './morphs.json';
import { normalizeName } from './normalize';
import type { NameDictionaryFile, NameEntry, NameKind } from './types';

const SIDES: [string, string][] = [
  ['左', 'Left'],
  ['右', 'Right'],
];

/** Dictionary entries as shipped, with sided bone entries expanded into 左 / 右 variants. */
export function expandEntries(file: NameDictionaryFile): NameEntry[] {
  const out: NameEntry[] = [];
  for (const e of file.entries) {
    if (!e.sided) {
      out.push({ ja: e.ja, en: e.en, ...(e.category ? { category: e.category } : {}) });
      continue;
    }
    for (const [ja, en] of SIDES) out.push({ ja: `${ja}${e.ja}`, en: `${en} ${e.en}` });
  }
  return out;
}

export const DICTIONARY: Record<NameKind, NameEntry[]> = {
  bone: expandEntries(bonesFile as NameDictionaryFile),
  morph: expandEntries(morphsFile as NameDictionaryFile),
  material: expandEntries(materialsFile as NameDictionaryFile),
};

/** Lookup maps keyed by the normalised Japanese name. */
const MAPS: Record<NameKind, Map<string, NameEntry>> = {
  bone: new Map(DICTIONARY.bone.map((e) => [normalizeName(e.ja), e])),
  morph: new Map(DICTIONARY.morph.map((e) => [normalizeName(e.ja), e])),
  material: new Map(DICTIONARY.material.map((e) => [normalizeName(e.ja), e])),
};

export const lookupDictionary = (kind: NameKind, ja: string): NameEntry | undefined =>
  MAPS[kind].get(normalizeName(ja));
