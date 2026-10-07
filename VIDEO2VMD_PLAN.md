# Video to VMD — Plan

A browser-only converter that turns a single-dancer video into an MMD bone motion (`.vmd`). Nothing is uploaded. Users supply their own videos and are responsible for the rights to them.

## Architecture

```
src/engine/video2vmd/          pure TypeScript, no React, no Babylon — runs in a Worker and in tests
  types.ts                     PoseFrame / PoseSequence / settings / report types
  landmarks.ts                 MediaPipe 33-landmark indices, left/right pairs, skeleton edges
  math.ts                      tiny vec3 / quaternion library (left-handed, MMD conventions)
  coords.ts                    MediaPipe world → MMD conversion (+ mirror)
  oneEuro.ts                   One Euro filter
  clean.ts                     gap filling, outlier rejection, bone-length normalisation, 30 fps resampling
  skeleton.ts                  MMD skeleton description (from the loaded PMX or a standard fallback)
  retarget.ts                  FK rotations, root motion, contacts, foot IK, joint limits
  contacts.ts                  foot-contact detection + pinning
  reduce.ts                    keyframe reduction (Douglas–Peucker on rotation / position curves)
  vmdWriter.ts                 byte-exact VMD writer (Shift-JIS via encoding-japanese)
  quality.ts                   quality report + plain-language warnings
  estimator.ts                 PoseEstimator interface
  mediapipeEstimator.ts        MediaPipe Pose Landmarker (heavy model, GPU → CPU fallback)
  syntheticEstimator.ts        procedural stick figure (tests, e2e "mock" backend)
  frameSource.ts               frame extraction: WebCodecs (mediabunny) or <video> seeking
  pipeline.ts                  extraction + inference loop (chunked, cancellable, ETA)
  pipeline.worker.ts           module Worker wrapper around pipeline.ts
src/features/video2vmd/        UI: stepper, video preview + skeleton overlay, settings, report
src/store/video2vmd.ts         Zustand slice (session state, settings, results)
```

- **Mode.** Video to VMD is a third app mode, next to Studio and Playground:
  - Desktop: the panel uses the left dock, so the source video sits beside the 3D viewport.
  - Tablet: left drawer.
  - Phone: a full-height bottom sheet tab.
- **Worker pipeline.** Decode (mediabunny + WebCodecs `VideoDecoder`) and inference (MediaPipe, module-worker import) run in a module Worker. Frames go to the estimator as `VideoFrame`/`ImageBitmap` and are closed immediately.
- **Fallback.** Without WebCodecs or `OffscreenCanvas` in workers, the same `pipeline.ts` runs on the main thread. It uses the `<video>` seek source and yields to the event loop after every frame.
- **Re-running.** Cleaning, retargeting, reduction and writing are pure functions over the stored `PoseSequence`. Changing settings re-runs them instantly, without re-running pose estimation.
- **Saved data.** The pose JSON, settings, report, generated VMD and source video (if ≤ 200 MB) are stored as project assets in IndexedDB.

## Coordinate conventions

| Space               | Handedness | Axes                                                                          | Units           |
| ------------------- | ---------- | ----------------------------------------------------------------------------- | --------------- |
| MediaPipe image     | —          | x → right, y → down, normalised `[0,1]`                                       | image fraction  |
| MediaPipe world     | right      | x → image right, y → down, z → away from camera; origin = hip centre          | metres          |
| MMD / Babylon (PMX) | left       | x → model's left (screen right), y → up, z → behind the model; model faces −Z | MMD unit ≈ 8 cm |

**Conversion** (dancer facing the camera, video not mirrored): `mmd = (x, −y, z) · scale`.

- Flipping Y turns MediaPipe's right-handed frame (right, down, away) into the left-handed (right, up, away) frame MMD uses.
- The dancer's left hand appears on image-right, and MMD's `左` bones live on +X. So the sides line up without swapping.
- `scale` = model leg length (足→ひざ→足首, in MMD units) ÷ measured leg length (metres). The fallback is 12.5 units/m.
- **Mirror toggle** (for selfie-flipped videos): negate x and swap every left/right landmark pair.

**Rotations.** MMD bones have no rest orientation: every bone's rest frame is world-aligned. For each driven bone, a world rotation `W` is built from two frames, each made of a primary direction plus a secondary (twist) direction:

- the rest frame, from the model's rest bone positions;
- the target frame, from the landmarks.

`W = F_target · F_rest⁻¹`. The VMD local rotation is `L = W_parent⁻¹ · W`, written as quaternion x, y, z, w.

**Continuity and smoothing.**

