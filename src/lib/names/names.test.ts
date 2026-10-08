import { describe, expect, it } from 'vitest';
import bonesFile from './bones.json';
import morphsFile from './morphs.json';
import materialsFile from './materials.json';
import {
  DICTIONARY,
  expandEntries,
  formatName,
  guessName,
  lookupDictionary,
  matchesName,
  modelLabelKey,
  nameTable,
  normalizeName,
  resolveName,
  searchKey,
  type NameDictionaryFile,
  type NameKind,
} from './index';

describe('dictionary', () => {
  for (const kind of ['bone', 'morph', 'material'] as NameKind[]) {
    it(`${kind}: every entry has an English label and no duplicate Japanese keys`, () => {
      const seen = new Set<string>();
      for (const e of DICTIONARY[kind]) {
        expect(e.ja.trim(), JSON.stringify(e)).not.toBe('');
        expect(e.en.trim(), JSON.stringify(e)).not.toBe('');
        const k = normalizeName(e.ja);
        expect(seen.has(k), `duplicate ${e.ja}`).toBe(false);
        seen.add(k);
      }
    });
  }

  it('covers the standard bone set with left / right variants', () => {
    for (const [ja, en] of [
      ['センター', 'Center'],
      ['グルーブ', 'Groove'],
      ['上半身2', 'Upper Body 2'],
      ['全ての親', 'Master'],
      ['左腕', 'Left Arm'],
      ['右ひじ', 'Right Elbow'],
      ['左親指０', 'Left Thumb 0'],
      ['右小指３', 'Right Little 3'],
      ['左足ＩＫ', 'Left Leg IK'],
      ['右つま先ＩＫ', 'Right Toe IK'],
      ['左足先EX', 'Left Toe EX'],
      ['右足首D', 'Right Ankle D'],
      ['左腰キャンセル', 'Left Waist Cancel'],
      ['右肩P', 'Right Shoulder P'],
      ['左腕捩', 'Left Arm Twist'],
      ['右手捩', 'Right Wrist Twist'],
    ]) {
      expect(lookupDictionary('bone', ja)?.en, ja).toBe(en);
    }
  });

  it('matches full-width and half-width spellings of the same name', () => {
    expect(lookupDictionary('bone', '左足IK')?.en).toBe('Left Leg IK');
    expect(lookupDictionary('bone', '左親指0')?.en).toBe('Left Thumb 0');
    expect(lookupDictionary('morph', 'ｳｨﾝｸ')?.en).toBe('Wink');
  });

  it('carries morph categories', () => {
    expect(lookupDictionary('morph', 'まばたき')?.category).toBe('eye');
    expect(lookupDictionary('morph', 'あ')?.category).toBe('mouth');
    expect(lookupDictionary('morph', '困る')?.category).toBe('eyebrow');
    expect(lookupDictionary('morph', '照れ')?.category).toBe('other');
    for (const e of DICTIONARY.morph) expect(['eyebrow', 'eye', 'mouth', 'other']).toContain(e.category);
  });

  it('expands sided entries only for bones', () => {
    const f = bonesFile as NameDictionaryFile;
    const sided = f.entries.filter((e) => e.sided).length;
    expect(DICTIONARY.bone.length).toBe(f.entries.length + sided);
    expect(expandEntries(morphsFile as NameDictionaryFile).length).toBe(
      (morphsFile as NameDictionaryFile).entries.length,
    );
    expect(expandEntries(materialsFile as NameDictionaryFile).length).toBe(
      (materialsFile as NameDictionaryFile).entries.length,
    );
  });
});

describe('pattern rules', () => {
  it('handles sides, IK, tips, twists, helpers, hair, skirt, numbers', () => {
    expect(guessName('左髪先')).toBe('Left Hair Tip');
    expect(guessName('右スカート前２')).toBe('Right Skirt Front 2');
    expect(guessName('髪1')).toBe('Hair 1');
    expect(guessName('リボン左')).toBe('Left Ribbon');
    expect(guessName('袖_L')).toBe('Left Sleeve');
    expect(guessName('左腕捩補助')).toBe('Left Arm Twist Helper');
    expect(guessName('左手ＩＫ')).toBe('Left Hand IK');
    expect(guessName('胸親')).toBe('Chest Parent');
    expect(guessName('右目光')).toBe('Right Eye Light');
    expect(guessName('口角上げ２')).toBeNull(); // 角 isn't a known token: no half translation
    expect(guessName('ＡＢＣ')).toBeNull(); // nothing Japanese to translate
    expect(guessName('謎ボーン')).toBeNull();
  });

  it('normalises full-width digits and letters to ASCII', () => {
    expect(normalizeName('足ＩＫ１２')).toBe('足IK12');
    expect(guessName('髪１２')).toBe('Hair 12');
  });
});

