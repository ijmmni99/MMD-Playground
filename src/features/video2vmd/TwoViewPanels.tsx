import { AlertTriangle, ChevronLeft, ChevronRight, RotateCcw, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, SliderRow, ToggleRow } from '@/components/ui/controls';
import { cn } from '@/components/ui/cn';
import { isCoarsePointer, isLowMemoryDevice } from '@/lib/device';
import { useV2V, v2v } from '@/store/video2vmd';
import {
  CAPTURE_PRESETS,
  applyCapturePreset,
  capturePresetOf,
  pickVideoFor,
  nudgeOffset,
  setAB,
  setCrop,
  setFeature,
  setManualOffset,
  setTrim,
  setTwoView,
  type CapturePreset,
} from './actions';
import { stageVideo, stageVideoSide } from './stage';
import { VideoStage } from './VideoStage';

const NO_FEATURES = { twoView: false, face: false, fingers: false };
/** Capture presets + feature checkboxes (Import step). */
export function FeaturePicker() {
  const f = useV2V((s) => s.settings.features) ?? NO_FEATURES;
  const preset = capturePresetOf(f);
  const constrained = isCoarsePointer() || isLowMemoryDevice();
  const items: { key: keyof typeof f; label: string; hint: string }[] = [
    {
      key: 'twoView',
      label: 'Two-view (high accuracy)',
      hint: 'Add a side video: much better arm / leg depth. Twice the analysis time.',
    },
    { key: 'face', label: 'Face', hint: 'Blinks, mouth, expressions and eye direction. About +40% time.' },
    { key: 'fingers', label: 'Fingers', hint: 'Open, close and point the fingers. About +60% time.' },
  ];
  return (
    <div className="flex flex-col gap-2" data-testid="v2v-features">
      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Capture presets">
        {(Object.keys(CAPTURE_PRESETS) as CapturePreset[]).map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={preset === id}
            title={CAPTURE_PRESETS[id].description}
            data-testid={`v2v-capture-${id}`}
            onClick={() => applyCapturePreset(id)}
            className={cn(
              'rounded-md border px-2 py-1.5 text-left text-[12px] coarse:min-h-[44px]',
              preset === id ? 'border-accent bg-accent-soft' : 'border-line hover:bg-bg-hover',
            )}
          >
            <div className="font-medium">{CAPTURE_PRESETS[id].label}</div>
            <div className="line-clamp-2 text-[10px] leading-tight text-fg-dim">
              {CAPTURE_PRESETS[id].description}
            </div>
          </button>
        ))}
      </div>
      {items.map((it) => (
        <label key={it.key} className="flex cursor-pointer items-start gap-2 text-[12px] coarse:min-h-[44px]">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-[#6d8bff]"
            checked={f[it.key]}
            data-testid={`v2v-feature-${it.key}`}
            onChange={(e) => setFeature(it.key, e.target.checked)}
          />
          <span>
            <span className="font-medium">{it.label}</span>
            <span className="block text-[11px] text-fg-dim">{it.hint}</span>
          </span>
        </label>
      ))}
      {constrained && (f.twoView || (f.face && f.fingers)) && (
        <div className="flex gap-2 rounded-md border border-warn/40 bg-warn/10 px-2.5 py-2 text-[12px]">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" />
          <span>
            On this device two-view and the Full preset need a lot of memory and time; analysis is capped at
            720p. Trim the videos to the part you need.
          </span>
        </div>
      )}
    </div>
  );
}

