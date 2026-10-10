import { describe, expect, it } from 'vitest';
import type { PmxModel, V3 } from '@/lib/convert/pmx/types';
import { writePmx } from '@/lib/convert/pmx/writer';
import { checkModel, hasErrors } from './check';
import { makeEditFixture } from './fixture';
import {
  canRedo,
  canUndo,
  commit,
  emptyHistory,
  endCoalesce,
  HISTORY_DEPTH,
  redo,
  replaceAll,
  undo,
} from './history';
import { checkMerge } from './merge';
import { applyOps, materialVertices, type Op } from './ops';
import { EMPTY_OUTFIT, materialGroups, outfitWarnings, type OutfitState } from './outfit';
import { readPmx } from './pmxRead';
import { partWeights, PRESETS, type ProportionState } from './proportions';
import { boneIndex, morphIndex } from './refs';

const base = makeEditFixture().pmx;
const bi = (m: PmxModel, n: string): number => boneIndex(m, n);
const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const minY = (m: PmxModel): number => Math.min(...m.vertices.map((v) => v.position[1]));
const scale = (overall: number, length = 1, thickness = 1) => ({ overall, length, thickness });
const props = (parts: ProportionState['parts']): Op => ({ type: 'proportions', state: { parts } });
const outfit = (s: Partial<OutfitState>): Op => ({ type: 'outfit', state: { ...EMPTY_OUTFIT, ...s } });

/** Every edited model must stay valid and survive a write → read trip. */
async function valid(m: PmxModel): Promise<void> {
  expect(checkModel(m).filter((i) => i.level === 'error')).toEqual([]);
  const back = await readPmx(writePmx(m));
  expect(back.vertices.length).toBe(m.vertices.length);
  expect(back.bones.length).toBe(m.bones.length);
}

describe('applyOps basics', () => {
  it('never mutates the original and an empty list is a deep copy', () => {
    const before = JSON.stringify(base.bones);
    const r = applyOps(base, [props({ handL: scale(2) }), { type: 'boneDelete', name: '左腕捩' }]);
    expect(JSON.stringify(base.bones)).toBe(before);
    expect(r.pmx.bones.length).toBe(base.bones.length - 1);
    expect(applyOps(base, []).pmx).not.toBe(base);
  });

  it('material patch, texture slot with an asset, texture replace', async () => {
    const top = base.materials.findIndex((m) => m.name === 'トップス');
    const r = applyOps(base, [
      { type: 'material', index: top, patch: { diffuse: [1, 0, 0, 1], edgeSize: 2 } },
      { type: 'materialTexture', index: top, slot: 'texture', path: 'tex/edit/top_red.png', asset: 'a1' },
      { type: 'textureReplace', from: 'tex/face.png', to: 'tex/edit/face_small.png', asset: 'a2' },
      { type: 'material', index: 99, patch: { edgeSize: 1 } },
    ]);
    const mat = r.pmx.materials[top];
    expect(mat.diffuse).toEqual([1, 0, 0, 1]);
    expect(r.pmx.textures[mat.texture]).toBe('tex/edit/top_red.png');
    expect(r.pmx.textures).toContain('tex/edit/face_small.png');
    expect(r.pmx.textures).not.toContain('tex/face.png');
    expect(r.assets).toEqual({ 'tex/edit/top_red.png': 'a1', 'tex/edit/face_small.png': 'a2' });
    expect(r.warnings).toEqual(['Material #99 not found']);
    await valid(r.pmx);
  });

  it('model info and display frames by name', () => {
    const r = applyOps(base, [
      { type: 'info', nameEn: 'Edited', comment: 'new' },
      {
        type: 'frames',
        frames: [
          {
            name: '腕',
            nameEn: 'Arms',
            special: false,
            items: [
              { kind: 'bone', name: '左腕' },
              { kind: 'morph', name: 'あ' },
              { kind: 'bone', name: 'nope' },
            ],
          },
        ],
      },
    ]);
    expect(r.pmx.nameEn).toBe('Edited');
    expect(r.pmx.name).toBe(base.name);
    expect(r.pmx.frames).toEqual([
      {
        name: '腕',
        nameEn: 'Arms',
        special: false,
        items: [
          { kind: 'bone', index: bi(base, '左腕') },
          { kind: 'morph', index: morphIndex(base, 'あ') },
        ],
      },
    ]);
  });
});