describe('resolution order', () => {
  it('override > dictionary > pattern > PMX field > original', () => {
    expect(resolveName('bone', '左腕', { override: 'L arm', pmxEn: 'arm_L' })).toMatchObject({
      en: 'L arm',
      source: 'override',
    });
    expect(resolveName('bone', '左腕', { pmxEn: 'arm_L' })).toMatchObject({
      en: 'Left Arm',
      source: 'dictionary',
    });
    expect(resolveName('bone', '左髪先', { pmxEn: 'hairtip_L' })).toMatchObject({
      en: 'Left Hair Tip',
      source: 'pattern',
    });
    expect(resolveName('bone', '謎ボーン', { pmxEn: 'Mystery' })).toMatchObject({
      en: 'Mystery',
      source: 'pmx',
    });
    expect(resolveName('bone', '謎ボーン', { pmxEn: '謎ボーン' })).toMatchObject({
      en: '謎ボーン',
      source: 'original',
    });
    expect(resolveName('bone', '謎ボーン', { pmxEn: '  ' })).toMatchObject({
      en: '謎ボーン',
      source: 'original',
    });
    expect(resolveName('bone', '謎ボーン', { override: '   ' }).source).toBe('original');
  });

  it('formats for each display mode, never blank', () => {
    const r = resolveName('bone', '左腕');
    expect(formatName(r, 'both')).toBe('Left Arm (左腕)');
    expect(formatName(r, 'en')).toBe('Left Arm');
    expect(formatName(r, 'ja')).toBe('左腕');
    const o = resolveName('bone', '謎ボーン');
    for (const m of ['both', 'en', 'ja'] as const) expect(formatName(o, m)).toBe('謎ボーン');
    expect(formatName(resolveName('material', ''), 'both')).toBe('');
  });
});

describe('search', () => {
  it('matches English and Japanese, case-, width- and kana-insensitive', () => {
    const r = resolveName('bone', '左ひじ');
    expect(matchesName('elbow', r)).toBe(true);
    expect(matchesName('LEFT EL', r)).toBe(true);
    expect(matchesName('ひじ', r)).toBe(true);
    expect(matchesName('ヒジ', r)).toBe(true);
    expect(matchesName('knee', r)).toBe(false);
    const ik = resolveName('bone', '右足ＩＫ');
    expect(matchesName('足IK', ik)).toBe(true);
    expect(matchesName('ｉｋ', ik)).toBe(true);
    expect(matchesName('', ik)).toBe(true);
    expect(searchKey('ウィンク')).toBe(searchKey('ｳｨﾝｸ'));
  });
});

describe('name tables', () => {
  const info = {
    bones: [{ name: '左腕' }, { name: '謎ボーン', en: 'Mystery' }],
    morphs: [{ name: 'まばたき' }],
    materials: [{ name: '顔' }, { name: '材質1', en: 'Mat One' }],
  };

  it('memoises per info + overrides and applies overrides', () => {
    const o = { bone: { 左腕: 'My Arm' } };
    const t = nameTable(info, o);
    expect(nameTable(info, o)).toBe(t);
    expect(nameTable(info, { ...o })).not.toBe(t);
    expect(t.get('bone', '左腕').en).toBe('My Arm');
    expect(t.get('bone', '謎ボーン')).toMatchObject({ en: 'Mystery', source: 'pmx' });
    expect(t.get('material', '顔').en).toBe('Face');
    expect(t.get('material', '材質1')).toMatchObject({ en: 'Material 1', source: 'pattern' });
    expect(t.get('morph', 'まばたき').category).toBe('eye');
  });

  it('never changes the Japanese identifier', () => {
    const t = nameTable(info, { bone: { 左腕: 'X' } });
    for (const b of info.bones) expect(t.get('bone', b.name).ja).toBe(b.name);
    expect(info.bones.map((b) => b.name)).toEqual(['左腕', '謎ボーン']);
  });

  it('model keys depend on name and skeleton', () => {
    const a = modelLabelKey('Miku', ['センター', '頭'], ['あ']);
    expect(modelLabelKey('Miku', ['センター', '頭'], ['あ'])).toBe(a);
    expect(modelLabelKey('Miku', ['センター'], ['あ'])).not.toBe(a);
    expect(modelLabelKey('Other', ['センター', '頭'], ['あ'])).not.toBe(a);
  });
});
