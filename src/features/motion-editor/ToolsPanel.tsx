import { useState } from 'react';
import { parseKeyId, type MotionClip } from '@/lib/motion/types';
import { readVmd } from '@/lib/motion/vmd';
import {
  additive,
  autoBlink,
  bake,
  blink,
  BLINK_MORPH,
  crossfade,
  deleteTime,
  insertTime,
  lipPattern,
  loop,
  mirror,
  offsetScale,
  reduce,
  retargetScale,
  retime,
  smooth,
  trim,
  vowel,
  VOWELS,
  type Scope,
  type SmoothMethod,
} from '@/lib/motion/tools';
import { me } from '@/store/motionEditor';
import { toast } from '@/store/studio';
import { commitClips } from './actions';
import { Btn, Check, Num, RangeFields, Row, Section } from './panelUi';
import { playhead, toolRange } from './view';

/** Tracks the selection touches (bones / morphs), for "selected tracks" scope. */
function selectedScope(): Scope {
  const s = me.get();
  const refs = [...s.selection].map(parseKeyId);
  let bones = [...new Set(refs.filter((r) => r.kind === 'bone').map((r) => r.track))];
  let morphs = [...new Set(refs.filter((r) => r.kind === 'morph').map((r) => r.track))];
  if (!bones.length && !morphs.length && s.channel) {
    if (s.channel.kind === 'bone') bones = [s.channel.track];
    if (s.channel.kind === 'morph') morphs = [s.channel.track];
  }
  return { bones, morphs };
}

async function pickVmd(): Promise<MotionClip | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.vmd';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      try {
        resolve(readVmd(await f.arrayBuffer()));
      } catch (e) {
        toast('error', `Not a VMD: ${(e as Error).message}`);
        resolve(null);
      }
    };
    input.click();
  });
}

