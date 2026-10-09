# Model Editor plan

A browser-only editor for loaded PMX models: body proportions, outfits, materials, bones / IK, morphs,
physics and model info, saved back to a valid PMX (ZIP with textures). It ships no models. Users edit
their own models and are responsible for their licenses.

## Layers

| Layer | Path | Notes |
|---|---|---|
| Pure logic | `src/lib/model-edit/` | framework-agnostic, unit-tested in Node |
| PMX records, writer, validator | `src/lib/convert/pmx/` | shared with the Model Converter; extended to full PMX 2.0 (SDEF / QDEF, additional UVs, every morph type, custom toon, external parent) |
| Parser | babylon-mmd `PmxReader` | `fromPmxObject()` maps its records to `PmxModel` with no loss |
| Engine | `src/engine/impl/BabylonStudioEngine.ts` | live vertex / material updates, model replacement keeping state |
| UI | `src/features/model-editor/` | the tab, sub-panels and viewport picking |
| State | `src/store/modelEditor.ts` | Zustand slice: session, op list, undo / redo, derived model |

Japanese names stay the real IDs everywhere. Labels go through the English-label layer
(`src/lib/names`).

## Editable model

`EditableModel = { pmx: PmxModel; textureFiles: Record<path, assetId> }`.

`PmxModel` holds vertices (position, normal, uv, extra UVs, BDEF / SDEF / QDEF weights, edge scale), faces,
materials, textures, bones (flags, tail, append, fixed / local axis, IK with link limits, external
parent), morphs (group, vertex, bone, uv, material, flip, impulse), display frames, rigid bodies and joints.
The parsed **original** is never mutated.

## Operations (non-destructive)

Edits are a list of JSON-serialisable operations. `applyOps(original, ops)` folds them over a deep copy
of the original, in three stages:

1. **Structural and data ops, in list order:**
   - material patches;
   - texture swaps / recolours;
   - bone edits (position, parent, flags, IK, rename, add, delete);
   - morph ops (create group, edit members, rename, panel, delete, reorder, scale, mirror);
   - rigid body / joint patches, physics presets and auto-physics;
   - clothes merge;
   - model info and display frame edits.

   Ops reference bones and morphs **by name**, so they survive index changes. Materials and rigid bodies
   are referenced by index; nothing deletes them, and merges only append.
2. **Proportions:** the last `proportions` op holds the whole slider state. It is applied once, after the
   structural ops, so merged clothes are fitted too and repeated slider moves never compound.
3. **Outfit visibility:** hidden groups become alpha-0 materials, and their exclusive rigid bodies and joints
   are removed from the output. Re-enabling a group restores them; nothing is lost because the original is
   untouched.

"Reset part" removes that part's entries. "Revert to original" empties the list. The **A/B toggle** shows the
original or the edited model. Undo / redo is a stack of op-list snapshots (depth 250). A drag updates the
last op in place (same `coalesceKey`) instead of pushing a new step.

## Proportions

- **Parts** map to standard MMD bones:
  - whole body (`全ての親`), head (頭), neck (首), torso (上半身), chest (上半身2), hips (下半身);
  - upper / lower arm (腕 / ひじ), hand (手首), fingers;
  - upper / lower leg (足 / ひざ), foot (足首).

  Each part has **overall**, **length** and **thickness** scale (0.5–2×, warning outside), with optional
  left / right link.
- **Vertex selection:** vertices whose total weight to the part's bones (the bone and its non-part
  descendants, e.g. a hand includes the fingers) is at or above a threshold (default 0.5).
- **Scaling:** around the part's joint pivot (the part's root bone rest position) in the bone's local frame:
  - **length** along the bone direction (pivot → child joint);
  - **thickness** across it;
  - **overall** on all axes.
- **Blending:** each vertex's displacement is multiplied by its part weight (smooth falloff), so vertices
  shared with the neighbouring part blend with no seam.
- **Downstream parts:** they move rigidly with the scaled part's end, so the chain stays connected: a longer
  thigh carries the knee, shin and foot along. Bone rest positions get the same transform: a bone inside the
  part is scaled, a bone downstream is translated.
