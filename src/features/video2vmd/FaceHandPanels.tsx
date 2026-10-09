import { RotateCcw } from 'lucide-react';
import { useMemo } from 'react';
import { Button, Section, SliderRow, ToggleRow } from '@/components/ui/controls';
import { DEFAULT_HAND_SETTINGS } from '@/engine/video2vmd/convert';
import { DEFAULT_FACE_SETTINGS, SOURCE_IDS, resolveMorphs, sourceLabel } from '@/lib/video2vmd/face';
import { useStudio } from '@/store/studio';
import { useV2V } from '@/store/video2vmd';
import { resetMorphMap, updateFace, updateHands, updateMorphEntry } from './actions';

/** Morph names of the retarget target (or null: standard names). */
function useTargetMorphs(): string[] | null {
  const target = useV2V((s) => s.targetModelId);
  const models = useStudio((s) => s.models);
  const selected = useStudio((s) => s.selectedModelId);
  return useMemo(() => {
    const dancers = models.filter((m) => !m.stage);
    const m = dancers.find((x) => x.id === target) ?? dancers.find((x) => x.id === selected) ?? dancers[0];
    return m ? m.info.morphs.map((x) => x.name) : null;
  }, [models, target, selected]);
}

/** Face options and the editable blendshape → morph table. */
export function FaceOptions() {
  const face = useV2V((s) => s.settings.face) ?? DEFAULT_FACE_SETTINGS;
  const hasAudio = useV2V((s) => !!s.video?.info.hasAudio);
  const report = useV2V((s) => s.result?.report.face);
  const morphs = useTargetMorphs();
  const resolved = useMemo(() => resolveMorphs(face.map, morphs), [face.map, morphs]);
  return (
    <Section title="Face" defaultOpen>
      {report && (
        <div className="mb-1 text-[11px] text-fg-muted" data-testid="v2v-face-summary">
          Face found in {report.detectedPct.toFixed(0)}% of frames · writing {report.written.length} morphs
        </div>
      )}
      <ToggleRow
        label="Mouth from the audio (lip-sync)"
        checked={face.lipSync}
        disabled={!hasAudio}
        onChange={(v) => updateFace({ lipSync: v }, 0)}
      />
      <ToggleRow label="Eye bones (gaze)" checked={face.eyes} onChange={(v) => updateFace({ eyes: v }, 0)} />
      <SliderRow
        label="Head from face tracking"
        value={face.headBlend}
        min={0}
        max={1}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => updateFace({ headBlend: v })}
      />
      <SliderRow
        label="Minimum blink length"
        value={face.minBlinkFrames}
        min={1}
        max={6}
        step={1}
        format={(v) => `${v} frames`}
        onChange={(v) => updateFace({ minBlinkFrames: v })}
      />
      <SliderRow
        label="Noise deadzone"
        value={face.deadzone}
        min={0}
        max={0.3}
        step={0.01}
        onChange={(v) => updateFace({ deadzone: v })}
      />
      <SliderRow
        label="Mouth release"
        value={face.release}
        min={0.02}
        max={0.4}
        step={0.01}
        format={(v) => `${Math.round(v * 1000)} ms`}
        onChange={(v) => updateFace({ release: v })}
      />
      <SliderRow
        label="Morph key reduction"
        value={face.reduceTolerance}
        min={0}
        max={0.1}
        step={0.005}
        format={(v) => (v === 0 ? 'off' : v.toFixed(3))}
        onChange={(v) => updateFace({ reduceTolerance: v }, 200)}
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[12px] font-medium">Morph mapping</span>
        <Button size="sm" variant="ghost" onClick={resetMorphMap}>
          <RotateCcw size={12} /> Defaults
        </Button>
      </div>
      <div className="mt-1 flex flex-col gap-1" data-testid="v2v-morph-table">
        {face.map.map((e, i) => {
          const name = resolved[i]?.name;
          return (
            <div
              key={`${e.morph}-${i}`}
              className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-0.5 text-[11px]"
            >
              <input
                type="checkbox"
                aria-label={`Write ${e.morph}`}
                className="h-4 w-4 accent-[#6d8bff]"
                checked={e.enabled}
                onChange={(ev) => updateMorphEntry(i, { enabled: ev.target.checked })}
              />
              <span className="truncate" title={name && name !== e.morph ? `Written as ${name}` : undefined}>
                <b className="text-fg">{e.morph}</b>{' '}
                {morphs && !name ? (
                  <span className="text-warn">· not in model</span>
                ) : name && name !== e.morph ? (
                  <span className="text-fg-dim">→ {name}</span>
                ) : null}
              </span>
              <select
                aria-label={`Source for ${e.morph}`}
                className="input h-6 max-w-[9rem] text-[11px] coarse:h-9"
                value={e.source}
                onChange={(ev) => updateMorphEntry(i, { source: ev.target.value })}
              >
                {SOURCE_IDS.map((id) => (
                  <option key={id} value={id}>
                    {sourceLabel(id)}
                  </option>
                ))}
              </select>
              <span />
              <label className="col-span-2 flex items-center gap-1.5 text-fg-muted">
                Gain
                <input
                  type="range"
                  aria-label={`Gain for ${e.morph}`}
                  className="min-w-0 flex-1 accent-[#6d8bff]"
                  min={0}
                  max={3}
                  step={0.05}
                  value={e.gain}
                  onChange={(ev) => updateMorphEntry(i, { gain: Number(ev.target.value) })}
                />
                <span className="w-7 text-right font-mono">{e.gain.toFixed(2)}</span>
                Offset
                <input
                  type="range"
                  aria-label={`Offset for ${e.morph}`}
                  className="w-14 accent-[#6d8bff]"
                  min={-0.5}
                  max={0.5}
                  step={0.05}
                  value={e.offset}
                  onChange={(ev) => updateMorphEntry(i, { offset: Number(ev.target.value) })}
                />
              </label>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/** Finger options. */
export function HandOptions() {
  const hands = useV2V((s) => s.settings.hands) ?? DEFAULT_HAND_SETTINGS;
  const report = useV2V((s) => s.result?.report.hands);
  return (
    <Section title="Fingers" defaultOpen>
      {report && (
        <div className="mb-1 text-[11px] text-fg-muted" data-testid="v2v-hands-summary">
          Left hand {report.detectedPct[0].toFixed(0)}% · right hand {report.detectedPct[1].toFixed(0)}% of
          frames
        </div>
      )}
      <ToggleRow
        label="Snap unsure frames to a hand preset"
        checked={hands.presetSnap}
        onChange={(v) => updateHands({ presetSnap: v }, 0)}
      />
      <ToggleRow
        label="Refine wrist and 手捩 from the hand"
        checked={hands.wristRefine}
        onChange={(v) => updateHands({ wristRefine: v }, 0)}
      />
      <SliderRow
        label="Finger smoothing"
        value={hands.minCutoff}
        min={0.3}
        max={6}
        step={0.1}
        format={(v) => `${v.toFixed(1)} Hz`}
        onChange={(v) => updateHands({ minCutoff: v })}
      />
      <SliderRow
        label="Hold on dropout"
        value={hands.holdSeconds}
        min={0}
        max={2}
        step={0.1}
        format={(v) => `${v.toFixed(1)} s`}
        onChange={(v) => updateHands({ holdSeconds: v })}
      />
      <SliderRow
        label="Finger key reduction"
        value={hands.reduceTolerance}
        min={0}
        max={4}
        step={0.1}
        format={(v) => (v === 0 ? 'off' : `${v.toFixed(1)}°`)}
        onChange={(v) => updateHands({ reduceTolerance: v }, 200)}
      />
    </Section>
  );
}
