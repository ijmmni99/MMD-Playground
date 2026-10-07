import {
  AlertTriangle,
  Check,
  Download,
  FileJson,
  FileVideo,
  Info,
  Music,
  Pause,
  Play,
  RotateCcw,
  Square,
  Upload,
} from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Button, Section, Select, SliderRow, ToggleRow } from '@/components/ui/controls';
import { cn } from '@/components/ui/cn';
import { formatTime } from '@/engine/video2vmd/convert';
import { PRESETS, type PresetId } from '@/engine/video2vmd/types';
import { pickFiles } from '@/features/app/filePickers';
import { setAudioOffset } from '@/store/actions';
import { useStudio } from '@/store/studio';
import { useV2V, V2V_STEPS, v2v, type V2VStep } from '@/store/video2vmd';
import {
  LONG_VIDEO_SECONDS,
  applyPreset,
  applyToModel,
  cancelDetection,
  downloadPoseJson,
  downloadVmd,
  extractAudio,
  importPoseJson,
  importVideo,
  setStep,
  setTargetModel,
  setTrim,
  startDetection,
  updateSettings,
} from './actions';
import { QualityReportView } from './QualityReportView';
import { stageVideo } from './stage';
import { VideoStage } from './VideoStage';

const VIDEO_ACCEPT = 'video/*,.mp4,.m4v,.mov,.webm,.mkv';

function pickVideo(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = VIDEO_ACCEPT;
  input.style.display = 'none';
  input.dataset.testid = 'v2v-file-input';
  document.body.appendChild(input);
  input.onchange = () => {
    const f = input.files?.[0];
    if (f) void importVideo(f, f.name);
    input.remove();
  };
  input.click();
}

function reachable(step: V2VStep): boolean {
  const s = v2v.get();
  switch (step) {
    case 'import':
      return true;
    case 'detect':
      return !!s.video;
    default:
      return !!s.pose;
  }
}

function Stepper() {
  const step = useV2V((s) => s.step);
  // Re-render when reachability changes.
  useV2V((s) => s.video);
  useV2V((s) => s.pose);
  const current = V2V_STEPS.findIndex((s) => s.id === step);
  return (
    <ol
      className="flex gap-1 overflow-x-auto px-3 py-2"
      aria-label="Conversion steps"
      data-testid="v2v-stepper"
    >
      {V2V_STEPS.map((s, i) => {
        const ok = reachable(s.id);
        return (
          <li key={s.id} className="shrink-0">
            <button
              type="button"
              disabled={!ok}
              aria-current={s.id === step ? 'step' : undefined}
              onClick={() => setStep(s.id)}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] coarse:h-10',
                s.id === step
                  ? 'border-accent bg-accent-soft text-fg'
                  : i < current
                    ? 'border-line text-fg-muted hover:text-fg'
                    : 'border-line text-fg-dim',
                !ok && 'opacity-40',
              )}
            >
              <span
                className={cn(
                  'grid h-4 w-4 place-items-center rounded-full text-[10px]',
                  i < current ? 'bg-accent text-white' : 'bg-bg-hover',
                )}
              >
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

function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn'; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex gap-2 rounded-md border px-2.5 py-2 text-[12px] leading-relaxed',
        tone === 'warn' ? 'border-warn/40 bg-warn/10 text-fg' : 'border-line bg-bg-raised text-fg-muted',
      )}
    >
      {tone === 'warn' ? (
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" />
      ) : (
        <Info size={14} className="mt-0.5 shrink-0 text-accent" />
      )}
      <div>{children}</div>
    </div>
  );
}

function Limitations() {
  return (
    <Notice>
      Works best with <b className="text-fg">one dancer, full body in frame</b>, a mostly static camera
      (tripod), plain background and good lighting. Fingers are not tracked, and depth (toward / away from the
      camera) is estimated, so forward-back moves are approximate. Everything runs on your device; you are
      responsible for the rights to the videos and music you use.
    </Notice>
  );
}

