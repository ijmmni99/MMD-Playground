import { useMemo, useState } from 'react';
import { useNameText } from '@/features/names/text';
import { ArrowDown, ArrowUp, Combine, Scissors, Trash2 } from 'lucide-react';
import { validateCamera, type CameraPreset } from '@/lib/motion/camera';
import { useMotionEditor, me } from '@/store/motionEditor';
import { studio, useStudio } from '@/store/studio';
import { updateSettings } from '@/store/actions';
import {
  addShot,
  applyPreset,
  applyShake,
  captureView,
  clampAll,
  lookAtBone,
  mergeShot,
  moveShot,
  removeShot,
  setLens,
  shotsFromMarkers,
  splitShotAt,
  updateShot,
  viewThroughCamera,
  writeCuts,
} from './directorActions';
import './cameraOverlay';
import { Btn, Check, Num, RangeFields, Row, Section } from './panelUi';
import { playhead, toolRange } from './view';

const PRESETS: { id: CameraPreset; label: string }[] = [
  { id: 'orbit', label: 'Orbit' },
  { id: 'dolly-in', label: 'Dolly in' },
  { id: 'crane-up', label: 'Crane up' },
  { id: 'front-side-cut', label: 'Front → side cut' },
  { id: 'face-close-up', label: 'Face close-up' },
];

