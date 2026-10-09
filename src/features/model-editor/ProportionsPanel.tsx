import { Download, Play, Save, Square, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, ToggleRow } from '@/components/ui/controls';
import { materialVertices } from '@/lib/model-edit/ops';
import {
  availableParts,
  IDENTITY,
  isIdentity,
  outOfRange,
  partLabel,
  PRESETS,
  SCALE_MAX,
  SCALE_MIN,
  type PartId,
  type PartScale,
} from '@/lib/model-edit/proportions';
import { engineOrNull } from '@/store/engineRef';
import { me, useModelEditor, useOps } from '@/store/modelEditor';
import {
  applyProportionPreset,
  commitOp,
  endDrag,
  exportProportionPreset,
  importProportionPreset,
  playTestPose,
  proportionState,
  resetPart,
  saveProportionPreset,
  setPartScale,
} from './actions';
import { Chip, Notice, SubHead, ValueSlider } from './ui';

const GROUPS: { label: string; parts: string[] }[] = [
  { label: 'Body', parts: ['whole', 'head', 'neck', 'torso', 'chest', 'hips'] },
  { label: 'Arms', parts: ['upperArm', 'lowerArm', 'hand', 'fingers'] },
  { label: 'Legs', parts: ['upperLeg', 'lowerLeg', 'foot'] },
];
const SIDED = new Set(['upperArm', 'lowerArm', 'hand', 'fingers', 'upperLeg', 'lowerLeg', 'foot']);
const SHORT: Record<string, string> = {
  whole: 'Whole',
  head: 'Head',
  neck: 'Neck',
  torso: 'Torso',
  chest: 'Chest',
  hips: 'Hips',
  upperArm: 'Upper arm',
  lowerArm: 'Forearm',
  hand: 'Hands',
  fingers: 'Fingers',
  upperLeg: 'Thigh',
  lowerLeg: 'Shin',
  foot: 'Feet',
};

