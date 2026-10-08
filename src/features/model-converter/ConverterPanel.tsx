import { AlertTriangle, Box, Check, Download, Info, Play, Shuffle, Upload, X } from 'lucide-react';
import { type ReactNode } from 'react';
import { Button, Row, SliderRow, ToggleRow } from '@/components/ui/controls';
import { cn } from '@/components/ui/cn';
import { REQUIRED } from '@/lib/convert/humanoid';
import { MMD_MORPHS } from '@/lib/convert/morphs';
import type { ChainPreset } from '@/lib/convert/physics';
import { collectFromDataTransfer } from '@/lib/ingest';
import { lookupDictionary } from '@/lib/names/dictionary';
import { togglePlay } from '@/store/actions';
import { cv, STEPS, useConverter, type ConverterStep } from '@/store/converter';
import { useStudio } from '@/store/studio';
import {
  cancelConversion,
  downloadZip,
  importConverterFiles,
  licenseLines,
  loadIntoStudio,
  loadSample,
  pickConverterFiles,
  playMotionFile,
  playTestDance,
  setOptions,
  showOriginal,
} from './actions';
import { MappingDialog } from './MappingDialog';
import { SLOT_LABEL } from './slots';

function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn'; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex gap-2 rounded-md border px-2.5 py-2 text-[12px] leading-relaxed',
        tone === 'warn' ? 'border-warn/40 bg-warn/10 text-fg' : 'border-line bg-bg-raised text-fg-muted',
      )}
    >
      {tone === 'warn' ? <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" /> : <Info size={14} className="mt-0.5 shrink-0 text-accent" />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Stepper() {
  const step = useConverter((s) => s.step);
  const ready = useConverter((s) => !!s.result);
  const current = STEPS.findIndex((s) => s.id === step);
  return (
    <ol className="flex flex-wrap gap-1 px-3 py-2" aria-label="Converter steps" data-testid="cv-stepper">
      {STEPS.map((s, i) => {
        const ok = s.id === 'import' || ready;
        return (
          <li key={s.id} className="shrink-0">
            <button
              type="button"
              disabled={!ok}
              aria-current={s.id === step ? 'step' : undefined}
              data-testid={`cv-step-${s.id}`}
              onClick={() => cv.set({ step: s.id })}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] coarse:h-10',
                s.id === step ? 'border-accent bg-accent-soft text-fg' : i < current ? 'border-line text-fg-muted hover:text-fg' : 'border-line text-fg-dim',
                !ok && 'opacity-40',
              )}
            >
              <span className={cn('grid h-4 w-4 place-items-center rounded-full text-[10px]', i < current ? 'bg-accent text-white' : 'bg-bg-hover')}>
                {i < current ? <Check size={10} /> : i + 1}
              </span>
              {s.label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function Progress() {
  const p = useConverter((s) => s.progress);
  const status = useConverter((s) => s.status);
  if (!p || (status !== 'parsing' && status !== 'converting')) return null;
  return (
    <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[12px]" role="status" data-testid="cv-progress">
      <div className="min-w-0 flex-1">
        <div className="mb-1 truncate text-fg-muted">{p.stage}…</div>
        <div className="h-1.5 overflow-hidden rounded bg-bg-hover">
          <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(p.value * 100)}%` }} />
        </div>
      </div>
      <Button size="sm" variant="ghost" onClick={cancelConversion} aria-label="Cancel conversion">
        <X size={14} /> Cancel
      </Button>
    </div>
  );
}

const next = (step: ConverterStep): void => {
  const i = STEPS.findIndex((s) => s.id === step);
  cv.set({ step: STEPS[Math.min(STEPS.length - 1, i + 1)].id });
};

function NextButton({ step, label = 'Next' }: { step: ConverterStep; label?: string }) {
  return (
    <div className="flex justify-end pt-2">
      <Button variant="primary" onClick={() => next(step)} data-testid={`cv-next-${step}`}>
        {label}
      </Button>
    </div>
  );
}

function fmtBytes(n: number): string {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`;
}

function ImportStep() {
  const summary = useConverter((s) => s.summary);
  const status = useConverter((s) => s.status);
  const error = useConverter((s) => s.error);
  return (
    <div className="flex flex-col gap-2 px-3 pb-3">
      <div
        className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line px-3 py-5 text-center text-[12px] text-fg-muted"
        data-testid="cv-dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void collectFromDataTransfer(e.dataTransfer).then(importConverterFiles);
        }}
      >
        <Box size={22} className="text-accent" />
        <div>
          Drop an <b className="text-fg">FBX, VRM, glTF or GLB</b> model — or a <b className="text-fg">ZIP</b> with the model and its textures (best on phones).
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="primary" onClick={() => void pickConverterFiles()} data-testid="cv-pick">
            <Upload size={14} /> Choose files…
          </Button>
          <Button onClick={() => void loadSample()} data-testid="cv-sample">
            Try the test humanoid
          </Button>
        </div>
      </div>
      {error && <Notice tone="warn">{error}</Notice>}
      {summary && (
        <div className="rounded-md border border-line bg-bg-raised p-2 text-[12px]" data-testid="cv-summary">
          <div className="font-medium">{summary.name}</div>
          <div className="text-fg-muted">
            {summary.file} · {summary.format.toUpperCase()} · {summary.bones.length} bones · {summary.vertices.toLocaleString()} vertices ·{' '}
            {summary.materials} materials · {summary.textures.length} textures · {fmtBytes(summary.bytes)}
          </div>
          {summary.warnings.slice(0, 4).map((w) => (
            <div key={w} className="mt-1 text-warn">
              {w}
            </div>
          ))}
        </div>
      )}
      {summary && status === 'ready' && <NextButton step="import" />}
      <Notice>
        Everything runs on this device. You are responsible for following the license of the model you convert — it is shown before export and copied into the result.
      </Notice>
    </div>
  );
}

function CheckStep() {
  const r = useConverter((s) => s.result);
  const summary = useConverter((s) => s.summary);
  if (!r || !summary) return null;
  return (
    <div className="flex flex-col gap-2 px-3 pb-3">
      {r.humanoid ? (
        r.weak.length ? (
          <Notice tone="warn">
            Some body bones were guessed ({r.weak.map((s) => SLOT_LABEL[s] ?? s).join(', ')}). Check them in the mapping screen.
          </Notice>
        ) : (
          <Notice>Humanoid rig recognised — every body bone is mapped. Dances will drive it with working foot IK.</Notice>
        )
      ) : (
        <Notice tone="warn">
          This doesn’t look like a humanoid (animal, robot or creature?). It converts as a static or partially rigged model and won’t follow MMD dances. If it is a person, map the bones by hand.
        </Notice>
      )}
      <Button onClick={() => cv.set({ mappingOpen: true })} data-testid="cv-open-mapping">
        <Shuffle size={14} /> Review bone mapping
      </Button>
      <div className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5 text-[12px]" data-testid="cv-mapping-summary">
        {REQUIRED.map((slot) => {
          const m = r.map[slot];
          const conf = m?.confidence ?? 0;
          return (
            <div key={slot} className="contents">
              <span className="truncate text-fg-muted">
                {SLOT_LABEL[slot]} → <span className="text-fg">{m ? summary.bones[m.bone]?.name : '—'}</span>
              </span>
              <span className={cn('font-mono text-[11px]', conf >= 0.8 ? 'text-ok' : conf >= 0.5 ? 'text-warn' : 'text-danger')}>
                {m ? `${Math.round(conf * 100)}%` : 'missing'}
              </span>
            </div>
          );
        })}
      </div>
      <div className="text-[11px] text-fg-dim">
        Kept as extra bones: {r.report.unmappedBones.length ? r.report.unmappedBones.slice(0, 12).join(', ') : 'none'}
        {r.report.unmappedBones.length > 12 ? '…' : ''}
      </div>
      <NextButton step="check" />
    </div>
  );
}

function PoseStep() {
  const r = useConverter((s) => s.result);
  const o = useConverter((s) => s.options);
  if (!r) return null;
  const rig = { twist: true, legD: false, shoulderP: false, waist: false, ...o.rig };
  return (
    <div className="flex flex-col gap-1 px-3 pb-3">
      <Notice>
        Rest pose: <b className="text-fg">{r.report.restPose}</b>
        {r.report.armAngle !== null ? ` (arms ${r.report.armAngle.toFixed(0)}° below horizontal)` : ''}. MMD motions expect an A-pose; the arms are rotated and the mesh re-skinned so it still deforms cleanly.
      </Notice>
      <ToggleRow label="Convert arms to the MMD A-pose" checked={o.aPose ?? true} onChange={(v) => setOptions({ aPose: v })} />
      <SliderRow label="A-pose arm angle" value={o.armAngle ?? 35} min={25} max={45} step={1} format={(v) => `${v}°`} onChange={(v) => setOptions({ armAngle: v })} disabled={o.aPose === false} />
      <SliderRow label="Height (MMD units)" value={o.height ?? 20} min={10} max={30} step={0.5} format={(v) => `${v} ≈ ${(v * 0.08).toFixed(2)} m`} onChange={(v) => setOptions({ height: v })} />
      <ToggleRow label="Twist bones (腕捩 / 手捩)" checked={rig.twist} onChange={(v) => setOptions({ rig: { ...rig, twist: v } })} />
      <ToggleRow label="Leg D bones (足D / ひざD / 足首D)" checked={rig.legD} onChange={(v) => setOptions({ rig: { ...rig, legD: v } })} />
      <ToggleRow label="Shoulder P bones (肩P)" checked={rig.shoulderP} onChange={(v) => setOptions({ rig: { ...rig, shoulderP: v } })} />
      <ToggleRow label="Waist bone (腰)" checked={rig.waist} onChange={(v) => setOptions({ rig: { ...rig, waist: v } })} />
      <ToggleRow label="Static model (no dance rig)" checked={!!o.forceStatic} onChange={(v) => setOptions({ forceStatic: v })} />
      <Row label="Texture size">
        <select
          aria-label="Texture size"
          value={String(o.maxTexture ?? 0)}
          onChange={(e) => setOptions({ maxTexture: Number(e.target.value) })}
          className="h-7 rounded-md border border-line bg-bg px-1 text-[12px] coarse:h-10"
        >
          <option value="0">Keep original</option>
          <option value="4096">Max 4096 px</option>
          <option value="2048">Max 2048 px</option>
          <option value="1024">Max 1024 px</option>
        </select>
      </Row>
      <NextButton step="pose" />
    </div>
  );
}

const TARGETS = Object.keys(MMD_MORPHS);
const EMPTY: Record<string, { target?: string; enabled?: boolean }> = {};

function FaceStep() {
  const r = useConverter((s) => s.result);
  const edits = useConverter((s) => s.options.morphEdits) ?? EMPTY;
  if (!r) return null;
  const set = (key: string, patch: { target?: string; enabled?: boolean }): void =>
    setOptions({ morphEdits: { ...edits, [key]: { ...edits[key], ...patch } } });
  const mapped = r.morphEntries.filter((e) => e.via !== 'kept');
  return (
    <div className="flex flex-col gap-2 px-3 pb-3">
      <Notice>
        Face morphs drive blink and talk clips. {mapped.length ? `${mapped.length} matched to MMD names.` : 'None matched automatically — pick targets below.'} Unmatched morphs are kept under “Other” with their original names.
      </Notice>
      <div className="flex flex-col gap-1" data-testid="cv-morphs">
        {r.morphEntries.map((e) => {
          const key = e.sources[0]?.key ?? e.target;
          const sourceName = e.sources.map((s) => r.morphNames[s.key] ?? s.key).join(' + ');
          const isKept = e.via === 'kept';
          return (
            <div key={key} className="flex items-center gap-2 text-[12px]">
              <input type="checkbox" aria-label={`Use ${sourceName}`} checked={e.enabled} onChange={(ev) => set(key, { enabled: ev.target.checked })} className="h-4 w-4 coarse:h-6 coarse:w-6" />
              <span className="min-w-0 flex-1 truncate" title={sourceName}>
                {sourceName}
              </span>
              <select
                aria-label={`MMD morph for ${sourceName}`}
                value={isKept ? '' : e.target}
                onChange={(ev) => set(key, { target: ev.target.value || (r.morphNames[key] ?? key) })}
                className="h-7 max-w-[150px] rounded-md border border-line bg-bg px-1 text-[12px] coarse:h-10"
              >
                <option value="">Keep name</option>
                {TARGETS.map((t) => (
                  <option key={t} value={t}>
                    {t} · {lookupDictionary('morph', t)?.en ?? t}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
        {!r.morphEntries.length && <div className="text-[12px] text-fg-dim">This model has no morph targets.</div>}
      </div>
      <NextButton step="face" />
    </div>
  );
}

function PhysicsStep() {
  const r = useConverter((s) => s.result);
  const o = useConverter((s) => s.options);
  if (!r) return null;
  const physics = { enabled: true, sway: 0.5, colliders: true, ...o.physics };
  const edits = o.chainEdits ?? {};
  const setChain = (id: string, patch: { enabled?: boolean; preset?: ChainPreset }): void =>
    setOptions({ chainEdits: { ...edits, [id]: { ...edits[id], ...patch } } });
  return (
    <div className="flex flex-col gap-1 px-3 pb-3">
      <Notice>
        {r.chains.length
          ? `${r.chains.length} swinging part(s) found (${[...new Set(r.chains.map((c) => c.kind))].join(', ')}). They get rigid bodies and spring joints; legs and body get colliders so skirts don’t pass through.`
          : 'No hair, skirt or tail bones found — nothing will sway.'}
      </Notice>
      <ToggleRow label="Physics" checked={physics.enabled} onChange={(v) => setOptions({ physics: { ...physics, enabled: v } })} />
      <SliderRow label="Less sway ↔ more sway" value={physics.sway} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setOptions({ physics: { ...physics, sway: v } })} />
      <ToggleRow label="Body colliders (head, body, arms, legs)" checked={physics.colliders} onChange={(v) => setOptions({ physics: { ...physics, colliders: v } })} />
      <div className="mt-1 flex flex-col gap-1" data-testid="cv-chains">
        {r.chains.map((c) => (
          <div key={c.id} className="flex items-center gap-2 text-[12px]">
            <input type="checkbox" aria-label={`Physics for ${c.name}`} checked={c.enabled} onChange={(e) => setChain(c.id, { enabled: e.target.checked })} className="h-4 w-4 coarse:h-6 coarse:w-6" />
            <span className="min-w-0 flex-1 truncate">
              {c.name} <span className="text-fg-dim">· {c.kind} · {c.bones.length} bones{c.source === 'vrm' ? ' · VRM spring' : ''}</span>
            </span>
            <select
              aria-label={`Preset for ${c.name}`}
              value={c.preset}
              onChange={(e) => setChain(c.id, { preset: e.target.value as ChainPreset })}
              className="h-7 rounded-md border border-line bg-bg px-1 text-[12px] coarse:h-10"
            >
              <option value="soft">Soft</option>
              <option value="skirt">Skirt</option>
              <option value="stiff">Stiff</option>
            </select>
          </div>
        ))}
      </div>
      <NextButton step="physics" />
    </div>
  );
}

function PreviewStep() {
  const r = useConverter((s) => s.result);
  const previewId = useConverter((s) => s.previewModelId);
  const original = useConverter((s) => s.showOriginal);
  const playing = useStudio((s) => s.playback.playing);
  if (!r) return null;
  const o = r.report.output;
  return (
    <div className="flex flex-col gap-2 px-3 pb-3">
      <Notice>The converted model is in the viewport. Play the built-in test dance (stepping, arm waves, blinking, talking) or any VMD.</Notice>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={playTestDance} disabled={!previewId} data-testid="cv-test-dance">
          <Play size={14} /> Test dance
        </Button>
        <Button onClick={() => void playMotionFile()} disabled={!previewId}>
          Play a VMD…
        </Button>
        <Button onClick={togglePlay} disabled={!previewId}>
          {playing ? 'Pause' : 'Play'}
        </Button>
      </div>
      <ToggleRow label="Show the original next to it" checked={original} onChange={(v) => void showOriginal(v)} />
      <div className="grid grid-cols-2 gap-x-3 text-[12px] text-fg-muted" data-testid="cv-stats">
        <span>Bones: {o.bones}</span>
        <span>Vertices: {o.vertices.toLocaleString()}</span>
        <span>Materials: {o.materials}</span>
        <span>Morphs: {o.morphs}</span>
        <span>Rigid bodies: {o.rigidBodies}</span>
        <span>Joints: {o.joints}</span>
      </div>
      <NextButton step="preview" />
    </div>
  );
}

function ExportStep() {
  const r = useConverter((s) => s.result);
  const summary = useConverter((s) => s.summary);
  const ack = useConverter((s) => s.licenseAck);
  if (!r || !summary) return null;
  const lic = licenseLines(summary.license);
  return (
    <div className="flex flex-col gap-2 px-3 pb-3">
      <div className="rounded-md border border-line bg-bg-raised p-2 text-[12px]" data-testid="cv-license">
        <div className="mb-1 font-medium">Model license</div>
        {lic.length ? (
          lic.map((l) => (
            <div key={l} className="break-words text-fg-muted">
              {l}
            </div>
          ))
        ) : (
          <div className="text-fg-muted">
            No license information in the file{summary.format === 'fbx' ? ' (FBX files carry none — e.g. Mixamo characters follow Adobe’s terms)' : ''}. Check the terms where you got it.
          </div>
        )}
      </div>
      <label className="flex items-start gap-2 text-[12px] coarse:min-h-[44px]">
        <input type="checkbox" checked={ack} onChange={(e) => cv.set({ licenseAck: e.target.checked })} className="mt-0.5 h-4 w-4 coarse:h-6 coarse:w-6" data-testid="cv-license-ack" />
        I have the right to use and convert this model under its license. The license text is copied into the output README.
      </label>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => void loadIntoStudio()} disabled={!ack} data-testid="cv-load">
          <Box size={14} /> Load into studio
        </Button>
        <Button onClick={() => void downloadZip()} disabled={!ack} data-testid="cv-download">
          <Download size={14} /> Download PMX ZIP
        </Button>
      </div>
      <Report />
    </div>
  );
}

function Report() {
  const r = useConverter((s) => s.result);
  if (!r) return null;
  const { fixes, warnings, tips } = r.report;
  return (
    <div className="flex flex-col gap-1 text-[12px]" data-testid="cv-report">
      <div className="font-medium">Conversion report</div>
      {fixes.map((f) => (
        <div key={f} className="flex gap-1 text-fg-muted">
          <Check size={13} className="mt-0.5 shrink-0 text-ok" /> {f}
        </div>
      ))}
      {warnings.map((w) => (
        <div key={w} className="flex gap-1">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" /> {w}
        </div>
      ))}
      {tips.map((t) => (
        <div key={t} className="flex gap-1 text-fg-muted">
          <Info size={13} className="mt-0.5 shrink-0 text-accent" /> {t}
        </div>
      ))}
    </div>
  );
}

export default function ConverterPanel({ embedded = false }: { embedded?: boolean }) {
  const step = useConverter((s) => s.step);
  const status = useConverter((s) => s.status);
  const mappingOpen = useConverter((s) => s.mappingOpen);
  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg-panel" aria-label="Model converter" data-testid="cv-panel">
      {!embedded && (
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3">
          <span className="panel-title">Model Converter</span>
          {status === 'converting' && <span className="text-[11px] text-fg-dim">Updating…</span>}
        </div>
      )}
      <Stepper />
      <Progress />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {step === 'import' && <ImportStep />}
        {step === 'check' && <CheckStep />}
        {step === 'pose' && <PoseStep />}
        {step === 'face' && <FaceStep />}
        {step === 'physics' && <PhysicsStep />}
        {step === 'preview' && <PreviewStep />}
        {step === 'export' && <ExportStep />}
      </div>
      {mappingOpen && <MappingDialog />}
    </div>
  );
}

