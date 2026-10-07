import { Pause, Play, StepBack, StepForward } from 'lucide-react';
import { useCallback, useRef } from 'react';
import { cn } from '@/components/ui/cn';
import type { PlaybackState } from '@/engine/types';
import { usePlaybackClock } from '@/hooks/usePlaybackClock';
import { haptic } from '@/lib/haptics';
import { formatTimecode, snapFrame } from '@/lib/timeline';
import { togglePlay } from '@/store/actions';
import { engineOrNull } from '@/store/engineRef';
import { useStudio } from '@/store/studio';

/**
 * Always-visible phone transport: play/pause, frame step, scrub bar and time. The bar and clock
 * are updated through refs every animation frame so playback doesn't re-render React.
 */
export function CompactTransport({ overlay = false }: { overlay?: boolean }) {
  const playing = useStudio((s) => s.playback.playing);
  const duration = useStudio((s) => s.playback.duration);
  const fillRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);

  const paint = useCallback((pb: PlaybackState) => {
    const p = pb.duration > 0 ? Math.min(1, pb.frame / pb.duration) : 0;
    if (fillRef.current) fillRef.current.style.transform = `scaleX(${p})`;
    if (knobRef.current) knobRef.current.style.left = `${p * 100}%`;
    if (timeRef.current)
      timeRef.current.textContent = `${formatTimecode(pb.frame)} / ${formatTimecode(pb.duration)}`;
    barRef.current?.setAttribute('aria-valuenow', String(Math.round(pb.frame)));
  }, []);
  usePlaybackClock(paint);

  const seekFromX = (clientX: number): void => {
    const bar = barRef.current;
    const engine = engineOrNull();
    if (!bar || !engine) return;
    const r = bar.getBoundingClientRect();
    const pb = engine.getPlayback();
    const f = snapFrame(((clientX - r.left) / r.width) * pb.duration, pb.duration);
    engine.seek(f);
    paint({ ...pb, frame: f });
  };

  return (
    <div
      className={cn(
        'flex h-14 shrink-0 items-center gap-1 px-2',
        overlay
          ? 'rounded-xl border border-line bg-bg-panel/90 backdrop-blur'
          : 'border-t border-line bg-bg-panel',
      )}
      role="toolbar"
      aria-label="Playback"
      data-testid="compact-transport"
    >
      <button
        type="button"
        aria-label="Previous frame"
        className="grid h-11 w-11 place-items-center rounded-lg text-fg-muted active:bg-bg-hover"
        onClick={() => engineOrNull()?.stepFrames(-1)}
      >
        <StepBack size={18} />
      </button>
      <button
        type="button"
        aria-label={playing ? 'Pause' : 'Play'}
        data-testid="play-toggle"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent-strong text-white active:scale-95"
        onClick={() => {
          haptic();
          togglePlay();
        }}
      >
        {playing ? <Pause size={20} /> : <Play size={20} className="translate-x-[1px]" />}
      </button>
      <button
        type="button"
        aria-label="Next frame"
        className="grid h-11 w-11 place-items-center rounded-lg text-fg-muted active:bg-bg-hover"
        onClick={() => engineOrNull()?.stepFrames(1)}
      >
        <StepForward size={18} />
      </button>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 px-1">
        <div
          ref={barRef}
          role="slider"
          tabIndex={0}
          aria-label="Playback position (frames)"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={0}
          className="relative h-8 touch-none"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            scrubbing.current = true;
            const engine = engineOrNull();
            if (engine?.getPlayback().playing) engine.pause();
            seekFromX(e.clientX);
          }}
          onPointerMove={(e) => scrubbing.current && seekFromX(e.clientX)}
          onPointerUp={() => (scrubbing.current = false)}
          onPointerCancel={() => (scrubbing.current = false)}
          onKeyDown={(e) => {
            const engine = engineOrNull();
            if (!engine) return;
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              e.stopPropagation();
              engine.stepFrames((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 30 : 1));
            }
          }}
        >
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-[#2c313d]">
            <div
              ref={fillRef}
              className="h-full w-full origin-left bg-accent"
              style={{ transform: 'scaleX(0)' }}
            />
          </div>
          <div
            ref={knobRef}
            className="pointer-events-none absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-white shadow"
            style={{ left: 0 }}
          />
        </div>
        <span
          ref={timeRef}
          className="font-mono text-[11px] tabular-nums leading-none text-fg-muted"
          data-testid="timecode"
        >
          00:00.00 / 00:00.00
        </span>
      </div>
    </div>
  );
}