/** Side video slot: pick, info, trim, crop, relative angle. */
export function SideSlot() {
  const side = useV2V((s) => s.side);
  const trim = useV2V((s) => s.sideTrim);
  const crop = useV2V((s) => s.sideCrop);
  const angle = useV2V((s) => s.twoView.angleDeg);
  if (!side) {
    return (
      <div
        className="flex flex-col gap-2 rounded-md border border-dashed border-line p-3 text-center"
        data-testid="v2v-side-slot"
      >
        <div className="text-[13px] font-medium">Side video</div>
        <div className="text-[11px] text-fg-muted">Same performance filmed from the side (about 90°).</div>
        <Button variant="primary" onClick={() => pickVideoFor('side')} data-testid="v2v-choose-side">
          <Upload size={14} /> Choose side video
        </Button>
      </div>
    );
  }
  const set = (i: 0 | 1, v: number): void => setTrim(i === 0 ? [v, trim[1]] : [trim[0], v], 'side');
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line p-2.5" data-testid="v2v-side-slot">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold">Side video</span>
        <Button size="sm" variant="ghost" onClick={() => pickVideoFor('side')}>
          Change
        </Button>
      </div>
      <VideoStage view="side" />
      <div className="text-[11px] text-fg-muted" data-testid="v2v-side-info">
        {side.info.name} · {side.info.width}×{side.info.height} ·{' '}
        {side.info.fps ? `${side.info.fps.toFixed(2)} fps` : 'fps ?'} · {side.info.duration.toFixed(2)} s ·{' '}
        {side.info.hasAudio ? 'audio' : 'no audio'}
      </div>
      {(['Start', 'End'] as const).map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <span className="w-10 text-[12px] text-fg-muted">{label}</span>
          <input
            type="range"
            aria-label={`Side trim ${label.toLowerCase()}`}
            className="min-w-0 flex-1 accent-[#6d8bff]"
            min={0}
            max={side.info.duration}
            step={0.01}
            value={trim[i]}
            onChange={(e) => {
              const v = Number(e.target.value);
              set(i as 0 | 1, v);
              if (stageVideoSide.current) stageVideoSide.current.currentTime = v;
            }}
          />
          <span className="w-12 text-right font-mono text-[11px]">{trim[i].toFixed(1)}s</span>
        </div>
      ))}
      {crop && (
        <Button size="sm" variant="ghost" onClick={() => setCrop(null, 'side')}>
          <RotateCcw size={12} /> Reset side crop
        </Button>
      )}
      <SliderRow
        label="Angle between cameras"
        value={angle}
        min={30}
        max={150}
        step={1}
        format={(v) => `${Math.round(v)}°`}
        onChange={(v) => setTwoView({ angleDeg: v })}
      />
    </div>
  );
}

