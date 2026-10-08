import { describe, expect, it } from 'vitest';
import { makeHumanoid } from './fixture';
import { parseGltf } from './gltf';

describe('glTF / VRM parsing', () => {
  it('reads a skinned Mixamo-style GLB', () => {
    const f = makeHumanoid({ style: 'mixamo' });
    const m = parseGltf(f.bytes, undefined, 'test.glb');
    expect(m.format).toBe('glb');
    expect(m.warnings).toEqual([]);
    // Every skeleton bone plus the Armature root.
    expect(m.bones.length).toBe(f.names.length + 1);
    const hips = m.bones.find((b) => b.name === 'mixamorig:Hips')!;
    expect(hips.position[1]).toBeCloseTo(0.95, 5);
    const lhand = m.bones.find((b) => b.name === 'mixamorig:LeftHand')!;
    expect(lhand.position[0]).toBeGreaterThan(0.5);
    expect(m.meshes).toHaveLength(2);
    expect(m.meshes[0].morphs.map((x) => x.name)).toEqual(['eyesClosed', 'jawOpen', 'eyeBlinkRight']);
    expect(m.textures).toHaveLength(1);
    expect(m.materials[1].texture).toBe(0);
    // Bind-pose positions survive skinning (IBM · joint world = identity here).
    const ys = Array.from(m.meshes[0].positions).filter((_, i) => i % 3 === 1);
    expect(Math.min(...ys)).toBeGreaterThan(-0.1);
    expect(Math.max(...ys)).toBeLessThan(1.75);
    // Weights normalised, joint indices point at bones.
    const w = m.meshes[0].weights;
    for (let v = 0; v < w.length / 4; v++) expect(w[v * 4] + w[v * 4 + 1] + w[v * 4 + 2] + w[v * 4 + 3]).toBeCloseTo(1, 5);
    expect(Math.max(...m.meshes[0].joints)).toBeLessThan(m.bones.length);
    // Fixture boxes face outward (24 verts per box).
    const mesh = m.meshes[0];
    let out = 0;
    for (let b = 0; b < mesh.positions.length / 3; b += 24) {
      const c = [0, 1, 2].map((k) => Array.from({ length: 24 }, (_, i) => mesh.positions[(b + i) * 3 + k]).reduce((x, y) => x + y) / 24);
      for (let v = b; v < b + 24; v++) out += [0, 1, 2].reduce((s, k) => s + (mesh.positions[v * 3 + k] - c[k]) * mesh.normals[v * 3 + k], 0) > 0 ? 1 : 0;
    }
    expect(out).toBe(mesh.positions.length / 3);
  });

  it('reads VRM 1.0 humanoid, expressions, spring bones and license', () => {
    const m = parseGltf(makeHumanoid({ style: 'vrm', vrm: 1 }).bytes);
    expect(m.format).toBe('vrm1');
    expect(m.bones[m.humanoid!.hips!].name).toBe('J_Bip_C_Hips');
    expect(m.bones[m.humanoid!.leftUpperArm!].name).toBe('J_Bip_L_UpperArm');
    expect(m.expressions!.map((e) => e.preset)).toEqual(['blink', 'aa']);
    expect(m.expressions![0].binds[0]).toEqual({ mesh: 0, morph: 0, weight: 1 });
    expect(m.springs!.chains.length).toBe(5);
    expect(m.springs!.chains[0].joints.length).toBe(3);
    expect(m.springs!.colliders).toHaveLength(1);
    expect(m.license).toMatchObject({ author: 'MMD Studio', commercial: 'personalNonProfit', redistribution: 'not allowed' });
  });

  it('reads VRM 0.x (thumb renaming, blend shape groups, secondary animation)', () => {
    const m = parseGltf(makeHumanoid({ style: 'vrm', vrm: 0, facingBack: true }).bytes);
    expect(m.format).toBe('vrm0');
    expect(m.bones[m.humanoid!.leftThumbMetacarpal!].name).toBe('J_Bip_L_Thumb1');
    expect(m.expressions!.map((e) => e.preset)).toEqual(['blink', 'aa']);
    expect(m.expressions![0].binds[0].weight).toBe(1);
    expect(m.springs!.chains.map((c) => c.joints.length)).toEqual([3, 3, 3, 3, 3]);
    expect(m.license).toMatchObject({ commercial: 'Disallow', licenseName: 'CC_BY' });
  });
});
