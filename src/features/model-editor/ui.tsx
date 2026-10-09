import { AlertTriangle, Info, Minus, Plus, RotateCcw } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { NumberField, Slider, Stepper } from '@/components/ui/controls';
import type { V3 } from '@/lib/convert/pmx/types';
import { fromHex, toHex } from './color';

export function Notice({
  tone = 'info',
  children,
  testid,
}: {
  tone?: 'info' | 'warn';
  children: ReactNode;
  testid?: string;
}) {
  return (
    <div
      data-testid={testid}
      className={cn(
        'flex gap-2 rounded-md border px-2.5 py-2 text-[12px] leading-relaxed',
        tone === 'warn' ? 'border-warn/40 bg-warn/10 text-fg' : 'border-line bg-bg-raised text-fg-muted',
      )}
    >
      {tone === 'warn' ? (
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" />
      ) : (
        <Info size={14} className="mt-0.5 shrink-0 text-accent" />
      )}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Small pill button (44 px tall on touch). */
export function Chip({
  active,
  onClick,
  children,
  testid,
  title,
  disabled,
}: {
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
  testid?: string;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={testid}
      title={title}
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'h-7 shrink-0 rounded-full border px-2.5 text-[12px] coarse:h-11 coarse:px-3.5 disabled:opacity-40',
        active ? 'border-accent bg-accent-soft text-fg' : 'border-line text-fg-muted hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

/**
 * Scale / value slider: slider, ± steppers (press and hold for fine repeat), exact number, reset.
 * `onChange(v, drag)` fires live while dragging (drag = true) and once on commit.
 */
export function ValueSlider({
  label,
  value,
  onChange,
  onCommit,
  min = 0.5,
  max = 2,
  step = 0.01,
  reset = 1,
  warnOutside,
  testid,
  precision = 2,
}: {
  label: string;
  value: number;
  onChange: (v: number, drag: boolean) => void;
  onCommit?: () => void;
  min?: number;
  max?: number;
  step?: number;
  reset?: number;
  warnOutside?: [number, number];
  testid?: string;
  precision?: number;
}) {
  const out = warnOutside && (value < warnOutside[0] || value > warnOutside[1]);
  const set = (v: number, drag: boolean): void => onChange(Number(v.toFixed(6)), drag);
  return (
    <div className="py-1" data-testid={testid}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[12px] text-fg-muted coarse:text-[13px]">{label}</span>
        <div className="flex items-center gap-1">
          {out && (
            <span className="text-[11px] text-warn" title="Outside the usual range — check the result">
              <AlertTriangle size={12} />
            </span>
          )}
          <NumberField
            label={label}
            value={value}
            precision={precision}
            step={step}
            className="w-16"
            onChange={(v) => {
              set(v, false);
              onCommit?.();
            }}
          />
          <button
            type="button"
            aria-label={`Reset ${label}`}
            title="Reset"
            className="grid h-6 w-6 place-items-center rounded text-fg-dim hover:text-fg coarse:h-11 coarse:w-11"
            onClick={() => {
              set(reset, false);
              onCommit?.();
            }}
          >
            <RotateCcw size={12} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
        <Stepper label={`Decrease ${label}`} onStep={(n) => set(Math.max(min, value - step * n), true)}>
          <Minus size={14} />
        </Stepper>
        <Slider
          label={label}
          value={Math.min(max, Math.max(min, value))}
          min={min}
          max={max}
          step={step}
          onChange={(v) => set(v, true)}
          onCommit={() => onCommit?.()}
        />
        <Stepper label={`Increase ${label}`} onStep={(n) => set(Math.min(max, value + step * n), true)}>
          <Plus size={14} />
        </Stepper>
      </div>
    </div>
  );
}

/** Three number fields for a vector. */
export function Vec3Field({
  label,
  value,
  onChange,
  step = 0.1,
  precision = 3,
  testid,
}: {
  label: string;
  value: V3;
  onChange: (v: V3) => void;
  step?: number;
  precision?: number;
  testid?: string;
}) {
  return (
    <div className="grid grid-cols-[72px_1fr_1fr_1fr] items-center gap-1 py-0.5" data-testid={testid}>
      <span className="truncate text-[12px] text-fg-muted">{label}</span>
      {(['x', 'y', 'z'] as const).map((ax, i) => (
        <NumberField
          key={ax}
          label={`${label} ${ax}`}
          value={value[i]}
          step={step}
          precision={precision}
          onChange={(v) => {
            const next = [...value] as V3;
            next[i] = v;
            onChange(next);
          }}
        />
      ))}
    </div>
  );
}

/** Colour input that reports live changes (drag) and the final value. */
export function ColorField({
  label,
  value,
  onChange,
  testid,
}: {
  label: string;
  value: readonly number[];
  onChange: (rgb: [number, number, number], drag: boolean) => void;
  testid?: string;
}) {
  const hex = toHex(value);
  const [local, setLocal] = useState(hex);
  useEffect(() => setLocal(hex), [hex]);
  return (
    <label className="flex min-h-[26px] items-center justify-between gap-2 py-0.5 coarse:min-h-[48px]">
      <span className="truncate text-[12px] text-fg-muted">{label}</span>
      <span className="flex items-center gap-1.5">
        <span className="font-mono text-[11px] text-fg-dim">{local}</span>
        <input
          type="color"
          aria-label={label}
          data-testid={testid}
          value={local}
          onInput={(e) => {
            const v = (e.target as HTMLInputElement).value;
            setLocal(v);
            onChange(fromHex(v), true);
          }}
          onChange={(e) => onChange(fromHex(e.target.value), false)}
          className="h-6 w-9 cursor-pointer coarse:h-10 coarse:w-12"
        />
      </span>
    </label>
  );
}

/** Text input that commits on blur / Enter. */
export function TextField({
  label,
  value,
  onCommit,
  testid,
  multiline,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  testid?: string;
  multiline?: boolean;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = (): void => {
    if (text !== value) onCommit(text);
  };
  const cls = 'input w-full px-2 text-[12px] coarse:text-[14px]';
  return (
    <label className="block py-1">
      <span className="mb-0.5 block text-[11px] text-fg-muted">{label}</span>
      {multiline ? (
        <textarea
          aria-label={label}
          data-testid={testid}
          className={cn(cls, 'min-h-[64px] py-1')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.stopPropagation()}
        />
      ) : (
        <input
          aria-label={label}
          data-testid={testid}
          className={cn(cls, 'h-7 coarse:h-11')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commit();
          }}
        />
      )}
    </label>
  );
}

export function SubHead({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mt-3 mb-1 flex items-center justify-between gap-2">
      <h3 className="panel-title">{children}</h3>
      {actions}
    </div>
  );
}