export function ProportionsPanel() {
  const ops = useOps();
  const part = useModelEditor((s) => s.part);
  const linkLR = useModelEditor((s) => s.linkLR);
  const original = useModelEditor((s) => s.original);
  const result = useModelEditor((s) => s.result);
  const presets = useModelEditor((s) => s.proportionPresets);
  const state = proportionState(ops);
  const have = useMemo(() => new Set(original ? availableParts(original) : []), [original]);
  const side: 'L' | 'R' = part.endsWith('R') ? 'R' : 'L';
  const base = SIDED.has(part.slice(0, -1)) ? part.slice(0, -1) : part;
  const scale: PartScale = state.parts[part] ?? IDENTITY;
  const [presetName, setPresetName] = useState('');
  const [playing, setPlaying] = useState(false);

  const pick = (b: string, s = side): void => me.set({ part: (SIDED.has(b) ? `${b}${s}` : b) as PartId });
  const set = (field: keyof PartScale) => (v: number, drag: boolean) =>
    setPartScale(part, { [field]: v }, drag);

  // Accessories weighted to nothing but the root bone (they won't follow the body).
  const unweighted = useMemo(() => {
    if (!result) return [];
    const m = result.pmx;
    return m.materials
      .map((mat, i) => ({ mat, i }))
      .filter(({ i }) => {
        const vs = [...materialVertices(m, [i])];
        return vs.length > 0 && vs.every((v) => m.vertices[v].bones.every((b) => b === 0));
      });
  }, [result]);

  return (
    <div className="space-y-1 px-3 pb-4" data-testid="me-proportions">
      <p className="pt-2 text-[12px] text-fg-muted">
        Pick a body part (or tap the model), then scale it. Joints blend smoothly, feet stay on the floor.
      </p>
      {GROUPS.map((g) => (
        <div key={g.label}>
          <SubHead>{g.label}</SubHead>
          <div className="flex flex-wrap gap-1.5">
            {g.parts.map((b) => {
              const id = (SIDED.has(b) ? `${b}${side}` : b) as PartId;
              const exists = b === 'whole' || have.has(id);
              const changed =
                !isIdentity(state.parts[id]) ||
                (SIDED.has(b) && !isIdentity(state.parts[`${b}${side === 'L' ? 'R' : 'L'}` as PartId]));
              return (
                <Chip
                  key={b}
                  active={base === b}
                  disabled={!exists}
                  testid={`me-part-${b}`}
                  onClick={() => pick(b)}
                >
                  {SHORT[b]}
                  {changed && <span className="ml-1 text-accent">•</span>}
                </Chip>
              );
            })}
          </div>
        </div>
      ))}
      {SIDED.has(base) && (
        <div className="mt-2 flex items-center gap-1.5">
          <Chip active={side === 'L'} onClick={() => pick(base, 'L')} testid="me-side-L">
            Left
          </Chip>
          <Chip active={side === 'R'} onClick={() => pick(base, 'R')} testid="me-side-R">
            Right
          </Chip>
          <div className="flex-1" />
        </div>
      )}
      <ToggleRow label="Link left and right" checked={linkLR} onChange={(v) => me.set({ linkLR: v })} />

      <SubHead
        actions={
          <Button size="sm" variant="ghost" onClick={() => resetPart(part)} data-testid="me-reset-part">
            Reset part
          </Button>
        }
      >
        {partLabel(part)}
      </SubHead>
      <ValueSlider
        label="Overall"
        testid="me-scale-overall"
        value={scale.overall}
        onChange={set('overall')}
        onCommit={endDrag}
        min={0.25}
        max={2.5}
        warnOutside={[SCALE_MIN, SCALE_MAX]}
      />
      <ValueSlider
        label={part === 'whole' ? 'Height' : 'Length'}
        testid="me-scale-length"
        value={scale.length}
        onChange={set('length')}
        onCommit={endDrag}
        min={0.25}
        max={2.5}
        warnOutside={[SCALE_MIN, SCALE_MAX]}
      />
      <ValueSlider
        label={part === 'whole' ? 'Width' : 'Thickness'}
        testid="me-scale-thickness"
        value={scale.thickness}
        onChange={set('thickness')}
        onCommit={endDrag}
        min={0.25}
        max={2.5}
        warnOutside={[SCALE_MIN, SCALE_MAX]}
      />
      {outOfRange(scale) && (
        <Notice tone="warn">Outside 0.5–2× the mesh may look stretched — check it with the test pose.</Notice>
      )}
      <ToggleRow
        label="Keep feet on the floor"
        checked={state.keepFeet !== false}
        onChange={(v) =>
          commitOp({ type: 'proportions', state: { ...state, keepFeet: v } }, { label: 'Keep feet on floor' })
        }
      />

      <SubHead>Presets</SubHead>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(PRESETS).map(([name, st]) => (
          <Chip
            key={name}
            testid={`me-preset-${name.replace(/\s+/g, '-')}`}
            onClick={() => applyProportionPreset(st, name)}
          >
            {name}
          </Chip>
        ))}
        {presets.map((p) => (
          <Chip key={`u-${p.name}`} onClick={() => applyProportionPreset(p.state, p.name)}>
            {p.name}
          </Chip>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <input
          className="input h-7 min-w-0 flex-1 px-2 text-[12px] coarse:h-11"
          placeholder="Preset name"
          aria-label="Preset name"
          value={presetName}
          onChange={(e) => setPresetName(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <Button
          size="sm"
          disabled={!presetName.trim()}
          onClick={() => {
            saveProportionPreset(presetName.trim());
            setPresetName('');
          }}
        >
          <Save size={13} /> Save
        </Button>
      </div>
      <div className="flex gap-1.5 pt-1">
        <Button size="sm" variant="ghost" onClick={exportProportionPreset}>
          <Download size={13} /> Export JSON
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void importProportionPreset()}>
          <Upload size={13} /> Import JSON
        </Button>
      </div>

      <SubHead>Check</SubHead>
      <div className="flex gap-1.5">
        <Button
          size="sm"
          data-testid="me-test-pose"
          onClick={() => {
            if (playing) engineOrNull()?.pause();
            else playTestPose();
            setPlaying(!playing);
          }}
        >
          {playing ? <Square size={13} /> : <Play size={13} />} {playing ? 'Stop test pose' : 'Test pose'}
        </Button>
      </div>

      {unweighted.length > 0 && (
        <>
          <SubHead>Unattached parts</SubHead>
          <Notice tone="warn">
            {unweighted.length} material(s) only follow the root bone, so they won’t move with the body.
            Attach them to a bone:
          </Notice>
          {unweighted.map(({ mat, i }) => (
            <AttachRow key={i} index={i} name={mat.name} />
          ))}
        </>
      )}
    </div>
  );
}

function AttachRow({ index, name }: { index: number; name: string }) {
  const result = useModelEditor((s) => s.result);
  const [bone, setBone] = useState('頭');
  return (
    <div className="flex items-center gap-1.5 py-1">
      <span className="min-w-0 flex-1 truncate text-[12px]">{name}</span>
      <select
        className="input h-7 text-[12px] coarse:h-11"
        aria-label={`Bone for ${name}`}
        value={bone}
        onChange={(e) => setBone(e.target.value)}
      >
        {result?.pmx.bones.map((b) => (
          <option key={b.name} value={b.name}>
            {b.name}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        onClick={() => commitOp({ type: 'attach', materials: [index], bone }, { label: `Attach ${name}` })}
      >
        Attach
      </Button>
    </div>
  );
}
