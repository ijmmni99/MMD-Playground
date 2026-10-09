# Video to VMD v2 — two-view capture, face tracking, finger tracking

This builds on `VIDEO2VMD_PLAN.md` (single-view body pipeline). Single-view body-only stays the default.
Everything below is opt-in from the Import step: the **Two-view**, **Face** and **Fingers** checkboxes, or
the **Fast / Balanced / Full** presets. Users supply their own videos and are responsible for the rights
to them; no assets ship with the app.

## Layers

| Layer                       | Path                                                              | Notes                                                                                                     |
| --------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Pure logic                  | `src/lib/video2vmd/`                                              | new modules: framework-agnostic, unit-tested in Node                                                      |
| Existing pure body pipeline | `src/engine/video2vmd/`                                           | clean / retarget / reduce / writer, unchanged API (extended, not rewritten)                               |
| Estimators                  | `src/engine/video2vmd/{estimator,faceEstimator,handEstimator}.ts` | `PoseEstimator` (unchanged), new `FaceEstimator`, `HandEstimator`; MediaPipe default, synthetic for tests |
| Worker                      | `src/engine/video2vmd/pipeline.worker.ts`                         | one Worker per view: decode → pose → crop pass (face, hands)                                              |
| UI                          | `src/features/video2vmd/`                                         | stepper, two video slots, overlays, mapping tables, reports                                               |
| State                       | `src/store/video2vmd.ts`                                          | Zustand slice, extended                                                                                   |

New pure modules in `src/lib/video2vmd/`:

