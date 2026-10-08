# Model Converter plan (FBX / VRM / glTF / GLB → PMX)

Everything runs in the browser. Heavy work (parsing, conversion, PMX writing) runs in a Web Worker;
texture decode / downscale runs where `OffscreenCanvas` / `createImageBitmap` exist (worker), else main thread.

## Layers

| Layer | Path | Notes |
|---|---|---|
| Pure logic | `src/lib/convert/` | framework-agnostic, unit-tested in Node (vitest) |
| Parsers | `src/lib/convert/gltf.ts` (glTF/GLB/VRM 0.x + 1.0), `src/lib/convert/fbx.ts` (three `FBXLoader` adapter) | both produce `SourceModel` |
| Worker | `src/lib/convert/convert.worker.ts` | parse → convert → write, progress + cancel |
| Engine | `src/engine/impl/…` | source-model preview mesh (original vs converted) |
| UI | `src/features/model-converter/` | stepper panel, mapping screen, review tables |
| State | `src/store/converter.ts` | Zustand slice |

## Intermediate data model

`SourceModel` (one shape for every input format), in **glTF space**: right-handed, +Y up, model faces +Z,
model's left at +X, metres (FBX unit scale applied at parse time).

- `bones[]`: `{ name, parent, world: Mat4 }` — bind-pose world matrix (column-major).
- `meshes[]`: bind-pose world-space `positions`, `normals`, `uvs`, triangle `indices`, `joints`/`weights`
  (4 per vertex, indices into `bones`), `materialIndex`, `morphs[]` (`{ name, delta positions }`).
- `materials[]`: base color, texture index, alpha mode/cutoff, double-sided, emissive, optional MToon
  (`shadeColor`, `outlineWidth`, `outlineColor`).
- `textures[]`: `{ name, mime, data }`.
- `humanoid?`: VRM humanoid map (VRM 1.0 bone names; 0.x mapped to the same keys).
- `expressions?`: VRM blendshape groups / expressions `{ name, preset, binds: [{ mesh, morph, weight }] }`.
- `springs?`: chains `{ bones[], stiffness, drag, gravity, radius }`, colliders `{ bone, offset, radius }`.
- `license?`: VRM meta (title, author, allowed users, commercial, redistribution, modification, url, text).
- `meta`: `{ format, version, warnings[] }`.

Output `PmxModel` mirrors PMX 2.0 records 1:1 (`src/lib/convert/pmx/types.ts`) and is what the writer and
the validator take.

## Coordinates and scale

- glTF → PMX: `z → −z` for positions, normals, bone positions, morph deltas. A mirror flips handedness,
  so **every triangle's winding is reversed** (`a b c → a c b`) to keep fronts facing out (PMX front =
  clockwise in babylon-mmd's left-handed space).
- Model faces −Z after the flip (MMD convention), left side stays at +X.
- Scale: target height (default **20 units** ≈ 1.6 m character; adjustable) measured from the lowest vertex
  to the head top; feet placed at Y = 0, model centred on X/Z at the hips.
- Node transforms are already baked into bind-pose world positions; bones keep only positions (PMX bones
  have no rest rotation), so non-uniform scale and rotated roots vanish naturally. A model lying down /
  Z-up (head not above hips) is rotated upright first.

## Bone mapping

Canonical slots (VRM 1.0 humanoid names) → MMD names:

| slot | MMD | slot | MMD |
|---|---|---|---|
| hips | 下半身 (and センター/グルーブ/腰 above) | spine | 上半身 |
| chest / upperChest | 上半身2 | neck | 首 |
| head | 頭 | leftEye / rightEye | 左目 / 右目 (+ 両目) |
| leftShoulder | 左肩 (+ 左肩P) | leftUpperArm | 左腕 (+ 左腕捩) |
| leftLowerArm | 左ひじ (+ 左手捩) | leftHand | 左手首 |
| leftThumbMetacarpal/Proximal/Distal | 左親指０/１/２ | leftIndex/Middle/Ring/Little Proximal/Intermediate/Distal | 左人指/中指/薬指/小指 １/２/３ |
| leftUpperLeg | 左足 | leftLowerLeg | 左ひざ |
| leftFoot | 左足首 | leftToes | 左つま先 |

(right side mirrors with 右). Generated: 全ての親, センター, グルーブ, 腰 (optional), 足ＩＫ親/足ＩＫ/つま先ＩＫ,
optional 足D/ひざD/足首D, 腕捩/手捩, 肩P.

Name sources in priority order:
1. VRM humanoid map (confidence 1).
2. Known rig dictionaries: Mixamo (`mixamorig:LeftArm` …), Unity/VRoid (`J_Bip_L_UpperArm` …),
   3ds Max Biped (`Bip001 L UpperArm` …), Blender Rigify / generic (`upper_arm.L` …), plain
   (`LeftUpperArm`, `Hips`, `Spine`…). Confidence 0.95.
