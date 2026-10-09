import { describe, expect, it } from 'vitest';
import { makeEditFixture } from '@/lib/model-edit/fixture';
import { autoAssign, guessLook } from './assign';
import {
  applyGlobals,
  cleanModelLooks,
  cleanSettings,
  DEFAULT_NPR_SETTINGS,
  featuresFor,
  isHeavy,
  LOOK_IDS,
  looksFromJson,
  looksToJson,
  PARAM_SPECS,
  PRESETS,
  resolveLook,
  selectTier,
  type ParamKey,
} from './looks';

describe('auto-assign by material name', () => {
  const cases: [string, string, string][] = [
    ['髪', '', 'animeHair'],
    ['前髪', '', 'animeHair'],
    ['hair_back', '', 'animeHair'],
    ['顔', '', 'animeFace'],
    ['face', '', 'animeFace'],
    ['口', 'mouth', 'animeFace'],
    ['肌', '', 'animeSkin'],
    ['体', 'body', 'animeSkin'],
    ['Body_skin', '', 'animeSkin'],
    ['目', '', 'eye'],
    ['瞳', '', 'eye'],
    ['白目', '', 'eye'],
    ['眉', '', 'eye'],
    ['EyeHighlight', '', 'eye'],
    ['iris_L', '', 'eye'],
    ['ニーソ', '', 'stockings'],
    ['ストッキング', '', 'stockings'],
    ['タイツ', '', 'stockings'],
    ['Stockings', '', 'stockings'],
    ['socks', '', 'stockings'],
    ['金具', '', 'metal'],
    ['ベルト金具', '', 'metal'],
    ['chain', '', 'metal'],
    ['silver_ring', '', 'metal'],
    ['服', '', 'clothSmooth'],
    ['トップス', 'top', 'clothSmooth'],
    ['スカート', '', 'clothSmooth'],
    ['jacket', '', 'clothSmooth'],
    ['レザージャケット', '', 'clothRough'],
    ['denim_pants', '', 'clothRough'],
    ['靴', '', 'clothRough'],
    ['boots', '', 'clothRough'],
    ['材質1', '', 'default'],
    ['mat_003', '', 'default'],
  ];
  it.each(cases)('%s (%s) → %s', (name, nameEn, look) => {
    expect(guessLook({ name, nameEn })).toBe(look);
  });

  it('uses the English name and the texture file when the Japanese name says nothing', () => {
    expect(guessLook({ name: '材質12', nameEn: 'hair' })).toBe('animeHair');
    expect(guessLook({ name: '材質3', texture: 'tex/stocking_black.png' })).toBe('stockings');
  });

  it('auto-assigns the NPR fixture with a distinct look per kind and keeps user choices', () => {
    const pmx = makeEditFixture({ npr: true }).pmx;
    const mats = pmx.materials.map((m) => ({
      name: m.name,
      nameEn: m.nameEn,
      texture: m.texture >= 0 ? pmx.textures[m.texture] : '',
    }));
    const looks = autoAssign(mats);
    const by = (n: string) => looks.materials[n]?.look ?? 'default';
    expect(by('髪')).toBe('animeHair');
    expect(by('顔')).toBe('animeFace');
    expect(by('体')).toBe('animeSkin');
    expect(by('トップス')).toBe('clothSmooth');
    expect(by('ニーソ')).toBe('stockings');
    expect(by('ベルト金具')).toBe('metal');
    expect(by('目')).toBe('eye');
    const mine = { materials: { 髪: { look: 'flatUnlit' as const } }, seeThroughEyes: false };
    const again = autoAssign(mats, mine);
    expect(again.materials['髪'].look).toBe('flatUnlit');
    expect(again.seeThroughEyes).toBe(false);
    expect(autoAssign(mats, mine, true).materials['髪'].look).toBe('animeHair');
  });
});