function ImportStep() {
  const video = useV2V((s) => s.video);
  const trim = useV2V((s) => s.trim);
  const crop = useV2V((s) => s.crop);
  const downscale = useV2V((s) => s.downscale);
  const [drag, setDrag] = useState(false);
  if (!video) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <div
          className={cn(
            'flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center',
            drag ? 'border-accent bg-accent/10' : 'border-line',
          )}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDrag(false);
            const f = e.dataTransfer.files[0];
            if (f) void importVideo(f, f.name);
          }}
        >
          <FileVideo size={28} className="text-accent" />
          <div className="text-[14px] font-medium">Choose a dance video</div>
          <div className="text-[12px] text-fg-muted">MP4, WebM or MOV · drop it here or pick a file</div>
          <Button variant="primary" onClick={pickVideo} data-testid="v2v-choose-video">
            <Upload size={14} /> Choose video
          </Button>
        </div>
        <Button
          variant="ghost"
          onClick={async () => {
            const [f] = await pickFiles('any');
            if (f) await importPoseJson(f.blob);
          }}
        >
          <FileJson size={14} /> Load saved pose JSON instead
        </Button>
        <Limitations />
      </div>
    );
  }
  const { info } = video;
  const long = trim[1] - trim[0] > LONG_VIDEO_SECONDS;
  const big = Math.max(info.width, info.height) > 1920;
  const set = (i: 0 | 1, v: number): void => setTrim(i === 0 ? [v, trim[1]] : [trim[0], v]);
  return (
    <div className="flex flex-col gap-3 p-3">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]" data-testid="v2v-info">
        <dt className="text-fg-muted">File</dt>
        <dd className="truncate" title={info.name}>
          {info.name}
        </dd>
        <dt className="text-fg-muted">Duration</dt>
        <dd>{info.duration.toFixed(2)} s</dd>
        <dt className="text-fg-muted">Resolution</dt>
        <dd>
          {info.width}×{info.height}
        </dd>
        <dt className="text-fg-muted">Frame rate</dt>
        <dd>{info.fps ? `${info.fps.toFixed(2)} fps` : 'unknown'}</dd>
        <dt className="text-fg-muted">Audio</dt>
        <dd>{info.hasAudio ? 'yes' : 'no'}</dd>
      </dl>
      {long && (
        <Notice tone="warn">
          The selected range is over {LONG_VIDEO_SECONDS / 60} minutes. It will take a while; consider
          trimming to the part you need.
        </Notice>
      )}
      {big && (
        <Notice tone="warn">
          This video is larger than 1080p. Downscaling speeds up analysis without hurting accuracy.
        </Notice>
      )}
      <ToggleRow
        label="Downscale for analysis (720p)"
        checked={downscale}
        onChange={(v) => v2v.set({ downscale: v })}
      />
      <div className="flex flex-col gap-2">
        <div className="text-[12px] font-medium">Trim</div>
        {(['Start', 'End'] as const).map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <span className="w-10 text-[12px] text-fg-muted">{label}</span>
            <input
              type="range"
              aria-label={`Trim ${label.toLowerCase()}`}
              className="min-w-0 flex-1 accent-[#6d8bff]"
              min={0}
              max={info.duration}
              step={0.01}
              value={trim[i]}
              onChange={(e) => {
                const v = Number(e.target.value);
                set(i as 0 | 1, v);
                if (stageVideo.current) stageVideo.current.currentTime = v;
              }}
            />
            <span className="w-12 text-right font-mono text-[11px]">{trim[i].toFixed(1)}s</span>
            <Button
              size="sm"
              variant="ghost"
              title={`Set ${label.toLowerCase()} to the current video time`}
              onClick={() => stageVideo.current && set(i as 0 | 1, stageVideo.current.currentTime)}
            >
              Here
            </Button>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 text-[12px]">
        <span className="text-fg-muted">
          Crop:{' '}
          {crop ? `${Math.round(crop.w * 100)}% × ${Math.round(crop.h * 100)}% of the frame` : 'whole frame'}
        </span>
        {crop && (
          <Button size="sm" variant="ghost" onClick={() => v2v.set({ crop: null })}>
            <RotateCcw size={12} /> Reset crop
          </Button>
        )}
      </div>
      <div className="flex gap-2">
        <Button
          variant="primary"
          className="flex-1"
          onClick={() => void startDetection()}
          data-testid="v2v-detect"
        >
          Detect poses
        </Button>
        <Button variant="ghost" onClick={pickVideo}>
          Change video
        </Button>
      </div>
      <Limitations />
    </div>
  );
}