| Module         | Contents                                                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`     | `FaceObs`, `HandObs`, `ViewSync`, `Calibration`, `FaceSettings`, `HandSettings`, `TwoViewSettings`, feature flags                               |
| `crop.ts`      | crop-window tracker (head, both wrists), smoothing, crop ↔ full-frame coordinate mapping                                                        |
| `sync.ts`      | onset envelope, normalised cross-correlation, audio sync, hip-velocity motion sync, resampling                                                  |
| `calibrate.ts` | yaw-only robust Kabsch with prior, scale + floor, intrinsics guess, DLT triangulation, reprojection                                             |
| `fuse.ts`      | per-joint per-frame fusion, single-view fallback flags, gap interpolation, bone-length enforcement                                              |
| `face.ts`      | ARKit blendshape list, MMD morph mapping table (gain / offset / enable), vowel derivation, blink logic, morph cleaning, eye gaze, head rotation |
| `hands.ts`     | 21-landmark hand topology, flexion / spread / opposition, MMD finger rig axes, retarget + limits, presets, cleaning                             |
| `lipsync.ts`   | audio energy + formant (band-ratio) viseme estimation for あいうえお                                                                            |
| `synthetic.ts` | stick figure with fingers and a face: blendshape sequences, two virtual cameras, known time offset, depth noise                                 |

## Data model

`PoseFrame` (stored per view) gains optional fields, so old pose JSON still loads:

- `face?: FaceObs` — 52 blendshapes (fixed ARKit order), 4×4 facial transformation matrix, 18 key 2D points
  (eye corners, lids, iris centres, mouth corners) in full-frame normalised coordinates, crop box, score.
  The full 478-point mesh is not stored (≈ 20 MB/min of JSON); the points the retargeter uses are.
- `hands?: { 15?: HandObs; 16?: HandObs }` — keyed by the **pose wrist landmark index** whose crop the hand
  came from (MediaPipe's left wrist 15, right wrist 16). Mirroring is applied later by the same index swap
  the body uses, so the mirror toggle stays a post-process. `HandObs` = 21 × [x, y, z] image points (full
  frame, normalised), 21 × [x, y, z] world points (metres), handedness label + score, crop box.

Two-view sessions keep both `PoseSequence`s plus `ViewSync` (offset, confidence, method) and `Calibration`.
Fusion produces one ordinary `PoseSequence` at 30 fps, which the unchanged cleaning, retargeting, foot IK and
writer consume. Face and hand observations are fused into the same frames.

## Coordinate conventions

Same as v1: MediaPipe world (right-handed, x right, y down, z away, hip-centred metres) → MMD axes
`(x, −y, z)`; MMD is left-handed, x = model's left, y up, model faces −Z.

- **World frame of a two-view session** = the front camera's MMD-axis frame.
- **Side camera yaw θ**: the angle around the vertical axis from the front camera to the side camera, positive
  toward the dancer's left (+X). `R_y(θ) = [[cos θ, 0, −sin θ], [0, 1, 0], [sin θ, 0, cos θ]]` maps a camera's
  own MMD-axis frame into the world: camera position `R_y(θ)·(0, h, −D)` (θ = 90° → at +X), view direction
  `d = R_y(θ)·(0, 0, 1) = (−sin θ, 0, cos θ)`. A hip-centred point seen by the side camera, `p_s`, is
  `p = R_y(θ)·p_s` in the world frame.
- **Camera view direction** in the world frame: front `d₀ = (0, 0, 1)`, side `d₁ = (−sin θ, 0, cos θ)`.
- Face / hand image points are stored in full-frame normalised coordinates, mapped back from the crop:
  `x_full = crop.x + x_crop · crop.w` (same for y).

## Time sync

Both clips are put on one 30 fps MMD timeline: front time `t`, side time `t + offset`. Both sequences are
resampled (linear on landmarks, nearest on observations); the overlap is the usable range, and the shorter
clip limits it.

1. **Audio:** decode both soundtracks (OfflineAudioContext at 11025 Hz, mono), compute an onset envelope
   (half-wave rectified first difference of log RMS energy in 10 ms hops), z-normalise, cross-correlate over
   ±10 s. `offset = lag of the peak`; confidence = `(peak − second-best peak outside ±0.1 s) / peak`,
   combined with the peak correlation itself. A clap gives a sharp, unambiguous peak.
2. **Motion fallback:** cross-correlate the vertical hip velocity (image y of the hip midpoint ÷ torso length
   in pixels, so camera distance doesn't matter) from both pose tracks, at the shared 30 fps rate; parabolic
   peak refinement gives sub-frame offsets.
3. **Manual:** offset slider (±10 s) with ±1-frame nudges and a side-by-side scrub preview. Manual edits win.

## Calibration

Inputs: per frame, front points `a_i` and side points `b_i` (MMD axes, hip-centred, metres), visibility
weights `w_i`.

**Yaw-only robust Kabsch.** Find θ minimising `Σ w_i ρ(‖Π(a_i − R_y(θ) b_i)‖) + λ (θ − θ₀)²`:

- `Π` down-weights each residual along both cameras' depth axes (monocular depth is the unreliable part);
- `ρ` is a Huber loss (iteratively reweighted: weight `min(1, δ / r)`);
- `θ₀` is the manual angle; `λ` is small, so the prior only breaks near-symmetric ties.

Each IRLS step is a weighted 2D Procrustes in the x–z plane with a closed form:
`θ = atan2(Σ w (a_x b_z − a_z b_x), Σ w (a_x b_x + a_z b_z))`, with sign convention matched to `R_y`. It
starts from a coarse 5° grid (global minimum) and θ₀, then refines.

- **Translation:** the mean of `a_i − R_y(θ) b_i` (≈ 0 because both are hip-centred; reported only).
- **Scale:** the ratio of median limb lengths, side → front. MediaPipe world scale differs slightly per view.
- **Floor:** the 10th percentile of the lowest foot heel / toe height over the clip, in the fused frame.
- **Intrinsics:** focal = `0.9 · max(w, h)` px by default (≈ 60° horizontal FOV on a phone), or the user's FOV.
  Camera distance per view comes from weak perspective (pixels per metre of limbs).

**DLT refinement.** Each camera gets `P = K [R | t]` from θ, distance and focal. For each joint, triangulate
the two image points by the linear DLT (4×4 SVD via the smallest eigenvector of `AᵀA`, Jacobi iterations).
Compare the reprojection error of the DLT point and of the fused world point placed at the triangulated hip
centre. Keep whichever has the lower error, per joint, when both views see it.

**Confidence** = the IRLS inlier fraction × the angle certainty (curvature of the cost at θ) × overlap
coverage. Plain-language warnings:

- _cameras moved_: the per-window θ (5 s windows) varies by more than 15°;
- _dancer not visible in both_: fewer than 60 % of frames are detected in both views;
- _views too similar_: |θ| < 25° or |θ − 180°| < 25°.

## Fusion rules (per joint, per frame)

- View weight `v_c` = landmark visibility × detection.
- Axis reliability of camera c along world axis e: `r_c(e) = 1 − 0.85 (e · d_c)²`. Depth along a camera's
  view direction is trusted least.
- Fused coordinate: `p_e = Σ_c v_c r_c(e) p_c,e / Σ_c v_c r_c(e)`. At θ = 90° this is "front for X and Y,
  side for Z", and it generalises to other angles.
- If only one view sees the joint (`v < threshold`), use that view and flag a _single-view frame_. If neither
  view sees it, mark it invalid; the existing gap interpolation fills it.
- After fusion, bone lengths are enforced: median length per limb, each child re-placed along its direction
  from the parent, root → leaves. Then the existing One Euro filter, outlier rejection, retargeting, foot IK
  and writer run unchanged.
- The fused image track (used for root motion) is the front view's image track.

## Crop pass (face and hands)

- **Anchors from the body pose** (analysed-area normalised coordinates):
  - head: centre = mean of nose, eyes and ears; size = 2.2 × ear-to-ear distance (min 1.6 × shoulder width × 0.5);
  - wrist: centre = wrist + 0.35 × (wrist − elbow), pushed toward the hand landmarks; size = 1.3 × forearm length.
- **Tracking:** square windows, centre and size smoothed with a One Euro filter (min cutoff 1.5 Hz,
  β 0.05). Size changes are rate-limited to 15 % per frame, so crops don't jitter.
- **Crop:** from the full-resolution decoded frame (not the downscaled analysis canvas), upscaled to the
  estimator input size: face 256 px, hand 224 px. Landmarks are mapped back to full-frame normalised
  coordinates.
- **Minimum pixel size:** head crops under 96 px and hand crops under 64 px in the source raise warnings.
- **Two-view:** face and hands are estimated in both views. Per frame, the best view wins when its crop is
  larger (×2 weight) and more frontal: face = small |yaw| from the transformation matrix; hand = large palm
  area. Values are blended by confidence.
- Runs in the per-view Worker with OffscreenCanvas. VideoFrames and ImageBitmaps are closed right after use.
  The work is chunked with cancel / resume and an ETA. On low-memory or mobile devices the analysis
  resolution is capped (720p) and the user is warned.

## Face → MMD morphs

Blendshape names follow ARKit / MediaPipe (52 shapes). A morph's value is
`clamp(gain · source + offset, 0, 1)`, with an enable toggle. The table is editable per project. Only morphs
present in the selected PMX are written (resolved through the loaded model's morph list and the name
dictionary). Missing ones are reported and skipped.

| MMD morph   | Source                                                                              | Default gain |
| ----------- | ----------------------------------------------------------------------------------- | ------------ |
| まばたき    | min(eyeBlinkLeft, eyeBlinkRight) (both closed)                                      | 1.1          |
| ウィンク    | eyeBlinkLeft − まばたき (left eye only)                                             | 1.1          |
| ウィンク右  | eyeBlinkRight − まばたき                                                            | 1.1          |
| あ          | vowel A                                                                             | 1.0          |
| い          | vowel I                                                                             | 1.0          |
| う          | vowel U                                                                             | 1.0          |
| え          | vowel E                                                                             | 1.0          |
| お          | vowel O                                                                             | 1.0          |
| ん          | max(mouthPressLeft/Right, mouthClose) × (1 − jawOpen)                               | 0.8          |
| 笑い        | avg(mouthSmileLeft/Right) × 0.6 + avg(cheekSquintLeft/Right) × 0.4                  | 1.0          |
| にやり      | max(0, mouthSmileLeft − mouthSmileRight) + max(0, mouthSmileRight − mouthSmileLeft) | 0.8          |
| 怒り        | avg(browDownLeft/Right)                                                             | 1.0          |
| 困る        | browInnerUp × (1 − avg(browOuterUp)) + 0.3 × avg(browDown)                          | 1.0          |
| 上          | avg(browOuterUpLeft/Right)                                                          | 1.0          |
| びっくり    | avg(eyeWideLeft/Right)                                                              | 1.0          |
| other (off) | e.g. mouthLeft/Right → 口横, cheekPuff → ぷくー, tongueOut → ぺろっ                 | 1.0          |

**Vowels.** j = jawOpen, f = mouthFunnel, p = mouthPucker, s = avg(mouthSmile), st = avg(mouthStretch):

- A = j · (1 − f) · (1 − p)
- I = (s + st) / 2 · (1 − j)
- U = p · (1 − j)
- E = st · j · (1 − p)
- O = f · j

Then they are normalised: if their sum exceeds 1, all are scaled down.

**Cleaning:**

- One Euro filter per morph.
- Deadzone 0.05 (below → 0, rescaled above).
- Mouth: attack/release smoothing (attack 30 ms, release 90 ms).
- Blinks: hysteresis at 0.55 / 0.35. A detected blink is held at least 3 frames (100 ms at 30 fps) so it isn't
  lost to resampling, with a 1-frame ramp.
- Keyframe reduction: Douglas–Peucker on each morph curve with a tolerance slider.

**Low confidence:** when the face score is under 0.5 or the face is missing, the morphs ease to neutral over
0.3 s, and back in when tracking returns. The report shows the % of frames with a face detected.

**Head:** the face transformation matrix gives the head's world rotation. It is converted to MMD axes (flip Y
and Z components accordingly) and slerped with the body-pose head rotation, weighted by face confidence
(0.7 max). It feeds 首 / 頭 through the existing 40/60 split.

**Eyes:** per eye, the iris centre is placed between the corners (x) and lids (y): `u, v ∈ [−1, 1]`.
Yaw = u · 25°, pitch = v · 20°, minus the clip median (rest gaze), clamped to ±20° / ±15°. They are written
to 両目 when the model has it, else to 左目 / 右目. Blinks freeze the gaze.

**Lip-sync alternative:** mouth vowels from audio instead of video. A Worker computes 20 ms frames, RMS
energy for openness and band energy ratios (300–900, 900–2000, 2000–4000 Hz) as F1 / F2 proxies. These are
classified as あいうえお with a soft-max, scaled by energy, then smoothed with attack/release. It is per
project and combinable with video blinks and expressions: the video mouth morphs are replaced, the rest kept.

## Fingers

**Hand Landmarker** (21 points, handedness) runs on each wrist crop, with two Landmarker instances, one per
crop, in VIDEO mode. The side comes from the crop's body wrist, not the handedness label. The label is judged
from the hand's appearance exactly like the body's left / right, so mirroring cannot flip one without the
other; the mirror toggle swaps both together. When labels disagree with the crop's side on more than 30 % of
frames, the report warns that crops may be catching the other hand (crossed or overlapping hands).

**Features per frame**, rotation invariant, from the hand world points:

- flexion of each joint = angle between consecutive segments (MCP: palm-plane-relative, using the
  wrist → MCP direction);
- spread = signed angle between each finger's proximal segment and the middle finger's, in the palm plane;
- thumb opposition = angle of the thumb metacarpal out of the palm plane.

**MMD rig axes** (from the PMX rest positions; MMD bones have no rest rotation, so axes are in model space):

- hand direction `h = middle1 − wrist`, across `a = index1 − little1`, palm normal
  `n = ± normalize(h × a)`, with the sign chosen so the palm faces down / inward in the rest pose;
- each finger joint's bend axis `k = normalize(dir × n)`, where `dir` = next joint − joint; rotating `dir`
  about `k` by +φ curls it toward the palm;
- the spread axis is `n`.

| MMD bone                       | Driven by                                                     | Limits                |
| ------------------------------ | ------------------------------------------------------------- | --------------------- |
| 親指０                         | opposition about `h` + 0.5 × CMC flex                         | 0…50°                 |
| 親指１, 親指２                 | thumb MCP / IP flexion                                        | −10…80°               |
| 人指１, 中指１, 薬指１, 小指１ | MCP flexion about `k` + spread about `n`                      | −15…95°, spread ±20°  |
| 人指２, 中指２, 薬指２, 小指２ | PIP flexion                                                   | 0…110°                |
| 人指３, 中指３, 薬指３, 小指３ | DIP flexion                                                   | 0…90°                 |
| 手首 (refinement)              | palm frame from hand landmarks blended with the body estimate | ±70° (existing clamp) |
| 手捩 (optional)                | 50 % of the hand's twist about the forearm axis               | ±80°                  |

**Cleaning:**

- One Euro filter per joint angle.
- Impossible poses are rejected: any flexion outside its limit by more than 30°, or a hand's bone lengths off
  by more than 40 % from the median.
- On dropout: hold the last pose for 0.5 s, then ease to the relaxed preset over 0.5 s.
- Keyframe reduction with a tolerance.

**Presets:** open, fist, point, peace and relaxed, as flexion vectors. Each frame is classified by its nearest
preset (weighted L2 on the flexions). When confidence is low and the snap toggle is on (off by default),
low-confidence frames snap to the nearest preset.

**Report:** % of frames with a hand detected, per hand. Warnings come from runs of missing frames ("hands not
detected at 0:42, using relaxed pose") and from crop size (too small) and motion blur. Blur is a proxy: the
wrist moves more than 1.5 crop widths per second while the detection is lost.

## VMD writer and integration

- Morph records: 23 bytes = 15-byte Shift-JIS name + uint32 frame + float32 weight. They are written by the
  shared motion library writer (`src/lib/motion/vmd.ts`, already byte-tested); the Video→VMD writer gains
  `morphs`. Finger and eye bones use the 111-byte bone records. Bone and morph keys are sorted by name then
  frame, with no duplicate (name, frame) pairs.
- **Apply to model** assigns one VMD (body + fingers + eyes + morphs). The Clip Timeline picks it up as a
  Dance clip through the existing "motion loaded from outside the timeline" hook. A separate face-only VMD
  is added as a Face source when the timeline is in use. The Motion Editor opens it as editable tracks like
  any assigned motion.
- **Export options:** body, fingers, face morphs and eye bones as checkboxes, applied as a filter over the
  keys before writing. The **raw landmark JSON** holds both views, face, hands, sync and calibration, so
  conversion can be re-run without ML.
- **Persistence:**
  - project `video2vmd` doc: both video refs, both pose refs, sync, calibration, feature flags, face / hand
    settings and mapping table;
  - pose JSON stored as content-addressed assets;
  - everything survives `.mmdstudio.zip` export / import (asset ids are collected by `projectBlobIds`).

## UI / UX

- **Import:**
  - feature checkboxes, each with a one-line cost and benefit;
  - presets: Fast (body only), Balanced (body + face), Full (two-view + face + fingers);
  - two-view: Front / Side slots (trim, crop, preview each) and a relative-angle slider (30–150°, default 90°);
  - a recommendation to use 1080p or higher;
  - on phones: a memory / time warning for two-view and Full, with resolution capped by default.
- **Detect:** both views run one after the other, with progress, ETA, cancel and resume. Then **Sync**
  (auto audio → motion fallback, offset + confidence, manual slider and nudges, side-by-side scrub) and
  **Calibration** (angle, confidence, warnings).
- **Overlays:** body skeleton, face points, hand skeletons, crop windows (toggles), both videos side by side.
- **Clean:** face mapping table (gain, offset, enable, PMX presence), lip-sync toggle, finger options
  (preset snap, 手捩 refinement), reduction tolerances.
- **Preview:** A/B toggle (two-view vs single-view result) with foot-skate and jitter scores for each.
- **Reports:** a section per feature with plain-language warnings.

## Testing

- **Unit:**
  - sync with known offsets (audio onset and hip velocity);
  - yaw Kabsch recovers a known angle (with noise and outliers);
  - DLT triangulation;
  - fusion weights and fallbacks;
  - bone-length enforcement;
  - blendshape mapping and gain;
  - blink minimum duration;
  - eye-direction limits;
  - finger flexion and clamps;
  - left / right resolution with the mirror toggle;
  - crop tracking and mapping back;
  - 23-byte morph records;
  - babylon-mmd round trip with body, finger and morph tracks.
- **Synthetic fixture:** a stick figure with fingers and a face, blendshape sequences, two virtual cameras at
  a known angle with a known time offset, and monocular depth noise.
  - Asserts: two-view joint error < single-view joint error on depth-heavy motion.
- **Playwright:**
  - two generated videos (front / side, a clap in the audio, known offset) + a PMX fixture with full fingers,
    eyes and face morphs, run with mocked (synthetic) estimators;
  - sync detection; the Full preset; export; the VMD loads and plays with finger and face tracks;
  - screenshots at desktop, tablet and phone sizes; no console errors.

## Milestones

- [x] a. Morph writer + round-trip tests; synthetic two-camera fixture
- [x] b. Crop pass infrastructure
- [x] c. Face tracking + morph mapping + eye / head
- [x] d. Hand tracking + finger retargeting
- [ ] e. Two-view import + time sync
- [ ] f. Auto-calibration + fusion
- [ ] g. Quality reports, presets, A/B preview
- [ ] h. Editor / timeline integration, persistence, export options
- [ ] i. Mobile, polish, tests, docs
