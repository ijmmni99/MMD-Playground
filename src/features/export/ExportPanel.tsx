import { Camera, Circle, Square } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Button, NumberField, Row, Section, Select, ToggleRow } from '@/components/ui/controls';
import type { RecordProgress } from '@/engine/StudioEngine';
import { saveOrShare } from '@/features/app/filePickers';
import { engineOrNull } from '@/store/engineRef';
import { toast, useStudio } from '@/store/studio';
import { formatTimecode } from '@/lib/timeline';
import { hasVideoEncoder, resolutionFor, supportedFormats, type ResolutionId } from './formats';

export function ExportPanel() {
  return (
    <div>
      <ScreenshotSection />
      <VideoSection />
    </div>
  );
}

const RES_OPTIONS: { value: ResolutionId; label: string }[] = [
  { value: '720p', label: '1280 × 720 (HD)' },
  { value: '1080p', label: '1920 × 1080 (Full HD)' },
  { value: '1440p', label: '2560 × 1440 (QHD)' },
  { value: '4k', label: '3840 × 2160 (4K)' },
  { value: 'vertical', label: '1080 × 1920 (vertical)' },
  { value: 'square', label: '1080 × 1080 (square)' },
  { value: 'viewport', label: 'Viewport size' },
  { value: 'custom', label: 'Custom…' },
];

function ResolutionPicker({
  value,
  onChange,
  custom,
  setCustom,
  max,
}: {
  value: ResolutionId;
  onChange: (v: ResolutionId) => void;
  custom: [number, number];
  setCustom: (v: [number, number]) => void;
  max: number;
}) {
  return (
    <>
      <Select<ResolutionId> label="Resolution" value={value} onChange={onChange} options={RES_OPTIONS} />
      {value === 'custom' && (
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1 py-1">
          <NumberField
            label="Width"
            value={custom[0]}
            precision={0}
            step={16}
            onChange={(w) => setCustom([Math.min(max, Math.max(16, Math.round(w))), custom[1]])}
          />
          <span className="text-fg-dim">×</span>
          <NumberField
            label="Height"
            value={custom[1]}
            precision={0}
            step={16}
            onChange={(h) => setCustom([custom[0], Math.min(max, Math.max(16, Math.round(h)))])}
          />
        </div>
      )}
    </>
  );
}