export default function DirectorPanel() {
  const camera = useMotionEditor((s) => s.camera);
  const shots = useMotionEditor((s) => s.shots);
  const pip = useMotionEditor((s) => s.pip);
  const path = useMotionEditor((s) => s.cameraPath);
  const bpm = useMotionEditor((s) => s.grid.bpm);
  const modelId = useMotionEditor((s) => s.modelId);
  const nameText = useNameText(modelId);
  const dof = useStudio((s) => s.settings.postfx.dof);
  const [bone, setBone] = useState('頭');
  const [step, setStep] = useState(2);
  const [preset, setPreset] = useState<CameraPreset>('orbit');
  const [distance, setDistance] = useState(35);
  const [fov, setFov] = useState(30);
  const [shake, setShake] = useState({ amp: 0.6, freq: 0.8, seed: 1 });
  const issues = useMemo(() => (camera ? validateCamera(camera.camera) : []), [camera]);
  const bones = useMemo(() => {
    const m = studio.get().models.find((x) => x.id === modelId);
    return m ? m.info.bones.map((b) => b.name) : [];
  }, [modelId]);
  const keys = camera?.camera.length ?? 0;

  return (
    <div className="flex flex-col" data-testid="me-director-panel">
      <Section title="Camera">
        <p className="text-[11px] text-fg-muted" data-testid="director-keys">
          {keys} camera keys{shots.length ? ` · ${shots.length} shots` : ''}
        </p>
        <div className="flex flex-wrap gap-1">
          <Btn
            primary
            testid="director-capture"
            onClick={() => void captureView()}
            title="Key the camera at the playhead from the viewport view"
          >
            Key from view
          </Btn>
          <Btn
            onClick={viewThroughCamera}
            disabled={!keys}
            title="Move the viewport to the camera's view at the playhead"
          >
            View through camera
          </Btn>
        </div>
        <Check label="Picture-in-picture preview" checked={pip} onChange={(v) => me.set({ pip: v })} />
        <Check
          label="Show 3D path, keys, frustum (drag a selected key)"
          checked={path}
          onChange={(v) => me.set({ cameraPath: v })}
        />
      </Section>

      <Section title="Range">
        <RangeFields />
      </Section>

      <Section title="Shots">
        <div className="flex flex-wrap gap-1">
          <Btn
            testid="shot-add"
            onClick={() => {
              const [a, b] = toolRange();
              addShot(a, b);
            }}
          >
            Shot from range
          </Btn>
          <Btn onClick={shotsFromMarkers}>Shots from markers</Btn>
          <Btn testid="shot-split" onClick={() => splitShotAt(playhead())}>
            <Scissors size={13} className="mr-1 inline" />
            Split at playhead
          </Btn>
          <Btn onClick={writeCuts} disabled={!shots.length}>
            Write cuts
          </Btn>
        </div>
        <ol className="flex flex-col gap-1" data-testid="shot-list">
          {shots.map((s, i) => (
            <li
              key={s.id}
              className="flex items-center gap-1 rounded border border-line px-1.5 py-1 text-[11px]"
            >
              <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: s.color }} />
              <input
                aria-label="Shot name"
                className="input h-6 w-16 min-w-0 px-1 text-[11px]"
                defaultValue={s.name}
                onBlur={(e) => e.target.value !== s.name && updateShot(s.id, { name: e.target.value })}
              />
              <span className="flex-1 truncate font-mono text-fg-muted">
                {s.start}–{s.end}
              </span>
              <select
                aria-label="Transition"
                className="input h-6 px-1 text-[11px]"
                value={s.transition}
                onChange={(e) => updateShot(s.id, { transition: e.target.value as 'cut' | 'blend' })}
              >
                <option value="cut">cut</option>
                <option value="blend">blend</option>
              </select>
              <button
                type="button"
                className="p-0.5 text-fg-muted hover:text-fg disabled:opacity-30"
                title="Earlier"
                disabled={i === 0}
                onClick={() => moveShot(s.id, i - 1)}
              >
                <ArrowUp size={12} />
              </button>
              <button
                type="button"
                className="p-0.5 text-fg-muted hover:text-fg disabled:opacity-30"
                title="Later"
                disabled={i === shots.length - 1}
                onClick={() => moveShot(s.id, i + 1)}
              >
                <ArrowDown size={12} />
              </button>
              <button
                type="button"
                className="p-0.5 text-fg-muted hover:text-fg disabled:opacity-30"
                title="Merge with next"
                disabled={i === shots.length - 1}
                onClick={() => mergeShot(s.id)}
              >
                <Combine size={12} />
              </button>
              <button
                type="button"
                className="p-0.5 text-fg-muted hover:text-fg"
                title="Delete shot (and its keys)"
                onClick={() => removeShot(s.id)}
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Auto camera">
        <Row>
          <label className="flex flex-1 flex-col gap-0.5 text-[11px] text-fg-muted">
            Preset
            <select
              className="input coarse:h-10"
              aria-label="Camera preset"
              value={preset}
              onChange={(e) => setPreset(e.target.value as CameraPreset)}
            >
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <Num label="Distance" value={distance} min={1} onChange={setDistance} />
          <Num label="FOV°" value={fov} min={1} max={125} onChange={setFov} />
        </Row>
        <Btn
          testid="director-preset"
          onClick={() => {
            const [a, b] = toolRange();
            void applyPreset(preset, a, b, { distance, fov });
          }}
        >
          Generate on range
        </Btn>
        <p className="text-[11px] text-fg-dim">
          {bpm > 0
            ? `Keys snap to the ${bpm} BPM grid; cuts land on bar lines.`
            : 'Set a BPM (Markers & BPM) to snap keys to beats.'}
        </p>
      </Section>

      <Section title="Look-at" open={false}>
        <Row>
          <label className="flex flex-1 flex-col gap-0.5 text-[11px] text-fg-muted">
            Bone
            <select
              className="input coarse:h-10"
              aria-label="Look-at bone"
              value={bone}
              onChange={(e) => setBone(e.target.value)}
            >
              {(bones.length ? bones : ['頭']).map((b) => (
                <option key={b} value={b}>
                  {nameText('bone', b)}
                </option>
              ))}
            </select>
          </label>
          <Num
            label="Every n frames"
            value={step}
            min={2}
            onChange={(v) => setStep(Math.max(2, Math.round(v)))}
          />
        </Row>
        <Btn
          testid="director-lookat"
          onClick={() => {
            const [a, b] = toolRange();
            void lookAtBone(bone, a, b, step);
          }}
        >
          Bake look-at
        </Btn>
        <p className="text-[11px] text-fg-dim">
          Keeps the camera path, rebakes rotation so the bone stays centred.
        </p>
      </Section>

      <Section title="Lens · shake" open={false}>
        <Row>
          <Num label="FOV°" value={fov} min={1} max={125} onChange={setFov} />
          <Btn onClick={() => setLens({ fov })}>Set FOV</Btn>
          <Num label="Distance" value={distance} onChange={setDistance} />
          <Btn onClick={() => setLens({ d: -Math.abs(distance) })}>Set</Btn>
        </Row>
        <Check
          label="Depth of field preview"
          checked={dof}
          onChange={(v) => updateSettings((d) => void (d.postfx.dof = v))}
        />
        <Row>
          <Num
            label="Shake °"
            value={shake.amp}
            step={0.1}
            min={0}
            onChange={(amp) => setShake({ ...shake, amp })}
          />
          <Num
            label="Freq Hz"
            value={shake.freq}
            step={0.1}
            min={0.05}
            onChange={(freq) => setShake({ ...shake, freq })}
          />
          <Num
            label="Seed"
            value={shake.seed}
            onChange={(seed) => setShake({ ...shake, seed: Math.round(seed) })}
          />
        </Row>
        <Btn
          onClick={() => {
            const [a, b] = toolRange();
            applyShake(a, b, shake.amp, shake.freq, shake.seed);
          }}
          disabled={!keys}
        >
          Add handheld shake
        </Btn>
      </Section>

      <Section title={`Checks${issues.length ? ` (${issues.length})` : ''}`} open={issues.length > 0}>
        {issues.length ? (
          <>
            <ul className="max-h-28 overflow-y-auto text-[11px] text-warn" data-testid="director-issues">
              {issues.slice(0, 50).map((x, i) => (
                <li key={i}>
                  {x.f}: {x.message}
                </li>
              ))}
            </ul>
            <Btn onClick={clampAll}>Clamp to valid ranges</Btn>
          </>
        ) : (
          <p className="text-[11px] text-fg-dim">FOV and distance are within MMD's ranges.</p>
        )}
      </Section>
    </div>
  );
}
