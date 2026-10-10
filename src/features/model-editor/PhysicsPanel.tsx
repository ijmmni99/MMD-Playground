import { Play, RefreshCw, Shield, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, ToggleRow } from '@/components/ui/controls';
import { cn } from '@/components/ui/cn';
import type { PmxModel, PmxRigidBody, V3 } from '@/lib/convert/pmx/types';
import { physicsWarnings, type PhysicsPresetName } from '@/lib/model-edit/physicsEdit';
import { engineOrNull } from '@/store/engineRef';
import { me, useModelEditor } from '@/store/modelEditor';
import { commitOp, endDrag, playTestPose, refreshOverlay, setPhysicsOverlay } from './actions';
import { Chip, Notice, SubHead, TextField, ValueSlider, Vec3Field } from './ui';

const DEG = 180 / Math.PI;
const SHAPES = ['Sphere', 'Box', 'Capsule'];
const MODES = ['Follow bone', 'Physics', 'Physics + bone position'];

/** Bodies downstream of `start` through joints (a chain), including it. */
function chainFrom(m: PmxModel, start: number): number[] {
  const out = [start];
  const seen = new Set(out);
  for (let k = 0; k < out.length; k++)
    for (const j of m.joints)
      if (j.a === out[k] && !seen.has(j.b)) {
        seen.add(j.b);
        out.push(j.b);
      }
  return out;
}

/** Bone chain root → tip following single children. */
function boneChain(m: PmxModel, root: number): number[] {
  const out = [root];
  for (let cur = root; ;) {
    const kids = m.bones.map((b, i) => (b.parent === cur ? i : -1)).filter((i) => i >= 0);
    if (kids.length !== 1) break;
    cur = kids[0];
    out.push(cur);
  }
  return out;
}

