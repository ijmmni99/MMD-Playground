// English display labels for Japanese MMD names. Display-only: Japanese names stay the identifiers.

export type NameKind = 'bone' | 'morph' | 'material';

/** Where a label came from (shown in tooltips; 'pattern' labels are marked as guesses). */
export type NameSource = 'override' | 'dictionary' | 'pattern' | 'pmx' | 'original';

export type MorphGroup = 'eyebrow' | 'eye' | 'mouth' | 'other';

/** One dictionary entry, as shipped in the JSON files. */
export interface NameEntry {
  ja: string;
  en: string;
  /** Morph panel group. */
  category?: MorphGroup;
  /** Bones: also defines 左 (Left …) and 右 (Right …) variants. */
  sided?: boolean;
}

export interface NameDictionaryFile {
  entries: NameEntry[];
}

export interface ResolvedName {
  /** The real identifier (unchanged). */
  ja: string;
  /** English label (equals `ja` when nothing better is known). */
  en: string;
  source: NameSource;
  /** Morph group from the dictionary, when known. */
  category?: MorphGroup;
}

export type NameDisplay = 'en' | 'ja' | 'both';

/** User labels for one model: kind → Japanese name → English label. */
export type LabelOverrides = Partial<Record<NameKind, Record<string, string>>>;

export const SOURCE_LABEL: Record<NameSource, string> = {
  override: 'your label',
  dictionary: 'built-in dictionary',
  pattern: 'guessed from the name',
  pmx: 'English name in the PMX',
  original: 'original name',
};
