import { Bone, ChevronDown, ChevronRight, Download, Eye, EyeOff, RotateCcw, Search, Upload, X } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { Button, Empty, IconButton, NumberField, Row, Section, Slider, Switch, ToggleRow } from '@/components/ui/controls';
import { cn } from '@/components/ui/cn';
import type { BoneInfo, MorphCategory, MorphInfo, TransformState, Vec3 } from '@/engine/types';
import { downloadBlob, pickFiles } from '@/features/app/filePickers';
import {
  exportPose,
  loadPoseFile,
  resetMorphs,
  resetPose,
  selectBone,
  setGizmoMode,
  setMaterial,
  setModelPhysics,
  setMorph,
  setTransform,
} from '@/store/actions';
import { useStudio, type ModelUI } from '@/store/studio';

export function ModelInspector() {
  const model = useStudio((s) => s.models.find((m) => m.id === s.selectedModelId) ?? null);
  if (!model) return <Empty>Select a model in the Scene panel to edit its transform, morphs, bones and materials.</Empty>;
  return (
    <div data-testid="model-inspector">
      <div className="border-b border-line px-3 py-2">
        <div className="truncate font-medium" title={model.name}>
          {model.name}
        </div>
        <div className="text-[11px] text-fg-dim">
          {model.info.fileName} · {model.info.vertexCount.toLocaleString()} verts · {model.info.bones.length} bones · {model.info.rigidBodyCount} rigid bodies
        </div>
      </div>
      <TransformSection model={model} />
      <PhysicsSection model={model} />
      <MorphSection model={model} />
      <BoneSection model={model} />
      <MaterialSection model={model} />
      <PoseSection model={model} />
    </div>
  );
}

function Vec3Row({ label, value, onChange, step }: { label: string; value: Vec3; onChange: (v: Vec3) => void; step: number }) {
  return (
    <div className="grid grid-cols-[64px_1fr_1fr_1fr] items-center gap-1 py-0.5">
      <span className="text-[12px] text-fg-muted">{label}</span>
      {(['X', 'Y', 'Z'] as const).map((axis, i) => (
        <NumberField
          key={axis}
          label={`${label} ${axis}`}
          value={value[i]}
          step={step}
          onChange={(v) => {
            const next: Vec3 = [...value];
            next[i] = v;
            onChange(next);
          }}
        />
      ))}
    </div>
  );
}

function TransformSection({ model }: { model: ModelUI }) {
  const t = model.transform;
  const set = (patch: Partial<TransformState>): void => setTransform(model.id, { ...t, ...patch });
  return (
    <Section
      title="Transform"
      actions={
        <IconButton size="sm" label="Reset transform" onClick={() => setTransform(model.id, { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 })}>
          <RotateCcw size={12} />
        </IconButton>
      }
    >
      <Vec3Row label="Position" value={t.position} step={0.5} onChange={(position) => set({ position })} />
      <Vec3Row label="Rotation" value={t.rotation} step={5} onChange={(rotation) => set({ rotation })} />
      <div className="grid grid-cols-[64px_1fr] items-center gap-1 py-0.5">
        <span className="text-[12px] text-fg-muted">Scale</span>
        <NumberField label="Scale" value={t.scale} step={0.05} onChange={(scale) => set({ scale: Math.max(0.01, scale) })} />
      </div>
    </Section>
  );
}

function PhysicsSection({ model }: { model: ModelUI }) {
  const physics = useStudio((s) => s.physics);
  const globalOn = useStudio((s) => s.settings.physics.enabled);
  return (
    <Section title="Physics">
      {!physics.available ? (
        <p className="text-[12px] text-warn">{physics.message ?? 'Physics engine unavailable.'}</p>
      ) : (
        <>
          <ToggleRow
            label="Simulate hair / skirt"
            checked={model.physics}
            onChange={(v) => setModelPhysics(model.id, v)}
            disabled={model.info.rigidBodyCount === 0}
            hint={model.info.rigidBodyCount === 0 ? 'This model has no rigid bodies' : undefined}
          />
          {!globalOn && <p className="text-[11px] text-fg-dim">Physics is disabled globally (Scene → Physics).</p>}
        </>
      )}
    </Section>
  );
}

const CATEGORY_LABEL: Record<MorphCategory, string> = { eyebrow: 'Eyebrows', eye: 'Eyes', mouth: 'Mouth', other: 'Other', system: 'System' };
const CATEGORY_ORDER: MorphCategory[] = ['eyebrow', 'eye', 'mouth', 'other', 'system'];

