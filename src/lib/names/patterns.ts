// Rule-based English guesses for non-standard names: side prefixes/suffixes, IK / D / EX suffixes,
// numbers, and a token table of common name parts. Only used when every non-ASCII character is
// covered by a known token, so guesses are approximate but never half-translated.

import { normalizeName } from './normalize';

const TOKENS: Record<string, string> = {
  // Body
  全ての親: 'Master',
  センター: 'Center',
  グルーブ: 'Groove',
  上半身: 'Upper Body',
  下半身: 'Lower Body',
  腰: 'Waist',
  首: 'Neck',
  頭: 'Head',
  肩: 'Shoulder',
  腕: 'Arm',
  ひじ: 'Elbow',
  肘: 'Elbow',
  手首: 'Wrist',
  手: 'Hand',
  指: 'Finger',
  親指: 'Thumb',
  人指: 'Index',
  人差指: 'Index',
  中指: 'Middle',
  薬指: 'Ring',
  小指: 'Little',
  足: 'Leg',
  脚: 'Leg',
  ひざ: 'Knee',
  膝: 'Knee',
  足首: 'Ankle',
  つま先: 'Toe',
  足先: 'Toe',
  胸: 'Chest',
  乳: 'Breast',
  おっぱい: 'Breast',
  尻: 'Hip',
  体: 'Body',
  肌: 'Skin',
  顎: 'Jaw',
  あご: 'Jaw',
  耳: 'Ear',
  鼻: 'Nose',
  頬: 'Cheek',
  ほほ: 'Cheek',
  目: 'Eye',
  眼: 'Eye',
  瞳: 'Pupil',
  眉: 'Brow',
  まぶた: 'Eyelid',
  瞼: 'Eyelid',
  口: 'Mouth',
  舌: 'Tongue',
  歯: 'Teeth',
  唇: 'Lip',
  尻尾: 'Tail',
  しっぽ: 'Tail',
  両: 'Both',
  // Hair / clothes
  髪: 'Hair',
  前髪: 'Bangs',
  後髪: 'Back Hair',
  横髪: 'Side Hair',
  もみあげ: 'Sideburn',
  アホ毛: 'Ahoge',
  おさげ: 'Braid',
  ツインテ: 'Twintail',
  ツインテール: 'Twintail',
  ポニテ: 'Ponytail',
  ポニーテール: 'Ponytail',
  スカート: 'Skirt',
  リボン: 'Ribbon',
  袖: 'Sleeve',
  裾: 'Hem',
  襟: 'Collar',
  服: 'Clothes',
  上着: 'Jacket',
  ネクタイ: 'Tie',
  帽子: 'Hat',
  靴: 'Shoe',
  手袋: 'Glove',
  ベルト: 'Belt',
  マント: 'Cape',
  フード: 'Hood',
  コート: 'Coat',
  パーカー: 'Hoodie',
  ズボン: 'Pants',
  飾り: 'Ornament',
  髪飾り: 'Hair Ornament',
  アクセ: 'Accessory',
  アクセサリ: 'Accessory',
  ヘッドホン: 'Headphones',
  眼鏡: 'Glasses',
  メガネ: 'Glasses',
  // Parts / modifiers
  先: 'Tip',
  親: 'Parent',
  捩: 'Twist',
  捩り: 'Twist',
  ねじり: 'Twist',
  補助: 'Helper',
  根: 'Root',
  元: 'Base',
  中: 'Mid',
  前: 'Front',
  後: 'Back',
  後ろ: 'Back',
  横: 'Side',
  上: 'Upper',
  下: 'Lower',
  外: 'Outer',
  内: 'Inner',
  回転: 'Rotation',
  操作: 'Control',
  調整: 'Adjust',
  揺れ: 'Sway',
  物理: 'Physics',
  連動: 'Link',
  剛体: 'Rigid Body',
  ダミー: 'Dummy',
  キャンセル: 'Cancel',
  位置: 'Position',
  材質: 'Material',
  ボーン: 'Bone',
  大: 'Large',
  小: 'Small',
  消: 'Off',
  消し: 'Off',
  光: 'Light',
  影: 'Shadow',
  表情: 'Expression',
  // Expressions
  笑: 'Smile',
  笑い: 'Smile',
  怒: 'Angry',
  怒り: 'Angry',
  涙: 'Tears',
  汗: 'Sweat',
  照れ: 'Blush',
  頬染め: 'Blush',
  閉じ: 'Close',
  開き: 'Open',
  上げ: 'Up',
  下げ: 'Down',
  広げ: 'Widen',
  寄せ: 'Together',
};

const MAX_TOKEN = Math.max(...Object.keys(TOKENS).map((k) => k.length));
const SEPARATOR = /[\s._\-・／/]/;
const ASCII = /[A-Za-z0-9]/;

/** Particles that join words and carry no meaning in a label. */
const SKIP = new Set(['の']);

const capitalize = (w: string): string => (/^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w);

/** English guess for a name, or null when it can't be fully covered. */
export function guessName(name: string): string | null {
  let s = normalizeName(name);
  if (!s) return null;
  let side = '';
  if (s.startsWith('左') || s.startsWith('右')) {
    side = s[0] === '左' ? 'Left' : 'Right';
    s = s.slice(1);
  } else if (/[左右]$/.test(s) && s.length > 1) {
    side = s.endsWith('左') ? 'Left' : 'Right';
    s = s.slice(0, -1);
  } else {
    const m = /^(.*?)[._]?([LR])$/.exec(s);
    if (m && m[1] && !ASCII.test(m[1].slice(-1))) {
      side = m[2] === 'L' ? 'Left' : 'Right';
      s = m[1];
    }
  }
  const words: string[] = [];
  let japanese = false;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (SEPARATOR.test(ch) || SKIP.has(ch)) {
      i++;
      continue;
    }
    if (ASCII.test(ch)) {
      let j = i;
      while (j < s.length && ASCII.test(s[j])) j++;
      words.push(s.slice(i, j));
      i = j;
      continue;
    }
    let hit = '';
    for (let n = Math.min(MAX_TOKEN, s.length - i); n > 0; n--) {
      const t = s.slice(i, i + n);
      if (TOKENS[t]) {
        hit = t;
        break;
      }
    }
    if (!hit) return null;
    words.push(TOKENS[hit]);
    japanese = true;
    i += hit.length;
  }
  if (!japanese) return null;
  return [side, ...words].filter(Boolean).map(capitalize).join(' ');
}
