// Auto-assign looks from material names. It reuses the Model Editor's outfit grouping and the English name
// dictionary, adding rules for what outfit groups don't separate: eyes, stockings, metal and rough cloth.

import { lookupDictionary } from '@/lib/names/dictionary';
import { guessGroup } from '@/lib/model-edit/outfit';
import type { LookId, MaterialLook, ModelLooks } from './looks';

const EYE =
  /目(?!元)|瞳|白目|眼|ハイライト|まつ毛|まつげ|睫|眉|まゆ|\beyes?\b|eye_?|iris|pupil|sclera|highlight|eyebrow|brow|lash/i;
const STOCKINGS =
  /ニーソ|ニーハイ|ストッキング|タイツ|靴下|ソックス|パンスト|網タイツ|stocking|tights|socks?\b|kneesocks?|knee_?high|thigh_?high|pantyhose|leggings?/i;
const METAL =
  /金属|金具|メタル|鎖|チェーン|銀|金色|鉄|鋼|ボタン金|ピアス|指輪|metal|chain|silver|gold|steel|iron|buckle|zipper|ring\b|earring|piercing|chrome/i;
const ROUGH =
  /革|レザー|デニム|ジーンズ|ニット|ウール|フェルト|leather|denim|jeans|knit|wool|felt|suede|tweed|canvas/i;
const SKIN = /肌|skin|素体/i;

export interface AssignInput {
  name: string;
  nameEn?: string;
  texture?: string;
}

/** Look for one material (Default when nothing matches). */
export function guessLook(m: AssignInput): LookId {
  const dict = lookupDictionary('material', m.name)?.en ?? '';
  const file =
    (m.texture ?? '')
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.[a-z0-9]+$/i, '') ?? '';
  const texts = [m.name, m.nameEn ?? '', dict, file].filter(Boolean);
  const any = (re: RegExp): boolean => texts.some((t) => re.test(t));
  if (any(EYE)) return 'eye';
  if (any(STOCKINGS)) return 'stockings';
  if (any(METAL)) return 'metal';
  const group = guessGroup(m.name, [m.nameEn ?? '', dict].filter(Boolean).join(' '), m.texture ?? '');
  switch (group) {
    case 'hair':
      return 'animeHair';
    case 'face':
      return 'animeFace';
    case 'body':
      return 'animeSkin';
    case 'top':
    case 'bottom':
    case 'gloves':
      return any(ROUGH) ? 'clothRough' : 'clothSmooth';
    case 'shoes':
      return 'clothRough';
    case 'accessories':
      return any(ROUGH) ? 'clothRough' : 'clothSmooth';
    default:
      return any(SKIN) ? 'animeSkin' : 'default';
  }
}

/**
 * Looks for every material. Materials the user already set keep their look (and overrides) unless `replace`.
 */
export function autoAssign(
  materials: readonly AssignInput[],
  current?: ModelLooks,
  replace = false,
): ModelLooks {
  const out: Record<string, MaterialLook> = {};
  for (const m of materials) {
    const keep = current?.materials[m.name];
    if (keep && !replace) {
      out[m.name] = keep;
      continue;
    }
    const look = guessLook(m);
    if (look !== 'default') out[m.name] = { look };
  }
  return { materials: out, seeThroughEyes: current?.seeThroughEyes ?? true };
}
