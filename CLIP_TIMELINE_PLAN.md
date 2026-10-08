# Clip Timeline + 3D Text clips

A video-editor style timeline on top of the existing engine. Clips reference source motions and never
edit their keyframes; the timeline is **baked** into ordinary `MotionClip`s (the Motion Editor model)
for playback and export. The keyframe Motion Editor stays as the "Advanced" view.

## Layers

| Layer      | Where                         | What                                                                                                                                                                                                                                                                                  |
| ---------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pure logic | `src/lib/clips/`              | data model, edit operations (split / trim / move / duplicate / loop / retime / mirror / reorder), snapping, baking with joins, serialization, SRT/LRC parsing, text layout, glyph outline → triangulated extruded geometry, text animation timing. No Babylon, no React; unit-tested. |
| Engine     | `src/engine/text/`            | Babylon text meshes (merged or per-letter), materials / style presets, placement (fixed, billboard, bone-attached, screen caption), per-frame animation, glow layer, disposal. Exposed as `engine.setTextClips()`.                                                                    |
| State      | `src/store/clipTimeline.ts`   | Zustand slice: the timeline document, selection, view (zoom / scroll / playhead mode), runtime source cache.                                                                                                                                                                          |
| UI         | `src/features/clip-timeline/` | timeline dock (tracks, clip blocks, ruler, contextual toolbar, add menu), text edit panel / sheet, font store, bake scheduler, audio controller, persistence.                                                                                                                         |

## Data model (`lib/clips/types.ts`)

```ts
type TrackKind = 'dance' | 'camera' | 'face' | 'audio' | 'text';
interface Track {
  id;
  kind;
  modelId?: string /* dance, face */;
  name;
}
interface Source {
  id;
  kind: 'motion' | 'camera' | 'face' | 'audio';
  name;
  ref?: FileRef;
  length; /* frames */
}
interface Clip {
  id;
  trackId;
  sourceId?: string; // text clips have no source
  sourceIn;
  sourceOut; // frames in the source (inclusive in, exclusive out)
  startFrame;
  speed /* 0.25–4 */;
  mirror;
  loopCount /* ≥ 1 */;
  join: {
    fade /* crossfade frames from the previous clip, default 8 */;
    root: 'continue' | 'origin';
    cut: boolean; /* camera: hard cut vs blend */
  };
  volume?: number; // audio
  text?: TextSpec; // text
}
interface TimelineDoc {
  version;
  tracks;
  clips;
  sources;
  fonts /* user fonts (FileRefs) */;
  textStyle; /* shared SRT/LRC style */
}
```

Timeline length of a clip = `ceil((sourceOut − sourceIn) / speed) × loopCount`.

## Baking (`lib/clips/bake.ts`)

Per dance track (one per model):

1. **Segment** each clip from its source: `trim(in, out)` → `mirror` → `retime(1/speed)` → `loop(n, seam blend)`
   (exactly the Motion Editor tools, so a bake equals the equivalent keyframe edits). The value at the cut
   points is sampled exactly, so split halves meet with no jump.
2. **Root continuity**: with `root: 'continue'`, the clip is offset so its センター (or 全ての親) XZ starts
   where the previous clip ended; the leg IK targets move by the same offset, so feet don't pop.
   `origin` keeps the source's own placement.
3. **Place** at `startFrame`.
4. **Joins**: touching clips crossfade over `join.fade` frames using the previous clip's handle (its source
   motion after its out point, or its held last pose); overlapping clips crossfade over the overlap.
   Crossfades bake per frame: slerp rotations, lerp positions and morphs.
5. **Face track** clips replace the dance morphs inside their ranges (with boundary keys).
6. Gaps hold the previous pose.

Camera track: segments with the same steps; a join is a **hard cut** (MMD cut pair: keys on consecutive
frames) or a **blend** over `fade` frames. Audio track: one loaded audio file, any number of clips of it;
a controller sets the engine's audio offset and volume for the clip under the playhead.

Rebakes run debounced (60 ms) and only for tracks whose clips / sources changed; the result goes to
`engine.setMotionClip` / `setCameraClip`. VMD export of the timeline writes the baked clips (text ignored,
with a notice).

## Text pipeline

1. **Fonts** (`features/clip-timeline/fonts.ts`): bundled OFL fonts in `public/fonts` (Noto Sans JP Bold,
   Bungee, Pacifico, Press Start 2P) loaded on demand; user .ttf / .otf / .woff stored as project assets.
   Parsed with opentype.js and cached.
2. **Layout** (`lib/clips/text/layout.ts`): lines, advance widths, kerning, letter / line spacing,
   alignment. Glyphs missing from the chosen font fall back to Noto Sans JP; still-missing glyphs are
   reported (and skipped).
3. **Geometry** (`lib/clips/text/geometry.ts`): glyph path → flattened contours (quality: curve steps) →
   outer / hole grouping by signed area and containment → earcut → front / back caps + side walls,
   optional bevel (inset ring) → positions / normals / indices. Cached per font + glyph + quality + depth +
   bevel.
4. **Engine** (`engine/text/TextLayer.ts`): one merged mesh per clip (per-letter meshes only when the
   animation is per-letter), style presets (Solid, Glossy, Neon + glow, Gradient (vertex colors),
   Outline / cartoon, Glass), placement (fixed with gizmo, billboard, bone + offset, screen caption parented
   to the camera), shadows / depth-test toggles, per-frame in / out / idle animation from
   `lib/clips/text/anim.ts`. Disposal on delete.
5. **SRT / LRC** (`lib/clips/subtitles.ts`) → one text clip per line on a text track with the shared style.

## UI

- Bottom dock modes: **Timeline** (playback), **Clips** (default on phones / tablets), **Advanced**
  (keyframe editor).
- Tracks with clip blocks: pose thumbnails (stick figure via FK of the model skeleton), audio waveform,
  colored labels for camera / face / text.
- Fixed center playhead (scroll the timeline) or free playhead (desktop default); pinch / wheel zoom.
- Gestures: tap select, drag move, edge trim, long-press drag to reorder (ripple), drag to another track
  of the same kind, snapping to playhead / clip edges / markers / beat grid.
- Contextual toolbar: Split, Delete, Duplicate, Retime, Mirror, Loop, Join (crossfade, root), Volume,
  Edit text. `+` menu: motion, camera, face preset, audio, text, subtitles.
- Undo / redo (global history, ≥ 200), autosave into the project, Revert to the session start.
- Double-click a dance / camera / face clip → its baked segment becomes an edited source and opens in
  the keyframe editor; **Back to clips** stores the edits in that source and rebakes.

## Milestones

- [x] a. Clip model + bake + tests
- [ ] b. Clip timeline UI: select / move / trim
- [ ] c. Split / delete / duplicate / retime / mirror / loop
- [ ] d. Joins and crossfades, root continuity
- [ ] e. Camera, face and audio tracks
- [ ] f. Text generation pipeline (fonts + extrude)
- [ ] g. Text styling, placement modes, bone attach
- [ ] h. Text animations + SRT / LRC import
- [ ] i. Advanced-view handoff to the keyframe editor
- [ ] j. Mobile, polish, tests, docs
