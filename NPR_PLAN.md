# NPR (anime / toon) looks — plan

Preset-based toon shading for PMX materials, layered on the existing renderer. "Default" stays byte-for-byte the
current rendering.

## How materials are made today

- babylon-mmd's loader builds one `MmdStandardMaterial` per PMX material (`MmdStandardMaterialBuilder`).
  It is a Babylon `StandardMaterial` plus babylon-mmd's `MmdPluginMaterial`, which adds:
  - sphere maps and the PMX toon texture;
  - texture colour morphs;
  - SDEF skinning;
  - MMD's ambient / diffuse handling, through GLSL code injection.
- Skinning, morph targets (`MorphTargetManager`), the shadow map (`ShadowGenerator`, PCF), bloom / tone mapping
  (`DefaultRenderingPipeline`) and fog all come from `StandardMaterial`'s shader and Babylon's includes.
- The outline is babylon-mmd's `MmdOutlineRenderer`: an inverted-hull pass per material (`renderOutline`,
  `outlineWidth`, `outlineColor`, `outlineAlpha`), sharing the mesh's skinning and morphs.
- The engine (`BabylonStudioEngine`) scales `outlineWidth` by the global outline setting and hides materials through
  alpha.

## Hook: a second `MaterialPlugin` (chosen)

| Option | Skinning / morphs / SDEF | Shadows | MMD outline | Post-FX | Cost |
|---|---|---|---|---|---|
| **MaterialPlugin on the existing material** | kept: same vertex shader | kept: the light loop's shadow term | kept: same material object | kept | small fragment add-on |
| NodeMaterial | we'd re-build skinning, SDEF and morph blocks | re-wire | outline renderer expects `MmdStandardMaterial` | ok | big graph per material |
| ShaderMaterial | re-implement all of it | manual shadow sampling | breaks | manual | most work, most risk |

`NprLookPlugin` (`src/engine/npr/NprLookPlugin.ts`) is attached to a material only when its look isn't Default, so a
Default material keeps the exact shader it has today. It runs after babylon-mmd's plugin (higher priority number) and
injects code at `CUSTOM_FRAGMENT_BEFORE_FOG`. By then Babylon has:

- computed `normalW`, `viewDirectionW`, `baseColor` (texture × texture-colour morph) and `alpha`;
- run the light loop, so `aggShadow` / `numLights` hold the shadow term (only the sun casts shadows, so its shadow is
  `aggShadow·n − (n − 1)`);
- added babylon-mmd's sphere-map colour.

The plugin computes the toon colour from these and replaces `color.rgb` / `color.a`. Fog, image processing, bloom and
tone mapping run afterwards, unchanged.

Light direction, sun colour and hemispheric sky / ground colours come from `NprGlobals`. The engine updates them when
lighting settings change, not every frame. Each plugin writes its look parameters into the material's UBO in
`bindForSubMesh`, only when its version or the effect changed.

**WebGPU:** the app's WebGPU path is opt-in (`?webgpu`). The plugin is GLSL-only (`isCompatible` returns false for
WGSL), so on WebGPU looks are disabled with a toast and materials stay Default.

## Shader structure (GLSL, WebGL2)

```
albedo   = baseColor.rgb * diffuse (MMD diffuse + ambient, as babylon-mmd computes it)
N'       = normalW (+ value-noise bump for cloth)
ndl      = dot(N', L) → half-lambert → face flatten
ramp     = analytic smoothstep(threshold ± softness)  |  PMX toon texture (custom ramp)
shadowed = min(ramp, mix(1, sunShadow, shadowStrength))
shade    = albedo * shadowTint (colour + saturation boost; "shadow warmth" shifts it warmer)
toon     = mix(shade, albedo, shadowed) * sun + albedo * hemisphere ambient
         + specular band (blinn half-vector band; hair: ring band)
         + rim (fresnel^power × light-facing mask) + emission + sparkle (metal) + sheen (stockings)
pbr      = albedo*(ndl·shadow·sun + ambient) + GGX·Fresnel specular        (High tier only)
colour   = mix(pbr, toon, toonAmount) + sphere map (as in MMD)
alpha    = keep | blend | mask (cut-off) | hash (stochastic discard, opaque pass)
eyes     = optional gl_FragDepth bias toward the camera ("see-through hair over eyes")
```

