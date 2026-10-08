/**
 * Canonical form for dictionary lookups: NFKC turns full-width digits / letters (０, ＩＫ) into ASCII
 * and half-width katakana (ｳｨﾝｸ) into full-width; whitespace is trimmed.
 */
export const normalizeName = (s: string): string => s.normalize('NFKC').trim();

/** Katakana → hiragana (so カタカナ and かたかな searches match each other). */
export function toHiragana(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    out += c >= 0x30a1 && c <= 0x30f6 ? String.fromCodePoint(c - 0x60) : ch;
  }
  return out;
}

/** Search key: NFKC, lower-case, katakana folded to hiragana, whitespace collapsed. */
export const searchKey = (s: string): string =>
  toHiragana(normalizeName(s).toLowerCase()).replace(/\s+/g, ' ');
