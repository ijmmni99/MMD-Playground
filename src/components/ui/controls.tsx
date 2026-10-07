import * as RSlider from '@radix-ui/react-slider';
import * as RSwitch from '@radix-ui/react-switch';
import * as RTooltip from '@radix-ui/react-tooltip';
import { ChevronDown, ChevronRight, Minus, Plus } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { useLayout } from '@/store/layout';
import { cn } from './cn';

type Variant = 'default' | 'primary' | 'ghost' | 'danger';

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }
>(function Button({ variant = 'default', size = 'md', className, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        'inline-flex select-none items-center justify-center gap-1.5 rounded font-medium transition-colors disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' ? 'h-6 px-2 text-[11px]' : 'h-7 px-2.5 text-[12px]',
        'coarse:min-h-[44px] coarse:px-3 coarse:text-[13px]',
        variant === 'primary' && 'bg-accent-strong text-white hover:bg-accent-hover',
        variant === 'default' && 'border border-line bg-bg-raised text-fg hover:bg-bg-hover',
        variant === 'ghost' && 'text-fg-muted hover:bg-bg-hover hover:text-fg',
        variant === 'danger' && 'border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20',
        className,
      )}
      {...rest}
    />
  );
});

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    label: string;
    active?: boolean;
    tooltip?: string;
    size?: 'sm' | 'md';
  }
>(function IconButton({ label, active, className, children, tooltip, size = 'md', ...rest }, ref) {
  const btn = (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded transition-colors disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' ? 'h-6 w-6' : 'h-7 w-7',
        'coarse:h-11 coarse:w-11',
        active ? 'bg-accent-soft text-accent' : 'text-fg-muted hover:bg-bg-hover hover:text-fg',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
  return <Tip content={tooltip ?? label}>{btn}</Tip>;
});

/** Tooltip on hover/focus; on touch devices a long-press shows it (there is no hover). */
export function Tip({
  content,
  children,
  side = 'bottom',
}: {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = (): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return (
    <RTooltip.Root delayDuration={350} open={open} onOpenChange={setOpen}>
      <RTooltip.Trigger
        asChild
        onPointerDown={(e) => {
          if (e.pointerType !== 'touch') return;
          clear();
          timer.current = setTimeout(() => {
            setOpen(true);
            timer.current = setTimeout(() => setOpen(false), 1600);
          }, 450);
        }}
        onPointerUp={(e) => e.pointerType === 'touch' && open === false && clear()}
        onPointerCancel={clear}
      >
        {children}
      </RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-xs rounded border border-line bg-bg-raised px-2 py-1 text-[11px] text-fg shadow-lg coarse:text-[13px]"
        >
          {content}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <RSwitch.Root
      checked={checked}
      onCheckedChange={onChange}
      aria-label={label}
      disabled={disabled}
      className="relative h-4 w-7 shrink-0 rounded-full bg-[#323846] transition-colors before:absolute before:-inset-3 before:content-[''] data-[state=checked]:bg-accent-strong disabled:opacity-40 coarse:h-7 coarse:w-12"
    >
      <RSwitch.Thumb className="block h-3 w-3 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[14px] coarse:h-6 coarse:w-6 coarse:data-[state=checked]:translate-x-[22px]" />
    </RSwitch.Root>
  );
}

export function Slider({
  value,
  onChange,
  onCommit,
  min = 0,
  max = 1,
  step = 0.01,
  label,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  disabled?: boolean;
}) {
  return (
    <RSlider.Root
      className="relative flex h-4 w-full touch-none select-none items-center coarse:h-11"
      value={[value]}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onValueChange={(v) => onChange(v[0])}
      onValueCommit={(v) => onCommit?.(v[0])}
      aria-label={label}
    >
      <RSlider.Track className="relative h-1 grow rounded-full bg-[#2c313d] coarse:h-1.5">
        <RSlider.Range className="absolute h-full rounded-full bg-accent" />
      </RSlider.Track>
      <RSlider.Thumb
        aria-label={label}
        className="block h-3 w-3 rounded-full border border-accent bg-white shadow transition-transform hover:scale-110 focus-visible:outline-2 coarse:h-7 coarse:w-7 coarse:border-2"
      />
    </RSlider.Root>
  );
}

/** Label + slider + numeric readout in one row. */
export function SliderRow({
  label,
  value,
  onChange,
  onCommit,
  min = 0,
  max = 1,
  step = 0.01,
  format,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  format?: (v: number) => string;
  disabled?: boolean;
}) {
  const coarse = useLayout((st) => st.coarse);
  const clamp = (v: number): number => Math.min(max, Math.max(min, Number(v.toFixed(6))));
  return (
    <div
      className={cn(
        'grid items-center gap-2 py-0.5',
        coarse ? 'grid-cols-[minmax(64px,88px)_44px_1fr_44px_48px]' : 'grid-cols-[88px_1fr_44px]',
      )}
    >
      <span className="truncate text-[12px] text-fg-muted coarse:text-[13px]" title={label}>
        {label}
      </span>
      {coarse && (
        <Stepper
          label={`Decrease ${label}`}
          disabled={disabled}
          onStep={(n) => {
            const v = clamp(value - step * n);
            onChange(v);
            onCommit?.(v);
          }}
        >
          <Minus size={16} />
        </Stepper>
      )}
      <Slider
        label={label}
        value={value}
        onChange={onChange}
        onCommit={onCommit}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
      />
      {coarse && (
        <Stepper
          label={`Increase ${label}`}
          disabled={disabled}
          onStep={(n) => {
            const v = clamp(value + step * n);
            onChange(v);
            onCommit?.(v);
          }}
        >
          <Plus size={16} />
        </Stepper>
      )}
      <span className="text-right font-mono text-[11px] tabular-nums text-fg-muted coarse:text-[12px]">
        {format ? format(value) : value.toFixed(2)}
      </span>
    </div>
  );
}

/**
 * ±1 step per tap; press and hold repeats, accelerating — fine adjustment without a precise drag.
 * `onStep(n)` receives the step multiplier.
 */
export function Stepper({
  label,
  onStep,
  disabled,
  children,
}: {
  label: string;
  onStep: (multiplier: number) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeats = useRef(0);
  const latest = useRef(onStep);
  latest.current = onStep;
  const stop = (): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  const tick = (): void => {
    repeats.current += 1;
    latest.current(repeats.current > 20 ? 5 : 1);
    timer.current = setTimeout(tick, repeats.current > 8 ? 40 : 90);
  };
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      className="grid h-11 w-11 select-none place-items-center rounded-lg border border-line text-fg-muted active:bg-bg-hover disabled:opacity-40"
      onPointerDown={(e) => {
        e.preventDefault();
        repeats.current = 0;
        latest.current(1);
        timer.current = setTimeout(tick, 420);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          latest.current(1);
        }
      }}
    >
      {children}
    </button>
  );
}

export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="flex min-h-[26px] items-center justify-between gap-2 py-0.5 coarse:min-h-[48px]">
      <span className="truncate text-[12px] text-fg-muted coarse:text-[13px]" title={hint ?? label}>
        {label}
      </span>
      <div className="flex items-center gap-1.5">{children}</div>
    </div>
  );
}