describe('history', () => {
  const op = (i: number): Op => ({ type: 'material', index: 0, patch: { edgeSize: i } });
  it('undo / redo restore op lists', () => {
    let h = emptyHistory();
    h = commit(h, op(1));
    h = commit(h, op(2));
    expect(h.ops.length).toBe(2);
    h = undo(h);
    expect(h.ops).toEqual([op(1)]);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.ops.length).toBe(2);
    h = undo(undo(h));
    expect(h.ops).toEqual([]);
    expect(canUndo(h)).toBe(false);
    h = commit(h, op(3));
    expect(canRedo(h)).toBe(false);
  });

  it('a drag coalesces into one step, ended by pointer up', () => {
    let h = emptyHistory();
    for (let i = 0; i < 20; i++) h = commit(h, op(i), 'drag');
    expect(h.ops).toEqual([op(19)]);
    expect(h.past.length).toBe(1);
    h = endCoalesce(h);
    h = commit(h, op(50), 'drag');
    expect(h.ops.length).toBe(2);
    h = undo(h);
    expect(h.ops).toEqual([op(19)]);
  });

  it('keeps at least 200 steps, at most the depth', () => {
    let h = emptyHistory();
    for (let i = 0; i < 300; i++) h = commit(h, op(i));
    expect(h.past.length).toBe(HISTORY_DEPTH);
    expect(HISTORY_DEPTH).toBeGreaterThanOrEqual(200);
    for (let i = 0; i < 200; i++) h = undo(h);
    expect(h.ops.length).toBe(100);
  });

  it('singleton ops replace their earlier copy; replaceAll is one step', () => {
    let h = emptyHistory();
    h = commit(h, props({ head: scale(1.2) }));
    h = commit(h, op(1));
    h = commit(h, props({ head: scale(1.4) }));
    expect(h.ops.filter((o) => o.type === 'proportions').length).toBe(1);
    h = replaceAll(h, []);
    expect(h.ops).toEqual([]);
    expect(undo(h).ops.length).toBe(2);
  });
});