function DetectStep() {
  const d = useV2V((s) => s.detect);
  const pose = useV2V((s) => s.pose);
  const pct = d.total ? Math.min(100, (d.done / d.total) * 100) : 0;
  const running = d.status === 'running' || d.status === 'loading';
  return (
    <div className="flex flex-col gap-3 p-3" data-testid="v2v-detect-step">
      <div className="text-[12px] text-fg-muted" aria-live="polite">
        {d.message || 'Ready to analyse the video.'}
      </div>
      {d.backend && <div className="text-[11px] text-fg-dim">Backend: {d.backend}</div>}
      <div
        className="h-2 overflow-hidden rounded bg-bg-hover"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Detection progress"
      >
        <div
          className={cn(
            'h-full bg-accent transition-[width]',
            d.status === 'loading' && !d.done && 'w-1/4 animate-pulse',
          )}
          style={d.done ? { width: `${pct}%` } : undefined}
        />
      </div>
      <div className="flex justify-between text-[11px] text-fg-muted">
        <span data-testid="v2v-frames">
          {d.done} / {d.total || '…'} frames
        </span>
        {running && d.rate > 0 && (
          <span>
            {d.rate.toFixed(1)} fps · ETA {formatTime(d.eta)}
          </span>
        )}
      </div>
      {d.error && <Notice tone="warn">{d.error}</Notice>}
      <div className="flex flex-wrap gap-2">
        {running ? (
          <Button variant="danger" onClick={cancelDetection} data-testid="v2v-cancel">
            <Square size={12} /> Cancel
          </Button>
        ) : (
          <>
            {d.status === 'cancelled' && (
              <Button variant="primary" onClick={() => void startDetection()}>
                <Play size={12} /> Resume
              </Button>
            )}
            <Button
              variant={d.status === 'done' ? 'default' : 'primary'}
              onClick={() => {
                if (d.status === 'cancelled') v2v.set({ pose: null });
                void startDetection();
              }}
            >
              <RotateCcw size={12} /> {d.status === 'idle' ? 'Start' : 'Restart'}
            </Button>
            {pose && (
              <Button variant="primary" onClick={() => setStep('clean')} data-testid="v2v-continue">
                Continue
              </Button>
            )}
          </>
        )}
      </div>
      {running && (
        <Notice>
          Analysis runs in the background and keeps the app responsive. The first run downloads the pose model
          (about 30 MB); it is cached for next time.
        </Notice>
      )}
    </div>
  );
}

function PresetButtons() {
  const preset = useV2V((s) => s.settings.preset);
  return (
    <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Presets">
      {(Object.keys(PRESETS) as PresetId[]).map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={preset === id}
          title={PRESETS[id].description}
          onClick={() => applyPreset(id)}
          className={cn(
            'rounded-md border px-2 py-1.5 text-left text-[12px] coarse:min-h-[44px]',
            preset === id ? 'border-accent bg-accent-soft' : 'border-line hover:bg-bg-hover',
          )}
        >
          <div className="font-medium">{PRESETS[id].label}</div>
          <div className="truncate text-[10px] text-fg-dim">{PRESETS[id].description}</div>
        </button>
      ))}
    </div>
  );
}

function CleanStep() {
  const s = useV2V((st) => st.settings);
  const result = useV2V((st) => st.result);
  return (
    <div className="flex flex-col gap-1">
      <div className="p-3 pb-1">
        <PresetButtons />
      </div>
      {result && (
        <div className="grid grid-cols-3 gap-2 px-3 py-2 text-center text-[11px]">
          <Stat label="Jitter (raw)" value={result.report.jitterRaw.toFixed(1)} />
          <Stat label="Jitter (clean)" value={result.report.jitterClean.toFixed(1)} />
          <Stat label="Repaired frames" value={String(result.report.outlierFrames)} />
        </div>
      )}
      <Section title="Advanced: smoothing" defaultOpen={false}>
        <SliderRow
          label="Min cutoff (Hz)"
          value={s.minCutoff}
          min={0.1}
          max={5}
          step={0.05}
          onChange={(v) => updateSettings({ minCutoff: v })}
        />
        <SliderRow
          label="Beta (speed response)"
          value={s.beta}
          min={0}
          max={3}
          step={0.01}
          onChange={(v) => updateSettings({ beta: v })}
        />
        <SliderRow
          label="Visibility threshold"
          value={s.visibilityThreshold}
          min={0}
          max={0.9}
          step={0.01}
          onChange={(v) => updateSettings({ visibilityThreshold: v })}
        />
        <SliderRow
          label="Outlier threshold"
          value={s.outlierThreshold}
          min={0.1}
          max={1}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => updateSettings({ outlierThreshold: v })}
        />
        <ToggleRow
          label="Mirror (selfie video)"
          checked={s.mirror}
          onChange={(v) => updateSettings({ mirror: v }, 0)}
        />
      </Section>
      <div className="p-3">
        <Button variant="primary" className="w-full" onClick={() => setStep('retarget')}>
          Continue
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-bg-raised px-1 py-1.5">
      <div className="text-[14px] font-semibold text-fg">{value}</div>
      <div className="text-fg-dim">{label}</div>
    </div>
  );
}

