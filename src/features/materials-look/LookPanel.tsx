import { ChevronDown, ChevronRight, Copy, Download, Gauge, Sparkles, Upload, Wand2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Section, Select, Switch, ToggleRow } from '@/components/ui/controls';
import { cn } from '@/components/ui/cn';
import { Chip, ColorField, Notice, ValueSlider } from '@/features/model-editor/ui';
import { NameLabel } from '@/features/names/NameLabel';
import { useNameText } from '@/features/names/text';
import {
  KEY_PARAMS,
  LOOK_IDS,
  LOOK_LABEL,
  PARAM_SPECS,
  PRESETS,
  type LookId,
  type MaterialLook,
  type ParamKey,
  type Rgb,
  type TierSetting,
} from '@/lib/npr/looks';
import { engineOrNull } from '@/store/engineRef';
import { looksStore, useLooks } from '@/store/looks';
import type { ModelUI } from '@/store/studio';
import {
  autoAssignLooks,
  clearLooks,
  copyLook,
  exportLooks,
  importLooks,
  paramValue,
  resetLookParam,
  setLookParam,
  setMaterialLook,
  setNprSettings,
  setSeeThroughEyes,
} from './actions';

const NO_MATERIALS: Record<string, MaterialLook> = {};

/** Live cost readout: shown while a heavy look is on screen. */
function CostBadge() {
  const [s, setS] = useState<{ heavy: number; cost: number; fps: number; supported: boolean } | null>(null);
  useEffect(() => {
    const tick = (): void => {
      const e = engineOrNull();
      if (!e) return;
      const st = e.getNprStats();
      setS({ heavy: st.heavy, cost: st.cost, fps: Math.round(e.getFps()), supported: st.supported });
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  if (!s) return null;
  if (!s.supported)
    return <Notice tone="warn">Looks need WebGL2; this renderer shows the PMX original materials.</Notice>;
  if (!s.heavy) return null;
  return (
    <div
      className="flex items-center gap-1.5 rounded border border-warn/40 bg-warn/10 px-2 py-1 text-[11px]"
      data-testid="look-cost"
    >
      <Gauge size={12} className="text-warn" />
      {s.heavy} heavy look(s) · ≈{s.cost.toFixed(1)}× shading cost · {s.fps} fps
    </div>
  );
}

export function LookSection({ model }: { model: ModelUI }) {
  const settings = useLooks((s) => s.settings);
  const materials = useLooks((s) => s.models[model.id]?.materials ?? NO_MATERIALS);
  const seeThrough = useLooks((s) => s.models[model.id]?.seeThroughEyes ?? true);
  const open = useLooks((s) => (s.open?.modelId === model.id ? s.open.material : null));
  const text = useNameText(model.id);
  const assigned = Object.keys(materials).length;
  return (
    <Section title={`Looks (anime / toon)${assigned ? ` · ${assigned}` : ''}`} defaultOpen={false}>
      <div className="space-y-2" data-testid="look-panel">
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="primary"
            size="sm"
            data-testid="look-auto"
            onClick={() => autoAssignLooks(model.id)}
          >
            <Wand2 size={13} /> Auto-assign looks
          </Button>
          <Button size="sm" variant="ghost" disabled={!assigned} onClick={() => clearLooks(model.id)}>
            Clear
          </Button>
          <Button size="sm" variant="ghost" onClick={() => exportLooks(model.id)} disabled={!assigned}>
            <Download size={13} /> JSON
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void importLooks(model.id)}>
            <Upload size={13} /> Import
          </Button>
        </div>
        <label className="flex items-center justify-between text-[12px] text-fg-muted">
          <span className="flex items-center gap-1">
            <Sparkles size={12} /> {settings.showOriginal ? 'Before (PMX original)' : 'After (looks)'}
          </span>
          <Switch
            label="Before / after"
            checked={!settings.showOriginal}
            onChange={(v) => setNprSettings({ showOriginal: !v })}
          />
        </label>
        <CostBadge />
        <ValueSlider
          label="Toon strength"
          testid="look-global-toon"
          value={settings.toonStrength}
          min={0}
          max={1}
          reset={1}
          onChange={(v, d) => setNprSettings({ toonStrength: v }, d)}
        />
        <ValueSlider
          label="Rim strength"
          testid="look-global-rim"
          value={settings.rimStrength}
          min={0}
          max={3}
          reset={1}
          onChange={(v, d) => setNprSettings({ rimStrength: v }, d)}
        />
        <ValueSlider
          label="Shadow warmth"
          testid="look-global-warmth"
          value={settings.shadowWarmth}
          min={-1}
          max={1}
          reset={0}
          onChange={(v, d) => setNprSettings({ shadowWarmth: v }, d)}
        />
        <Select<TierSetting>
          label="Look quality"
          value={settings.tier}
          onChange={(tier) => setNprSettings({ tier })}
          options={[
            { value: 'auto', label: 'Auto (follows render quality)' },
            { value: 'high', label: 'High (full)' },
            { value: 'medium', label: 'Medium (no realistic blend)' },
            { value: 'low', label: 'Low (flat toon + outline)' },
          ]}
        />
        <Select<'hull' | 'post'>
          label="Outline"
          value={settings.outlineMode}
          onChange={(outlineMode) => setNprSettings({ outlineMode })}
          options={[
            { value: 'hull', label: 'Inverted hull (PMX edge)' },
            { value: 'post', label: 'Post-process (depth edges)' },
          ]}
        />
        <ToggleRow
          label="Thinner outline far away"
          checked={settings.outlineFalloff}
          onChange={(v) => setNprSettings({ outlineFalloff: v })}
        />
        <ToggleRow
          label="See-through hair over eyes"
          checked={seeThrough}
          onChange={(v) => setSeeThroughEyes(model.id, v)}
        />

        <ul className="divide-y divide-line rounded-md border border-line" data-testid="look-materials">
          {model.info.materials.map((mat) => {
            const m = materials[mat.name];
            const look = m?.look ?? 'default';
            const isOpen = open === mat.name;
            return (
              <li key={`${mat.index}-${mat.name}`}>
                <div className="flex items-center gap-1 px-1.5 py-0.5">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-label={`Edit look of ${text('material', mat.name)}`}
                    disabled={look === 'default'}
                    className="grid h-6 w-5 place-items-center text-fg-dim disabled:opacity-30 coarse:h-11 coarse:w-8"
                    onClick={() =>
                      looksStore.set({ open: isOpen ? null : { modelId: model.id, material: mat.name } })
                    }
                  >
                    {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  </button>
                  <NameLabel
                    modelId={model.id}
                    kind="material"
                    ja={mat.name}
                    className="flex-1 text-[12px]"
                    fallback={`Material ${mat.index}`}
                  />
                  <select
                    className="input h-6 max-w-[48%] text-[11px] coarse:h-11 coarse:text-[13px]"
                    aria-label={`Look for ${text('material', mat.name)}`}
                    data-testid={`look-select-${mat.name}`}
                    value={look}
                    onChange={(e) => setMaterialLook(model.id, mat.name, e.target.value as LookId)}
                  >
                    {LOOK_IDS.map((id) => (
                      <option key={id} value={id}>
                        {LOOK_LABEL[id]}
                      </option>
                    ))}
                  </select>
                </div>
                {isOpen && m && (
                  <LookEditor
                    modelId={model.id}
                    material={mat.name}
                    look={m}
                    all={model.info.materials.map((x) => x.name)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </Section>
  );
}

function ParamControl({
  modelId,
  material,
  look,
  k,
}: {
  modelId: string;
  material: string;
  look: MaterialLook;
  k: ParamKey;
}) {
  const spec = PARAM_SPECS[k];
  const value = paramValue(look, k);
  const preset = PRESETS[look.look as Exclude<LookId, 'default'>][k];
  const overridden = look.params?.[k] !== undefined;
  const reset = (): void => resetLookParam(modelId, material, k);
  if (spec.kind === 'number')
    return (
      <ValueSlider
        label={spec.label}
        testid={`look-param-${k}`}
        value={value as number}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        reset={preset as number}
        onChange={(v, drag) =>
          v === preset && !drag ? reset() : setLookParam(modelId, material, k, v as never, drag)
        }
      />
    );
  if (spec.kind === 'color')
    return (
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <ColorField
            label={spec.label}
            value={(value as Rgb | null) ?? [0, 0, 0]}
            onChange={(rgb, drag) => setLookParam(modelId, material, k, rgb as never, drag)}
          />
        </div>
        <button
          type="button"
          className={cn('text-[11px] text-fg-dim hover:text-fg', !overridden && 'invisible')}
          onClick={reset}
        >
          Reset
        </button>
      </div>
    );
  if (spec.kind === 'enum')
    return (
      <Select<string>
        label={spec.label}
        value={value as string}
        options={spec.options.map((o) => ({ value: o, label: o }))}
        onChange={(v) => setLookParam(modelId, material, k, v as never)}
      />
    );
  return (
    <ToggleRow
      label={spec.label}
      checked={value as boolean}
      onChange={(v) => setLookParam(modelId, material, k, v as never)}
    />
  );
}

function LookEditor({
  modelId,
  material,
  look,
  all,
}: {
  modelId: string;
  material: string;
  look: MaterialLook;
  all: string[];
}) {
  const [more, setMore] = useState(false);
  const [copyTo, setCopyTo] = useState<string[]>([]);
  const text = useNameText(modelId);
  const rest = (Object.keys(PARAM_SPECS) as ParamKey[]).filter((k) => !KEY_PARAMS.includes(k));
  return (
    <div className="space-y-0.5 bg-bg-raised/40 px-2 pb-2" data-testid="look-editor">
      {KEY_PARAMS.map((k) => (
        <ParamControl key={k} modelId={modelId} material={material} look={look} k={k} />
      ))}
      <button
        type="button"
        className="flex items-center gap-1 py-1 text-[12px] text-fg-muted hover:text-fg"
        onClick={() => setMore(!more)}
      >
        {more ? <ChevronDown size={12} /> : <ChevronRight size={12} />} More parameters
      </button>
      {more &&
        rest.map((k) => <ParamControl key={k} modelId={modelId} material={material} look={look} k={k} />)}
      <div className="pt-1 text-[11px] text-fg-muted">Copy this look to:</div>
      <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
        {all
          .filter((n) => n !== material)
          .map((n) => (
            <Chip
              key={n}
              active={copyTo.includes(n)}
              onClick={() => setCopyTo(copyTo.includes(n) ? copyTo.filter((x) => x !== n) : [...copyTo, n])}
            >
              {text('material', n)}
            </Chip>
          ))}
      </div>
      <Button
        size="sm"
        disabled={!copyTo.length}
        onClick={() => {
          copyLook(modelId, material, copyTo);
          setCopyTo([]);
        }}
      >
        <Copy size={13} /> Copy look
      </Button>
    </div>
  );
}
