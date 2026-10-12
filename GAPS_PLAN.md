# Gaps Plan

Tracks the known gaps from the project review. Work top to bottom. Tick a box only when the change is merged to `main` with tests and the README "Known limitations" entry is updated or removed.

Status key: `[ ]` todo, `[~]` in progress, `[x]` done.

## Working rules

- One milestone per commit series. Each milestone ends with `pnpm typecheck`, `pnpm lint`, `pnpm test` and (if the UI changed) `pnpm build` plus the relevant Playwright spec all passing.
- Pure logic goes in `src/lib/`, with unit tests. Babylon code stays behind `StudioEngine`.
- No new third-party assets. Use the procedural fixtures in `scripts/make-fixtures.mjs`.
- Update the README feature table and "Known limitations" in the same commit as the feature.

## Milestones

### P1. VMD light and self-shadow tracks (highest value)

Today these tracks are kept and re-exported but not shown.

- [x] P1.1 Parse and expose light keyframes (colour, direction) and self-shadow keyframes (mode, distance) from the loaded VMD. Unit tests in `src/lib/vmd.test.ts`.
- [x] P1.2 Drive the scene directional light from the light track during playback and seek. A manual light override wins when the user turns off "Use motion light".
- [~] P1.3 Map the self-shadow track to shadow darkness and range. Done: mode 0 sets full shadow darkness. Todo: apply the range value to the shadow map extents.
- [x] P1.4 Show light and shadow keys on the timeline. (VMD export of edited motions: not checked.)
- [x] P1.5 e2e: a fixture VMD with a light track changes the light colour at a known frame.

### P2. VPD pose import

- [x] P2.1 Parse `.vpd` (Shift-JIS, bone and morph entries) in `src/lib/`. Unit tests with a procedural sample.
- [x] P2.2 Drop or Open of a `.vpd` applies the pose to the selected model.
- [x] P2.3 Export the current pose as `.vpd` next to `.pose.json`.

### P3. Motion Editor: hand poses and beat detection

- [x] P3.1 Hand-pose presets (open, fist, point, peace, relaxed) applied to the finger bones at the playhead, reusing the Video to VMD finger presets.
- [x] P3.2 Audio beat detection (onset energy on the decoded waveform) that sets BPM and snaps keys to beats.

### P4. Performance and load

- [x] P4.1 Initial load under 800 KB gzip. Measured: index.html pulls 43 files, 360 KB gzip in total. The 1.1 MB gzip Babylon engine chunk is already a dynamic import, but any use needs it, so splitting it further would not help. No change made.
- [ ] P4.2 (deferred) Opt-in multi-threaded Bullet when the host sends COOP/COEP. Needs the engine to move from `MmdRuntime` + `MmdBulletPhysics` to babylon-mmd's WASM runtime and physics classes, and `nginx.conf` does not send COOP/COEP yet (an earlier note here said it did; it does not). A rewrite of the runtime, so left until there is a measured physics bottleneck.

### P5. Looks and rendering

- [x] P5.1 Let toon looks use the HDR environment for ambient colour.
- [ ] P5.2 Multiple simultaneous audio clips in the Clip Timeline.

### P6. Video to VMD quality

- [~] P6.1 Drive shoulders (肩) and 腕捩 from the pose, not rest. Done: 肩 follows 20 % of the arm swing, max 25°, unit-tested on the synthetic dancer. Todo: 腕捩.
- [ ] P6.2 Improve depth handling for toward/away moves in single view.

### P7. Model scaling with physics

- [ ] P7.1 Scale rigid-body sizes and joint positions with model scale, so scaled physics-heavy models behave.

### P8. Mobile

- [ ] P8.1 Folder picking fallback on phones (guided ZIP flow).
- [ ] P8.2 Full Monaco-free playground editor on phones, or a lighter code field.

### Out of scope for now

Mesh sculpting, weight painting and weight transfer; OBJ/Collada/.blend import; `.x` accessories; node-graph shader editor.

## Log

Newest first. One line per finished step: date, milestone id, commit.

- 2026-10-12: P5.1 done (toon ambient from the HDR's spherical polynomial, `src/lib/shAmbient.ts`, `e2e/hdr-ambient.spec.ts` passes). P6.1 partly done (肩 only).
- 2026-10-11: P4 reviewed: P4.1 already met (360 KB gzip initial), P4.2 deferred (runtime rewrite).
- 2026-10-11: P3 done: Tools > Hands keys the five presets at the playhead (`src/lib/motion/hands.ts`); Markers > Detect from music (`src/lib/beats.ts`, one steady tempo). `e2e/hands-beats.spec.ts` passes with the existing motion-editor specs. Not checked on real music.
- 2026-10-11: P2 done: `src/lib/vpd.ts` (parse and write, Shift-JIS), drop or Load pose accepts `.vpd`, Save VPD button, `e2e/vpd.spec.ts` passes. Not checked against a real MMD-made VPD.
- 2026-10-11: P1.4 and P1.5 done: timeline Light and Self shadow rows, `getSunState()`, `e2e/vmd-light.spec.ts` passes in Chromium (light interpolates, toggle restores manual sun).
- 2026-10-11: P1.1, P1.2 and part of P1.3 done (`src/lib/vmdLight.ts`, engine `updateMotionLight`, Scene toggle). Unit tests pass (406). Not yet checked in a real browser.
- 2026-10-11: plan created.