/** Sync & calibration review (Clean step, two-view). */
export function SyncPanel() {
  const sync = useV2V((s) => s.sync);
  const auto = useV2V((s) => s.autoSync);
  const cal = useV2V((s) => s.calibration);
  const tv = useV2V((s) => s.twoView);
  const side = useV2V((s) => s.side);
  const pose = useV2V((s) => s.pose);
  const sidePose = useV2V((s) => s.sidePose);
  const [scrub, setScrub] = useState(0);
  const start = pose?.frames[0]?.time ?? 0;
  const end = pose?.frames[pose.frames.length - 1]?.time ?? 1;
  useEffect(() => {
    const t = start + scrub;
    if (stageVideo.current) stageVideo.current.currentTime = t;
    if (stageVideoSide.current) stageVideoSide.current.currentTime = Math.max(0, t + (sync?.offset ?? 0));
  }, [scrub, sync?.offset, start]);
  if (!sidePose || !side) {
    return (
      <div className="mx-3 rounded-md border border-line p-2.5 text-[12px] text-fg-muted">
        Two-view is on: add a side video at Import and run detection to sync and fuse both views.
      </div>
    );
  }
  const fps = side.info.fps || 30;
  return (
    <div
      className="mx-3 flex flex-col gap-2 rounded-md border border-line bg-bg-raised p-2.5"
      data-testid="v2v-sync"
    >
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold">Sync & calibration</span>
        {cal && (
          <span
            className={cn('text-[11px]', cal.confidence > 0.5 ? 'text-ok' : 'text-warn')}
            data-testid="v2v-calibration"
          >
            {Math.round(cal.yawDeg)}° · {Math.round(cal.confidence * 100)}% confident
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <VideoStage view="front" compact />
        <VideoStage view="side" compact />
      </div>
      <input
        type="range"
        aria-label="Scrub both videos"
        className="w-full accent-[#6d8bff]"
        min={0}
        max={Math.max(0.1, end - start)}
        step={0.01}
        value={scrub}
        onChange={(e) => setScrub(Number(e.target.value))}
      />
      <div className="text-[12px]" data-testid="v2v-offset">
        Offset <b>{sync ? `${sync.offset >= 0 ? '+' : ''}${Math.round(sync.offset * 1000)} ms` : '—'}</b>
        <span className="text-fg-muted">
          {' '}
          (
          {sync?.method === 'manual'
            ? 'manual'
            : `${sync?.method ?? 'auto'}, ${Math.round((sync?.confidence ?? 0) * 100)}% confident`}
          )
        </span>
        {auto && (
          <div className="text-[11px] text-fg-dim">
            Audio:{' '}
            {auto.audio
              ? `${Math.round(auto.audio.offset * 1000)} ms (${Math.round(auto.audio.confidence * 100)}%)`
              : 'n/a'}{' '}
            · Motion:{' '}
            {auto.motion
              ? `${Math.round(auto.motion.offset * 1000)} ms (${Math.round(auto.motion.confidence * 100)}%)`
              : 'n/a'}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          onClick={() => nudgeOffset(-1)}
          aria-label="One frame earlier"
          title="One frame earlier"
        >
          <ChevronLeft size={12} />
        </Button>
        <input
          type="range"
          aria-label="Sync offset"
          className="min-w-0 flex-1 accent-[#6d8bff]"
          min={-10}
          max={10}
          step={1 / fps}
          value={sync?.offset ?? 0}
          onChange={(e) => setManualOffset(Number(e.target.value))}
        />
        <Button size="sm" onClick={() => nudgeOffset(1)} aria-label="One frame later" title="One frame later">
          <ChevronRight size={12} />
        </Button>
        {tv.manualOffset !== null && (
          <Button size="sm" variant="ghost" onClick={() => setManualOffset(null)}>
            Auto
          </Button>
        )}
      </div>
      <SliderRow
        label="Angle (your estimate)"
        value={tv.angleDeg}
        min={30}
        max={150}
        step={1}
        format={(v) => `${Math.round(v)}°`}
        onChange={(v) => setTwoView({ angleDeg: v })}
      />
      <SliderRow
        label="Camera field of view"
        value={tv.fovDeg}
        min={30}
        max={110}
        step={1}
        format={(v) => `${Math.round(v)}°`}
        onChange={(v) => setTwoView({ fovDeg: v })}
      />
      <ToggleRow
        label="Triangulate where it fits better"
        checked={tv.triangulate}
        onChange={(v) => setTwoView({ triangulate: v })}
      />
      {cal?.warnings.map((w) => (
        <div key={w} className="flex gap-1.5 text-[11px] leading-snug">
          <AlertTriangle size={12} className="mt-0.5 shrink-0 text-warn" />
          {w}
        </div>
      ))}
    </div>
  );
}

/** A/B: preview / export the two-view or the single-view result, with their scores. */
export function ABToggle() {
  const ab = useV2V((s) => s.ab);
  const reports = useV2V((s) => s.abReports);
  if (!reports) return null;
  const row = (id: 'two' | 'single', label: string) => {
    const r = reports[id];
    return (
      <button
        type="button"
        role="radio"
        aria-checked={ab === id}
        data-testid={`v2v-ab-${id}`}
        onClick={() => setAB(id)}
        className={cn(
          'flex-1 rounded-md border px-2 py-1.5 text-left text-[12px] coarse:min-h-[44px]',
          ab === id ? 'border-accent bg-accent-soft' : 'border-line hover:bg-bg-hover',
        )}
      >
        <div className="font-medium">{label}</div>
        <div className="text-[10px] text-fg-dim">
          Foot skate {r.footSkateAfter.toFixed(2)} · jitter {r.jitterClean.toFixed(1)}
        </div>
      </button>
    );
  };
  return (
    <div className="flex gap-1.5" role="radiogroup" aria-label="Compare results" data-testid="v2v-ab">
      {row('two', 'Two-view')}
      {row('single', 'Single-view')}
    </div>
  );
}

/** Overlay toggles for the source previews. */
export function OverlayToggles() {
  const o = useV2V((s) => s.overlays);
  const f = useV2V((s) => s.settings.features) ?? NO_FEATURES;
  const items: { key: keyof typeof o; label: string; show: boolean }[] = [
    { key: 'body', label: 'Body', show: true },
    { key: 'face', label: 'Face', show: f.face },
    { key: 'hands', label: 'Hands', show: f.fingers },
    { key: 'crops', label: 'Crops', show: f.face || f.fingers },
  ];
  const shown = items.filter((i) => i.show);
  if (shown.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 px-3 pb-1 text-[11px]" aria-label="Overlays">
      <span className="text-fg-dim">Show:</span>
      {shown.map((i) => (
        <button
          key={i.key}
          type="button"
          aria-pressed={o[i.key]}
          onClick={() => v2v.set({ overlays: { ...o, [i.key]: !o[i.key] } })}
          className={cn(
            'rounded-full border px-2 py-0.5 coarse:py-1.5',
            o[i.key] ? 'border-accent bg-accent-soft text-fg' : 'border-line text-fg-muted',
          )}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}