export function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <Row label={label} hint={hint}>
      <Switch label={label} checked={checked} onChange={onChange} disabled={disabled} />
    </Row>
  );
}

export function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Row label={label}>
      <span className="font-mono text-[11px] text-fg-dim">{value}</span>
      <input
        type="color"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-5 w-8 coarse:h-9 coarse:w-12"
      />
    </Row>
  );
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  hideLabel,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  hideLabel?: boolean;
}) {
  const select = (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="input h-6 cursor-pointer pr-6 text-[12px] coarse:h-11"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
  return hideLabel ? select : <Row label={label}>{select}</Row>;
}

/** Number field that commits on blur/Enter and supports arrow-key nudging. */
export function NumberField({
  label,
  value,
  onChange,
  step = 0.1,
  precision = 2,
  className,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  precision?: number;
  className?: string;
}) {
  const [text, setText] = useState(value.toFixed(precision));
  useEffect(() => {
    setText(value.toFixed(precision));
  }, [value, precision]);
  const commit = (): void => {
    const v = Number.parseFloat(text);
    if (Number.isFinite(v)) onChange(v);
    else setText(value.toFixed(precision));
  };
  return (
    <input
      aria-label={label}
      title={label}
      inputMode="decimal"
      className={cn(
        'input h-6 w-full min-w-0 px-1.5 text-right font-mono text-[11px] coarse:h-11',
        className,
      )}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const v = value + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
          onChange(Number(v.toFixed(precision)));
        }
        e.stopPropagation();
      }}
    />
  );
}

export function Section({
  title,
  children,
  defaultOpen = true,
  actions,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className="border-b border-line">
      <div className="flex h-8 items-center gap-1 px-2 coarse:h-12">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
          className="flex flex-1 items-center gap-1 rounded text-left panel-title hover:text-fg"
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {title}
        </button>
        {actions}
      </div>
      {open && (
        <div id={id} className="px-3 pb-3">
          {children}
        </div>
      )}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-3 py-6 text-center text-[12px] leading-relaxed text-fg-dim">{children}</div>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-bg px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
      {children}
    </kbd>
  );
}