export function PhysicsPanel() {
  const result = useModelEditor((s) => s.result);
  const overlay = useModelEditor((s) => s.physicsOverlay);
  const body = useModelEditor((s) => s.body);
  const [preset, setPreset] = useState<PhysicsPresetName>('soft');
  const [sway, setSway] = useState(0.5);
  const [autoRoot, setAutoRoot] = useState('');
  const pmx = result?.pmx;
  const warnings = useMemo(() => (pmx ? physicsWarnings(pmx) : []), [pmx]);
  if (!pmx) return null;
  const pick = (i: number): void => {
    me.set({ body: i });
    refreshOverlay();
  };
  return (
    <div className="px-3 pb-4" data-testid="me-physics">
      <ToggleRow label="Show rigid bodies and joints" checked={overlay} onChange={setPhysicsOverlay} />
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" onClick={playTestPose}>
          <Play size={13} /> Test motion
        </Button>
        <Button size="sm" onClick={() => engineOrNull()?.resetPhysics()}>
          <RefreshCw size={13} /> Reset physics
        </Button>
      </div>
      <div className="mt-2 rounded-md border border-line p-2">
        <Button
          size="sm"
          variant="primary"
          data-testid="me-body-collisions"
          onClick={() =>
            commitOp({ type: 'bodyCollisions' }, { label: 'Hair / skirt collide with the body' })
          }
        >
          <Shield size={13} /> Stop hair & skirt passing through the body
        </Button>
        <p className="mt-1 text-[11px] text-fg-dim">
          Adds missing body colliders (head, torso, hips, arms, legs) and makes every physics part collide
          with them. Also repairs models converted before this fix.
        </p>
      </div>
      {warnings.length > 0 && (
        <div className="mt-2">
          <Notice tone="warn" testid="me-physics-warning">
            Physics may explode: {warnings.slice(0, 3).join('; ')}
            {warnings.length > 3 ? '…' : ''}
          </Notice>
        </div>
      )}
      <SubHead>Rigid bodies ({pmx.rigidBodies.length})</SubHead>
      <ul className="max-h-[30vh] overflow-y-auto rounded-md border border-line">
        {pmx.rigidBodies.map((r, i) => (
          <li key={i}>
            <button
              type="button"
              className={cn(
                'flex w-full items-center gap-2 px-2 py-0.5 text-left text-[12px] coarse:py-2.5',
                body === i && 'bg-accent-soft',
              )}
              onClick={() => pick(i)}
            >
              <span className={cn('h-2 w-2 shrink-0 rounded-full', r.mode === 0 ? 'bg-accent' : 'bg-warn')} />
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              <span className="text-[10px] text-fg-dim">{pmx.bones[r.bone]?.name ?? '—'}</span>
            </button>
          </li>
        ))}
      </ul>
      {body !== null && pmx.rigidBodies[body] && <BodyFields index={body} />}

      <SubHead>Presets</SubHead>
      <p className="text-[12px] text-fg-muted">
        Applies to the selected body and everything hanging below it (its chain).
      </p>
      <div className="mt-1 flex gap-1.5">
        {(['soft', 'skirt', 'stiff'] as const).map((p) => (
          <Chip key={p} active={preset === p} onClick={() => setPreset(p)}>
            {p[0].toUpperCase() + p.slice(1)}
          </Chip>
        ))}
      </div>
      <ValueSlider label="Sway" value={sway} min={0} max={1} reset={0.5} onChange={(v) => setSway(v)} />
      <Button
        size="sm"
        disabled={body === null}
        onClick={() =>
          body !== null &&
          commitOp(
            { type: 'physicsPreset', bodies: chainFrom(pmx, body), preset, sway },
            { label: `Physics preset ${preset}` },
          )
        }
      >
        Apply to chain
      </Button>

      <SubHead>
        <span className="flex items-center gap-1">
          <Wand2 size={13} /> Generate for a bone chain
        </span>
      </SubHead>
      <div className="flex gap-1.5">
        <select
          className="input h-7 min-w-0 flex-1 text-[12px] coarse:h-11"
          aria-label="Chain root bone"
          value={autoRoot}
          onChange={(e) => setAutoRoot(e.target.value)}
        >
          <option value="">Chain root bone…</option>
          {pmx.bones.map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          disabled={!autoRoot}
          onClick={() => {
            const root = pmx.bones.findIndex((b) => b.name === autoRoot);
            const chain = boneChain(pmx, root).map((i) => pmx.bones[i].name);
            commitOp(
              { type: 'autoPhysics', bones: chain, preset, sway },
              { label: `Auto physics ${autoRoot}` },
            );
          }}
        >
          Generate
        </Button>
      </div>
    </div>
  );
}

function BodyFields({ index }: { index: number }) {
  const result = useModelEditor((s) => s.result)!;
  const pmx = result.pmx;
  const r = pmx.rigidBodies[index];
  const p = (patch: Partial<PmxRigidBody>, drag = false): void =>
    commitOp(
      { type: 'rigidBody', index, patch },
      {
        coalesce: drag ? `rb:${index}:${Object.keys(patch).join()}` : undefined,
        label: `Rigid body ${r.name}`,
      },
    );
  const joints = pmx.joints.map((j, i) => ({ j, i })).filter(({ j }) => j.b === index || j.a === index);
  return (
    <div data-testid="me-body-fields">
      <SubHead>{r.name}</SubHead>
      <TextField label="Name" value={r.name} onCommit={(v) => p({ name: v })} />
      <label className="flex items-center justify-between py-1 text-[12px] text-fg-muted">
        Shape
        <select
          className="input h-6 text-[12px] coarse:h-11"
          value={r.shape}
          onChange={(e) => p({ shape: Number(e.target.value) as 0 | 1 | 2 })}
        >
          {SHAPES.map((s, i) => (
            <option key={s} value={i}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between py-1 text-[12px] text-fg-muted">
        Mode
        <select
          className="input h-6 text-[12px] coarse:h-11"
          value={r.mode}
          onChange={(e) => p({ mode: Number(e.target.value) as 0 | 1 | 2 })}
        >
          {MODES.map((s, i) => (
            <option key={s} value={i}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <Vec3Field label="Size" value={r.size} step={0.05} onChange={(v) => p({ size: v })} />
      <Vec3Field label="Position" value={r.position} onChange={(v) => p({ position: v })} />
      <Vec3Field
        label="Rotation (°)"
        value={r.rotation.map((x) => x * DEG) as V3}
        precision={1}
        step={1}
        onChange={(v) => p({ rotation: v.map((x) => x / DEG) as V3 })}
      />
      <ValueSlider
        label="Mass"
        value={r.mass}
        min={0}
        max={10}
        step={0.05}
        reset={1}
        onChange={(v, d) => p({ mass: v }, d)}
        onCommit={endDrag}
      />
      <ValueSlider
        label="Move damping"
        value={r.linearDamping}
        min={0}
        max={1}
        reset={0.5}
        onChange={(v, d) => p({ linearDamping: v }, d)}
        onCommit={endDrag}
      />
      <ValueSlider
        label="Turn damping"
        value={r.angularDamping}
        min={0}
        max={1}
        reset={0.5}
        onChange={(v, d) => p({ angularDamping: v }, d)}
        onCommit={endDrag}
      />
      <ValueSlider
        label="Bounce"
        value={r.restitution}
        min={0}
        max={1}
        reset={0}
        onChange={(v, d) => p({ restitution: v }, d)}
        onCommit={endDrag}
      />
      <ValueSlider
        label="Friction"
        value={r.friction}
        min={0}
        max={1}
        reset={0.5}
        onChange={(v, d) => p({ friction: v }, d)}
        onCommit={endDrag}
      />
      <label className="flex items-center justify-between py-1 text-[12px] text-fg-muted">
        Group
        <select
          className="input h-6 text-[12px] coarse:h-11"
          value={r.group}
          onChange={(e) => p({ group: Number(e.target.value) })}
        >
          {Array.from({ length: 16 }, (_, i) => (
            <option key={i} value={i}>
              {i + 1}
            </option>
          ))}
        </select>
      </label>
      <div className="py-1 text-[12px] text-fg-muted">Collides with groups</div>
      <div className="grid grid-cols-8 gap-1">
        {Array.from({ length: 16 }, (_, g) => (
          <label key={g} className="flex flex-col items-center text-[10px]">
            <input
              type="checkbox"
              checked={(r.collidesWith & (1 << g)) !== 0}
              onChange={(e) =>
                p({ collidesWith: e.target.checked ? r.collidesWith | (1 << g) : r.collidesWith & ~(1 << g) })
              }
            />
            {g + 1}
          </label>
        ))}
      </div>
      {joints.map(({ j, i }) => (
        <div key={i} className="mt-2 rounded border border-line p-1.5">
          <div className="text-[12px] font-medium">Joint {j.name}</div>
          <Vec3Field
            label="Turn min (°)"
            precision={1}
            step={1}
            value={j.rotateMin.map((x) => x * DEG) as V3}
            onChange={(v) =>
              commitOp({ type: 'joint', index: i, patch: { rotateMin: v.map((x) => x / DEG) as V3 } })
            }
          />
          <Vec3Field
            label="Turn max (°)"
            precision={1}
            step={1}
            value={j.rotateMax.map((x) => x * DEG) as V3}
            onChange={(v) =>
              commitOp({ type: 'joint', index: i, patch: { rotateMax: v.map((x) => x / DEG) as V3 } })
            }
          />
          <Vec3Field
            label="Move min"
            value={j.moveMin}
            onChange={(v) => commitOp({ type: 'joint', index: i, patch: { moveMin: v } })}
          />
          <Vec3Field
            label="Move max"
            value={j.moveMax}
            onChange={(v) => commitOp({ type: 'joint', index: i, patch: { moveMax: v } })}
          />
          <Vec3Field
            label="Turn spring"
            value={j.springRotate}
            step={1}
            precision={1}
            onChange={(v) => commitOp({ type: 'joint', index: i, patch: { springRotate: v } })}
          />
          <Vec3Field
            label="Move spring"
            value={j.springMove}
            step={1}
            precision={1}
            onChange={(v) => commitOp({ type: 'joint', index: i, patch: { springMove: v } })}
          />
        </div>
      ))}
    </div>
  );
}