- Sign continuity: `q ← −q` when `dot(q, q_prev) < 0`.
- Slerp-based One Euro smoothing on the quaternions.

## Bone mapping

Landmark numbers are MediaPipe Pose indices; L/R are the dancer's sides.

| MMD bone                 | Primary direction (target)                          | Twist / secondary                                               | Notes                                                                                                                    |
| ------------------------ | --------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| センター                 | translation: hip centre (image-space root track)    | —                                                               | Root motion. Ground contact keeps feet on the floor.                                                                     |
| グルーブ                 | —                                                   | —                                                               | Left at rest; optional vertical bounce is carried by センター.                                                           |
| 下半身                   | hips lateral R→L (24→23)                            | spine up (hip mid → shoulder mid)                               | Pelvis yaw / roll / tilt.                                                                                                |
| 上半身 (+ 上半身2)       | shoulders lateral R→L (12→11)                       | spine up                                                        | Split 50 / 50 between 上半身 and 上半身2 when both exist.                                                                |
| 首, 頭                   | ears lateral (8→7)                                  | face forward (ear mid → nose 0)                                 | Split 40 / 60 neck / head. Clamped to ±60° yaw, ±45° pitch/roll.                                                         |
| 左/右 肩                 | —                                                   | —                                                               | Left at rest: both shoulder landmarks lie on one line, so there is no independent clavicle signal.                       |
| 左/右 腕                 | shoulder → elbow (11→13, 12→14)                     | elbow hinge normal (upper × fore); previous frame when straight | —                                                                                                                        |
| 左/右 ひじ               | elbow → wrist (13→15, 14→16)                        | same hinge normal                                               | Hinge: one-way bend, clamped 0–165°.                                                                                     |
| 左/右 手首               | wrist → mid(index, pinky) (15→19/17)                | index − pinky                                                   | Damped 50 %, clamped ±70°.                                                                                               |
| 左/右 足                 | hip → knee (23→25, 24→26)                           | knee hinge normal; −pelvis lateral when straight                | —                                                                                                                        |
| 左/右 ひざ               | knee → ankle (25→27, 26→28)                         | same hinge normal                                               | Hinge: bends backward only, clamped 0–160°.                                                                              |
| 左/右 足首               | ankle → foot index (27→31, 28→32), pitch-calibrated | knee hinge normal                                               | The person's flat-foot pitch (frames where the foot is lowest) is mapped onto the rig's 足首→つま先 pitch. Clamped ±60°. |
| 左/右 足ＩＫ             | translation: solved ankle position (contact-pinned) | rotation: foot world rotation                                   | IK mode only.                                                                                                            |
| 左/右 つま先ＩＫ         | 0 (follows the 足ＩＫ rotation as its child)        | —                                                               | IK mode only.                                                                                                            |
| fingers, 腕捩/手捩, eyes | rest                                                | —                                                               | Not tracked.                                                                                                             |

**FK-only vs IK-assisted.**

- **FK-only:** the VMD contains a property (IK) keyframe at frame 0 that disables 左足ＩＫ, 右足ＩＫ, 左つま先ＩＫ and 右つま先ＩＫ. The FK leg rotations then play as computed.
- **IK-assisted (default):** foot IK targets are keyed. They are pinned during detected contacts to remove foot skating.

**Root motion.**

- The image-space hip track is converted to metres with a weak-perspective model. Pixels per metre is the second-largest projected/true limb-length ratio; depth comes from the change in that scale.
- **Leg odometry:** while a foot is planted, センター moves so that foot stays put. The image track drives flight phases, plus a slow (0.15 Hz) drift correction toward it.
- **Height:** a residual places the supporting foot on the floor. It is interpolated through jumps, and no foot may go below the floor.

## Milestones

- [x] a. Tab shell + video import (metadata, trim, crop, warnings) + deterministic frame extraction (progress, cancel)
- [x] b. PoseEstimator interface, MediaPipe implementation in a Worker, skeleton overlay
- [x] c. Cleaning: gaps, One Euro, outliers, bone-length normalisation, 30 fps resample
- [x] d. VMD writer + byte-level and round-trip tests (built first)
- [x] e. Retargeting FK against the selected PMX (or the standard fallback skeleton)
- [x] f. Root motion, ground contact, foot contacts, foot IK
- [x] g. Preview: apply to model, side-by-side synced playback, audio passthrough
- [ ] h. Export (.vmd, pose JSON), persistence, quality report, presets, keyframe reduction
- [ ] i. Mobile, Playwright smoke test (mock estimator), screenshots, docs
- [ ] j. (stretch) Face blendshapes → MMD morphs