- **Dependent data:**
  - rigid bodies follow their bone: position transformed, size scaled by the part's scale;
  - joints follow the midpoint of their two bodies;
  - IK bones (足ＩＫ / つま先ＩＫ) move with their target;
  - 全ての親 / センター keep the feet on the floor: after a leg change, everything is shifted so the lowest
    foot vertex is back at its original height;
  - twist and helper bones move with their parents;
  - vertex weights stay normalised;
  - edge scale is multiplied by the thickness scale.
- **Presets:** Chibi, Long legs, Bigger head, Reset. Custom presets save / load as JSON.

## Live preview and engine

- An edited model is shown as a **single-mesh** load (one geometry, identity vertex order), so vertex
  buffers can be updated in place.
- **While a slider is dragged:** positions are rewritten with `updateVerticesData` on the rest pose, and
  material colours change on the live `MmdStandardMaterial`.
- **When the drag ends**, or after other edits: a debounced (400 ms) **rebuild** writes the PMX in memory and
  replaces the model in the engine with the same id. Transform, motion, physics toggle and morph weights are
  kept. Bones, IK and physics are rebuilt here, so physics rebuilds are debounced by construction.

## Saving

- **Validation** first, using `validatePmx` plus extras: NaN, ranges, weight sums, bone cycles, missing
  textures and count consistency. Problems are shown in plain language.
- **Save as PMX ZIP:**
  - `model.pmx`, written by the converter writer: UTF-16LE, dynamic index sizes;
  - textures under `tex/` with safe names; untouched original texture paths are kept;
  - `README.txt` with the source, preserved license / comment text and the edit history;
  - `edit-report.json`.
- **Edit list JSON:** export / import, to reapply edits to the same model.
- **Persistence:** the session (original file refs, ops, added texture assets) is autosaved in the project
  (IndexedDB) and travels with `.mmdstudio.zip`. On reload the session is restored and the edited model
  rebuilt. **Apply to scene** writes the edited PMX as the model's files, so it is a normal model from then on.

## Outfits

- **Auto-grouping:** material names, English names and texture names are matched against pattern rules
  (Hair, Face, Body, Top, Bottom / Skirt, Shoes, Gloves, Accessories, Other). You can move materials
  between groups and create custom groups.
- **Toggles:** hiding a group hides its materials and removes the physics of bones used only by it.
  Hole warning: when a clothing group is hidden and no body material covers the same bones.
  "Hide body under outfit": body vertices weighted to the clothing's bones are collapsed (zero-area faces)
  for the selected region.
- **Presets:** visibility, colours and texture choices, recalled with one tap.
- **Recolour:**
  - colour / HSV shift / tint of the diffuse colour;
  - texture recolour by an HSV shift on the image (canvas);
  - uploaded patterns and logos replace or are composited into the texture.

  The original textures are kept. New images are project assets, written as new files in the ZIP.
- **Clothes swap (same skeleton):**
  1. Load a second PMX and pick its groups.
  2. Its vertices, faces, materials and textures are appended. Bones are remapped by name; extra bones
     (skirt chains…) are added with collision-free names, under the mapped parent.
  3. Physics bodies and joints are appended with remapped indices.
  4. The body under the new clothes is auto-hidden.

  If the standard bones the clothes are weighted to don't exist in the target, the merge is refused with a
  clear message. There is no weight transfer.
- **Licenses:** a reminder before merging. The source model and a note go into the README.

## Milestones

- [x] a. EditableModel, full PMX writer, op list, validation, undo / redo, round-trip tests
- [x] b. Materials editor
- [x] c. Proportion sliders (body and hands)
- [x] d. Dependent data (physics, IK, helper bones, floor)
- [x] e. Outfit grouping, toggles, presets
- [x] f. Recolour and retexture
- [x] g. Bone and IK editing
- [x] h. Morph editing
- [x] i. Physics editing
- [x] j. Clothes swap for same-skeleton models
- [x] k. Mobile, polish, tests, docs
