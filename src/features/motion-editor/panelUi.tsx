import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/components/ui/cn';
import { me, useMotionEditor } from '@/store/motionEditor';
import { playhead, toolRange } from './view';

/** Collapsible panel section. */
export function Section({
  title,
  children,
  open: initial = true,
  testid,
}: {
  title: string;
  children: ReactNode;
  open?: boolean;
  testid?: string;
}) {
  const [open, setOpen] = useState(initial);
  return (
    <section className="border-b border-line" data-testid={testid}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-1 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-fg-muted hover:text-fg coarse:min-h-[44px]"
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {title}
      </button>
      {open && <div className="flex flex-col gap-2 px-3 pb-3 text-[12px]">{children}</div>}
    </section>
  );
}

/** Labelled numeric input. */
export function Num({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
  className,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  className?: string;
}) {
  return (
    <label className={cn('flex min-w-0 flex-1 flex-col gap-0.5 text-[11px] text-fg-muted', className)}>
      {label}
      <input
        type="number"
        className="input w-full min-w-0 font-mono coarse:h-10"
        value={Number.isFinite(value) ? value : ''}
        step={step}
        min={min}
        max={max}
        aria-label={label}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
      />
    </label>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <div className="flex items-end gap-1.5">{children}</div>;
}

export function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-[12px] text-fg-muted coarse:min-h-[44px]">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Btn({
  children,
  onClick,
  primary,
  testid,
  disabled,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
  testid?: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={primary ? 'btn-primary' : 'btn'}
      onClick={onClick}
      data-testid={testid}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

/** Range editor bound to the store (`range`), with shortcuts. */
export function RangeFields() {
  const range = useMotionEditor((s) => s.range);
  useMotionEditor((s) => s.selection);
  const [from, to] = range ?? toolRange();
  const set = (a: number, b: number): void =>
    me.set({ range: [Math.max(0, Math.min(a, b)), Math.max(0, Math.max(a, b))] });
  return (
    <div className="flex flex-col gap-1.5" data-testid="me-range">
      <Row>
        <Num
          label="From"
          value={from}
          onChange={(v) => set(Math.round(v), Math.max(to, Math.round(v)))}
          min={0}
        />
        <Num
          label="To"
          value={to}
          onChange={(v) => set(Math.min(from, Math.round(v)), Math.round(v))}
          min={0}
        />
      </Row>
      <div className="flex flex-wrap gap-1 text-[11px]">
        <button type="button" className="btn" onClick={() => set(playhead(), Math.max(to, playhead()))}>
          From ⟵ playhead
        </button>
        <button type="button" className="btn" onClick={() => set(Math.min(from, playhead()), playhead())}>
          To ⟵ playhead
        </button>
        <button type="button" className="btn" onClick={() => me.set({ range: null })} disabled={!range}>
          {range ? 'Clear' : 'Auto'}
        </button>
      </div>
      <p className="text-[11px] text-fg-dim">
        {range
          ? 'Shift-drag the ruler to change, Alt-click to clear.'
          : 'Auto: selected keys, else the whole clip. Shift-drag the ruler to set.'}
      </p>
    </div>
  );
}
