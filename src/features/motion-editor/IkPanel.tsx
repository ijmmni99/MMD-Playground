import { useMemo, useState } from 'react';
import { Lock, RefreshCw, Trash2 } from 'lucide-react';
import { useMotionEditor, me } from '@/store/motionEditor';
import { toast } from '@/store/studio';
import {
  addPin,
  bakeIkToFk,
  fitIkFromFk,
  ikChains,
  recapturePin,
  removePin,
  setSolver,
  type IkResult,
} from './ikActions';
import './ikOverlay';
import { Btn, Check, Num, RangeFields, Row, Section } from './panelUi';
import { toolRange } from './view';

const isLeg = (name: string): boolean => name.includes('足');

export default function IkPanel() {
  const modelId = useMotionEditor((s) => s.modelId);
  const revision = useMotionEditor((s) => s.revision);
  const overlay = useMotionEditor((s) => s.ikOverlay);
  const bakeFk = useMotionEditor((s) => s.bakeFk);
  const ikOff = useMotionEditor((s) => (s.modelId ? !!s.ikOff[s.modelId] : false));
  const pins = useMotionEditor((s) => (s.modelId ? s.pins[s.modelId] : undefined));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- chains change with the model (and its load)
  const chains = useMemo(() => ikChains(), [modelId, revision]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [reduceOn, setReduceOn] = useState(true);
  const [tol, setTol] = useState(0.5);
  const [blendIn, setBlendIn] = useState(3);
  const [blendOut, setBlendOut] = useState(3);
  const [pinBone, setPinBone] = useState('');
  const [result, setResult] = useState<{ op: string; r: IkResult } | null>(null);

  if (!modelId) return <div className="p-3 text-[12px] text-fg-muted">Pick a model to edit its IK.</div>;
  if (!chains.length)
    return <div className="p-3 text-[12px] text-fg-muted">This model has no IK chains.</div>;

  const isPicked = (bone: string): boolean => picked[bone] ?? isLeg(bone);
  const selected = chains.filter((c) => isPicked(c.bone)).map((c) => c.bone);
  const report = (op: string, r: IkResult | null): void => {
    if (!r) return;
    setResult({ op, r });
    if (r.error > 0.05)
      toast('warning', `${op}: target moved up to ${r.error.toFixed(3)} — check the range edges`);
  };
  const pinTarget = pinBone || chains.find((c) => isLeg(c.bone))?.bone || chains[0].bone;

  return (
    <div className="flex flex-col" data-testid="me-ik-panel">
      <Section title="Solver & overlay">
        <Check label="IK solver on (this model)" checked={!ikOff} onChange={(v) => setSolver(v)} />
        <Check
          label="Show IK chains, targets, knee direction"
          checked={overlay}
          onChange={(v) => me.set({ ikOverlay: v })}
        />
        <Check
          label="Keying an IK bone also keys its FK chain"
          checked={bakeFk}
          onChange={(v) => me.set({ bakeFk: v })}
        />
        <p className="text-[11px] text-fg-dim">
          Select a 足ＩＫ / 手ＩＫ bone, drag it with the move gizmo, press K. The grey cross is where it was.
        </p>
      </Section>

      <Section title="Range & chains">
        <RangeFields />
        <div className="flex flex-col gap-0.5" role="group" aria-label="IK chains">
          {chains.map((c) => (
            <Check
              key={c.bone}
              label={`${c.bone} → ${c.target} (${c.links.length})`}
              checked={isPicked(c.bone)}
              onChange={(v) => setPicked((p) => ({ ...p, [c.bone]: v }))}
            />
          ))}
        </div>
      </Section>

      <Section title="IK ↔ FK">
        <Row>
          <Check label="Reduce keys" checked={reduceOn} onChange={setReduceOn} />
          <Num label="Tolerance °/units" value={tol} step={0.1} min={0} onChange={setTol} />
        </Row>
        <div className="flex flex-wrap gap-1">
          <Btn
            testid="ik-bake"
            disabled={!selected.length}
            onClick={() => {
              const [a, b] = toolRange();
              report('Bake IK → FK', bakeIkToFk(selected, a, b, { reduceTol: reduceOn ? tol : undefined }));
            }}
          >
            Bake IK → FK
          </Btn>
          <Btn
            testid="ik-fit"
            disabled={!selected.length}
            onClick={() => {
              const [a, b] = toolRange();
              report(
                'Fit IK from FK',
                fitIkFromFk(selected, a, b, { reduceTol: reduceOn ? tol / 50 : undefined }),
              );
            }}
          >
            Fit IK from FK
          </Btn>
        </div>
        {result && (
          <p className="font-mono text-[11px] text-fg-muted" data-testid="ik-result">
            {result.op}: {result.r.frames} frames, max target error {result.r.error.toFixed(4)}
          </p>
        )}
        <p className="text-[11px] text-fg-dim">
          Bake writes the solved leg rotations every frame and turns IK off for the range. Fit keys the IK
          targets where FK puts the feet and turns IK on.
        </p>
      </Section>

      <Section title="Foot pinning">
        <Row>
          <label className="flex flex-1 flex-col gap-0.5 text-[11px] text-fg-muted">
            Bone
            <select
              className="input coarse:h-10"
              value={pinTarget}
              onChange={(e) => setPinBone(e.target.value)}
              aria-label="Pin bone"
            >
              {chains.map((c) => (
                <option key={c.bone}>{c.bone}</option>
              ))}
            </select>
          </label>
          <Num label="Blend in" value={blendIn} min={0} onChange={setBlendIn} />
          <Num label="Blend out" value={blendOut} min={0} onChange={setBlendOut} />
        </Row>
        <Btn
          testid="ik-pin"
          onClick={() => {
            const [a, b] = toolRange();
            addPin(pinTarget, a, b, Math.round(blendIn), Math.round(blendOut));
          }}
        >
          <Lock size={13} className="mr-1 inline" /> Pin over range
        </Btn>
        <ul className="flex flex-col gap-1" data-testid="ik-pins">
          {(pins ?? []).map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-1 rounded border border-line px-2 py-1 text-[11px]"
            >
              <Lock size={12} className="text-[#4dd0e1]" />
              <span className="flex-1 truncate">
                {p.bone} {p.start}–{p.end}
                <span className="text-fg-dim">
                  {' '}
                  ±{p.blendIn}/{p.blendOut}
                </span>
              </span>
              <button
                type="button"
                title="Re-anchor at start"
                className="p-1 text-fg-muted hover:text-fg"
                onClick={() => recapturePin(p.id)}
              >
                <RefreshCw size={12} />
              </button>
              <button
                type="button"
                title="Remove pin"
                className="p-1 text-fg-muted hover:text-fg"
                onClick={() => removePin(p.id)}
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-fg-dim">
          Pinned feet hold their start position; IK height never goes below the floor.
        </p>
      </Section>
    </div>
  );
}
