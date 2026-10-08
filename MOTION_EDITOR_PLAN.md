# Motion Editor & Camera Director — Plan

Edit VMD keyframes (bones FK and IK, morphs, camera) inside MMD Studio, with IK-aware posing, motion tools, a camera director, undo/redo and persistence. No copyrighted assets; all fixtures are generated.

## Layers

```
src/lib/motion/            pure TypeScript, framework-agnostic, fully unit-tested
  types.ts                 MotionClip / CameraClip / keys / curves / markers / shots / pins
  bezier.ts                VMD bezier evaluation (bit-compatible with babylon-mmd's BezierInterpolate), presets
  vmd.ts                   VMD read → clip, clip → VMD write (bone 111 B, morph 23 B, camera 61 B, light 28 B,
                           self-shadow 9 B, property/IK variable); unsupported sections preserved
  evaluate.ts              sample a track at any frame exactly like the runtime (segment curve = later key's curve)
  edit.ts                  immutable key operations: insert/update/delete/move/copy/paste/nudge/select-range
  tools.ts                 trim, insert/delete time, retime, loop+seam blend, mirror, smooth, reduce, bake,
                           offset/scale with falloff, blend/crossfade, additive layer, retarget scale
  ik.ts                    CCD IK (MMD semantics, knee limits) for tests and analysis; pins (foot lock); ground clamp
  camera.ts                MMD camera math (eye/forward from target+rotation+distance), capture from orbit view,
                           look-at bake, shots (split/merge/reorder/cut), presets on a BPM grid, seeded shake,
                           lens presets, safety clamps
  timing.ts                BPM grid, markers, snapping
src/engine/motion/         Babylon-dependent: clip → MmdAnimation (per-track cache), samplers
src/store/motionEditor.ts  Zustand slice: clips, originals, selection, playhead tools, editor UI state
src/features/motion-editor UI: dock tab, dope sheet (canvas), graph editor (canvas), toolbars, tool panels,
                           camera director, markers/BPM, status bar
```

## Data model

- **`MotionClip`** (per model): `bones: BoneTrack[]`, `morphs: MorphTrack[]`, `props: PropertyKey[]` (visibility + IK on/off), plus preserved `camera`, `lights` and `shadows`.
  - `BoneKey = { f, p: [x,y,z], r: [x,y,z,w], ip: number[16], phys?: 0|1 }`.
  - `ip` holds four channel curves (X, Y, Z, rotation), each as `x1, y1, x2, y2` bytes (0–127).
  - `MorphKey = { f, w }` (VMD morphs are linear).
- **`CameraClip`**: `keys: CameraKey[]`.
  - `CameraKey = { f, t: target[3], r: euler[3] (radians), d: distance, fov: degrees, persp, ip: number[24] }`.
  - `ip` holds six channels: X, Y, Z, rotation, distance and FOV.
- **Immutability:**
  - Every edit returns a new clip and replaces only the tracks it touched.
  - Undo snapshots are just clip references, so they're cheap and support 200+ levels.
  - The engine caches built Babylon tracks in a `WeakMap<track, built>`, so a rebuild only re-creates changed tracks.
- **Interpolation semantics (VMD):**
  - The segment from key A to key B uses **B's** curve; weight = `Bezier(x1/127, x2/127, y1/127, y2/127, (f - fA)/(fB - fA))`.
  - Bone rotation slerps by that weight; position channels lerp independently.
  - Camera keys on consecutive frames are a **cut**: the runtime holds A. Shot boundaries use this.
- **Byte layout:**
  - Bone interpolation is the 64-byte block. Channel c is read from row c at byte offsets 0/4/8/12; each row is the previous one shifted left by one byte. Row 0 bytes 2–3 carry the physics toggle.
  - Camera interpolation is 24 bytes, ordered x1, x2, y1, y2 per channel.
- **Editor metadata** (saved in the project and in an optional sidecar JSON): markers, BPM and beat offset, shots, pin ranges.

## How edits reach the runtime

```
user action → command (before/after clip refs) → store.clips[model] = after
           → effectiveClip = applyPins(clip)            (pins are non-destructive overlays)
           → engine.setMotionClip(model, effectiveClip) (debounced ~50 ms while dragging)
           → buildMmdAnimation (cached tracks) → model.createRuntimeAnimation → setRuntimeAnimation
           → destroy previous handle → re-evaluate current frame if paused
```

The camera goes through the same flow via `engine.setCameraClip`. Playback continues uninterrupted; no model reload.

## IK

- 足ＩＫ / つま先ＩＫ (and any PMX IK bone, e.g. hand IK) are ordinary editable tracks (position + rotation).
- **Viewport posing:**
  - Selecting an IK bone and translating it with the gizmo moves the IK target.
  - babylon-mmd's own solver runs every frame, even while paused, so the knee or elbow follows.
  - **Key** writes the IK bone's key. With **Bake FK** on, it also keys the chain bones' solved local rotations, read from world matrices.
- **Bake IK→FK (range):** the engine samples the real runtime per frame with IK on and keys the chain FK rotations. IK is then disabled over the range via property keys (off at start, on after the end). Boundary frames are blended over N frames so there are no pops.
- **Fit IK from FK (range):** sample with IK off, compute ankle position and foot rotation, key the IK bone. Within the tolerance, intermediate keys are reduced.
- **Pins:** per-range locks on an IK bone `{bone, start, end, blendIn, blendOut}`.
  - Applied as an overlay when building the effective clip.
  - Inside the range the IK translation is held at its value on the start frame, then blended out. Y is clamped ≥ 0, so the foot can't sink.
  - Editing keys underneath a pin doesn't move the planted foot, and a ghost marker shows the unpinned position.
- **Solver toggle** per model (debug), plus overlays for chain, target and pole.
- **Unit tests** use a pure CCD solver in `lib/motion/ik.ts` with MMD knee limits.

## Camera Director

- **Editing:** the camera track has dope-sheet and graph editing, plus "capture viewport as key".
- **Viewport:** the eye-path spline and key handles (draggable target points), a frustum at the playhead, and a picture-in-picture view of the VMD camera (a second Babylon camera viewport).
- **Shots** `{name, start, end, color, transition: 'cut'|'blend'}` show as colored blocks.
  - **Cut** writes a hold key at `start-1` and the new shot's key at `start` (consecutive frames = cut).
  - **Blend** interpolates.
- **Look-at:** aim the camera at a bone (head / center / hands) with smoothing and offset, baked to rotation keys.
- **Generators:** starter presets (orbit, dolly-in, crane up, front-to-side cut, face close-up) snapped to the BPM grid and markers, plus a seeded handheld shake layer.
- **Safety:** FOV is clamped to 1–175° and distance to ±(0.01–5000), with warnings.

## Milestones

- [x] a. Clip model, VMD read/write (all record types), bezier, runtime build, round-trip and loader tests
- [x] b. Editor dock tab and dope sheet (canvas, groups, select / box / drag / alt-copy / snap / zoom)
- [x] c. Pose keying from gizmo and morph sliders, auto-key, delete/clear
- [x] d. Undo/redo via commands, revert / A-B, autosave and zip round-trip
- [x] e. Graph editor (bezier handles, presets, Euler display)
- [x] f. Motion tools (time, mirror, smooth, reduce/bake, offset/scale)
- [x] g. IK-aware editing (bake, fit, pins, ghost, overlays, solver toggle)
- [x] h. Blend / additive layer / retarget scale
- [x] i. Camera editor and Camera Director (path, PiP, shots, look-at, presets, shake, lens)
- [x] j. Markers and BPM grid (snapping)
- [x] k. Mobile, polish, Playwright, docs