Defines select the variant: `NPR`, `NPR_TIER_HIGH` / `NPR_TIER_MED`, `NPR_RAMP_TEX`, `NPR_HYBRID`, `NPR_NOISE`,
`NPR_SPARKLE`, `NPR_SHEEN`, `NPR_ALPHA_HASH`, `NPR_ALPHA_MASK`, `NPR_SEE_THROUGH`, `NPR_BLUSH`, `NPR_UNLIT`. Babylon
compiles each define set lazily on first use and caches the effect, so all materials with the same preset and tier
share one program.

## Outline

The MMD inverted hull stays the default; edge colour and size come from the PMX.
- Per-material overrides: a colour, and thickness as a multiplier.
- Distance falloff: an `onBeforeRender` pass computes each model's camera distance. It rewrites `outlineWidth` only
  when the factor changes by more than 2 %, so there are no per-frame writes or allocations while the camera is still.
- Post-process mode: a depth-edge `PostProcess` (Sobel on the depth renderer) replaces the hull outlines while it's on.

## Alpha and draw order

- **alpha-hash:** an interleaved-gradient hash discard. The material is treated as opaque, so there's no sorting
  problem and it works with shadows.
- **mask:** a cut-off at 0.5.
- **blend:** Babylon's sorted alpha blend, as today.
- **See-through hair over eyes:** eye and brow materials write a depth biased toward the camera
  (`gl_FragDepth`, by `seeThrough` world units), so nearby hair loses the depth test while the back of the head
  still hides the eyes. It's toggleable per model and costs nothing elsewhere.

## Data (pure, `src/lib/npr`)

- `LookId`: one of default, animeSkin, animeFace, animeHair, clothSmooth, clothRough, stockings, metal, eye,
  flatUnlit.
- `LookParams`: every parameter, with ranges and defaults per preset (`PARAM_SPECS`).
- `MaterialLook`: `{ look, params? }`, where `params` holds only the overrides.
- `ModelLooks`: `{ materials: Record<name, MaterialLook>, seeThroughEyes }`.
- `NprSettings`: global options:
  - tier (auto / high / medium / low);
  - before / after;
  - toon strength, rim strength, shadow warmth;
  - outline mode and falloff.
- Auto-assign (`assign.ts`) classifies by material name, English name, the dictionary label and texture name. It
  checks eye and stockings first, then metal, then the Model Editor's outfit groups:
  - hair → Anime Hair;
  - face → Anime Face;
  - body → Anime Skin;
  - top / bottom / gloves → Cloth Smooth (Cloth Rough for leather, denim and knit);
  - shoes → Cloth Rough;
  - anything else stays Default.
- Serialised in the project (`looks`), `.mmdstudio.zip` and shareable JSON (`mmd-studio-looks`, v1), validated and
  clamped on import.

## Quality tiers

| Tier | Features |
|---|---|
| High | everything, hybrid PBR blend |
| Medium | no hybrid PBR, no sparkle |
| Low | flat toon ramp, shadow tint and outline only (no rim, spec, noise, sheen; hash → mask) |

"Auto" follows the viewport quality, which the adaptive-quality controller already lowers on slow devices. Phones
default to Low.

If a variant fails to compile (`onError`), that material's plugin is disabled, so it falls back to Default with one
toast and never shows a black model.

On context loss Babylon rebuilds effects; the looks are plain JS state, so they're re-applied unchanged.

## Performance budget

- Fragment cost:
  - High ≈ 60–80 ALU plus one optional texture;
  - Low ≈ 20 ALU.
- No per-frame allocation: parameters are packed into preallocated `Float32Array`s at edit time, and globals are
  rewritten only on settings change.
- Target 60 fps on a mid-range laptop with three models, High tier. Phones run Low by default.
- A "cost" badge appears when a heavy look is active: hybrid, sparkle or alpha-hash, on High.

## Layout

- `src/lib/npr/` — presets, parameter specs, auto-assign, serialisation, tiers (unit-tested)
- `src/engine/npr/` — `NprLookPlugin`, `NprGlobals`, outline falloff, post-process outline, apply / fallback
- `src/store/looks.ts` — Zustand slice: per-model looks, global settings
- `src/features/materials-look/` — the Look library and per-material editor (inspector section and a sheet on phones)

## Milestones

- [ ] a. Plugin + Anime Skin with skinning, morphs and shadows
- [ ] b. Preset library + auto-assign
- [ ] c. Outline upgrade
- [ ] d. Hair-over-eyes and alpha-hash
- [ ] e. UI and per-material parameters
- [ ] f. Quality tiers and adaptive fallback
- [ ] g. Persistence and sharing
- [ ] h. Mobile, tests, docs
