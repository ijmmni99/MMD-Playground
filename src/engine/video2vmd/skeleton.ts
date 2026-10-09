import type { Vec3 } from './math';

/** One bone of the target model, rest position in model space (MMD units). */
export interface SkeletonBone {
  name: string;
  parent: number;
  position: Vec3;
}

export interface Skeleton {
  /** Model name (written into the VMD header). */
  name: string;
  bones: SkeletonBone[];
}

/** Bones the converter reads or drives. */
export const BONE = {
  root: '全ての親',
  center: 'センター',
  groove: 'グルーブ',
  upper: '上半身',
  upper2: '上半身2',
  lower: '下半身',
  neck: '首',
  head: '頭',
  shoulder: (s: Side) => `${s}肩`,
  arm: (s: Side) => `${s}腕`,
  elbow: (s: Side) => `${s}ひじ`,
  wrist: (s: Side) => `${s}手首`,
  middle1: (s: Side) => `${s}中指１`,
  index1: (s: Side) => `${s}人指１`,
  pinky1: (s: Side) => `${s}小指１`,
  leg: (s: Side) => `${s}足`,
  knee: (s: Side) => `${s}ひざ`,
  ankle: (s: Side) => `${s}足首`,
  toe: (s: Side) => `${s}つま先`,
  legIk: (s: Side) => `${s}足ＩＫ`,
  toeIk: (s: Side) => `${s}つま先ＩＫ`,
} as const;

export type Side = '左' | '右';
export const SIDES: Side[] = ['左', '右'];

type Def = [name: string, parent: string | null, position: Vec3];

const LEFT: Def[] = [
  ['左肩', '上半身2', [0.25, 15.3, 0.5]],
  ['左腕', '左肩', [1.5, 15.0, 0.6]],
  ['左ひじ', '左腕', [3.3, 13.5, 0.7]],
  ['左手首', '左ひじ', [5.0, 12.0, 0.7]],
  ['左親指０', '左手首', [5.25, 11.65, 0.15]],
  ['左親指１', '左親指０', [5.52, 11.41, 0.15]],
  ['左親指２', '左親指１', [5.79, 11.17, 0.15]],
  ['左人指１', '左手首', [5.7, 11.4, 0.35]],
  ['左人指２', '左人指１', [5.97, 11.16, 0.35]],
  ['左人指３', '左人指２', [6.24, 10.92, 0.35]],
  ['左中指１', '左手首', [5.8, 11.3, 0.65]],
  ['左中指２', '左中指１', [6.07, 11.06, 0.65]],
  ['左中指３', '左中指２', [6.34, 10.82, 0.65]],
  ['左薬指１', '左手首', [5.72, 11.3, 0.85]],
  ['左薬指２', '左薬指１', [5.99, 11.06, 0.85]],
  ['左薬指３', '左薬指２', [6.26, 10.82, 0.85]],
  ['左小指１', '左手首', [5.6, 11.3, 1.0]],
  ['左小指２', '左小指１', [5.87, 11.06, 1.0]],
  ['左小指３', '左小指２', [6.14, 10.82, 1.0]],
  ['左目', '頭', [0.3, 17.4, -0.55]],
  ['左足', '下半身', [0.9, 10.6, 0.3]],
  ['左ひざ', '左足', [0.95, 6.0, 0.2]],
  ['左足首', '左ひざ', [1.0, 1.3, 0.6]],
  ['左つま先', '左足首', [1.0, 0.0, -1.4]],
  ['左足ＩＫ', '全ての親', [1.0, 1.3, 0.6]],
  ['左つま先ＩＫ', '左足ＩＫ', [1.0, 0.0, -1.4]],
];

const STANDARD: Def[] = [
  ['全ての親', null, [0, 0, 0]],
  ['センター', '全ての親', [0, 8.0, 0]],
  ['グルーブ', 'センター', [0, 8.2, 0]],
  ['上半身', 'グルーブ', [0, 11.6, 0.2]],
  ['上半身2', '上半身', [0, 13.0, 0.3]],
  ['首', '上半身2', [0, 15.6, 0.4]],
  ['頭', '首', [0, 16.4, 0.3]],
  ['両目', '頭', [0, 17.6, -0.4]],
  ['下半身', 'グルーブ', [0, 11.6, 0.2]],
  ...LEFT,
  ...LEFT.map(([n, p, pos]): Def => [
    n.replace('左', '右'),
    p && p.startsWith('左') ? p.replace('左', '右') : p,
    [-pos[0], pos[1], pos[2]],
  ]),
];

/** Standard MMD skeleton (approximate proportions of a ~20-unit-tall model) for when no model is loaded. */
export function standardSkeleton(): Skeleton {
  const index = new Map(STANDARD.map(([n], i) => [n, i]));
  return {
    name: 'MMD Studio',
    bones: STANDARD.map(([name, parent, position]) => ({
      name,
      parent: parent === null ? -1 : (index.get(parent) ?? -1),
      position: [...position],
    })),
  };
}

/** Name → index lookup plus helpers. */
export class SkeletonIndex {
  readonly byName = new Map<string, number>();
  /** Bones ordered so every parent comes before its children. */
  readonly order: number[];

  constructor(readonly skeleton: Skeleton) {
    skeleton.bones.forEach((b, i) => {
      if (!this.byName.has(b.name)) this.byName.set(b.name, i);
    });
    const depth = skeleton.bones.map((_, i) => {
      let d = 0;
      let p = skeleton.bones[i].parent;
      while (p >= 0 && d < 512) {
        d++;
        p = skeleton.bones[p].parent;
      }
      return d;
    });
    this.order = skeleton.bones.map((_, i) => i).sort((a, b) => depth[a] - depth[b] || a - b);
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  index(name: string): number {
    return this.byName.get(name) ?? -1;
  }

  pos(name: string): Vec3 | null {
    const i = this.byName.get(name);
    return i === undefined ? null : this.skeleton.bones[i].position;
  }
}