function RetargetStep() {
  const s = useV2V((st) => st.settings);
  const target = useV2V((st) => st.targetModelId);
  const result = useV2V((st) => st.result);
  const error = useV2V((st) => st.convertError);
  const allModels = useStudio((st) => st.models);
  const models = allModels.filter((m) => !m.stage);
  const selected = useStudio((st) => st.selectedModelId);
  const auto = models.find((m) => m.id === selected) ?? models[0];
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-col gap-2 p-3">
        <Select
          label="Target skeleton"
          value={target ?? 'auto'}
          onChange={(v) => setTargetModel(v === 'auto' ? null : v)}
          options={[
            { value: 'auto', label: auto ? `Selected model (${auto.name})` : 'Standard MMD skeleton' },
            ...models.map((m) => ({ value: m.id, label: m.name })),
          ]}
        />
        <ToggleRow
          label="Foot IK (pin planted feet)"
          checked={s.footIk}
          onChange={(v) => updateSettings({ footIk: v }, 0)}
        />
        <ToggleRow
          label="Drive legs & センター"
          checked={s.lowerBody}
          onChange={(v) => updateSettings({ lowerBody: v }, 0)}
        />
        <ToggleRow
          label="Mirror (selfie video)"
          checked={s.mirror}
          onChange={(v) => updateSettings({ mirror: v }, 0)}
        />
      </div>
      <Section title="Advanced: retargeting" defaultOpen={false}>
        <SliderRow
          label="Scale"
          value={s.scale}
          min={0.5}
          max={2}
          step={0.01}
          format={(v) => `${v.toFixed(2)}×`}
          onChange={(v) => updateSettings({ scale: v })}
        />
        <SliderRow
          label="Root motion"
          value={s.rootStrength}
          min={0}
          max={2}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => updateSettings({ rootStrength: v })}
        />
        <SliderRow
          label="Depth motion"
          value={s.rootDepthStrength}
          min={0}
          max={2}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => updateSettings({ rootDepthStrength: v })}
        />
        <SliderRow
          label="Contact height"
          value={s.contactHeight}
          min={0.02}
          max={0.25}
          step={0.005}
          format={(v) => `${Math.round(v * 100)}% leg`}
          onChange={(v) => updateSettings({ contactHeight: v })}
        />
        <SliderRow
          label="Contact speed"
          value={s.contactSpeed}
          min={0.2}
          max={3}
          step={0.05}
          format={(v) => `${v.toFixed(2)} legs/s`}
          onChange={(v) => updateSettings({ contactSpeed: v })}
        />
      </Section>
      {error && (
        <div className="px-3">
          <Notice tone="warn">{error}</Notice>
        </div>
      )}
      {result && <QualityReportView report={result.report} skeletonName={result.skeletonName} />}
      <div className="p-3">
        <Button variant="primary" className="w-full" onClick={() => setStep('preview')}>
          Continue
        </Button>
      </div>
    </div>
  );
}

