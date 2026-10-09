import { ChevronDown, ChevronRight, FlipHorizontal2, Move3d, Play, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, ToggleRow } from '@/components/ui/controls';
import { cn } from '@/components/ui/cn';
import { canonicalMmdName } from '@/lib/convert/humanoid';
import { BoneFlag, type PmxModel, type V3 } from '@/lib/convert/pmx/types';
import { DICTIONARY, matchesName } from '@/lib/names';
import { boneIndex } from '@/lib/model-edit/refs';
import { isStandardBone } from '@/lib/model-edit/standard';
import { NameLabel } from '@/features/names/NameLabel';
import { engineOrNull } from '@/store/engineRef';
import { me, useModelEditor, useOps } from '@/store/modelEditor';
import { useNameTable } from '@/store/names';
import { studio } from '@/store/studio';
import { commitOp, playTestPose } from './actions';
import { Notice, SubHead, TextField, Vec3Field } from './ui';

const FLAG_ROWS: [number, string][] = [
  [BoneFlag.Rotatable, 'Rotatable'],
  [BoneFlag.Movable, 'Movable'],
  [BoneFlag.Visible, 'Visible'],
  [BoneFlag.Enabled, 'Enabled (selectable)'],
  [BoneFlag.AfterPhysics, 'Deform after physics'],
];
const DEG = 180 / Math.PI;

/** A standard name to restore: the name before a rename in this session, a canonical spelling, or the dictionary. */
function standardFor(name: string, ops: ReturnType<typeof useOps>, en: string): string | null {
  for (let i = ops.length - 1; i >= 0; i--) {
    const o = ops[i];
    if (o.type === 'boneRename' && o.to === name) return o.from;
  }
  const c = canonicalMmdName(name);
  if (c !== name && isStandardBone(c)) return c;
  const hit = DICTIONARY.bone.find((e) => e.en.toLowerCase() === en.toLowerCase() && isStandardBone(e.ja));
  return hit && hit.ja !== name ? hit.ja : null;
}

