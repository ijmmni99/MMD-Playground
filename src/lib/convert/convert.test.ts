import { PmxReader } from 'babylon-mmd/esm/Loader/Parser/pmxReader';
import { describe, expect, it } from 'vitest';
import { makeHumanoid, type FixtureStyle } from './fixture';
import { parseGltf } from './gltf';
import { analyzeName, assess, completeByStructure, mapByNames, REQUIRED } from './humanoid';
import { matchMorphName } from './morphs';
import { orient, scaleAndGround } from './normalize';
import { eulerForY } from './physics';
import { convertModel } from './pipeline';
import { writePmx } from './pmx/writer';
import { armAngle, detectRestPose, rebindArms } from './pose';

const load = (style: FixtureStyle, extra: Parameters<typeof makeHumanoid>[0] = {}) => parseGltf(makeHumanoid({ style, ...extra }).bytes);

describe('name analysis', () => {
  it('resolves sides and parts across naming styles', () => {
    expect(analyzeName('mixamorig:LeftForeArm')).toMatchObject({ side: 'left', core: 'forearm' });
    expect(analyzeName('J_Bip_R_UpperLeg')).toMatchObject({ side: 'right', core: 'upperleg' });
    expect(analyzeName('J_Bip_C_Hips')).toMatchObject({ side: null, core: 'hips' });
    expect(analyzeName('upper_arm.L')).toMatchObject({ side: 'left', core: 'upperarm' });
    expect(analyzeName('Bip001 R Calf')).toMatchObject({ side: 'right', core: 'calf' });
    expect(analyzeName('thigh_l')).toMatchObject({ side: 'left', core: 'thigh' });
    expect(analyzeName('左腕').side).toBe('left');
  });
});

describe('humanoid mapping', () => {
  for (const style of ['mixamo', 'vrm', 'blender'] as const) {
    it(`maps every required bone of a ${style} rig by name`, () => {
      const m = load(style);
      const map = mapByNames(m);
      for (const s of REQUIRED) expect(map[s]?.confidence ?? 0, s).toBeGreaterThanOrEqual(0.5);
      expect(m.bones[map.leftUpperArm!.bone].position[0]).toBeGreaterThan(0);
      expect(m.bones[map.rightLowerLeg!.bone].position[0]).toBeLessThan(0);
      expect(map.chest).toBeDefined();
      expect(map.leftIndexDistal).toBeDefined();
      expect(map.leftThumbMetacarpal).toBeDefined();
      expect(map.leftToes).toBeDefined();
    });
  }

  it('uses the VRM humanoid map with full confidence', () => {
    const m = load('vrm', { vrm: 1 });
    const r = assess(mapByNames(m));
    expect(r.weak).toEqual([]);
    expect(r.map.hips).toMatchObject({ confidence: 1, via: 'vrm' });
  });

  it('guesses a scrambled rig from its structure, flagged for review', () => {
    const m = load('scrambled');
    const names = mapByNames(m);
    expect(Object.keys(names)).toHaveLength(0);
    orient(m, names);
    scaleAndGround(m, 20);
    const map = completeByStructure(names, m.bones, 20);
    const r = assess(map);
    expect(r.humanoid).toBe(true);
    expect(r.weak.length).toBeGreaterThan(0); // structure = below the confidence threshold → review
    const f = makeHumanoid({ style: 'scrambled' });
    const key = (slot: keyof typeof map) => f.keys[f.names.indexOf(m.bones[map[slot]!.bone].name)];
    expect(key('hips')).toBe('hips');
    expect(key('head')).toBe('head');
    expect(key('leftUpperArm')).toBe('leftUpperArm');
    expect(key('rightHand')).toBe('rightHand');
    expect(key('leftLowerLeg')).toBe('leftLowerLeg');
    expect(key('rightFoot')).toBe('rightFoot');
    expect(key('leftShoulder')).toBe('leftShoulder');
  });
});

describe('normalization', () => {
  it('turns a model that faces −Z (VRM 0.x) and a centimetre rig upright, facing +Z, 20 units tall', () => {
    for (const opts of [{ vrm: 0 as const, facingBack: true }, { scale: 100 }]) {
      const m = load('vrm', opts);
      const map = mapByNames(m);
      orient(m, map);
      const s = scaleAndGround(m, 20, map.hips?.bone);
      expect(m.bones[map.leftUpperArm!.bone].position[0]).toBeGreaterThan(0);
      expect(m.bones[map.leftToes!.bone].position[2]).toBeGreaterThan(m.bones[map.leftFoot!.bone].position[2]);
      let minY = Infinity;
      let maxY = -Infinity;
      for (const mesh of m.meshes)
        for (let i = 1; i < mesh.positions.length; i += 3) {
          minY = Math.min(minY, mesh.positions[i]);
          maxY = Math.max(maxY, mesh.positions[i]);
        }
      expect(minY).toBeCloseTo(0, 4);
      expect(maxY).toBeCloseTo(20, 3);
      expect(s.scale).toBeGreaterThan(0);
    }
  });
});