function PreviewStep() {
  const result = useV2V((st) => st.result);
  const applied = useV2V((st) => st.appliedTo);
  const video = useV2V((st) => st.video);
  const models = useStudio((st) => st.models);
  const playing = useStudio((st) => st.playback.playing);
  const audio = useStudio((st) => st.audio);
  const offset = useStudio((st) => st.audioOffsetMs);
  const appliedName = models.find((m) => m.id === applied)?.name;
  const hasModel = models.some((m) => !m.stage);
  return (
    <div className="flex flex-col gap-3 p-3">
      {!hasModel && (
        <Notice tone="warn">
          Load a model first (Models → Add model, or try the built-in sample) to preview the motion on it.
        </Notice>
      )}
      <Button
        variant="primary"
        disabled={!result || !hasModel}
        onClick={() => void applyToModel()}
        data-testid="v2v-apply"
      >
        <Play size={14} /> {applied ? 'Re-apply to model' : 'Apply to model'}
      </Button>
      {appliedName && (
        <div
          className="flex items-center justify-between gap-2 text-[12px] text-fg-muted"
          data-testid="v2v-applied"
        >
          <span>
            Playing on <b className="text-fg">{appliedName}</b>. The video follows the studio playhead.
          </span>
          <Button
            size="sm"
            onClick={() => {
              void import('@/store/engineRef').then(({ engineOrNull }) => {
                const e = engineOrNull();
                if (!e) return;
                if (e.getPlayback().playing) e.pause();
                else e.play();
              });
            }}
          >
            {playing ? <Pause size={12} /> : <Play size={12} />}
          </Button>
        </div>
      )}
      {video?.info.hasAudio && (
        <div className="flex flex-col gap-2 rounded-md border border-line p-2">
          <Button onClick={() => void extractAudio()} data-testid="v2v-audio">
            <Music size={14} />{' '}
            {audio ? 'Replace studio audio with the video’s audio' : 'Use the video’s audio'}
          </Button>
          {audio && (
            <SliderRow
              label="Audio offset"
              value={offset}
              min={-1000}
              max={1000}
              step={10}
              format={(v) => `${v > 0 ? '+' : ''}${v} ms`}
              onChange={(v) => setAudioOffset(v)}
            />
          )}
        </div>
      )}
      <Button variant="ghost" onClick={() => setStep('export')}>
        Continue to export
      </Button>
    </div>
  );
}

function ExportStep() {
  const result = useV2V((st) => st.result);
  const tol = useV2V((st) => st.settings.reduceTolerance);
  const pose = useV2V((st) => st.pose);
  const jsonInput = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-3 p-3">
      <SliderRow
        label="Keyframe reduction"
        value={tol}
        min={0}
        max={3}
        step={0.05}
        format={(v) => (v === 0 ? 'off' : `${v.toFixed(2)}°`)}
        onChange={(v) => updateSettings({ reduceTolerance: v }, 200)}
      />
      {result && (
        <div className="text-[12px] text-fg-muted" data-testid="v2v-keys">
          {result.report.keysOriginal.toLocaleString()} keys →{' '}
          <b className="text-fg">{result.report.keysReduced.toLocaleString()}</b> after reduction (
          {Math.round((1 - result.report.keysReduced / Math.max(1, result.report.keysOriginal)) * 100)}%
          fewer) · {(result.vmd.byteLength / 1024).toFixed(0)} KB
        </div>
      )}
      <Button
        variant="primary"
        disabled={!result}
        onClick={() => void downloadVmd()}
        data-testid="v2v-download"
      >
        <Download size={14} /> Download .vmd
      </Button>
      <Button disabled={!pose} onClick={downloadPoseJson} data-testid="v2v-pose-json">
        <FileJson size={14} /> Download pose data (JSON)
      </Button>
      <Button variant="ghost" onClick={() => jsonInput.current?.click()}>
        <Upload size={14} /> Load pose JSON
      </Button>
      <input
        ref={jsonInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importPoseJson(f);
          e.target.value = '';
        }}
      />
      <Notice>
        The .vmd is a standard bone motion (Shift-JIS bone names, 30 fps) and loads in MikuMikuDance and other
        MMD tools. Pose JSON keeps the raw landmarks so you can re-run retargeting without analysing the video
        again.
      </Notice>
    </div>
  );
}

/** Video → VMD converter: stepper + video stage + per-step controls. */
export default function Video2VmdPanel() {
  const step = useV2V((s) => s.step);
  const video = useV2V((s) => s.video);
  const converting = useV2V((s) => s.converting);
  return (
    <div
      className="flex h-full flex-col overflow-hidden bg-bg-panel"
      aria-label="Video to VMD"
      data-testid="v2v-panel"
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3">
        <span className="panel-title">Video to VMD</span>
        {converting && <span className="text-[11px] text-fg-dim">Updating…</span>}
      </div>
      <Stepper />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {video && (
          <div className="px-3 pb-1">
            <VideoStage />
          </div>
        )}
        {step === 'import' && <ImportStep />}
        {step === 'detect' && <DetectStep />}
        {step === 'clean' && <CleanStep />}
        {step === 'retarget' && <RetargetStep />}
        {step === 'preview' && <PreviewStep />}
        {step === 'export' && <ExportStep />}
      </div>
    </div>
  );
}