function ScreenshotSection() {
  const [res, setRes] = useState<ResolutionId>('1080p');
  const [custom, setCustom] = useState<[number, number]>([2048, 2048]);
  const [transparent, setTransparent] = useState(false);
  const [busy, setBusy] = useState(false);
  const ready = useStudio((s) => s.engineReady);
  return (
    <Section title="Screenshot (PNG)">
      <ResolutionPicker value={res} onChange={setRes} custom={custom} setCustom={setCustom} max={4096} />
      <ToggleRow label="Transparent background" checked={transparent} onChange={setTransparent} />
      <Button
        variant="primary"
        className="mt-2 w-full"
        disabled={!ready || busy}
        data-testid="screenshot-button"
        onClick={async () => {
          const engine = engineOrNull();
          if (!engine) return;
          setBusy(true);
          try {
            const [w, h] = resolutionFor(res, custom);
            const blob = await engine.screenshot({ width: w, height: h, transparent });
            await saveOrShare(blob, `mmd-studio-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
            toast('success', `Saved ${w}×${h} screenshot`);
          } catch (e) {
            toast('error', `Screenshot failed: ${e instanceof Error ? e.message : String(e)}`);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Camera size={14} /> Take screenshot
      </Button>
    </Section>
  );
}

function VideoSection() {
  const playback = useStudio((s) => s.playback);
  const hasAudio = useStudio((s) => s.audio !== null);
  const formats = useMemo(supportedFormats, []);
  const [res, setRes] = useState<ResolutionId>('1080p');
  const [custom, setCustom] = useState<[number, number]>([1920, 1080]);
  const [fps, setFps] = useState(30);
  const [formatId, setFormatId] = useState(formats[0]?.id ?? '');
  const [range, setRange] = useState<'all' | 'custom'>('all');
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(300);
  const [audio, setAudio] = useState(true);
  const [quality, setQuality] = useState<'standard' | 'high'>('high');
  const [progress, setProgress] = useState<RecordProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const format = formats.find((f) => f.id === formatId) ?? formats[0];
  const duration = Math.round(playback.duration);

  const record = async (): Promise<void> => {
    const engine = engineOrNull();
    if (!engine || !format) return;
    if (duration <= 0) {
      toast('warning', 'Nothing to record yet — load a motion, camera motion or audio first.');
      return;
    }
    const [w, h] = resolutionFor(res, custom);
    const startFrame = range === 'all' ? 0 : Math.max(0, Math.min(start, duration));
    const endFrame = range === 'all' ? duration : Math.max(startFrame + 1, Math.min(end, duration));
    const pixels = w * h;
    const bitrate = Math.round(pixels * fps * (quality === 'high' ? 0.2 : 0.1));
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setProgress({ phase: 'recording', progress: 0, frame: startFrame });
    try {
      const blob = await engine.record(
        {
          width: w,
          height: h,
          fps,
          mimeType: format.mimeType,
          deterministic: format.deterministic,
          startFrame,
          endFrame,
          includeAudio: audio && hasAudio,
          bitrate,
        },
        setProgress,
        ctrl.signal,
      );
      await saveOrShare(blob, `mmd-studio-${Date.now()}.${format.ext}`);
      toast('success', `Video saved (${(blob.size / 1024 / 1024).toFixed(1)} MB)`);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') toast('info', 'Recording cancelled');
      else toast('error', `Recording failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  };

  return (
    <Section title="Video">
      {!hasVideoEncoder(formats) && (
        <p
          className="mb-2 rounded-md border border-warn/40 bg-warn/10 p-2 text-[12px] leading-relaxed text-warn"
          role="status"
        >
          This browser can’t encode video (no MediaRecorder/WebCodecs support — common on older iOS Safari).
          You can still export every frame as PNGs in a ZIP and combine them on a computer.
        </p>
      )}
      <ResolutionPicker value={res} onChange={setRes} custom={custom} setCustom={setCustom} max={3840} />
      <Select
        label="Frame rate"
        value={String(fps)}
        onChange={(v) => setFps(Number(v))}
        options={['24', '30', '60'].map((v) => ({ value: v, label: `${v} fps` }))}
      />
      <Select
        label="Format"
        value={format?.id ?? ''}
        onChange={setFormatId}
        options={formats.map((f) => ({ value: f.id, label: f.label }))}
      />
      {format && <p className="mb-1 text-[11px] leading-relaxed text-fg-dim">{format.description}</p>}
      <Select
        label="Quality"
        value={quality}
        onChange={setQuality}
        options={[
          { value: 'standard', label: 'Standard' },
          { value: 'high', label: 'High' },
        ]}
      />
      <Select
        label="Range"
        value={range}
        onChange={setRange}
        options={[
          { value: 'all', label: `Whole timeline (${formatTimecode(duration)})` },
          { value: 'custom', label: 'Custom frames' },
        ]}
      />
      {range === 'custom' && (
        <div className="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-1 py-1 text-[11px] text-fg-dim">
          from
          <NumberField
            label="Start frame"
            value={start}
            precision={0}
            step={1}
            onChange={(v) => setStart(Math.max(0, Math.round(v)))}
          />
          to
          <NumberField
            label="End frame"
            value={end}
            precision={0}
            step={1}
            onChange={(v) => setEnd(Math.max(1, Math.round(v)))}
          />
        </div>
      )}
      <ToggleRow label="Include audio" checked={audio && hasAudio} disabled={!hasAudio} onChange={setAudio} />
      {progress ? (
        <div className="mt-2 rounded-md border border-line p-2" aria-live="polite">
          <div className="mb-1 flex justify-between text-[12px]">
            <span className="capitalize">{progress.phase}…</span>
            <span className="font-mono">{Math.round(progress.progress * 100)}%</span>
          </div>
          <div
            className="mb-2 h-1.5 overflow-hidden rounded bg-bg-hover"
            role="progressbar"
            aria-valuenow={Math.round(progress.progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full bg-danger transition-[width]"
              style={{ width: `${progress.progress * 100}%` }}
            />
          </div>
          <Button variant="danger" size="sm" className="w-full" onClick={() => abortRef.current?.abort()}>
            <Square size={11} /> Cancel
          </Button>
        </div>
      ) : (
        <Button
          variant="primary"
          className="mt-2 w-full"
          onClick={() => void record()}
          data-testid="record-button"
        >
          <Circle size={12} className="fill-danger text-danger" /> Record video
        </Button>
      )}
      <Row label="Tip">
        <span className="max-w-[170px] text-right text-[11px] text-fg-dim">
          Frame-stepped modes never drop frames, even on slow GPUs.
        </span>
      </Row>
    </Section>
  );
}