describe('A-pose rebind', () => {
  it('detects the T-pose and re-skins the arms to the target angle', () => {
    const m = load('mixamo');
    const map = mapByNames(m);
    expect(detectRestPose(m, map).pose).toBe('T-pose');
    const handBone = map.leftHand!.bone;
    const pivot = [...m.bones[map.leftUpperArm!.bone].position];
    // A vertex fully weighted to the hand.
    const mesh = m.meshes[0];
    let v = -1;
    for (let i = 0; i < mesh.weights.length / 4; i++) if (mesh.joints[i * 4] === handBone && mesh.weights[i * 4] === 1) v = i;
    expect(v).toBeGreaterThanOrEqual(0);
    const before = [mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]];
    const r = rebindArms(m, map, 35);
    expect(r.left).toBeCloseTo(35, 3);
    expect(armAngle(m, map, 'left')).toBeCloseTo(35, 3);
    expect(armAngle(m, map, 'right')).toBeCloseTo(35, 3);
    // Rigidly weighted vertices rotate exactly with the arm about the shoulder joint.
    const a = (-35 * Math.PI) / 180;
    const x = before[0] - pivot[0];
    const y = before[1] - pivot[1];
    expect(mesh.positions[v * 3]).toBeCloseTo(pivot[0] + x * Math.cos(a) - y * Math.sin(a), 5);
    expect(mesh.positions[v * 3 + 1]).toBeCloseTo(pivot[1] + x * Math.sin(a) + y * Math.cos(a), 5);
    expect(mesh.positions[v * 3 + 2]).toBeCloseTo(before[2], 6);
    expect(detectRestPose(m, map).pose).toBe('A-pose');
  });
});

describe('morph names', () => {
  it('matches Japanese, VRoid, ARKit and VRChat names', () => {
    expect(matchMorphName('Fcl_EYE_Close')?.target).toBe('まばたき');
    expect(matchMorphName('Fcl_MTH_A')?.target).toBe('あ');
    expect(matchMorphName('eyeBlinkLeft')?.target).toBe('ウィンク');
    expect(matchMorphName('vrc.v_oh')?.target).toBe('お');
    expect(matchMorphName('jawOpen')?.target).toBe('あ');
    expect(matchMorphName('まばたき')).toEqual({ target: 'まばたき', confidence: 1 });
    expect(matchMorphName('Face_blink_both')?.target).toBe('まばたき');
    expect(matchMorphName('Tongue_out')).toBeNull();
  });
});

describe('capsule orientation', () => {
  it('turns local +Y onto a direction', () => {
    const d: [number, number, number] = [0.3, -0.8, 0.5];
    const [p, , r] = eulerForY(d);
    const l = Math.hypot(...d);
    expect(-Math.sin(r)).toBeCloseTo(d[0] / l, 6);
    expect(Math.cos(r) * Math.cos(p)).toBeCloseTo(d[1] / l, 6);
    expect(Math.cos(r) * Math.sin(p)).toBeCloseTo(d[2] / l, 6);
  });
});

