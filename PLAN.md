# MMD Studio – Build Plan

Browser-only MikuMikuDance studio. Vite + React 18 + TS (strict) + Babylon.js 9 + babylon-mmd.

## Key technical decisions
- **Runtime**: babylon-mmd JS `MmdRuntime` + `MmdBulletPhysics` on a single-threaded Bullet WASM
  instance (`MmdWasmInstanceTypeSPR`). Single-threaded because GitHub Pages / static hosts cannot
  send COOP/COEP headers required for SharedArrayBuffer.
- **Per-model physics toggle**: every model is built with physics; toggling flips the model's
  `rigidBodyStates` (0 = rigid bodies follow bones). No rebuild needed.
- **Audio sync**: the MMD runtime is the master clock; an `AudioSync` helper keeps an
  `HTMLAudioElement` (routed through Web Audio so the recorder can capture it) aligned to
  `runtimeTime + offset`, re-seeking only when drift > 80 ms.
- **Texture resolution**: all inputs are normalised into a virtual file list (`VFile {path, blob}`).
  PMX texture paths are resolved case-insensitively with `\`/`/` normalisation, Shift-JIS ZIP
  filename decoding, basename fallback, and a 1x1 placeholder for missing textures (warned).
- **Engine/UI boundary**: `StudioEngine` (framework-agnostic, typed event emitter) owns every
  Babylon object. React talks to it only through methods + DTOs. A bridge syncs Zustand state
  into the engine.
- **Persistence**: IndexedDB stores project docs + file blobs; autosave is debounced.

## Milestones
- [ ] a. Scaffold, engine core, viewport (camera modes, grid/axes, stats, quality presets)
- [ ] b. Asset loading (drop/picker/folders/ZIP worker), path resolution, model list panel
- [ ] c. Playback, audio sync + offset, timeline (keyframe ticks, camera track, waveform)
- [ ] d. Bullet physics + model inspector (morphs, bones+gizmo, materials, transform)
- [ ] e. Lighting, shadows, background/HDR, post-processing, camera tools
- [ ] f. Pose save/load, screenshot, video recording (realtime + frame-stepped)
- [ ] g. IndexedDB autosave, recent projects, .mmdstudio.zip export/import
- [ ] h. Playground tab (Monaco, studio API, 5 examples, console)
- [ ] i. Polish, shortcuts, undo/redo, a11y, tests (vitest + Playwright), docs, Docker, CI

## Test fixtures
`scripts/make-fixtures.mjs` procedurally generates a tiny PMX (bones, hair chain with rigid
bodies/joints, morphs, texture in a sub-folder), a model VMD, a camera VMD and a WAV. No
third-party assets are shipped.
