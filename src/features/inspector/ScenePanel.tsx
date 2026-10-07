import { Crosshair, ImagePlus, RotateCcw, X } from 'lucide-react';
import { Button, ColorRow, Row, Section, Select, SliderRow, ToggleRow } from '@/components/ui/controls';
import { DEFAULT_SETTINGS } from '@/engine/defaults';
import type { BackgroundMode, ToneMapping } from '@/engine/types';
import { pickFiles } from '@/features/app/filePickers';
import { engineOrNull } from '@/store/engineRef';
import { focusDofOnHead, setHdr, updateSettings } from '@/store/actions';
import { useStudio } from '@/store/studio';

const deg = (v: number): string => `${Math.round(v)}°`;

export function ScenePanel() {
  const s = useStudio((st) => st.settings);
  const physics = useStudio((st) => st.physics);
  const l = s.lighting;
  const b = s.background;
  const p = s.postfx;
  return (
    <div>
      <Section
        title="Directional light"
        actions={
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              updateSettings((d) => void (d.lighting = structuredClone(DEFAULT_SETTINGS.lighting)))
            }
          >
            <RotateCcw size={11} />
          </Button>
        }
      >
        <SliderRow
          label="Intensity"
          value={l.dirIntensity}
          min={0}
          max={3}
          onChange={(v) => updateSettings((d) => void (d.lighting.dirIntensity = v))}
        />
        <SliderRow
          label="Azimuth"
          value={l.dirAzimuth}
          min={-180}
          max={180}
          step={1}
          format={deg}
          onChange={(v) => updateSettings((d) => void (d.lighting.dirAzimuth = v))}
        />
        <SliderRow
          label="Elevation"
          value={l.dirElevation}
          min={5}
          max={90}
          step={1}
          format={deg}
          onChange={(v) => updateSettings((d) => void (d.lighting.dirElevation = v))}
        />
        <ColorRow
          label="Color"
          value={l.dirColor}
          onChange={(v) => updateSettings((d) => void (d.lighting.dirColor = v))}
        />
        <ToggleRow
          label="Shadows"
          checked={l.shadows}
          onChange={(v) => updateSettings((d) => void (d.lighting.shadows = v))}
        />
        <ToggleRow
          label="Soft shadows (PCF)"
          checked={l.softShadows}
          disabled={!l.shadows}
          onChange={(v) => updateSettings((d) => void (d.lighting.softShadows = v))}
        />
        <SliderRow
          label="Shadow darkness"
          value={l.shadowDarkness}
          min={0}
          max={1}
          disabled={!l.shadows}
          onChange={(v) => updateSettings((d) => void (d.lighting.shadowDarkness = v))}
        />
      </Section>
      <Section title="Ambient light">
        <SliderRow
          label="Intensity"
          value={l.ambientIntensity}
          min={0}
          max={2}
          onChange={(v) => updateSettings((d) => void (d.lighting.ambientIntensity = v))}
        />
        <ColorRow
          label="Sky color"
          value={l.ambientColor}
          onChange={(v) => updateSettings((d) => void (d.lighting.ambientColor = v))}
        />
        <ColorRow
          label="Ground color"
          value={l.groundColor}
          onChange={(v) => updateSettings((d) => void (d.lighting.groundColor = v))}
        />
      </Section>
      <Section title="Background">
        <Select<BackgroundMode>
          label="Mode"
          value={b.mode}
          onChange={(v) => updateSettings((d) => void (d.background.mode = v))}
          options={[
            { value: 'solid', label: 'Solid color' },
            { value: 'gradient', label: 'Gradient' },
            { value: 'hdr', label: 'HDR environment' },
            { value: 'transparent', label: 'Transparent' },
          ]}
        />
        {b.mode === 'solid' && (
          <ColorRow
            label="Color"
            value={b.color}
            onChange={(v) => updateSettings((d) => void (d.background.color = v))}
          />
        )}
        {b.mode === 'gradient' && (
          <>
            <ColorRow
              label="Top"
              value={b.gradientTop}
              onChange={(v) => updateSettings((d) => void (d.background.gradientTop = v))}
            />
            <ColorRow
              label="Bottom"
              value={b.gradientBottom}
              onChange={(v) => updateSettings((d) => void (d.background.gradientBottom = v))}
            />
          </>
        )}
        {b.mode === 'hdr' && (
          <>
            <Row label="Environment">
              {b.hdrName ? (
                <>
                  <span className="max-w-[110px] truncate text-[12px]" title={b.hdrName}>
                    {b.hdrName}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Remove environment"
                    onClick={() => void setHdr(null)}
                  >
                    <X size={12} />
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  onClick={async () => {
                    const [f] = await pickFiles('.hdr,.env');
                    if (f) await setHdr(f);
                  }}
                >
                  <ImagePlus size={12} /> Load .hdr / .env
                </Button>
              )}
            </Row>
            <SliderRow
              label="Intensity"
              value={b.hdrIntensity}
              min={0}
              max={3}
              onChange={(v) => updateSettings((d) => void (d.background.hdrIntensity = v))}
            />
          </>
        )}
        {b.mode === 'transparent' && (
          <p className="text-[11px] text-fg-dim">
            Transparent background applies to PNG screenshots and the viewport.
          </p>
        )}
        <ToggleRow
          label="Ground shadow plane"
          checked={b.showGround}
          onChange={(v) => updateSettings((d) => void (d.background.showGround = v))}
        />
      </Section>
      <Section title="Post-processing">
        <ToggleRow
          label="Bloom"
          checked={p.bloom}
          onChange={(v) => updateSettings((d) => void (d.postfx.bloom = v))}
        />
        {p.bloom && (
          <>
            <SliderRow
              label="Bloom weight"
              value={p.bloomWeight}
              min={0}
              max={1.5}
              onChange={(v) => updateSettings((d) => void (d.postfx.bloomWeight = v))}
            />
            <SliderRow
              label="Threshold"
              value={p.bloomThreshold}
              min={0}
              max={1}
              onChange={(v) => updateSettings((d) => void (d.postfx.bloomThreshold = v))}
            />
          </>
        )}
        <ToggleRow
          label="Depth of field"
          checked={p.dof}
          onChange={(v) => updateSettings((d) => void (d.postfx.dof = v))}
        />
        {p.dof && (
          <>
            <SliderRow
              label="Focus dist."
              value={p.dofFocusDistance}
              min={1}
              max={200}
              step={0.5}
              format={(v) => v.toFixed(1)}
              onChange={(v) => updateSettings((d) => void (d.postfx.dofFocusDistance = v))}
            />
            <SliderRow
              label="f-stop"
              value={p.dofFStop}
              min={0.5}
              max={16}
              step={0.1}
              format={(v) => `f/${v.toFixed(1)}`}
              onChange={(v) => updateSettings((d) => void (d.postfx.dofFStop = v))}
            />
          </>
        )}
        <div className="mb-1">
          <Button size="sm" onClick={focusDofOnHead}>
            <Crosshair size={12} /> Focus on model head
          </Button>
        </div>
        <ToggleRow
          label="FXAA"
          checked={p.fxaa}
          onChange={(v) => updateSettings((d) => void (d.postfx.fxaa = v))}
        />
        <ToggleRow
          label="SSAO"
          checked={p.ssao}
          onChange={(v) => updateSettings((d) => void (d.postfx.ssao = v))}
        />
        <Select<ToneMapping>
          label="Tone mapping"
          value={p.toneMapping}
          onChange={(v) => updateSettings((d) => void (d.postfx.toneMapping = v))}
          options={[
            { value: 'none', label: 'None' },
            { value: 'standard', label: 'Standard' },
            { value: 'aces', label: 'ACES' },
            { value: 'khr', label: 'Khronos neutral' },
          ]}
        />
        <SliderRow
          label="Exposure"
          value={p.exposure}
          min={0.2}
          max={3}
          onChange={(v) => updateSettings((d) => void (d.postfx.exposure = v))}
        />
        <SliderRow
          label="Contrast"
          value={p.contrast}
          min={0.5}
          max={2}
          onChange={(v) => updateSettings((d) => void (d.postfx.contrast = v))}
        />
        <ToggleRow
          label="Vignette"
          checked={p.vignette}
          onChange={(v) => updateSettings((d) => void (d.postfx.vignette = v))}
        />
        {p.vignette && (
          <SliderRow
            label="Vignette"
            value={p.vignetteWeight}
            min={0}
            max={5}
            onChange={(v) => updateSettings((d) => void (d.postfx.vignetteWeight = v))}
          />
        )}
        <SliderRow
          label="Outline / toon"
          value={p.outlineScale}
          min={0}
          max={3}
          onChange={(v) => updateSettings((d) => void (d.postfx.outlineScale = v))}
        />
        <p className="text-[11px] text-fg-dim">MSAA samples follow the quality preset in the toolbar.</p>
      </Section>
      <Section title="Physics (global)">
        {!physics.available && (
          <p className="mb-2 text-[12px] text-warn">{physics.message ?? 'Physics unavailable'}</p>
        )}
        <ToggleRow
          label="Enable physics"
          checked={s.physics.enabled}
          disabled={!physics.available}
          onChange={(v) => updateSettings((d) => void (d.physics.enabled = v))}
        />
        <SliderRow
          label="Gravity"
          value={s.physics.gravity}
          min={0}
          max={300}
          step={1}
          format={(v) => v.toFixed(0)}
          onChange={(v) => updateSettings((d) => void (d.physics.gravity = v))}
        />
        <SliderRow
          label="Substeps"
          value={s.physics.substeps}
          min={1}
          max={20}
          step={1}
          format={(v) => v.toFixed(0)}
          onChange={(v) => updateSettings((d) => void (d.physics.substeps = v))}
        />
        <Select
          label="Fixed step"
          value={String(Math.round(1 / s.physics.fixedTimeStep))}
          onChange={(v) => updateSettings((d) => void (d.physics.fixedTimeStep = 1 / Number(v)))}
          options={['30', '60', '120', '240'].map((v) => ({ value: v, label: `1/${v} s` }))}
        />
        <div className="mt-2">
          <Button size="sm" onClick={() => engineOrNull()?.resetPhysics()} disabled={!physics.available}>
            <RotateCcw size={12} /> Reset physics
          </Button>
        </div>
      </Section>
    </div>
  );
}
