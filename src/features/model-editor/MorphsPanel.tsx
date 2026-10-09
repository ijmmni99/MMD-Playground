import { ArrowDown, ArrowUp, FlipHorizontal2, Layers, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/controls';
import { cn } from '@/components/ui/cn';
import type { MorphPanel } from '@/lib/convert/pmx/types';
import { matchesName } from '@/lib/names';
import { NameLabel } from '@/features/names/NameLabel';
import { setMorph } from '@/store/actions';
import { me, useModelEditor } from '@/store/modelEditor';
import { useNameTable } from '@/store/names';
import { commitOp, endDrag } from './actions';
import { Chip, SubHead, TextField, ValueSlider } from './ui';

const PANEL_LABEL: Record<MorphPanel, string> = {
  1: 'Eyebrow',
  2: 'Eye',
  3: 'Mouth',
  4: 'Other',
  0: 'System',
};
const ORDER: MorphPanel[] = [2, 3, 1, 4, 0];

export function MorphsPanel() {
  const result = useModelEditor((s) => s.result);
  const modelId = useModelEditor((s) => s.modelId);
  const selected = useModelEditor((s) => s.morph);
  const mix = useModelEditor((s) => s.morphMix);
  const table = useNameTable(modelId);
  const [query, setQuery] = useState('');
  const [panel, setPanel] = useState<MorphPanel | 'all'>('all');
  const [groupName, setGroupName] = useState('');
  const [groupPanel, setGroupPanel] = useState<MorphPanel>(4);
  const pmx = result?.pmx;
  const list = useMemo(
    () =>
      pmx
        ? pmx.morphs
            .map((m, i) => ({ m, i }))
            .filter(
              ({ m }) =>
                (panel === 'all' || m.panel === panel) && matchesName(query, table.get('morph', m.name)),
            )
            .sort((a, b) => ORDER.indexOf(a.m.panel) - ORDER.indexOf(b.m.panel) || a.i - b.i)
        : [],
    [pmx, panel, query, table],
  );
  if (!pmx || !modelId) return null;
  const active = Object.entries(mix).filter(([, w]) => w !== 0);
  const setWeight = (name: string, w: number): void => {
    me.set((s) => ({ morphMix: { ...s.morphMix, [name]: w } }));
    setMorph(modelId, name, w, false);
  };
  return (
    <div className="px-3 pb-4" data-testid="me-morphs">
      <div className="flex flex-wrap gap-1.5 pt-2">
        <Chip active={panel === 'all'} onClick={() => setPanel('all')}>
          All
        </Chip>
        {ORDER.map((p) => (
          <Chip key={p} active={panel === p} onClick={() => setPanel(p)}>
            {PANEL_LABEL[p]}
          </Chip>
        ))}
      </div>
      <input
        className="input mt-1.5 h-7 w-full px-2 text-[12px] coarse:h-11"
        placeholder="Search morphs (English or 日本語)"
        aria-label="Search morphs"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <ul className="mt-1.5 max-h-[36vh] overflow-y-auto rounded-md border border-line">
        {list.map(({ m, i }) => (
          <li key={i} className={cn('px-2', selected === m.name && 'bg-accent-soft')}>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="min-w-0 flex-1 truncate py-0.5 text-left text-[12px]"
                onClick={() => me.set({ morph: m.name })}
                data-testid={`me-morph-${m.name}`}
              >
                <NameLabel modelId={modelId} kind="morph" ja={m.name} />
                <span className="ml-1 text-[10px] text-fg-dim">{m.kind}</span>
              </button>
            </div>
            <ValueSlider
              label={m.name}
              value={mix[m.name] ?? 0}
              min={0}
              max={1}
              reset={0}
              testid={`me-morph-slider-${m.name}`}
              onChange={(v) => setWeight(m.name, v)}
            />
          </li>
        ))}
      </ul>

      <SubHead>
        <span className="flex items-center gap-1">
          <Layers size={13} /> New group morph from the sliders
        </span>
      </SubHead>
      <p className="text-[12px] text-fg-muted">
        {active.length
          ? active.map(([n, w]) => `${n} ${w.toFixed(2)}`).join(', ')
          : 'Move some sliders above first.'}
      </p>
      <div className="mt-1 flex gap-1.5">
        <input
          className="input h-7 min-w-0 flex-1 px-2 text-[12px] coarse:h-11"
          placeholder="Morph name (日本語 OK)"
          aria-label="Group morph name"
          data-testid="me-group-name"
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <select
          className="input h-7 text-[12px] coarse:h-11"
          aria-label="Panel"
          value={groupPanel}
          onChange={(e) => setGroupPanel(Number(e.target.value) as MorphPanel)}
        >
          {ORDER.filter((p) => p !== 0).map((p) => (
            <option key={p} value={p}>
              {PANEL_LABEL[p]}
            </option>
          ))}
        </select>
      </div>
      <Button
        size="sm"
        variant="primary"
        className="mt-1.5"
        data-testid="me-create-group"
        disabled={!groupName.trim() || !active.length}
        onClick={() => {
          const name = groupName.trim();
          commitOp(
            {
              type: 'morphGroup',
              name,
              nameEn: name,
              panel: groupPanel,
              members: active.map(([morph, weight]) => ({ morph, weight })),
            },
            { label: `Group morph ${name}` },
          );
          for (const [n] of active) setMorph(modelId, n, 0, false);
          me.set({ morphMix: {}, morph: name });
          setGroupName('');
        }}
      >
        Create group morph
      </Button>

      {selected && pmx.morphs.some((m) => m.name === selected) && <MorphFields name={selected} />}
    </div>
  );
}

function MorphFields({ name }: { name: string }) {
  const result = useModelEditor((s) => s.result)!;
  const pmx = result.pmx;
  const index = pmx.morphs.findIndex((m) => m.name === name);
  const m = pmx.morphs[index];
  const [factor, setFactor] = useState(1);
  const move = (d: number): void => {
    const names = pmx.morphs.map((x) => x.name);
    const j = index + d;
    if (j < 0 || j >= names.length) return;
    [names[index], names[j]] = [names[j], names[index]];
    commitOp({ type: 'morphOrder', names }, { label: 'Reorder morphs' });
  };
  return (
    <div data-testid="me-morph-fields">
      <SubHead>
        {m.name} · {m.kind}
      </SubHead>
      <TextField
        label="Name (日本語 — the ID motions use)"
        value={m.name}
        onCommit={(v) => {
          const to = v.trim();
          if (!to) return;
          commitOp({ type: 'morph', name: m.name, patch: { name: to } }, { label: `Rename morph ${m.name}` });
          me.set({ morph: to });
        }}
      />
      <TextField
        label="English name"
        value={m.nameEn}
        onCommit={(v) => commitOp({ type: 'morph', name: m.name, patch: { nameEn: v } })}
      />
      <label className="flex items-center justify-between py-1 text-[12px] text-fg-muted">
        Panel
        <select
          className="input h-6 text-[12px] coarse:h-11"
          value={m.panel}
          onChange={(e) =>
            commitOp({ type: 'morph', name: m.name, patch: { panel: Number(e.target.value) as MorphPanel } })
          }
        >
          {ORDER.map((p) => (
            <option key={p} value={p}>
              {PANEL_LABEL[p]}
            </option>
          ))}
        </select>
      </label>
      {m.kind === 'group' && (
        <>
          <SubHead>Members</SubHead>
          {m.offsets.map((o, k) => (
            <div key={k} className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <ValueSlider
                  label={pmx.morphs[o.morph]?.name ?? '?'}
                  value={o.weight}
                  min={-1}
                  max={1}
                  reset={1}
                  onChange={(v, drag) =>
                    commitOp(
                      {
                        type: 'morphGroup',
                        name: m.name,
                        nameEn: m.nameEn,
                        panel: m.panel,
                        members: m.offsets.map((x, j) => ({
                          morph: pmx.morphs[x.morph].name,
                          weight: j === k ? v : x.weight,
                        })),
                      },
                      { coalesce: drag ? `group:${m.name}:${k}` : undefined },
                    )
                  }
                  onCommit={endDrag}
                />
              </div>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Remove member"
                onClick={() =>
                  commitOp({
                    type: 'morphGroup',
                    name: m.name,
                    nameEn: m.nameEn,
                    panel: m.panel,
                    members: m.offsets
                      .filter((_, j) => j !== k)
                      .map((x) => ({ morph: pmx.morphs[x.morph].name, weight: x.weight })),
                  })
                }
              >
                ×
              </Button>
            </div>
          ))}
        </>
      )}
      {(m.kind === 'vertex' || m.kind === 'bone' || m.kind === 'uv') && (
        <div className="mt-1">
          <ValueSlider
            label="Strength ×"
            value={factor}
            min={0}
            max={3}
            reset={1}
            onChange={(v) => setFactor(v)}
          />
          <Button
            size="sm"
            disabled={factor === 1}
            onClick={() => (
              commitOp({ type: 'morphScale', name: m.name, factor }, { label: `Scale morph ${m.name}` }),
              setFactor(1)
            )}
          >
            Apply strength
          </Button>
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {m.kind === 'vertex' && (
          <Button
            size="sm"
            onClick={() =>
              commitOp({ type: 'morphMirror', name: m.name, from: 'L' }, { label: `Mirror ${m.name}` })
            }
            title="Copy the left half onto the right"
          >
            <FlipHorizontal2 size={13} /> Mirror L→R
          </Button>
        )}
        <Button size="sm" variant="ghost" aria-label="Move up" onClick={() => move(-1)}>
          <ArrowUp size={13} />
        </Button>
        <Button size="sm" variant="ghost" aria-label="Move down" onClick={() => move(1)}>
          <ArrowDown size={13} />
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={() => {
            if (!window.confirm(`Delete morph “${m.name}”? Motions using it will no longer move anything.`))
              return;
            commitOp({ type: 'morphDelete', name: m.name }, { label: `Delete morph ${m.name}` });
            me.set({ morph: null });
          }}
        >
          <Trash2 size={13} /> Delete
        </Button>
      </div>
    </div>
  );
}