3. Generic heuristics: tokens (arm / forearm / hand / thigh / shin / calf / foot / toe / finger names,
   upper / lower / 1-2-3), side from `Left/Right`, `L/R`, `.L`, `_l`, `左/右`. Confidence 0.6–0.85.
4. Structure: hips = root of the three largest subtrees, legs = descending chains, arms = horizontal
   chains from the chest, side from X sign, fingers = children of hands ordered by X/Z. Confidence 0.4–0.6.

Required slots: hips, spine, head, both upper arms / lower arms / hands, both upper legs / lower legs / feet.
Any required slot under 0.5 → manual mapping screen. Fewer than 6 required slots found → non-humanoid
(static / partial rig, no dance claims).

Unmapped bones are kept (original names), parented to their nearest kept ancestor; their weights stay.

## Pose normalization

- Rest pose from the upper-arm direction angle below horizontal: < 15° T-pose, 25–50° A-pose, else other.
- Target A-pose angle (default 35°). The arm chain (upper arm and all descendants) is rotated about the
  shoulder joint around the model's forward axis, **and the mesh is re-skinned** to the new bind pose
  (LBS with the per-bone delta matrices; weights unchanged), so the new rest pose deforms cleanly.
- Legs: a slight knee bend (≈ 1–2°) is baked only into IK limits, not the mesh; knee IK links are
  limited to the X axis (MMD convention).
- Twist bones (腕捩/手捩) are fixed-axis bones along the limb; weights move from 腕/ひじ to them only when
  the source had twist bones (then mapped) — otherwise they're added with no weights.

## IK

足ＩＫ (target 足首, links ひざ [X-axis limit −180°…−0.5°], 足; loop 40, limit 2 rad·¼) and つま先ＩＫ
(target つま先, link 足首; loop 3, limit 4) under 左足IK親 / 右足IK親 under 全ての親. Verified with a
synthetic stepping VMD in the babylon-mmd runtime (knees bend forward only, feet reach targets).

## Morphs

VRM presets / expressions → まばたき, ウィンク (left), ウィンク右, あ, い, う, え, お, 笑い, 怒り, 困る, 喜び…;
other names via a synonym table (Japanese, English, ARKit, VRChat visemes, VRoid `Fcl_*`) with fuzzy
matching (normalised token overlap). Panels: eyebrow 1, eye 2, mouth 3, other 4. A target needing
several source morphs becomes a group morph over vertex morphs. Unmatched morphs are kept (panel 4).

## Physics generation

- Groups: body 0 (bone-following, collides with hair/skirt), hair/accessories 1, skirt 2, colliders 3.
  Non-collision masks: a chain never collides with itself or other chains; body colliders collide with all.
- Per chain: first rigid body bone-following (mode 0) on the chain root's parent, the rest physics
  (mode 1, or 2 = physics + bone position for stability); capsules along each segment, radius from VRM
  hit radius or 12 % of segment length; mass 1 → 0.3 down the chain.
- Joints: 6-DOF spring between consecutive bodies, rotation limits ±(20°…45°) from stiffness, spring
  rotation constants from stiffness, damping from drag (linear 0.5…0.99, angular 0.5…0.99).
- VRM 0.x `secondaryAnimation` / 1.0 `VRMC_springBone`: stiffness → angular spring / limits, drag →
  damping, gravityPower → mass, hitRadius → capsule radius; colliders → bone-following spheres.
- FBX/glTF: chains of unmapped bones whose names match hair/髪/skirt/スカート/tail/尻尾/ribbon/リボン/
  cloth/cape/sleeve/袖/ear/耳/bust/胸, or structurally hanging off head / hips / chest.
- Skirt: ring chains plus optional side joints; leg capsules (足, ひざ) and a hip capsule as colliders.
- Presets Soft / Skirt / Stiff, a global "less ↔ more sway" factor, per-chain toggles.

## PMX writer

PMX 2.0, UTF-16LE, index sizes chosen from counts (vertex 1/2/4 unsigned-ish per spec, others 1/2/4
signed), BDEF1/2/4, materials, bones (flags), morphs (vertex + group), display frames (Root, Center, IK,
Body, Arms, Legs, Fingers, Face, Physics, Other), rigid bodies, joints. A validator runs first: no NaN,
indices in range, weights sum to 1, no bone cycles, texture paths present, counts consistent.

Output ZIP: `model.pmx`, `tex/*`, `README.txt` (source, license, notes), `conversion-report.json`.

## Milestones

- [x] a. PMX writer + validator + round-trip through babylon-mmd `PmxReader`
- [ ] b. glTF / GLB / VRM → SourceModel (procedural fixture generator in tests)
- [ ] c. Normalization: axes, winding, scale, grounding
- [ ] d. Humanoid mapping + manual mapping UI
- [ ] e. A-pose rebind + axes / twist bones
- [ ] f. IK + display frames
- [ ] g. Materials + textures
- [ ] h. Morphs
- [ ] i. Physics: VRM spring bones, then heuristic chains
- [ ] j. FBX parsing
- [ ] k. Preview, studio integration, license, report, persistence
- [ ] l. Mobile, polish, e2e, docs
