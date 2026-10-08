// Text clip properties: a floating panel (desktop / tablet) or a bottom sheet (phone).

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Upload, X } from 'lucide-react';
import { ColorRow, NumberField, Row, Select, SliderRow, ToggleRow } from '@/components/ui/controls';
import { cn } from '@/components/ui/cn';
import { findClip } from '@/lib/clips/ops';
import type { TextIdleAnim, TextInAnim, TextPlacement, TextSpec, TextStylePreset } from '@/lib/clips/types';
import { isPhoneMode } from '@/lib/layoutMode';
import { ct, useClipTimeline } from '@/store/clipTimeline';
import { engineOrNull } from '@/store/engineRef';
import { useLayout } from '@/store/layout';
import { useStudio } from '@/store/studio';
import { setClipText, setSubtitleStyle } from './actions';
import { fontFamilies, uploadFont } from './fonts';

const STYLES: { value: TextStylePreset; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'glossy', label: 'Glossy' },
  { value: 'neon', label: 'Neon' },
  { value: 'gradient', label: 'Gradient' },
  { value: 'outline', label: 'Outline' },
  { value: 'glass', label: 'Glass' },
];
const PLACEMENTS: { value: TextPlacement; label: string }[] = [
  { value: 'billboard', label: 'Billboard (faces camera)' },
  { value: 'fixed', label: 'Fixed in the scene' },
  { value: 'bone', label: 'Attached to a bone' },
  { value: 'caption', label: 'Screen caption' },
];
const ANIMS: { value: TextInAnim; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Fade' },
  { value: 'pop', label: 'Pop' },
  { value: 'slide', label: 'Slide' },
  { value: 'typewriter', label: 'Typewriter' },
  { value: 'wave', label: 'Wave' },
  { value: 'spin', label: 'Spin' },
  { value: 'drop', label: 'Drop & bounce' },
];
const IDLES: { value: TextIdleAnim; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'float', label: 'Float' },
  { value: 'pulse', label: 'Pulse' },
  { value: 'wobble', label: 'Wobble' },
];
/** Fields the subtitle style shares (not the words or timing). */
const STYLE_KEYS: (keyof TextSpec)[] = [
  'font',
  'size',
  'letterSpacing',
  'lineSpacing',
  'align',
  'depth',
  'bevel',
  'color',
  'color2',
  'style',
  'placement',
  'position',
  'rotation',
  'scale',
  'modelId',
  'bone',
  'animIn',
  'animInFrames',
  'animOut',
  'animOutFrames',
  'idle',
  'castShadow',
  'onTop',
];