describe('presets and parameters', () => {
  it('every preset value is inside its parameter range', () => {
    for (const [id, p] of Object.entries(PRESETS)) {
      for (const [k, spec] of Object.entries(PARAM_SPECS)) {
        const v = p[k as ParamKey];
        if (spec.kind === 'number') {
          expect(v, `${id}.${k}`).toBeGreaterThanOrEqual(spec.min);
          expect(v, `${id}.${k}`).toBeLessThanOrEqual(spec.max);
        } else if (spec.kind === 'color' && v !== null)
          expect((v as number[]).every((x) => x >= 0 && x <= 1)).toBe(true);
        else if (spec.kind === 'enum') expect(spec.options).toContain(v);
      }
    }
    expect(Object.keys(PRESETS).length).toBe(LOOK_IDS.length - 1);
  });

  it('presets are distinct', () => {
    const keys = Object.values(PRESETS).map((p) => JSON.stringify(p));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('overrides are clamped and invalid ones dropped; Default resolves to null', () => {
    expect(resolveLook({ look: 'default' })).toBeNull();
    expect(resolveLook(undefined)).toBeNull();
    const p = resolveLook({
      look: 'animeSkin',
      params: { rimStrength: 99, rampSoftness: -3, shadowColor: [2, 0.5, -1], alphaMode: 'nope' as never },
    })!;
    expect(p.rimStrength).toBe(2);
    expect(p.rampSoftness).toBe(0);
    expect(p.shadowColor).toEqual([1, 0.5, 0]);
    expect(p.alphaMode).toBe('keep');
  });

  it('global quick controls', () => {
    const base = resolveLook({ look: 'metal' })!;
    const g = applyGlobals(base, {
      ...DEFAULT_NPR_SETTINGS,
      toonStrength: 0.5,
      rimStrength: 2,
      shadowWarmth: 1,
    });
    expect(g.toon).toBeCloseTo(base.toon * 0.5);
    expect(g.rimStrength).toBeCloseTo(base.rimStrength * 2);
    expect(g.shadowColor[0]).toBeGreaterThan(base.shadowColor[0]);
    expect(g.shadowColor[2]).toBeLessThan(base.shadowColor[2]);
  });
});

describe('quality tiers', () => {
  it('auto follows the viewport quality, explicit tiers win', () => {
    expect(selectTier('auto', 'low')).toBe('low');
    expect(selectTier('auto', 'high')).toBe('high');
    expect(selectTier('medium', 'high')).toBe('medium');
    expect(selectTier('high', 'low')).toBe('high');
  });

  it('features shrink with the tier', () => {
    const metal = resolveLook({ look: 'metal' })!;
    const high = featuresFor(metal, 'high');
    const med = featuresFor(metal, 'medium');
    const low = featuresFor(metal, 'low');
    expect(high.hybrid && high.sparkle && high.rim && high.spec).toBe(true);
    expect(med.hybrid || med.sparkle).toBe(false);
    expect(med.rim).toBe(true);
    expect(low.rim || low.spec || low.noise).toBe(false);
    expect(isHeavy(high)).toBe(true);
    expect(isHeavy(low)).toBe(false);
    const st = featuresFor(resolveLook({ look: 'stockings' })!, 'low');
    expect(st.alpha).toBe('mask');
    expect(featuresFor(resolveLook({ look: 'stockings' })!, 'high').alpha).toBe('hash');
  });
});

describe('serialisation', () => {
  it('JSON round trip keeps looks and overrides', () => {
    const looks = {
      materials: {
        髪: { look: 'animeHair' as const, params: { rimStrength: 0.8, outlineColor: null } },
        目: { look: 'eye' as const },
      },
      seeThroughEyes: false,
    };
    expect(looksFromJson(looksToJson(looks, 'Test'))).toEqual(looks);
  });

  it('cleaning drops unknown looks and parameters', () => {
    const c = cleanModelLooks({
      materials: { a: { look: 'bogus' }, b: { look: 'metal', params: { foo: 1, sparkle: 9 } } },
    })!;
    expect(c.materials).toEqual({ b: { look: 'metal', params: { sparkle: 2 } } });
    expect(c.seeThroughEyes).toBe(true);
    expect(() => looksFromJson('{"type":"x"}')).toThrow();
    expect(cleanSettings({ tier: 'ultra', toonStrength: 5, outlineMode: 'post' })).toEqual({
      ...DEFAULT_NPR_SETTINGS,
      toonStrength: 1,
      outlineMode: 'post',
    });
  });
});