export function BonesPanel() {
  const result = useModelEditor((s) => s.result);
  const modelId = useModelEditor((s) => s.modelId);
  const selected = useModelEditor((s) => s.bone);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<number, boolean>>({ 0: true });
  const table = useNameTable(modelId);
  const pmx = result?.pmx;
  const kids = useMemo(() => {
    const k: number[][] = pmx ? pmx.bones.map(() => []) : [];
    pmx?.bones.forEach((b, i) => b.parent >= 0 && k[b.parent]?.push(i));
    return k;
  }, [pmx]);
  if (!pmx) return null;
  const roots = pmx.bones.map((b, i) => (b.parent < 0 ? i : -1)).filter((i) => i >= 0);
  const matches = query.trim()
    ? pmx.bones.map((b, i) => (matchesName(query, table.get('bone', b.name)) ? i : -1)).filter((i) => i >= 0)
    : null;
  const sel = selected ? boneIndex(pmx, selected) : -1;

  const row = (i: number, depth: number): JSX.Element => {
    const b = pmx.bones[i];
    const hasKids = kids[i].length > 0;
    return (
      <li key={i}>
        <div
          className={cn('flex items-center gap-0.5 pr-1', sel === i && 'bg-accent-soft')}
          style={{ paddingLeft: depth * 10 }}
        >
          <button
            type="button"
            aria-label={open[i] ? 'Collapse' : 'Expand'}
            className={cn('grid h-6 w-5 place-items-center text-fg-dim coarse:h-10', !hasKids && 'invisible')}
            onClick={() => setOpen({ ...open, [i]: !open[i] })}
          >
            {open[i] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          <button
            type="button"
            className="min-w-0 flex-1 truncate py-0.5 text-left text-[12px] coarse:py-2.5"
            data-testid={`me-bone-${b.name}`}
            onClick={() => selectBone(b.name)}
          >
            <NameLabel modelId={modelId} kind="bone" ja={b.name} />
            {b.ik && <span className="ml-1 text-[10px] text-accent">IK</span>}
          </button>
        </div>
        {open[i] && hasKids && <ul>{kids[i].map((k) => row(k, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <div className="px-3 pb-4" data-testid="me-bones">
      <div className="flex items-center gap-1.5 pt-2">
        <input
          className="input h-7 min-w-0 flex-1 px-2 text-[12px] coarse:h-11"
          placeholder="Search bones (English or 日本語)"
          aria-label="Search bones"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <Button
          size="sm"
          variant="ghost"
          title="Copy left-side positions and IK limits to the right side"
          onClick={() => commitOp({ type: 'boneMirror', from: 'L' }, { label: 'Mirror bones left → right' })}
        >
          <FlipHorizontal2 size={13} /> L→R
        </Button>
      </div>
      <ul className="mt-1.5 max-h-[34vh] overflow-y-auto rounded-md border border-line">
        {matches
          ? matches.map((i) => (
              <li key={i}>
                <button
                  type="button"
                  className={cn(
                    'w-full truncate px-2 py-0.5 text-left text-[12px] coarse:py-2.5',
                    sel === i && 'bg-accent-soft',
                  )}
                  onClick={() => selectBone(pmx.bones[i].name)}
                >
                  <NameLabel modelId={modelId} kind="bone" ja={pmx.bones[i].name} />
                </button>
              </li>
            ))
          : roots.map((r) => row(r, 0))}
      </ul>
      {sel >= 0 && <BoneFields index={sel} />}
    </div>
  );
}

function selectBone(name: string): void {
  me.set({ bone: name });
  const s = studio.get();
  const id = me.get().modelId;
  const info = s.models.find((m) => m.id === id)?.info;
  const i = info?.bones.findIndex((b) => b.name === name) ?? -1;
  if (id && i >= 0) engineOrNull()?.selectBone(id, i);
}

/** Model-space → world point for the gizmo (model transform: position, uniform scale, rotation ignored when 0). */
function toWorld(p: V3): [number, number, number] {
  const t = studio.get().models.find((m) => m.id === me.get().modelId)?.transform;
  if (!t) return [...p];
  return [p[0] * t.scale + t.position[0], p[1] * t.scale + t.position[1], p[2] * t.scale + t.position[2]];
}
function toModel(p: [number, number, number]): V3 {
  const t = studio.get().models.find((m) => m.id === me.get().modelId)?.transform;
  if (!t) return p;
  return [
    (p[0] - t.position[0]) / t.scale,
    (p[1] - t.position[1]) / t.scale,
    (p[2] - t.position[2]) / t.scale,
  ];
}

function BoneFields({ index }: { index: number }) {
  const ops = useOps();
  const result = useModelEditor((s) => s.result)!;
  const modelId = useModelEditor((s) => s.modelId);
  const table = useNameTable(modelId);
  const pmx = result.pmx;
  const b = pmx.bones[index];
  const [gizmo, setGizmo] = useState(false);
  const [newName, setNewName] = useState('');
  const std = standardFor(b.name, ops, table.get('bone', b.name).en);
  const frame = pmx.frames.findIndex((f) => f.items.some((it) => it.kind === 'bone' && it.index === index));

  useEffect(() => {
    const engine = engineOrNull();
    if (!engine || !gizmo) return;
    engine.setPointGizmo(toWorld(b.position), {
      onEnd: (p) =>
        commitOp(
          {
            type: 'bone',
            name: b.name,
            patch: { position: toModel(p).map((x) => Number(x.toFixed(4))) as V3 },
          },
          { label: `Move bone ${b.name}` },
        ),
    });
    return () => engine.setPointGizmo(null);
  }, [gizmo, b.name, b.position]);

  return (
    <div data-testid="me-bone-fields">
      <SubHead>
        <NameLabel modelId={modelId} kind="bone" ja={b.name} />
      </SubHead>
      <Vec3Field
        label="Position"
        value={b.position}
        testid="me-bone-position"
        onChange={(v) =>
          commitOp({ type: 'bone', name: b.name, patch: { position: v } }, { label: `Move bone ${b.name}` })
        }
      />
      <ToggleRow label="Move with gizmo" checked={gizmo} onChange={setGizmo} />
      <label className="flex items-center justify-between gap-2 py-1 text-[12px] text-fg-muted">
        Parent
        <select
          className="input h-6 max-w-[60%] text-[12px] coarse:h-11"
          aria-label="Parent bone"
          value={b.parent >= 0 ? pmx.bones[b.parent].name : ''}
          onChange={(e) =>
            commitOp(
              { type: 'bone', name: b.name, patch: { parent: e.target.value } },
              { label: `Reparent ${b.name}` },
            )
          }
        >
          <option value="">(none)</option>
          {pmx.bones.map((x, i) =>
            i === index ? null : (
              <option key={x.name} value={x.name}>
                {x.name}
              </option>
            ),
          )}
        </select>
      </label>
      {FLAG_ROWS.map(([bit, label]) => (
        <ToggleRow
          key={bit}
          label={label}
          checked={(b.flags & bit) !== 0}
          onChange={(v) =>
            commitOp({ type: 'bone', name: b.name, patch: { flags: v ? b.flags | bit : b.flags & ~bit } })
          }
        />
      ))}
      <label className="flex items-center justify-between gap-2 py-1 text-[12px] text-fg-muted">
        Display frame
        <select
          className="input h-6 text-[12px] coarse:h-11"
          aria-label="Display frame"
          value={frame}
          onChange={(e) => {
            const to = Number(e.target.value);
            const frames = pmx.frames.map((f, fi) => ({
              name: f.name,
              nameEn: f.nameEn,
              special: f.special,
              items: f.items
                .filter((it) => !(it.kind === 'bone' && it.index === index))
                .map((it) => ({
                  kind: it.kind,
                  name: it.kind === 'bone' ? pmx.bones[it.index].name : pmx.morphs[it.index].name,
                }))
                .concat(fi === to ? [{ kind: 'bone' as const, name: b.name }] : []),
            }));
            commitOp({ type: 'frames', frames }, { label: 'Display frame' });
          }}
        >
          <option value={-1}>(none)</option>
          {pmx.frames.map((f, i) => (
            <option key={i} value={i}>
              {f.name}
            </option>
          ))}
        </select>
      </label>

      <SubHead>Name</SubHead>
      <TextField
        label="Japanese name (the ID motions use)"
        value={b.name}
        testid="me-bone-name"
        onCommit={(v) => {
          const to = v.trim();
          if (!to || to === b.name) return;
          if (
            isStandardBone(b.name) &&
            !window.confirm(
              `VMD motions find bones by their Japanese name. Renaming “${b.name}” means motions won’t move it any more. Rename anyway?`,
            )
          )
            return;
          commitOp({ type: 'boneRename', from: b.name, to }, { label: `Rename ${b.name} → ${to}` });
          me.set({ bone: to });
        }}
      />
      <TextField
        label="English name"
        value={b.nameEn}
        onCommit={(v) => commitOp({ type: 'bone', name: b.name, patch: { nameEn: v } })}
      />
      {std && boneIndex(pmx, std) < 0 && (
        <Button
          size="sm"
          onClick={() => {
            commitOp(
              { type: 'boneRename', from: b.name, to: std },
              { label: `Restore standard name ${std}` },
            );
            me.set({ bone: std });
          }}
        >
          Restore standard name “{std}”
        </Button>
      )}

      {b.ik && <IkFields index={index} />}

      <SubHead>Add / delete</SubHead>
      <div className="flex gap-1.5">
        <input
          className="input h-7 min-w-0 flex-1 px-2 text-[12px] coarse:h-11"
          placeholder="New child bone name"
          aria-label="New bone name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <Button
          size="sm"
          disabled={!newName.trim()}
          onClick={() => {
            const p = b.position;
            commitOp(
              {
                type: 'boneAdd',
                name: newName.trim(),
                nameEn: newName.trim(),
                parent: b.name,
                position: [p[0], p[1] + 0.5, p[2]],
              },
              { label: `Add bone ${newName.trim()}` },
            );
            me.set({ bone: newName.trim() });
            setNewName('');
          }}
        >
          <Plus size={13} /> Add child
        </Button>
      </div>
      <Button
        size="sm"
        variant="danger"
        className="mt-1.5"
        disabled={b.parent < 0}
        data-testid="me-bone-delete"
        onClick={() => {
          const parent = pmx.bones[b.parent]?.name;
          const n = pmx.vertices.filter((v) => v.bones.includes(index)).length;
          if (
            !window.confirm(
              `Delete “${b.name}”? Its ${n} weighted vertices, children and rigid bodies move to “${parent}”.`,
            )
          )
            return;
          commitOp({ type: 'boneDelete', name: b.name }, { label: `Delete bone ${b.name}` });
          me.set({ bone: parent ?? null });
        }}
      >
        <Trash2 size={13} /> Delete bone
      </Button>
    </div>
  );
}

function kneeFlipWarning(pmx: PmxModel, index: number): string | null {
  const ik = pmx.bones[index].ik;
  if (!ik) return null;
  for (const l of ik.links) {
    const name = pmx.bones[l.bone]?.name ?? '';
    if (!/ひざ|knee/i.test(name)) continue;
    if (!l.limit)
      return `${name} has no angle limit — the knee may bend backwards. Limit it to X only (−180° … −0.5°).`;
    if (l.limit.max[0] > 0 || Math.abs(l.limit.min[1]) + Math.abs(l.limit.max[1]) > 0.01)
      return `${name}'s limit lets it bend the wrong way. Use X only (−180° … −0.5°).`;
  }
  return null;
}

function IkFields({ index }: { index: number }) {
  const result = useModelEditor((s) => s.result)!;
  const pmx = result.pmx;
  const b = pmx.bones[index];
  const ik = b.ik!;
  const spec = () => ({
    target: pmx.bones[ik.target].name,
    loop: ik.loop,
    limit: ik.limit,
    links: ik.links.map((l) => ({ bone: pmx.bones[l.bone].name, limit: l.limit })),
  });
  const save = (patch: Partial<ReturnType<typeof spec>>, label = `IK ${b.name}`): void =>
    commitOp({ type: 'ik', name: b.name, ik: { ...spec(), ...patch } }, { label });
  const warn = kneeFlipWarning(pmx, index);
  const [addLink, setAddLink] = useState('');
  return (
    <div data-testid="me-ik">
      <SubHead
        actions={
          <Button size="sm" variant="ghost" onClick={playTestPose}>
            <Play size={13} /> Test pose
          </Button>
        }
      >
        IK
      </SubHead>
      {warn && (
        <Notice tone="warn" testid="me-knee-warning">
          {warn}
        </Notice>
      )}
      <label className="flex items-center justify-between gap-2 py-1 text-[12px] text-fg-muted">
        Target
        <select
          className="input h-6 max-w-[60%] text-[12px] coarse:h-11"
          value={pmx.bones[ik.target].name}
          onChange={(e) => save({ target: e.target.value })}
        >
          {pmx.bones.map((x) => (
            <option key={x.name} value={x.name}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] text-fg-muted">
          Loop
          <input
            type="number"
            className="input h-7 w-full px-1 text-[12px] coarse:h-11"
            value={ik.loop}
            min={1}
            max={255}
            onChange={(e) => save({ loop: Math.max(1, Number(e.target.value) || 1) })}
          />
        </label>
        <label className="text-[11px] text-fg-muted">
          Angle per step (°)
          <input
            type="number"
            className="input h-7 w-full px-1 text-[12px] coarse:h-11"
            value={Number((ik.limit * DEG).toFixed(2))}
            step={1}
            onChange={(e) => save({ limit: (Number(e.target.value) || 0) / DEG })}
          />
        </label>
      </div>
      <ul className="mt-1 space-y-1">
        {ik.links.map((l, k) => {
          const name = pmx.bones[l.bone].name;
          const lim = l.limit;
          const setLimit = (limit: { min: V3; max: V3 } | undefined): void =>
            save({ links: spec().links.map((x, j) => (j === k ? { ...x, limit } : x)) });
          return (
            <li key={k} className="rounded border border-line p-1.5">
              <div className="flex items-center justify-between text-[12px]">
                <span>{name}</span>
                <div className="flex gap-1">
                  {/ひざ|knee/i.test(name) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setLimit({ min: [-Math.PI, 0, 0], max: [-0.008726646, 0, 0] })}
                    >
                      Knee X-limit
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setLimit(
                        lim
                          ? undefined
                          : { min: [-Math.PI, -Math.PI, -Math.PI], max: [Math.PI, Math.PI, Math.PI] },
                      )
                    }
                  >
                    {lim ? 'No limit' : 'Limit'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${name} from the chain`}
                    onClick={() => save({ links: spec().links.filter((_, j) => j !== k) })}
                  >
                    ×
                  </Button>
                </div>
              </div>
              {lim && (
                <>
                  <Vec3Field
                    label="Min (°)"
                    precision={1}
                    step={1}
                    value={lim.min.map((x) => x * DEG) as V3}
                    onChange={(v) => setLimit({ min: v.map((x) => x / DEG) as V3, max: lim.max })}
                  />
                  <Vec3Field
                    label="Max (°)"
                    precision={1}
                    step={1}
                    value={lim.max.map((x) => x * DEG) as V3}
                    onChange={(v) => setLimit({ min: lim.min, max: v.map((x) => x / DEG) as V3 })}
                  />
                </>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-1.5 flex gap-1.5">
        <select
          className="input h-7 min-w-0 flex-1 text-[12px] coarse:h-11"
          aria-label="Add chain bone"
          value={addLink}
          onChange={(e) => setAddLink(e.target.value)}
        >
          <option value="">Add a chain bone…</option>
          {pmx.bones.map((x) => (
            <option key={x.name} value={x.name}>
              {x.name}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          disabled={!addLink}
          onClick={() => (
            save({ links: [...spec().links, { bone: addLink, limit: undefined }] }),
            setAddLink('')
          )}
        >
          Add
        </Button>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="mt-1"
        onClick={() => commitOp({ type: 'ik', name: b.name, ik: null }, { label: `Remove IK ${b.name}` })}
      >
        Remove IK
      </Button>
      <p className="mt-1 flex items-center gap-1 text-[11px] text-fg-dim">
        <Move3d size={11} /> Changes rebuild the model; use Test pose to check knees and feet.
      </p>
    </div>
  );
}
