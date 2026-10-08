# English labels for Japanese bone, morph and material names

Display-layer only. Japanese names stay the identifiers in the engine, VMD import/export, IK, physics,
the motion editor's clips and project files. Every label is computed from `(kind, japaneseName)` at
render time.

## Where names are shown today

| Place                                                         | File                                                                                 | What                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------- |
| Model inspector: morph sliders, morph search, category groups | `features/inspector/ModelInspector.tsx` (`MorphSection`, `MorphSlider`, `SearchBox`) | morph names                 |
| Model inspector: bone tree, bone search, selected bone        | `ModelInspector.tsx` (`BoneSection`, `BoneRow`)                                      | bone names                  |
| Model inspector: material list (show/hide, outline, alpha)    | `ModelInspector.tsx` (`MaterialSection`)                                             | material names, aria labels |
| Playback timeline: per-model bone / morph track rows          | `features/timeline/Timeline.tsx`                                                     | bone / morph names          |
| Camera panel: "follow bone" select                            | `features/inspector/CameraPanel.tsx`                                                 | bone names                  |
| Motion editor dope sheet rows (canvas)                        | `features/motion-editor/DopeSheet.tsx` via `rows.ts`                                 | bone / morph names          |
| Motion editor graph editor title, status bar channel          | `GraphEditor.tsx`, `EditorDock.tsx`                                                  | bone / morph name           |
| IK panel: chain list, pin bone select, pin list               | `IkPanel.tsx`                                                                        | IK / target bone names      |
| Camera Director: look-at bone select                          | `DirectorPanel.tsx`                                                                  | bone names                  |
| Tools / toasts ("Pin 左足ＩＫ", "has no keys to pin")         | `ikActions.ts`                                                                       | bone names in text          |

Not touched: model names, file names, VMD/PMX data, playground API (scripts keep using Japanese names).

## Resolution (first hit wins)

1. **Override** for this model (`labels[modelKey][kind][ja]`).
2. **Dictionary** (`src/lib/names/*.json`): exact match on the NFKC-normalised name; 左/右 variants are
   generated from entries marked `sided`.
3. **Pattern rules** (`patterns.ts`): normalise (NFKC: full-width digits/letters → ASCII), split off
   左/右 (prefix or suffix) → Left/Right, trailing numbers, IK / D / EX suffixes, then greedy
   longest-match over a token table (腕 Arm, 先 Tip, 親 Parent, 捩 Twist, 補助 Helper, 袖 Sleeve,
   髪 Hair, スカート Skirt, リボン Ribbon, 胸 Chest, 目 Eye, 口 Mouth, …). Only used when every
   non-ASCII character is covered; marked as a guess in the UI.
4. **PMX English name** (bone / morph / material `englishName`) when non-empty and different from the
   Japanese name.
5. **Original** Japanese name.

`resolveName(kind, ja, { override, pmxEn })` → `{ en, ja, source }`. A per-model `NameTable`
(precomputed `Map`s, memoised on the model info + override objects) serves the UI; a model with
thousands of morphs resolves once, not per render.

## Display

- Setting `nameDisplay: 'en' | 'ja' | 'both'` (default both → `Left Arm (左腕)`), a per-device pref in
  `store/prefs.ts` (localStorage), switchable from the inspector and More menu.
- `<NameLabel>` component: label text, truncation, tooltip with the Japanese name and the source
  (override / dictionary / pattern / PMX / original), a dotted underline + `≈` for pattern guesses,
  context menu / long-press → Rename label.
- Canvas (dope sheet) uses the same table through a plain function.
- Search: `matchesName(query, resolved)` compares NFKC + lower-case + katakana→hiragana forms of
  both English and Japanese.
- Order stays the model's own order.

## Overrides

- Store slice `useNames` with `labels: Record<modelKey, { bone, morph, material: Record<ja, en> }>`.
- `modelKey = modelName + '#' + fnv1a(bones + morphs names)` so the same PMX in another project
  shares its labels when imported, and a different model with the same name doesn't.
- Saved in the project document (`ProjectDoc.labels`, IndexedDB autosave) and therefore in
  `.mmdstudio.zip`; JSON export / import of one model's labels from the inspector.
- Rename dialog (Radix dialog): text field, Reset label, Reset all labels for this model.

## Materials

Small dictionary (顔 Face, 髪 Hair, 服 Clothes, 肌 Skin, スカート Skirt, 靴 Shoes, 目 Eyes, 眉
Eyebrows, 口 Mouth, 歯 Teeth, リボン Ribbon, 袖 Sleeves, …) + the same pattern rules. Material English
names come from the loader's serialization metadata (`preserveSerializationData`).

## Milestones

- [x] a. Dictionary JSON + normalise + patterns + resolver + search + tests
- [x] b. `NameLabel` / name table wired into every place listed above
- [x] c. Display setting + bilingual search
- [ ] d. Overrides: rename / reset / reset all, project + zip persistence, JSON import/export
- [ ] e. Materials dictionary + PMX material English names
- [ ] f. Mobile polish (long-press, 44 px, truncation), Playwright desktop + phone, README