function MorphSection({ model }: { model: ModelUI }) {
  const [query, setQuery] = useState('');
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byCat = new Map<MorphCategory, MorphInfo[]>();
    for (const m of model.info.morphs) {
      if (q && !m.name.toLowerCase().includes(q)) continue;
      const list = byCat.get(m.category) ?? [];
      list.push(m);
      byCat.set(m.category, list);
    }
    return CATEGORY_ORDER.filter((c) => byCat.has(c)).map((c) => ({ category: c, morphs: byCat.get(c)! }));
  }, [model.info.morphs, query]);
  const active = Object.values(model.morphs).filter((v) => v !== 0).length;
  return (
    <Section
      title={`Morphs (${model.info.morphs.length})`}
      actions={
        <Button size="sm" variant="ghost" onClick={() => resetMorphs(model.id)} disabled={active === 0}>
          Reset all
        </Button>
      }
    >
      {model.info.morphs.length === 0 ? (
        <p className="text-[12px] text-fg-dim">This model has no morphs.</p>
      ) : (
        <>
          <SearchBox value={query} onChange={setQuery} label="Search morphs" />
          {groups.map((g) => (
            <MorphGroup key={g.category} title={CATEGORY_LABEL[g.category]} morphs={g.morphs} model={model} defaultOpen={g.category !== 'system'} />
          ))}
          {groups.length === 0 && <p className="py-2 text-[12px] text-fg-dim">No morph matches “{query}”.</p>}
          {model.motion && <p className="mt-2 text-[11px] text-fg-dim">Morphs keyed in the motion override sliders while playing.</p>}
        </>
      )}
    </Section>
  );
}

function SearchBox({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="relative mb-2">
      <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-dim" />
      <input aria-label={label} placeholder={label} value={value} onChange={(e) => onChange(e.target.value)} className="input w-full pl-6" onKeyDown={(e) => e.stopPropagation()} />
      {value && (
        <button type="button" aria-label="Clear search" className="absolute right-1.5 top-1/2 -translate-y-1/2 text-fg-dim hover:text-fg" onClick={() => onChange('')}>
          <X size={12} />
        </button>
      )}
    </div>
  );
}

function MorphGroup({ title, morphs, model, defaultOpen }: { title: string; morphs: ModelUI['info']['morphs']; model: ModelUI; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-1">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-1 py-1 text-[11px] font-semibold text-fg-muted hover:text-fg">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {title} <span className="font-normal text-fg-dim">({morphs.length})</span>
      </button>
      {open && (
        <div className="pl-1">
          {morphs.map((m) => (
            <MorphSlider key={m.index} modelId={model.id} name={m.name} value={model.morphs[m.name] ?? 0} />
          ))}
        </div>
      )}
    </div>
  );
}

const MorphSlider = memo(function MorphSlider({ modelId, name, value }: { modelId: string; name: string; value: number }) {
  return (
    <div className="grid grid-cols-[96px_1fr_34px] items-center gap-2 py-[3px]">
      <span className={cn('truncate text-[12px]', value ? 'text-fg' : 'text-fg-muted')} title={name}>
        {name}
      </span>
      <Slider label={`Morph ${name}`} value={value} onChange={(v) => setMorph(modelId, name, v)} min={0} max={1} step={0.01} />
      <span className="text-right font-mono text-[10px] tabular-nums text-fg-dim">{value.toFixed(2)}</span>
    </div>
  );
});

interface BoneNode {
  bone: BoneInfo;
  children: BoneNode[];
}

function buildTree(bones: BoneInfo[]): BoneNode[] {
  const nodes = bones.map((bone) => ({ bone, children: [] as BoneNode[] }));
  const roots: BoneNode[] = [];
  for (const n of nodes) {
    if (n.bone.parent >= 0 && nodes[n.bone.parent]) nodes[n.bone.parent].children.push(n);
    else roots.push(n);
  }
  return roots;
}

function BoneSection({ model }: { model: ModelUI }) {
  const selected = useStudio((s) => s.selectedBone);
  const gizmo = useStudio((s) => s.gizmoMode);
  const [query, setQuery] = useState('');
  const tree = useMemo(() => buildTree(model.info.bones), [model.info.bones]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? model.info.bones.filter((b) => b.name.toLowerCase().includes(q)) : null;
  }, [model.info.bones, query]);
  return (
    <Section title={`Bones (${model.info.bones.length})`} defaultOpen={false}>
      <div className="mb-2 flex items-center gap-1">
        <Button size="sm" variant={gizmo === 'rotate' ? 'primary' : 'default'} onClick={() => setGizmoMode('rotate')}>
          Rotate (R)
        </Button>
        <Button size="sm" variant={gizmo === 'translate' ? 'primary' : 'default'} onClick={() => setGizmoMode('translate')}>
          Move (T)
        </Button>
        {selected !== null && (
          <Button size="sm" variant="ghost" onClick={() => selectBone(null)}>
            Deselect
          </Button>
        )}
      </div>
      <SearchBox value={query} onChange={setQuery} label="Search bones" />
      <div role="tree" aria-label="Bone hierarchy" className="max-h-72 overflow-y-auto rounded border border-line bg-bg py-1">
        {filtered
          ? filtered.map((b) => <BoneRow key={b.index} bone={b} depth={0} selected={selected === b.index} />)
          : tree.map((n) => <BoneTreeNode key={n.bone.index} node={n} depth={0} selected={selected} />)}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-fg-dim">
        Select a bone, then drag the gizmo in the viewport. Edits are undoable; playing a motion overrides keyed bones.
      </p>
    </Section>
  );
}