describe('full conversion', () => {
  for (const [style, vrm] of [
    ['mixamo', undefined],
    ['vrm', 1],
    ['vrm', 0],
    ['blender', undefined],
  ] as const) {
    it(`converts a ${style}${vrm !== undefined ? ` VRM ${vrm}` : ''} model into a valid PMX`, async () => {
      const src = load(style, vrm !== undefined ? { vrm, facingBack: vrm === 0 } : {});
      const r = convertModel(src);
      expect(r.validation.filter((v) => v.level === 'error')).toEqual([]);
      expect(r.mapping.weak).toEqual([]);
      expect(r.report.humanoid).toBe(true);
      const names = r.pmx.bones.map((b) => b.name);
      for (const n of ['全ての親', 'センター', 'グルーブ', '上半身', '上半身2', '首', '頭', '下半身', '左肩', '左腕', '左腕捩', '左ひじ', '左手捩', '左手首', '左親指０', '左人指３', '左足', '左ひざ', '左足首', '左つま先', '左足ＩＫ', '左つま先ＩＫ', '右足IK親', '両目', '左目'])
        expect(names, n).toContain(n);
      const ik = r.pmx.bones[names.indexOf('左足ＩＫ')].ik!;
      expect(r.pmx.bones[ik.target].name).toBe('左足首');
      expect(ik.links.map((l) => r.pmx.bones[l.bone].name)).toEqual(['左ひざ', '左足']);
      // MMD space: model faces −Z (toes in front of the ankles), left side at +X.
      const toe = r.pmx.bones[names.indexOf('左つま先')].position;
      const ankle = r.pmx.bones[names.indexOf('左足首')].position;
      expect(toe[2]).toBeLessThan(ankle[2]);
      expect(r.pmx.bones[names.indexOf('左腕')].position[0]).toBeGreaterThan(0);
      // A-pose.
      const arm = r.pmx.bones[names.indexOf('左腕')].position;
      const elbow = r.pmx.bones[names.indexOf('左ひじ')].position;
      expect((Math.atan2(arm[1] - elbow[1], elbow[0] - arm[0]) * 180) / Math.PI).toBeCloseTo(35, 1);
      // Winding: PMX fronts have cross(b − a, c − a) along the vertex normal.
      let agree = 0;
      for (let t = 0; t < r.pmx.indices.length; t += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => r.pmx.vertices[r.pmx.indices[t + k]]);
        const u = b.position.map((v, k) => v - a.position[k]);
        const w = c.position.map((v, k) => v - a.position[k]);
        const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        if (n[0] * a.normal[0] + n[1] * a.normal[1] + n[2] * a.normal[2] > 0) agree++;
      }
      expect(agree / (r.pmx.indices.length / 3)).toBeGreaterThan(0.99);
      // Weights: ≤ 4, normalised.
      for (const v of r.pmx.vertices) {
        expect(v.bones.length).toBeLessThanOrEqual(4);
        expect(v.weights.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 5);
      }
      // Face morphs.
      const morphNames = r.pmx.morphs.map((x) => x.name);
      expect(morphNames).toContain('まばたき');
      expect(morphNames).toContain('あ');
      expect(r.pmx.morphs.find((x) => x.name === 'まばたき')!.panel).toBe(2);
      // Physics: hair + 4 skirt chains with joints, plus body colliders.
      expect(r.chains.length).toBeGreaterThanOrEqual(5);
      expect(r.chains.some((c) => c.kind === 'skirt')).toBe(true);
      expect(r.chains.some((c) => c.kind === 'hair')).toBe(true);
      expect(r.pmx.joints.length).toBeGreaterThanOrEqual(15);
      expect(r.pmx.rigidBodies.some((b) => b.mode === 1)).toBe(true);
      // Round trip through babylon-mmd.
      const back = await PmxReader.ParseAsync(writePmx(r.pmx));
      expect(back.bones.map((b) => b.name)).toEqual(names);
      expect(back.morphs.length).toBe(r.pmx.morphs.length);
      expect(back.materials.length).toBe(r.pmx.materials.length);
      expect(back.rigidBodies.length).toBe(r.pmx.rigidBodies.length);
      expect(back.joints.length).toBe(r.pmx.joints.length);
      expect(back.textures).toEqual(['tex/face_skin.png']);
    });
  }

  it('keeps VRM spring chains with their parameters', () => {
    const r = convertModel(load('vrm', { vrm: 1 }));
    const vrm = r.chains.filter((c) => c.source === 'vrm');
    expect(vrm).toHaveLength(5);
    expect(vrm.every((c) => c.vrm && c.bones.length === 3)).toBe(true);
  });

  it('converts a non-humanoid as a static model', () => {
    const src = load('mixamo', { secondary: false });
    // A "snake": five bones in a row along the ground, everything weighted to the first.
    src.bones = [0, 1, 2, 3, 4].map((i) => ({ name: `seg${i}`, parent: i - 1, position: [0, 0.1, i * 0.3] as [number, number, number] }));
    for (const mesh of src.meshes) {
      mesh.joints.fill(0);
      mesh.weights.fill(0);
      for (let v = 0; v < mesh.weights.length / 4; v++) mesh.weights[v * 4] = 1;
    }
    const r = convertModel(src);
    expect(r.report.humanoid).toBe(false);
    expect(r.pmx.bones.some((b) => b.ik)).toBe(false);
    expect(r.pmx.bones.map((b) => b.name)).toEqual(['全ての親', 'センター', 'seg0', 'seg1', 'seg2', 'seg3', 'seg4']);
    expect(r.report.warnings.join(' ')).toMatch(/humanoid/);
    expect(r.validation.filter((v) => v.level === 'error')).toEqual([]);
  });

  it('honours manual mapping and option toggles', () => {
    const src = load('scrambled');
    const auto = convertModel(src);
    expect(auto.mapping.weak.length).toBeGreaterThan(0);
    const fixed = convertModel(src, {
      mapping: Object.fromEntries(auto.mapping.weak.map((s) => [s, auto.map[s]!.bone])),
      aPose: false,
      rig: { twist: false, legD: true, shoulderP: true, waist: true },
    });
    expect(fixed.mapping.weak).toEqual([]);
    const names = fixed.pmx.bones.map((b) => b.name);
    expect(names).not.toContain('左腕捩');
    for (const n of ['左足D', '左ひざD', '左足首D', '左肩P', '左肩C', '腰']) expect(names).toContain(n);
    expect(fixed.report.armRotation).toEqual({ left: 0, right: 0 });
    expect(fixed.validation.filter((v) => v.level === 'error')).toEqual([]);
  });
});