describe('proportions', () => {
  it('bigger hands move only hand / finger vertices and keep the wrist seam closed', async () => {
    const r = applyOps(base, [props({ handL: scale(1.6), fingersL: scale(1.6) })]).pmx;
    const hand = partWeights(base, 'handL');
    const fingers = partWeights(base, 'fingersL');
    let movedOutside = 0;
    let movedInside = 0;
    base.vertices.forEach((v, i) => {
      const d = dist(v.position, r.vertices[i].position);
      if (hand[i] + fingers[i] === 0 && d > 1e-6) movedOutside++;
      if (hand[i] + fingers[i] > 0.9 && d > 0.05) movedInside++;
    });
    expect(movedOutside).toBe(0);
    expect(movedInside).toBeGreaterThan(20);
    // Seam: no edge in the arm / hand mesh stretches by more than the scale.
    let worst = 0;
    for (let i = 0; i < base.indices.length; i += 3)
      for (let k = 0; k < 3; k++) {
        const a = base.indices[i + k];
        const b = base.indices[i + ((k + 1) % 3)];
        const d0 = dist(base.vertices[a].position, base.vertices[b].position);
        if (d0 < 1e-4) continue;
        worst = Math.max(worst, dist(r.vertices[a].position, r.vertices[b].position) / d0);
      }
    expect(worst).toBeLessThan(1.7);
    // The fingers' bones moved outward with the hand.
    const w = bi(base, '左手首');
    const tip = bi(base, '左中指３');
    expect(dist(r.bones[tip].position, r.bones[w].position)).toBeCloseTo(
      dist(base.bones[tip].position, base.bones[w].position) * 1.6,
      1,
    );
    expect(r.bones[w].position).toEqual(base.bones[w].position);
    await valid(r);
  });

  it('longer legs keep the feet on the floor, lift the hips and move IK, bodies and joints', async () => {
    const r = applyOps(base, [
      props({
        upperLegL: scale(1, 1.3),
        upperLegR: scale(1, 1.3),
        lowerLegL: scale(1, 1.3),
        lowerLegR: scale(1, 1.3),
      }),
    ]).pmx;
    expect(minY(r)).toBeCloseTo(minY(base), 4);
    const hip = (m: PmxModel) => m.bones[bi(m, '下半身')].position[1];
    const legLen = base.bones[bi(base, '左足')].position[1] - base.bones[bi(base, '左足首')].position[1];
    expect(hip(r) - hip(base)).toBeCloseTo(legLen * 0.3, 1);
    // IK handles sit on their ankles; toes stay on the ground.
    for (const J of ['左', '右']) {
      expect(dist(r.bones[bi(r, `${J}足ＩＫ`)].position, r.bones[bi(r, `${J}足首`)].position)).toBeLessThan(
        1e-6,
      );
      expect(
        dist(r.bones[bi(r, `${J}つま先ＩＫ`)].position, r.bones[bi(r, `${J}つま先`)].position),
      ).toBeLessThan(1e-6);
    }
    expect(r.bones[0].position).toEqual([0, 0, 0]);
    // The thigh collider follows and stretches.
    const thigh = base.rigidBodies.findIndex((b) => b.name === '左足');
    expect(r.rigidBodies[thigh].size[1]).toBeCloseTo(base.rigidBodies[thigh].size[1] * 1.3, 4);
    expect(r.rigidBodies[thigh].position[1]).toBeGreaterThan(base.rigidBodies[thigh].position[1]);
    // Skirt physics rides up with the hips.
    const skirtJoint = base.joints.findIndex((j) => /スカート/.test(j.name));
    expect(r.joints[skirtJoint].position[1] - base.joints[skirtJoint].position[1]).toBeCloseTo(
      legLen * 0.3,
      1,
    );
    // Weights still sum to 1.
    for (const v of r.vertices) expect(v.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    await valid(r);
  });

  it('bigger head scales its morphs; whole-body scale keeps feet down; presets apply', async () => {
    const blink = morphIndex(base, 'まばたき');
    const r = applyOps(base, [props({ head: scale(1.5) })]).pmx;
    const o0 = base.morphs[blink];
    const o1 = r.morphs[blink];
    if (o0.kind !== 'vertex' || o1.kind !== 'vertex') throw new Error('kind');
    expect(o1.offsets[0].offset[1]).toBeCloseTo(o0.offsets[0].offset[1] * 1.5, 5);
    const whole = applyOps(base, [props({ whole: scale(1.2) })]).pmx;
    expect(minY(whole)).toBeCloseTo(minY(base) * 1.2, 4);
    const top = (m: PmxModel) => Math.max(...m.vertices.map((v) => v.position[1]));
    expect(top(whole)).toBeCloseTo(top(base) * 1.2, 3);
    const chibi = applyOps(base, [{ type: 'proportions', state: PRESETS.Chibi }]).pmx;
    expect(top(chibi)).toBeLessThan(top(base));
    expect(minY(chibi)).toBeCloseTo(minY(base), 4);
    await valid(chibi);
  });

  it('only the last proportions op counts (no compounding)', () => {
    const a = applyOps(base, [props({ head: scale(1.3) })]).pmx;
    const b = applyOps(base, [props({ head: scale(2) }), props({ head: scale(1.3) })]).pmx;
    expect(b.vertices.map((v) => v.position)).toEqual(a.vertices.map((v) => v.position));
  });
});

describe('outfit', () => {
  it('auto-groups the fixture materials', () => {
    expect(materialGroups(base)).toEqual([
      'hair',
      'face',
      'body',
      'top',
      'bottom',
      'shoes',
      'gloves',
      'accessories',
    ]);
    expect(materialGroups(base, { ...EMPTY_OUTFIT, assign: { 7: 'hair' } })[7]).toBe('hair');
  });

  it('hiding the skirt makes it invisible and removes its physics', async () => {
    const r = applyOps(base, [outfit({ hidden: ['bottom'] })]);
    const skirt = base.materials.findIndex((m) => m.name === 'スカート');
    expect(r.hidden).toEqual([skirt]);
    expect(r.pmx.materials[skirt].diffuse[3]).toBe(0);
    expect(r.pmx.rigidBodies.some((b) => /スカート/.test(b.name))).toBe(false);
    expect(r.pmx.joints.some((j) => /スカート/.test(j.name))).toBe(false);
    // Body colliders stay.
    expect(r.pmx.rigidBodies.some((b) => b.name === '左足')).toBe(true);
    await valid(r.pmx);
    // Showing it again restores everything (the original is untouched).
    const back = applyOps(base, [outfit({ hidden: ['bottom'] }), outfit({ hidden: [] })]);
    expect(back.pmx.rigidBodies.length).toBe(base.rigidBodies.length);
  });

  it('hide body under the top collapses covered torso faces only', () => {
    const r = applyOps(base, [outfit({ hideBodyUnder: ['top'] })]).pmx;
    const body = base.materials.findIndex((m) => m.name === '体');
    let o = 0;
    for (let k = 0; k < body; k++) o += base.materials[k].indexCount;
    let collapsed = 0;
    for (let i = o; i < o + base.materials[body].indexCount; i += 3)
      if (r.indices[i] === r.indices[i + 1] && r.indices[i] === r.indices[i + 2]) collapsed++;
    expect(collapsed).toBeGreaterThan(10);
    expect(collapsed).toBeLessThan(base.materials[body].indexCount / 3 / 2);
  });

  it('warns about holes when hiding clothes with no body underneath', () => {
    expect(outfitWarnings(base, { ...EMPTY_OUTFIT, hidden: ['gloves'] })[0]).toMatch(
      /Gloves may leave holes/,
    );
    expect(outfitWarnings(base, { ...EMPTY_OUTFIT, hidden: ['top'] })).toEqual([]);
  });
});

describe('bones and IK', () => {
  it('rename, add, move, reparent (cycle refused)', async () => {
    const r = applyOps(base, [
      { type: 'boneRename', from: '左腕捩', to: '左腕ねじり' },
      { type: 'boneAdd', name: 'アホ毛', nameEn: 'ahoge', parent: '頭', position: [0, 18.5, 0] },
      { type: 'bone', name: '左ひじ', patch: { position: [4.4, 14, 0] } },
      { type: 'bone', name: '左腕', patch: { parent: '左手首' } },
      { type: 'boneRename', from: '右腕', to: '左腕' },
    ]);
    expect(bi(r.pmx, '左腕ねじり')).toBeGreaterThan(0);
    expect(r.pmx.bones[bi(r.pmx, 'アホ毛')].parent).toBe(bi(r.pmx, '頭'));
    expect(r.pmx.bones[bi(r.pmx, '左ひじ')].position[0]).toBe(4.4);
    expect(r.warnings).toEqual([
      'Bone "左腕" can\'t be parented to its own child "左手首"',
      'A bone named "左腕" already exists',
    ]);
    await valid(r.pmx);
  });

  it('delete moves weights, children and bodies to the parent', async () => {
    const r = applyOps(base, [{ type: 'boneDelete', name: '左ひじ' }]).pmx;
    expect(bi(r, '左ひじ')).toBe(-1);
    expect(r.bones[bi(r, '左手首')].parent).toBe(bi(r, '左腕'));
    const elbowVerts = base.vertices
      .map((v, i) => (v.bones.includes(bi(base, '左ひじ')) ? i : -1))
      .filter((i) => i >= 0);
    for (const i of elbowVerts)
      expect(r.vertices[i].bones.every((b) => b >= 0 && b < r.bones.length)).toBe(true);
    expect(r.rigidBodies.find((b) => b.name === '左ひじ')!.bone).toBe(bi(r, '左腕'));
    await valid(r);
  });

  it('IK edit, removal and left → right mirror', async () => {
    const r = applyOps(base, [
      {
        type: 'ik',
        name: '左足ＩＫ',
        ik: {
          target: '左足首',
          loop: 20,
          limit: 1,
          links: [
            { bone: '左ひざ', limit: { min: [-3, -0.1, -0.2], max: [-0.01, 0.3, 0.4] } },
            { bone: '左足' },
          ],
        },
      },
      { type: 'bone', name: '左ひざ', patch: { position: [1, 5.8, -0.1] } },
      { type: 'boneMirror', from: 'L' },
      { type: 'ik', name: '右つま先ＩＫ', ik: null },
    ]).pmx;
    const ikR = r.bones[bi(r, '右足ＩＫ')].ik!;
    expect(ikR.loop).toBe(20);
    expect(ikR.links[0].limit).toEqual({ min: [-3, -0.3, -0.4], max: [-0.01, 0.1, 0.2] });
    expect(r.bones[bi(r, '右ひざ')].position).toEqual([-1, 5.8, -0.1]);
    expect(r.bones[bi(r, '右つま先ＩＫ')].ik).toBeUndefined();
    await valid(r);
  });
});

describe('morphs', () => {
  it('group morph from sliders, rename, panel, scale, reorder, delete', async () => {
    const r = applyOps(base, [
      {
        type: 'morphGroup',
        name: 'ウィンク笑い',
        nameEn: 'wink smile',
        panel: 4,
        members: [
          { morph: 'まばたき', weight: 0.5 },
          { morph: 'あ', weight: 0.3 },
          { morph: 'nope', weight: 1 },
        ],
      },
      { type: 'morph', name: 'あ', patch: { name: 'あー', panel: 3 } },
      { type: 'morphScale', name: 'まばたき', factor: 2 },
      { type: 'morphOrder', names: ['ウィンク笑い'] },
      { type: 'morphDelete', name: 'にこり' },
    ]).pmx;
    expect(r.morphs[0].name).toBe('ウィンク笑い');
    const g = r.morphs[0];
    if (g.kind !== 'group') throw new Error('kind');
    expect(g.offsets.map((o) => [r.morphs[o.morph].name, o.weight])).toEqual([
      ['まばたき', 0.5],
      ['あー', 0.3],
    ]);
    // The old group 笑顔 (まばたき + にこり) lost the deleted member and still points at まばたき.
    const smile = r.morphs.find((m) => m.name === '笑顔')!;
    if (smile.kind !== 'group') throw new Error('kind');
    expect(smile.offsets.map((o) => r.morphs[o.morph].name)).toEqual(['まばたき']);
    const blink = r.morphs.find((m) => m.name === 'まばたき')!;
    const blink0 = base.morphs.find((m) => m.name === 'まばたき')!;
    if (blink.kind !== 'vertex' || blink0.kind !== 'vertex') throw new Error('kind');
    expect(blink.offsets[0].offset[1]).toBeCloseTo(blink0.offsets[0].offset[1] * 2);
    // The new morph is in the facial frame.
    expect(r.frames.find((f) => f.name === '表情')!.items.map((it) => r.morphs[it.index].name)).toContain(
      'ウィンク笑い',
    );
    await valid(r);
  });

  it('mirror copies left offsets onto the right', () => {
    const left = base.vertices
      .map((v, i) => (v.position[0] > 0.3 && v.bones[0] === bi(base, '頭') && v.position[2] < -0.5 ? i : -1))
      .filter((i) => i >= 0);
    const m0: PmxModel = structuredClone(base);
    m0.morphs.push({
      kind: 'vertex',
      name: '左ウィンク',
      nameEn: 'wink L',
      panel: 2,
      offsets: left.map((vertex) => ({ vertex, offset: [0.1, -0.1, 0] })),
    });
    const r = applyOps(m0, [{ type: 'morphMirror', name: '左ウィンク', to: '両ウィンク', from: 'L' }]).pmx;
    const both = r.morphs.find((m) => m.name === '両ウィンク')!;
    if (both.kind !== 'vertex') throw new Error('kind');
    expect(both.offsets.length).toBe(left.length * 2);
    const right = both.offsets.find((o) => r.vertices[o.vertex].position[0] < 0)!;
    expect(right.offset).toEqual([-0.1, -0.1, 0]);
  });
});

describe('physics', () => {
  it('presets change damping and joint limits; auto physics adds a chain', async () => {
    const skirt = base.rigidBodies
      .map((b, i) => (/スカート/.test(b.name) && b.mode !== 0 ? i : -1))
      .filter((i) => i >= 0);
    const soft = applyOps(base, [{ type: 'physicsPreset', bodies: skirt, preset: 'soft', sway: 1 }]).pmx;
    const stiff = applyOps(base, [{ type: 'physicsPreset', bodies: skirt, preset: 'stiff', sway: 0 }]).pmx;
    const j = soft.joints.findIndex((x) => x.b === skirt[0]);
    expect(soft.joints[j].rotateMax[0]).toBeGreaterThan(stiff.joints[j].rotateMax[0]);
    expect(stiff.joints[j].springRotate[0]).toBeGreaterThan(soft.joints[j].springRotate[0]);
    const r = applyOps(base, [
      { type: 'boneAdd', name: '尻尾1', nameEn: 'tail1', parent: '下半身', position: [0, 9.5, 1.2] },
      { type: 'boneAdd', name: '尻尾2', nameEn: 'tail2', parent: '尻尾1', position: [0, 8.5, 2] },
      { type: 'autoPhysics', bones: ['尻尾1', '尻尾2'], preset: 'soft', sway: 0.5 },
    ]).pmx;
    expect(r.rigidBodies.length).toBe(base.rigidBodies.length + 3);
    expect(r.joints.length).toBe(base.joints.length + 2);
    await valid(r);
  });

  it('auto physics collides with the model body, whatever collision groups the model uses', () => {
    // Real models often keep body colliders in another group that doesn't list the hair group.
    const m0: PmxModel = structuredClone(base);
    const colliders = m0.rigidBodies
      .map((r, i) => (r.mode === 0 && r.collidesWith ? i : -1))
      .filter((i) => i >= 0);
    for (const i of colliders) Object.assign(m0.rigidBodies[i], { group: 5, collidesWith: 1 << 5 });
    const tail: Op[] = [
      { type: 'boneAdd', name: '尻尾1', nameEn: 'tail1', parent: '下半身', position: [0, 9.5, 1.2] },
      { type: 'boneAdd', name: '尻尾2', nameEn: 'tail2', parent: '尻尾1', position: [0, 8.5, 2] },
      { type: 'boneAdd', name: '尻尾3', nameEn: 'tail3', parent: '尻尾2', position: [0, 7.5, 2.5] },
      { type: 'autoPhysics', bones: ['尻尾1', '尻尾2', '尻尾3'], preset: 'soft', sway: 0.5 },
    ];
    const r = applyOps(m0, tail).pmx;
    const tip = r.rigidBodies.find((b) => b.bone === bi(r, '尻尾3'))!;
    expect(tip.group).not.toBe(5);
    expect(tip.collidesWith & (1 << 5)).toBeTruthy();
    for (const i of colliders) expect(r.rigidBodies[i].collidesWith & (1 << tip.group)).toBeTruthy();
    // No body colliders at all: they're generated for the body parts.
    const bare: PmxModel = structuredClone(base);
    bare.joints = [];
    bare.rigidBodies = [];
    const g = applyOps(bare, tail).pmx;
    const tip2 = g.rigidBodies.find((b) => b.bone === bi(g, '尻尾3'))!;
    const hips = g.rigidBodies.find((b) => b.bone === bi(g, '下半身') && b.mode === 0 && b.collidesWith)!;
    expect(hips).toBeDefined();
    expect(hips.collidesWith & (1 << tip2.group)).toBeTruthy();
    expect(tip2.collidesWith & (1 << hips.group)).toBeTruthy();
  });

  it('body collisions: physics bodies collide with the body, inverted masks are repaired', () => {
    // Like a model converted before the mask fix: hair / skirt collide with everything except the body.
    const m0: PmxModel = structuredClone(base);
    for (const r of m0.rigidBodies) r.collidesWith = ~r.collidesWith & 0xffff;
    // Drop the leg colliders: they must be generated.
    const legs = new Set(['左ひざ', '右ひざ'].map((n) => bi(m0, n)));
    m0.rigidBodies = m0.rigidBodies.filter((r) => !(r.mode === 0 && legs.has(r.bone)));
    m0.joints = [];
    const r = applyOps(m0, [{ type: 'bodyCollisions' }]).pmx;
    const colliders = r.rigidBodies.filter((b) => b.mode === 0 && b.collidesWith);
    const group = colliders[0].group;
    expect(colliders.every((b) => b.group === group)).toBe(true);
    expect(r.rigidBodies.some((b) => b.mode === 0 && b.bone === bi(r, '左ひざ'))).toBe(true);
    const dyn = r.rigidBodies.filter((b) => b.mode !== 0);
    const colliding = dyn.filter((b) => b.collidesWith);
    expect(colliding.length).toBeGreaterThan(dyn.length / 2);
    for (const b of colliding) {
      expect(b.collidesWith).toBe(1 << group);
      expect(b.group).not.toBe(group);
      for (const c of colliders) expect(c.collidesWith & (1 << b.group)).toBeTruthy();
    }
  });

  it('rigid body and joint patches; NaN is reported', () => {
    const r = applyOps(base, [
      { type: 'rigidBody', index: 0, patch: { mass: 3, mode: 1 } },
      { type: 'joint', index: 0, patch: { springRotate: [5, 5, 5] } },
      { type: 'rigidBody', index: 1, patch: { size: [Number.NaN, 1, 1] } },
    ]).pmx;
    expect(r.rigidBodies[0].mass).toBe(3);
    expect(r.joints[0].springRotate).toEqual([5, 5, 5]);
    expect(hasErrors(checkModel(r))).toBe(true);
  });

  it('attach to bone fixes unweighted accessories', () => {
    const ribbon = base.materials.findIndex((m) => m.name === 'リボン');
    const m0: PmxModel = structuredClone(base);
    for (const v of materialVertices(m0, [ribbon]))
      m0.vertices[v] = { ...m0.vertices[v], bones: [0], weights: [1] };
    const r = applyOps(m0, [{ type: 'attach', materials: [ribbon], bone: '頭' }]).pmx;
    for (const v of materialVertices(r, [ribbon])) expect(r.vertices[v].bones).toEqual([bi(r, '頭')]);
  });
});

describe('clothes swap', () => {
  const donor = makeEditFixture({
    name: 'ドナー',
    materials: ['ジャケット', 'スカート'],
    topName: 'ジャケット',
    topColor: [0.8, 0.2, 0.2],
  }).pmx;
  const donors = { d1: { pmx: donor, label: 'Donor' } };

  it('appends the jacket with textures, maps bones and adds extra chains with free names', async () => {
    const jacket = donor.materials.findIndex((m) => m.name === 'ジャケット');
    const skirt = donor.materials.findIndex((m) => m.name === 'スカート');
    const r = applyOps(base, [{ type: 'merge', donor: 'd1', materials: [jacket, skirt], label: 'Donor' }], {
      donors,
    });
    expect(r.warnings).toEqual([]);
    const m = r.pmx;
    expect(m.materials.length).toBe(base.materials.length + 2);
    expect(m.materials[base.materials.length].name).toBe('ジャケット');
    expect(m.textures).toContain('tex/Donor/top.png');
    expect(r.donorFiles['tex/Donor/top.png']).toEqual({ donor: 'd1', path: 'tex/top.png' });
    // The donor's skirt chain came in as new bones (スカート前1_2…), with its physics.
    expect(bi(m, 'スカート前1_2')).toBeGreaterThan(0);
    expect(m.bones[bi(m, 'スカート前1_2')].parent).toBe(bi(m, '下半身'));
    expect(m.rigidBodies.length).toBeGreaterThan(base.rigidBodies.length);
    expect(m.joints.length).toBeGreaterThan(base.joints.length);
    // Jacket vertices follow the target's own torso bones.
    const jv = [...materialVertices(m, [base.materials.length])];
    expect(
      jv.every((v) => m.vertices[v].bones.every((b) => b === bi(m, '上半身') || b === bi(m, '上半身2'))),
    ).toBe(true);
    await valid(m);
    // With the body under it hidden.
    const hidden = applyOps(
      base,
      [
        { type: 'merge', donor: 'd1', materials: [jacket], label: 'Donor' },
        outfit({ assign: { [base.materials.length]: 'top' }, hidden: [], hideBodyUnder: ['top'] }),
      ],
      { donors },
    );
    expect(hidden.pmx.indices.length).toBe(m.indices.length - donor.materials[skirt].indexCount);
  });

  it('refuses a different skeleton with a clear message', () => {
    const other: PmxModel = structuredClone(donor);
    other.bones.forEach((b, i) => (b.name = `Bone${i}`));
    expect(checkMerge(base, other, [0])).toBeNull(); // non-standard names: all added as new bones
    const missing: PmxModel = structuredClone(base);
    missing.bones[bi(missing, '上半身2')].name = '胸';
    expect(checkMerge(missing, donor, [0])).toMatch(/doesn't have: 上半身2/);
    const r = applyOps(missing, [{ type: 'merge', donor: 'd1', materials: [0], label: 'Donor' }], { donors });
    expect(r.warnings[0]).toMatch(/same skeleton/);
    expect(applyOps(base, [{ type: 'merge', donor: 'x', materials: [0], label: 'Gone' }]).warnings).toEqual([
      'Clothes source "Gone" is not loaded',
    ]);
  });
});
