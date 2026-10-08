// Manual bone mapping: tap a body slot on the diagram, then the source bone it should use.

import { Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/controls';
import { cn } from '@/components/ui/cn';
import { CONFIDENT, REQUIRED } from '@/lib/convert/humanoid';
import type { HumanSlot } from '@/lib/convert/types';
import { cv, useConverter } from '@/store/converter';
import { setOptions } from './actions';
import { DIAGRAM, FINGER_ROWS, SLOT_LABEL } from './slots';

const NONE: Partial<Record<HumanSlot, number | null>> = {};

export function MappingDialog() {
  const summary = useConverter((s) => s.summary);
  const result = useConverter((s) => s.result);
  const saved = useConverter((s) => s.options.mapping) ?? NONE;
  const [edits, setEdits] = useState<Partial<Record<HumanSlot, number | null>>>(saved);
  const firstWeak = result?.weak[0] ?? 'hips';
  const [slot, setSlot] = useState<HumanSlot>(firstWeak);
  const [query, setQuery] = useState('');
  const [fingers, setFingers] = useState(false);
  const bones = useMemo(() => summary?.bones ?? [], [summary]);
  const depth = useMemo(() => {
    const d: number[] = [];
    bones.forEach((b, i) => (d[i] = b.parent >= 0 ? (d[b.parent] ?? 0) + 1 : 0));
    return d;
  }, [bones]);
  // Tree order: depth-first from the roots.
  const order = useMemo(() => {
    const kids: number[][] = bones.map(() => []);
    const roots: number[] = [];
    bones.forEach((b, i) => (b.parent >= 0 ? kids[b.parent].push(i) : roots.push(i)));
    const out: number[] = [];
    const walk = (i: number): void => {
      out.push(i);
      kids[i].forEach(walk);
    };
    roots.forEach(walk);
    return out;
  }, [bones]);
  if (!summary || !result) return null;

  const current = (s: HumanSlot): { bone: number | null; conf: number } => {
    if (s in edits) return { bone: edits[s] ?? null, conf: edits[s] === null ? 0 : 1 };
    const m = result.map[s];
    return { bone: m?.bone ?? null, conf: m?.confidence ?? 0 };
  };
  const assign = (bone: number | null): void => {
    const nextEdits = { ...edits, [slot]: bone };
    setEdits(nextEdits);
    // Advance to the next weak required slot.
    const weak = REQUIRED.find((s) => s !== slot && !(s in nextEdits) && (result.map[s]?.confidence ?? 0) < CONFIDENT);
    if (weak) setSlot(weak);
  };
  const close = (apply: boolean): void => {
    if (apply) setOptions({ mapping: edits });
    cv.set({ mappingOpen: false });
  };
  const slotButton = (s: HumanSlot | null, i: number) => {
    if (!s) return <div key={i} />;
    const c = current(s);
    const required = REQUIRED.includes(s);
    return (
      <button
        key={s}
        type="button"
        data-testid={`map-slot-${s}`}
        aria-pressed={slot === s}
        onClick={() => setSlot(s)}
        className={cn(
          'flex min-h-[44px] flex-col items-center justify-center rounded-md border px-1 text-[11px] leading-tight',
          slot === s ? 'border-accent bg-accent-soft' : 'border-line',
          c.bone === null ? (required ? 'text-danger' : 'text-fg-dim') : c.conf >= 0.8 ? 'text-fg' : 'text-warn',
        )}
      >
        <span className="font-medium">{SLOT_LABEL[s]}</span>
        <span className="max-w-full truncate text-[10px] text-fg-muted">{c.bone !== null ? bones[c.bone]?.name : required ? 'missing' : '—'}</span>
      </button>
    );
  };
  const q = query.trim().toLowerCase();
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 p-0 sm:p-6" role="dialog" aria-label="Bone mapping" data-testid="mapping-dialog">
      <div className="flex w-full max-w-4xl flex-col overflow-hidden bg-bg-panel sm:rounded-xl sm:border sm:border-line">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
          <span className="flex-1 font-medium">Bone mapping</span>
          <span className="hidden text-[12px] text-fg-dim sm:inline">Tap a body part, then the model’s bone for it.</span>
          <button type="button" aria-label="Close without changes" onClick={() => close(false)} className="grid h-9 w-9 place-items-center rounded-md hover:bg-bg-hover coarse:h-11 coarse:w-11">
            <X size={16} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <div className="max-h-[45%] shrink-0 overflow-y-auto border-b border-line p-2 sm:max-h-none sm:w-[46%] sm:border-b-0 sm:border-r">
            <div className="grid grid-cols-3 gap-1" data-testid="mapping-diagram">
              {DIAGRAM.flatMap((row, r) => row.map((s, c) => slotButton(s, r * 3 + c)))}
            </div>
            <button type="button" className="mt-2 text-[12px] text-accent" onClick={() => setFingers(!fingers)}>
              {fingers ? 'Hide fingers' : 'Show fingers'}
            </button>
            {fingers && <div className="mt-1 grid grid-cols-3 gap-1">{FINGER_ROWS.map((s, i) => slotButton(s, 100 + i))}</div>}
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-1.5">
              <span className="text-[12px]">
                <b>{SLOT_LABEL[slot]}</b> uses:
              </span>
              <div className="relative flex-1">
                <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-dim" />
                <input
                  aria-label="Filter bones"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter bones"
                  className="h-8 w-full rounded-md border border-line bg-bg pl-7 pr-2 text-[12px] coarse:h-10"
                />
              </div>
              <Button size="sm" onClick={() => assign(null)}>
                None
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-1" data-testid="mapping-bones">
              {order
                .filter((i) => !q || bones[i].name.toLowerCase().includes(q))
                .map((i) => {
                  const sel = current(slot).bone === i;
                  const usedBy = Object.keys(result.map).find((s) => current(s as HumanSlot).bone === i && s !== slot);
                  return (
                    <button
                      key={i}
                      type="button"
                      data-bone={bones[i].name}
                      onClick={() => assign(i)}
                      className={cn('flex min-h-[36px] w-full items-center gap-2 px-2 text-left text-[12px] hover:bg-bg-hover coarse:min-h-[44px]', sel && 'bg-accent-soft')}
                      style={{ paddingLeft: 8 + Math.min(12, depth[i] ?? 0) * 10 }}
                    >
                      <span className="truncate">{bones[i].name}</span>
                      {usedBy && <span className="shrink-0 text-[10px] text-fg-dim">{SLOT_LABEL[usedBy]}</span>}
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-line px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <Button onClick={() => setEdits({})}>Reset to automatic</Button>
          <Button
            data-testid="mapping-accept"
            onClick={() =>
              setEdits((e) => ({
                ...Object.fromEntries(Object.entries(result.map).map(([s, m]) => [s, m!.bone])),
                ...e,
              }))
            }
          >
            Accept suggestions
          </Button>
          <Button variant="primary" onClick={() => close(true)} data-testid="mapping-done">
            Apply mapping
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