describe('MMD-sourced models and loose textures', () => {
  it('reads Japanese MMD bone names in 左/右 and …L / …R styles', async () => {
    const { mmdSlot, canonicalMmdName } = await import('./humanoid');
    expect(mmdSlot('左腕')).toBe('leftUpperArm');
    expect(mmdSlot('腕L')).toBe('leftUpperArm');
    expect(mmdSlot('ひざR')).toBe('rightLowerLeg');
    expect(mmdSlot('中指１L')).toBe('leftMiddleProximal');
    expect(mmdSlot('親指０R')).toBe('rightThumbMetacarpal');
    expect(mmdSlot('上半身2')).toBe('chest');
    expect(mmdSlot('下半身')).toBe('hips');
    expect(mmdSlot('スカートC1R')).toBeNull();
    expect(canonicalMmdName('足ＩＫR')).toBe('右足ＩＫ');
    expect(canonicalMmdName('足IK親L')).toBe('左足IK親');
    expect(canonicalMmdName('スカートC1R')).toBe('右スカートC1');
    expect(canonicalMmdName('腕捩L')).toBe('左腕捩');
  });

  it('maps an MMD rig exported with …L / …R names and reuses its own helper bones', () => {
    const src = load('mixamo');
    const ja: Record<string, string> = {
      Hips: '下半身', Spine: '上半身', Spine1: '上半身2', Neck: '首', Head: '頭',
      LeftShoulder: '肩L', LeftArm: '腕L', LeftForeArm: 'ひじL', LeftHand: '手首L', LeftUpLeg: '足L', LeftLeg: 'ひざL', LeftFoot: '足首L', LeftToeBase: 'つま先L',
      RightShoulder: '肩R', RightArm: '腕R', RightForeArm: 'ひじR', RightHand: '手首R', RightUpLeg: '足R', RightLeg: 'ひざR', RightFoot: '足首R', RightToeBase: 'つま先R',
    };
    for (const b of src.bones) {
      const k = b.name.replace('mixamorig:', '');
      if (ja[k]) b.name = ja[k];
    }
    // The source's own IK target (weightless) must not be duplicated.
    src.bones.push({ name: '足ＩＫL', parent: 0, position: [0.09, 0.08, 0] });
    const r = convertModel(src);
    expect(r.mapping.weak).toEqual([]);
    expect(r.map.leftUpperArm?.via).toBe('dictionary');
    const names = r.pmx.bones.map((b) => b.name);
    expect(names.filter((n) => n === '左足ＩＫ')).toHaveLength(1);
    expect(names.some((n) => /足ＩＫ_/.test(n))).toBe(false);
  });

  it('links loose texture files by material name and drops outline shells', () => {
    const src = load('mixamo');
    // Like a Sketchfab export: no texture links, images beside the model, plus an outline duplicate.
    src.materials[0] = { ...src.materials[0], name: '体', texture: -1 };
    src.materials[1] = { ...src.materials[1], name: '前髪', texture: -1 };
    const png = src.textures[0].data;
    src.textures = [
      { name: 'face.png', mime: 'image/png', data: png, loose: true },
      { name: 'hair.png', mime: 'image/png', data: png, loose: true },
      { name: 'body.png', mime: 'image/png', data: png, loose: true },
    ];
    src.materials.push({ ...src.materials[0], name: 'OH_Outline_Material' });
    src.meshes.push({ ...src.meshes[0], material: 2 });
    const r = convertModel(src);
    expect(r.materials.map((m) => m.texture)).toEqual([2, 1, -1]);
    expect(r.pmx.textures.sort()).toEqual(['tex/body.png', 'tex/hair.png']);
    expect(r.pmx.materials.map((m) => m.name)).not.toContain('OH_Outline_Material');
    expect(r.report.fixes.join(' ')).toMatch(/outline/);
    // A manual choice wins.
    const edited = convertModel(src, { textureEdits: { 0: 0 } });
    expect(edited.materials[0].texture).toBe(0);
  });
});