function BoneTreeNode({ node, depth, selected }: { node: BoneNode; depth: number; selected: number | null }) {
  const [open, setOpen] = useState(depth < 2);
  return (
    <div role="none">
      <BoneRow bone={node.bone} depth={depth} selected={selected === node.bone.index} hasChildren={node.children.length > 0} open={open} onToggle={() => setOpen(!open)} />
      {open && node.children.map((c) => <BoneTreeNode key={c.bone.index} node={c} depth={depth + 1} selected={selected} />)}
    </div>
  );
}

function BoneRow({ bone, depth, selected, hasChildren, open, onToggle }: { bone: BoneInfo; depth: number; selected: boolean; hasChildren?: boolean; open?: boolean; onToggle?: () => void }) {
  return (
    <div
      role="treeitem"
      aria-selected={selected}
      aria-expanded={hasChildren ? open : undefined}
      tabIndex={0}
      className={cn('flex h-6 cursor-pointer items-center gap-1 pr-2 text-[12px] outline-none', selected ? 'bg-accent-soft text-accent' : 'hover:bg-bg-hover focus-visible:bg-bg-hover')}
      style={{ paddingLeft: 4 + depth * 12 }}
      onClick={() => selectBone(selected ? null : bone.index)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          selectBone(bone.index);
        } else if (e.key === 'ArrowRight' && hasChildren && !open) {
          e.stopPropagation();
          onToggle?.();
        } else if (e.key === 'ArrowLeft' && hasChildren && open) {
          e.stopPropagation();
          onToggle?.();
        }
      }}
    >
      {hasChildren ? (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          className="text-fg-dim hover:text-fg"
          onClick={(e) => {
            e.stopPropagation();
            onToggle?.();
          }}
        >
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
      ) : (
        <span className="inline-block w-[11px]" />
      )}
      <Bone size={11} className={bone.physics ? 'text-warn' : 'text-fg-dim'} />
      <span className="truncate">{bone.name}</span>
      {bone.physics && <span className="ml-auto text-[10px] text-warn">phys</span>}
    </div>
  );
}

function MaterialSection({ model }: { model: ModelUI }) {
  return (
    <Section title={`Materials (${model.info.materials.length})`} defaultOpen={false}>
      <div className="flex flex-col gap-1">
        {model.info.materials.map((mat, i) => {
          const st = model.materials[i] ?? { visible: true, outline: mat.outline, alpha: mat.alpha };
          return (
            <div key={i} className="rounded border border-line px-2 py-1">
              <div className="flex items-center gap-1">
                <IconButton size="sm" label={st.visible ? `Hide ${mat.name}` : `Show ${mat.name}`} onClick={() => setMaterial(model.id, i, { visible: !st.visible })}>
                  {st.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                </IconButton>
                <span className={cn('min-w-0 flex-1 truncate text-[12px]', !st.visible && 'text-fg-dim line-through')} title={mat.name}>
                  {mat.name || `Material ${i}`}
                </span>
                <span className="text-[10px] text-fg-dim">outline</span>
                <Switch label={`Outline for ${mat.name}`} checked={st.outline} onChange={(v) => setMaterial(model.id, i, { outline: v })} />
              </div>
              <div className="grid grid-cols-[40px_1fr_30px] items-center gap-2 pl-1">
                <span className="text-[11px] text-fg-dim">alpha</span>
                <Slider label={`Alpha for ${mat.name}`} value={st.alpha} min={0} max={1} step={0.01} onChange={(v) => setMaterial(model.id, i, { alpha: v })} />
                <span className="text-right font-mono text-[10px] text-fg-dim">{st.alpha.toFixed(2)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function PoseSection({ model }: { model: ModelUI }) {
  return (
    <Section title="Pose">
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          onClick={() => {
            const blob = exportPose(model.id);
            if (blob) downloadBlob(blob, `${model.name.replace(/[\\/:*?"<>|]+/g, '_')}.pose.json`);
          }}
        >
          <Download size={12} /> Save pose
        </Button>
        <Button
          size="sm"
          onClick={async () => {
            const [f] = await pickFiles('.json,application/json');
            if (f) await loadPoseFile(model.id, f.blob);
          }}
        >
          <Upload size={12} /> Load pose
        </Button>
        <Button size="sm" variant="ghost" onClick={() => resetPose(model.id)}>
          <RotateCcw size={12} /> Reset to default
        </Button>
      </div>
      <Row label="Poses store bone rotations/offsets + morphs as JSON.">
        <span />
      </Row>
    </Section>
  );
}