export default function ToolsPanel() {
  const [onlySelected, setOnlySelected] = useState(false);
  const [withCamera, setWithCamera] = useState(false);
  const [count, setCount] = useState(30);
  const [factor, setFactor] = useState(1.5);
  const [times, setTimes] = useState(2);
  const [seam, setSeam] = useState(6);
  const [method, setMethod] = useState<SmoothMethod>('gaussian');
  const [strength, setStrength] = useState(2);
  const [posTol, setPosTol] = useState(0.02);
  const [rotTol, setRotTol] = useState(0.5);
  const [off, setOff] = useState({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, scale: 1, falloff: 10 });
  const [retarget, setRetarget] = useState(1);
  const [fade, setFade] = useState(20);
  const [weight, setWeight] = useState(1);
  const [blinkEvery, setBlinkEvery] = useState(90);

  const scope = (): Scope => (onlySelected ? selectedScope() : {});
  const run = (
    label: string,
    fn: (c: MotionClip, r: [number, number]) => MotionClip,
    cameraToo = withCamera,
  ): void => {
    const r = toolRange();
    const ok = commitClips(label, (c) => fn(c, r), cameraToo ? (c) => fn(c, r) : null);
    if (ok) toast('info', label);
  };
  const timeRun = (label: string, fn: (c: MotionClip, r: [number, number]) => MotionClip): void =>
    run(label, fn);

  return (
    <div className="flex flex-col" data-testid="me-tools-panel">
      <Section title="Range & scope">
        <RangeFields />
        <Check label="Only selected tracks" checked={onlySelected} onChange={setOnlySelected} />
        <Check label="Time tools also move the camera" checked={withCamera} onChange={setWithCamera} />
      </Section>

      <Section title="Time">
        <div className="flex flex-wrap gap-1">
          <Btn testid="tool-trim" onClick={() => timeRun('Trim', (c, [a, b]) => trim(c, a, b))}>
            Trim to range
          </Btn>
          <Btn onClick={() => timeRun('Delete time', (c, [a, b]) => deleteTime(c, a, b + 1))}>
            Delete range
          </Btn>
        </div>
        <Row>
          <Num label="Frames" value={count} onChange={setCount} min={1} />
          <Btn onClick={() => timeRun('Insert time', (c, [a]) => insertTime(c, a, Math.round(count)))}>
            Insert at start
          </Btn>
        </Row>
        <Row>
          <Num label="Speed factor (×length)" value={factor} step={0.1} min={0.05} onChange={setFactor} />
          <Btn
            testid="tool-retime"
            onClick={() => timeRun('Retime', (c, [a, b]) => retime(c, a, b, factor, { camera: true }))}
          >
            Retime
          </Btn>
        </Row>
        <Row>
          <Num
            label="Total times"
            value={times}
            min={2}
            onChange={(v) => setTimes(Math.max(2, Math.round(v)))}
          />
          <Num label="Seam blend" value={seam} min={0} onChange={setSeam} />
          <Btn onClick={() => timeRun('Loop', (c, [a, b]) => loop(c, a, b + 1, times, seam))}>Loop</Btn>
        </Row>
      </Section>

      <Section title="Mirror">
        <p className="text-[11px] text-fg-dim">Swaps 左 ↔ 右 (IK included) and flips X within the range.</p>
        <Btn
          testid="tool-mirror"
          onClick={() => run('Mirror', (c, [a, b]) => mirror(c, scope(), a, b), false)}
        >
          Mirror pose
        </Btn>
      </Section>

      <Section title="Smooth · reduce · bake">
        <Row>
          <label className="flex flex-1 flex-col gap-0.5 text-[11px] text-fg-muted">
            Method
            <select
              className="input coarse:h-10"
              value={method}
              onChange={(e) => setMethod(e.target.value as SmoothMethod)}
              aria-label="Smoothing method"
            >
              <option value="gaussian">Gaussian</option>
              <option value="one-euro">One Euro</option>
            </select>
          </label>
          <Num
            label={method === 'gaussian' ? 'Sigma (frames)' : 'Min cutoff (Hz)'}
            value={strength}
            step={0.25}
            min={0.05}
            onChange={setStrength}
          />
        </Row>
        <Btn
          testid="tool-smooth"
          onClick={() => run('Smooth', (c, [a, b]) => smooth(c, a, b, { method, strength }, scope()), false)}
        >
          Smooth
        </Btn>
        <Row>
          <Num label="Pos tol." value={posTol} step={0.01} min={0} onChange={setPosTol} />
          <Num label="Rot tol. °" value={rotTol} step={0.1} min={0} onChange={setRotTol} />
        </Row>
        <div className="flex flex-wrap gap-1">
          <Btn
            onClick={() =>
              run('Reduce keys', (c, [a, b]) => reduce(c, a, b, { pos: posTol, rot: rotTol }, scope()), false)
            }
          >
            Reduce keys
          </Btn>
          <Btn onClick={() => run('Bake every frame', (c, [a, b]) => bake(c, a, b, scope()), false)}>
            Bake every frame
          </Btn>
        </div>
      </Section>

      <Section title="Offset · scale" open={false}>
        <Row>
          <Num label="Pos X" value={off.x} step={0.1} onChange={(x) => setOff({ ...off, x })} />
          <Num label="Pos Y" value={off.y} step={0.1} onChange={(y) => setOff({ ...off, y })} />
          <Num label="Pos Z" value={off.z} step={0.1} onChange={(z) => setOff({ ...off, z })} />
        </Row>
        <Row>
          <Num label="Rot X°" value={off.rx} onChange={(rx) => setOff({ ...off, rx })} />
          <Num label="Rot Y°" value={off.ry} onChange={(ry) => setOff({ ...off, ry })} />
          <Num label="Rot Z°" value={off.rz} onChange={(rz) => setOff({ ...off, rz })} />
        </Row>
        <Row>
          <Num
            label="Amplitude ×"
            value={off.scale}
            step={0.1}
            onChange={(scale) => setOff({ ...off, scale })}
          />
          <Num
            label="Falloff"
            value={off.falloff}
            min={0}
            onChange={(falloff) => setOff({ ...off, falloff })}
          />
        </Row>
        <Btn
          onClick={() =>
            run(
              'Offset / scale',
              (c, [a, b]) =>
                offsetScale(
                  c,
                  a,
                  b,
                  {
                    pos: [off.x, off.y, off.z],
                    rotDeg: [off.rx, off.ry, off.rz],
                    scale: off.scale,
                    falloff: off.falloff,
                  },
                  scope(),
                ),
              false,
            )
          }
        >
          Apply
        </Btn>
        <Row>
          <Num label="Retarget scale" value={retarget} step={0.05} min={0.01} onChange={setRetarget} />
          <Btn onClick={() => run('Retarget scale', (c) => retargetScale(c, retarget, false), false)}>
            Scale moves
          </Btn>
        </Row>
      </Section>

      <Section title="Blend · layer" open={false}>
        <p className="text-[11px] text-fg-dim">
          Pick a second VMD. Crossfade switches to it at the playhead; a layer adds it on top.
        </p>
        <Row>
          <Num label="Crossfade frames" value={fade} min={1} onChange={setFade} />
          <Btn
            onClick={async () => {
              const b = await pickVmd();
              if (b) run('Crossfade VMD', (c) => crossfade(c, b, playhead(), fade), false);
            }}
          >
            Crossfade…
          </Btn>
        </Row>
        <Row>
          <Num label="Layer weight" value={weight} step={0.1} onChange={setWeight} />
          <Btn
            onClick={async () => {
              const l = await pickVmd();
              if (l) run('Additive layer', (c) => additive(c, l, weight, playhead()), false);
            }}
          >
            Add layer…
          </Btn>
        </Row>
      </Section>

      <Section title="Face" open={false}>
        <div className="flex flex-wrap gap-1">
          <Btn onClick={() => run('Blink', (c) => blink(c, playhead()), false)}>Blink at playhead</Btn>
          {VOWELS.map((v) => (
            <Btn
              key={v}
              onClick={() => run(`Mouth ${v}`, (c) => vowel(c, playhead(), v), false)}
              title={`Mouth shape ${v}`}
            >
              {v}
            </Btn>
          ))}
        </div>
        <Row>
          <Num label="Blink every (frames)" value={blinkEvery} min={20} onChange={setBlinkEvery} />
          <Btn
            testid="tool-autoblink"
            onClick={() =>
              run(
                'Auto-blink',
                (c, [a, b]) => autoBlink(c, a, b, { interval: blinkEvery, seed: a + 1 }),
                false,
              )
            }
          >
            Auto-blink
          </Btn>
        </Row>
        <Btn onClick={() => run('Talking mouth', (c, [a, b]) => lipPattern(c, a, b), false)}>
          Talking mouth in range
        </Btn>
        <p className="text-[11px] text-fg-dim">Uses the standard morphs {BLINK_MORPH} and あいうえお.</p>
      </Section>
    </div>
  );
}