export function TextPanel() {
  const id = useClipTimeline((s) => s.textEditing);
  const clip = useClipTimeline((s) => (s.textEditing ? findClip(s.doc, s.textEditing) : undefined));
  const track = useClipTimeline((s) => s.doc.tracks.find((t) => t.id === clip?.trackId));
  const missing = useClipTimeline((s) => (id ? s.textMissing[id] : undefined));
  const fontsRev = useClipTimeline((s) => s.doc.fonts?.length ?? 0);
  const models = useStudio((s) => s.models);
  const phone = useLayout((s) => isPhoneMode(s.mode));
  const t = clip?.text;

  // Position gizmo for fixed / billboard text.
  const gizmo = t && (t.placement === 'fixed' || t.placement === 'billboard') ? t.position.join(',') : '';
  useEffect(() => {
    const engine = engineOrNull();
    if (!engine || !id || !gizmo) return;
    const pos = gizmo.split(',').map(Number) as [number, number, number];
    engine.setPointGizmo(pos, { onEnd: (p) => setClipText(id, { position: p }) });
    return () => engine.setPointGizmo(null);
  }, [id, gizmo]);

  useEffect(() => {
    // The clip went away (deleted / undone).
    if (id && !clip) ct.set({ textEditing: null });
  }, [id, clip]);

  if (!id || !t || !clip) return null;
  const set = (patch: Partial<TextSpec>): void => setClipText(id, patch);
  const model = models.find((m) => m.id === t.modelId) ?? models.find((m) => !m.stage);
  const families = fontFamilies();
  void fontsRev;
  const isSubtitle = track?.name.startsWith('Subtitles');

  // Portal: a fixed panel inside the (transformed) phone sheet would be positioned against the sheet.
  return createPortal(
    <div
      role="dialog"
      aria-label="Text clip"
      data-testid="text-panel"
      className={cn(
        'fixed z-40 flex flex-col overflow-hidden border border-line bg-bg-panel shadow-2xl',
        phone
          ? 'inset-x-0 bottom-0 max-h-[70vh] rounded-t-2xl pb-[env(safe-area-inset-bottom)]'
          : 'bottom-28 right-4 max-h-[min(640px,75vh)] w-[340px] rounded-xl',
      )}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-2">
        <span className="text-[13px] font-medium">Text</span>
        <button
          type="button"
          className="flex h-9 items-center gap-1 rounded-md px-2 text-[12px] text-fg-muted hover:bg-bg-hover coarse:h-11"
          onClick={() => ct.set({ textEditing: null })}
          data-testid="text-done"
        >
          {phone ? 'Done' : <X size={16} aria-label="Close" />}
        </button>
      </div>
      <div className="flex min-h-0 flex-col gap-1 overflow-y-auto px-3 py-2 [&>*]:shrink-0">
        <textarea
          aria-label="Text content"
          data-testid="text-content"
          value={t.content}
          rows={2}
          onChange={(e) => set({ content: e.target.value })}
          className="min-h-[60px] w-full shrink-0 resize-y rounded-md border border-line bg-bg px-2 py-1.5 text-[14px]"
        />
        {missing?.length ? (
          <p className="text-[11px] text-warn" data-testid="text-missing">
            No font has {missing.slice(0, 8).join(' ')} — those characters are skipped.
          </p>
        ) : null}
        <Row label="Font">
          <select
            aria-label="Font"
            data-testid="text-font"
            value={t.font}
            onChange={(e) => set({ font: e.target.value })}
            className="h-7 max-w-[160px] rounded-md border border-line bg-bg px-1 text-[12px] coarse:h-10"
          >
            {families.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-line coarse:h-10 coarse:w-10"
            title="Upload a font (.ttf, .otf, .woff)"
            aria-label="Upload a font"
            onClick={() => void uploadFont().then((f) => f && set({ font: f }))}
          >
            <Upload size={14} />
          </button>
        </Row>
        <div className="flex flex-wrap gap-1 py-1" role="radiogroup" aria-label="Look">
          {STYLES.map((s) => (
            <button
              key={s.value}
              type="button"
              role="radio"
              aria-checked={t.style === s.value}
              data-testid={`text-style-${s.value}`}
              onClick={() =>
                set({
                  style: s.value,
                  ...(s.value === 'neon' && t.color.toLowerCase() === '#ffffff' ? { color: '#38e8ff' } : {}),
                })
              }
              className={cn('btn coarse:min-h-[44px]', t.style === s.value && 'border-accent bg-accent-soft')}
            >
              {s.label}
            </button>
          ))}
        </div>
        <ColorRow label="Color" value={t.color} onChange={(v) => set({ color: v })} />
        {(t.style === 'gradient' || t.style === 'outline') && (
          <ColorRow
            label={t.style === 'gradient' ? 'Bottom color' : 'Outline color'}
            value={t.color2}
            onChange={(v) => set({ color2: v })}
          />
        )}
        <SliderRow
          label="Size"
          value={t.size}
          min={0.2}
          max={6}
          step={0.05}
          onChange={(v) => set({ size: v })}
        />
        <SliderRow
          label="Letter spacing"
          value={t.letterSpacing}
          min={-0.2}
          max={1}
          step={0.01}
          onChange={(v) => set({ letterSpacing: v })}
        />
        <SliderRow
          label="Line spacing"
          value={t.lineSpacing}
          min={0.8}
          max={2.5}
          step={0.05}
          onChange={(v) => set({ lineSpacing: v })}
        />
        <Select
          label="Align"
          value={t.align}
          options={[
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Center' },
            { value: 'right', label: 'Right' },
          ]}
          onChange={(v) => set({ align: v })}
        />
        <SliderRow
          label="Depth"
          value={t.depth}
          min={0}
          max={2}
          step={0.01}
          onChange={(v) => set({ depth: v })}
        />
        <SliderRow
          label="Bevel"
          value={t.bevel}
          min={0}
          max={0.1}
          step={0.005}
          onChange={(v) => set({ bevel: v })}
        />

        <div className="mt-2 text-[11px] font-medium uppercase tracking-wide text-fg-dim">Placement</div>
        <Select
          label="Placement"
          value={t.placement}
          options={PLACEMENTS}
          onChange={(v) => set({ placement: v })}
        />
        {t.placement === 'bone' && model && (
          <Row label="Bone">
            <select
              aria-label="Bone"
              value={t.bone ?? ''}
              onChange={(e) => set({ bone: e.target.value, modelId: model.id })}
              className="h-7 max-w-[180px] rounded-md border border-line bg-bg px-1 text-[12px] coarse:h-10"
            >
              {model.info.bones.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          </Row>
        )}
        {t.placement !== 'caption' && (
          <Row label={t.placement === 'bone' ? 'Offset' : 'Position'}>
            {[0, 1, 2].map((k) => (
              <NumberField
                key={k}
                className="w-14"
                label={`${t.placement === 'bone' ? 'Offset' : 'Position'} ${'XYZ'[k]}`}
                value={t.position[k]}
                onChange={(v) => {
                  const p = [...t.position] as [number, number, number];
                  p[k] = v;
                  set({ position: p });
                }}
              />
            ))}
          </Row>
        )}
        {t.placement === 'fixed' && (
          <Row label="Rotation">
            {[0, 1, 2].map((k) => (
              <NumberField
                key={k}
                className="w-14"
                precision={0}
                step={5}
                label={`Rotation ${'XYZ'[k]}`}
                value={t.rotation[k]}
                onChange={(v) => {
                  const r = [...t.rotation] as [number, number, number];
                  r[k] = v;
                  set({ rotation: r });
                }}
              />
            ))}
          </Row>
        )}
        <SliderRow
          label="Scale"
          value={t.scale}
          min={0.1}
          max={5}
          step={0.05}
          onChange={(v) => set({ scale: v })}
        />
        <ToggleRow label="Cast shadow" checked={t.castShadow} onChange={(v) => set({ castShadow: v })} />
        <ToggleRow label="Always on top" checked={t.onTop} onChange={(v) => set({ onTop: v })} />

        <div className="mt-2 text-[11px] font-medium uppercase tracking-wide text-fg-dim">Animation</div>
        <Select label="In" value={t.animIn} options={ANIMS} onChange={(v) => set({ animIn: v })} />
        {t.animIn !== 'none' && (
          <SliderRow
            label="In frames"
            value={t.animInFrames}
            min={1}
            max={120}
            step={1}
            onChange={(v) => set({ animInFrames: v })}
          />
        )}
        <Select label="Out" value={t.animOut} options={ANIMS} onChange={(v) => set({ animOut: v })} />
        {t.animOut !== 'none' && (
          <SliderRow
            label="Out frames"
            value={t.animOutFrames}
            min={1}
            max={120}
            step={1}
            onChange={(v) => set({ animOutFrames: v })}
          />
        )}
        <Select label="Idle" value={t.idle} options={IDLES} onChange={(v) => set({ idle: v })} />
        {isSubtitle && (
          <button
            type="button"
            className="btn mt-2 coarse:min-h-[44px]"
            onClick={() =>
              setSubtitleStyle(Object.fromEntries(STYLE_KEYS.map((k) => [k, t[k]])) as Partial<TextSpec>)
            }
          >
            Use this style for every subtitle line
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
