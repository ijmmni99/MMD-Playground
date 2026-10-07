import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { clampDrag, resolveSnap, snapHeights, type SnapHeights } from '@/lib/sheet';
import { haptic } from '@/lib/haptics';
import { setSheetSnap, type SheetSnap } from '@/store/layout';
import { cn } from '@/components/ui/cn';

/** Drag handle (20) + title row (44). */
const HEADER = 64;

/**
 * Phone bottom sheet with peek / half / full snap points. Positioned inside the viewport area
 * (not over the tab bar); at peek and half the rest of the viewport stays interactive.
 */
export function BottomSheet({
  id,
  title,
  snap,
  children,
}: {
  id: string;
  title: string;
  snap: SheetSnap;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(600);
  const [drag, setDrag] = useState<number | null>(null);
  const samples = useRef<{ y: number; t: number }[]>([]);
  const start = useRef<{ y: number; h: number } | null>(null);

  useLayoutEffect(() => {
    const parent = rootRef.current?.parentElement;
    if (!parent) return;
    const ro = new ResizeObserver(() => setAvailable(parent.clientHeight));
    ro.observe(parent);
    setAvailable(parent.clientHeight);
    return () => ro.disconnect();
  }, []);

  const heights: SnapHeights = snapHeights(available);
  const target = snap === 'closed' ? 0 : heights[snap];
  const height = drag ?? target;

  // Escape closes the sheet.
  useEffect(() => {
    if (snap === 'closed') return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setSheetSnap('closed');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [snap]);

  const onPointerDown = (e: React.PointerEvent): void => {
    if ((e.target as HTMLElement).closest('button:not([data-drag-handle])')) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    start.current = { y: e.clientY, h: height };
    samples.current = [{ y: e.clientY, t: performance.now() }];
  };
  const onPointerMove = (e: React.PointerEvent): void => {
    if (!start.current) return;
    const h = clampDrag(start.current.h + (start.current.y - e.clientY), heights);
    if (drag === null && Math.abs(start.current.y - e.clientY) < 4) return;
    setDrag(h);
    samples.current.push({ y: e.clientY, t: performance.now() });
    if (samples.current.length > 6) samples.current.shift();
  };
  const onPointerUp = (): void => {
    if (!start.current) return;
    const s = samples.current;
    const first = s[0];
    const last = s[s.length - 1];
    const dt = Math.max(1, last.t - first.t);
    const velocity = (first.y - last.y) / dt; // up = positive
    const next = drag === null ? snap : resolveSnap(drag, velocity, heights);
    start.current = null;
    setDrag(null);
    if (next !== snap) haptic();
    setSheetSnap(next);
  };

  const cycle = (): void => setSheetSnap(snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'peek');

  return (
    <div
      ref={rootRef}
      id={id}
      role="region"
      aria-label={`${title} panel`}
      aria-hidden={snap === 'closed'}
      data-testid="bottom-sheet"
      data-snap={snap}
      className={cn(
        'absolute inset-x-0 bottom-0 z-30 flex flex-col rounded-t-2xl border-t border-line bg-bg-panel shadow-[0_-8px_30px_rgba(0,0,0,0.45)] will-change-transform',
        drag === null && 'motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out',
        snap === 'closed' && drag === null && 'pointer-events-none',
      )}
      style={{ height: heights.full, transform: `translateY(${heights.full - height}px)` }}
    >
      <div
        className="shrink-0 touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <button
          type="button"
          data-drag-handle
          tabIndex={snap === 'closed' ? -1 : 0}
          aria-label={`Resize ${title} panel (currently ${snap})`}
          onClick={cycle}
          className="flex h-5 w-full items-center justify-center"
        >
          <span className="h-1.5 w-10 rounded-full bg-[#4a5163]" />
        </button>
        <div className="flex h-11 items-center gap-1 px-3">
          <h2 className="flex-1 truncate text-[14px] font-semibold">{title}</h2>
          <button
            type="button"
            tabIndex={snap === 'closed' ? -1 : 0}
            aria-label={snap === 'full' ? 'Shrink panel' : 'Expand panel'}
            onClick={() => setSheetSnap(snap === 'full' ? 'half' : 'full')}
            className="grid h-11 w-11 place-items-center rounded-lg text-fg-muted active:bg-bg-hover"
          >
            {snap === 'full' ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
          </button>
          <button
            type="button"
            tabIndex={snap === 'closed' ? -1 : 0}
            aria-label={`Close ${title} panel`}
            onClick={() => setSheetSnap('closed')}
            className="grid h-11 w-11 place-items-center rounded-lg text-fg-muted active:bg-bg-hover"
          >
            <X size={18} />
          </button>
        </div>
      </div>
      <div
        className="min-h-0 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]"
        style={{ height: Math.max(0, (drag ?? target) - HEADER) }}
      >
        {snap !== 'closed' && children}
      </div>
    </div>
  );
}
