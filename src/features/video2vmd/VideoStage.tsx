import { useEffect, useRef, useState } from 'react';
import { SKELETON_EDGES } from '@/engine/video2vmd/landmarks';
import type { CropBox, PoseFrame } from '@/engine/video2vmd/types';
import { HAND_EDGES } from '@/lib/video2vmd/types';
import { frameAt, stageVideo, stageVideoSide } from './stage';
import { engineOrNull } from '@/store/engineRef';
import { useV2V, v2v, type ViewId } from '@/store/video2vmd';
import { setCrop } from './actions';

/** Rectangle (CSS px) the video content occupies inside a box with object-fit: contain. */
function contentRect(boxW: number, boxH: number, vw: number, vh: number) {
  if (!vw || !vh) return { x: 0, y: 0, w: boxW, h: boxH };
  const s = Math.min(boxW / vw, boxH / vh);
  const w = vw * s;
  const h = vh * s;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

type Area = { x: number; y: number; w: number; h: number };

/** Maps analysed-area normalised coordinates to canvas pixels. */
const mapper =
  (area: Area, crop: CropBox | null) =>
  (x: number, y: number): [number, number] => {
    const c = crop ?? { x: 0, y: 0, w: 1, h: 1 };
    return [area.x + (c.x + x * c.w) * area.w, area.y + (c.y + y * c.h) * area.h];
  };

function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  frame: PoseFrame,
  area: Area,
  crop: CropBox | null,
): void {
  if (!frame.detected || frame.image.length < 132) return;
  const m = mapper(area, crop);
  const pt = (i: number): [number, number, number] => [
    ...m(frame.image[i * 4], frame.image[i * 4 + 1]),
    frame.image[i * 4 + 3],
  ];
  ctx.lineWidth = Math.max(2, area.w / 220);
  ctx.lineCap = 'round';
  for (const [a, b] of SKELETON_EDGES) {
    const [ax, ay, av] = pt(a);
    const [bx, by, bv] = pt(b);
    const vis = Math.min(av, bv);
    const left = (a % 2 === 1 && a > 10) || (b % 2 === 1 && b > 10);
    ctx.strokeStyle =
      vis < 0.35 ? 'rgba(255,90,90,0.55)' : left ? 'rgba(80,220,255,0.95)' : 'rgba(255,200,60,0.95)';
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 33; i++) {
    const [x, y, v] = pt(i);
    if (v < 0.35) continue;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1.5, area.w / 300), 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Face points, hand skeletons and crop windows from the crop pass. */
function drawCropPass(
  ctx: CanvasRenderingContext2D,
  frame: PoseFrame,
  area: Area,
  crop: CropBox | null,
  o: { face: boolean; hands: boolean; crops: boolean },
): void {
  const m = mapper(area, crop);
  const box = (c: { x: number; y: number; w: number; h: number }, color: string): void => {
    const [x0, y0] = m(c.x, c.y);
    const [x1, y1] = m(c.x + c.w, c.y + c.h);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.setLineDash([]);
  };
  const r = Math.max(1.2, area.w / 420);
  if (frame.face) {
    if (o.crops) box(frame.face.crop, 'rgba(255,120,220,0.9)');
    if (o.face) {
      ctx.fillStyle = 'rgba(255,140,230,0.95)';
      for (let i = 0; i + 1 < frame.face.points.length; i += 2) {
        const [x, y] = m(frame.face.points[i], frame.face.points[i + 1]);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  frame.hands?.forEach((h, k) => {
    if (!h) return;
    if (o.crops) box(h.crop, k === 0 ? 'rgba(80,220,255,0.9)' : 'rgba(255,200,60,0.9)');
    if (!o.hands) return;
    ctx.strokeStyle = k === 0 ? 'rgba(120,240,255,0.95)' : 'rgba(255,220,110,0.95)';
    ctx.lineWidth = Math.max(1, area.w / 400);
    for (const [a, b] of HAND_EDGES) {
      const [ax, ay] = m(h.image[a * 3], h.image[a * 3 + 1]);
      const [bx, by] = m(h.image[b * 3], h.image[b * 3 + 1]);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
  });
}

/**
 * Source video with the detected skeleton (and face / hand / crop overlays) drawn on top. On the Import
 * step a drag draws the crop box; during detection the live analysed frame is shown; in later steps the
 * video follows the studio playhead (the side view adds the sync offset).
 */
export function VideoStage({ view = 'front', compact = false }: { view?: ViewId; compact?: boolean }) {
  const video = useV2V((s) => (view === 'front' ? s.video : s.side));
  const step = useV2V((s) => s.step);
  const trim = useV2V((s) => (view === 'front' ? s.trim : s.sideTrim));
  const detectStatus = useV2V((s) => s.detect.status);
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const live = detectStatus === 'running' || detectStatus === 'loading';
  const synced = step === 'preview' || step === 'export' || step === 'retarget' || step === 'clean';

  // Draw loop: overlay follows the video (or the live analysed frame during detection).
  useEffect(() => {
    let raf = 0;
    const draw = (): void => {
      raf = requestAnimationFrame(draw);
      const box = boxRef.current;
      const canvas = canvasRef.current;
      const v = videoRef.current;
      if (!box || !canvas) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = box.clientWidth;
      const H = box.clientHeight;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const s = v2v.get();
      const slot = view === 'front' ? s.video : s.side;
      const crop = view === 'front' ? s.crop : s.sideCrop;
      const pose = view === 'front' ? s.pose : s.sidePose;
      const liveData = view === 'front' ? s.live : s.liveSide;
      const info = slot?.info;
      const area = contentRect(W, H, info?.width ?? 16, info?.height ?? 9);
      const o = s.overlays;
      if ((s.detect.status === 'running' || s.detect.status === 'loading') && s.detect.view === view) {
        const thumb = liveData.thumbnail;
        const c = crop ?? { x: 0, y: 0, w: 1, h: 1 };
        const sub = { x: area.x + c.x * area.w, y: area.y + c.y * area.h, w: c.w * area.w, h: c.h * area.h };
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, W, H);
        if (thumb) ctx.drawImage(thumb, sub.x, sub.y, sub.w, sub.h);
        if (liveData.frame) {
          if (o.body) drawSkeleton(ctx, liveData.frame, area, crop);
          drawCropPass(ctx, liveData.frame, area, crop, o);
        }
        return;
      }
      // Crop box.
      const c = drag
        ? {
            x: Math.min(drag.x0, drag.x1),
            y: Math.min(drag.y0, drag.y1),
            w: Math.abs(drag.x1 - drag.x0),
            h: Math.abs(drag.y1 - drag.y0),
          }
        : crop;
      if (c) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        const r = { x: area.x + c.x * area.w, y: area.y + c.y * area.h, w: c.w * area.w, h: c.h * area.h };
        ctx.fillRect(area.x, area.y, area.w, r.y - area.y);
        ctx.fillRect(area.x, r.y + r.h, area.w, area.y + area.h - r.y - r.h);
        ctx.fillRect(area.x, r.y, r.x - area.x, r.h);
        ctx.fillRect(r.x + r.w, r.y, area.x + area.w - r.x - r.w, r.h);
        ctx.strokeStyle = '#6d8bff';
        ctx.lineWidth = 2;
        ctx.strokeRect(r.x, r.y, r.w, r.h);
      }
      if (pose && v) {
        const f = frameAt(pose, v.currentTime);
        if (f) {
          if (o.body) drawSkeleton(ctx, f, area, pose.crop);
          drawCropPass(ctx, f, area, pose.crop, o);
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [drag, view]);

  // Studio ↔ video sync (preview steps). The side view runs at front time + offset.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !synced) return;
    let raf = 0;
    let ours = false;
    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const engine = engineOrNull();
      const s = v2v.get();
      if (!engine || !s.appliedTo) return;
      const pb = engine.getPlayback();
      const start = s.result?.track.times[0] ?? s.trim[0];
      const target = start + pb.frame / 30 + (view === 'side' ? (s.sync?.offset ?? 0) : 0);
      if (pb.playing) {
        if (v.paused) void v.play().catch(() => undefined);
        if (Math.abs(v.currentTime - target) > 0.15) {
          ours = true;
          v.currentTime = target;
        }
      } else {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - target) > 0.04) {
          ours = true;
          v.currentTime = target;
        }
      }
    };
    // Scrubbing the front video's own controls moves the studio playhead.
    const onSeeked = (): void => {
      if (ours) {
        ours = false;
        return;
      }
      const engine = engineOrNull();
      const s = v2v.get();
      if (view !== 'front' || !engine || !s.appliedTo) return;
      const start = s.result?.track.times[0] ?? s.trim[0];
      engine.seek(Math.max(0, (v.currentTime - start) * 30));
    };
    v.addEventListener('seeked', onSeeked);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener('seeked', onSeeked);
    };
  }, [synced, video?.url, view]);

  if (!video) return null;

  const toNorm = (e: React.PointerEvent): { x: number; y: number } => {
    const box = boxRef.current!.getBoundingClientRect();
    const area = contentRect(box.width, box.height, video.info.width, video.info.height);
    return {
      x: Math.min(1, Math.max(0, (e.clientX - box.left - area.x) / area.w)),
      y: Math.min(1, Math.max(0, (e.clientY - box.top - area.y) / area.h)),
    };
  };
  const cropping = step === 'import';

  return (
    <div
      ref={boxRef}
      className={
        compact
          ? 'relative aspect-video w-full overflow-hidden rounded-md bg-black'
          : 'relative aspect-video max-h-[42vh] w-full overflow-hidden rounded-md bg-black'
      }
      data-testid={view === 'front' ? 'v2v-stage' : 'v2v-stage-side'}
    >
      <video
        ref={(el) => {
          videoRef.current = el;
          if (view === 'front') stageVideo.current = el;
          else stageVideoSide.current = el;
        }}
        src={video.url}
        className="absolute inset-0 h-full w-full object-contain"
        muted
        playsInline
        controls={!cropping && !live && view === 'front' && !compact}
        preload="auto"
        onLoadedMetadata={(e) => {
          if (trim[0] > 0) e.currentTarget.currentTime = trim[0];
        }}
      />
      <canvas
        ref={canvasRef}
        aria-hidden
        className={
          cropping
            ? 'absolute inset-0 h-full w-full cursor-crosshair touch-none'
            : 'pointer-events-none absolute inset-0 h-full w-full'
        }
        onPointerDown={(e) => {
          if (!cropping) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = toNorm(e);
          setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        }}
        onPointerMove={(e) => {
          if (!drag) return;
          const p = toNorm(e);
          setDrag({ ...drag, x1: p.x, y1: p.y });
        }}
        onPointerUp={() => {
          if (!drag) return;
          const c: CropBox = {
            x: Math.min(drag.x0, drag.x1),
            y: Math.min(drag.y0, drag.y1),
            w: Math.abs(drag.x1 - drag.x0),
            h: Math.abs(drag.y1 - drag.y0),
          };
          setDrag(null);
          if (c.w > 0.05 && c.h > 0.05) setCrop(c, view);
        }}
      />
      {view === 'side' && (
        <div className="pointer-events-none absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white/90">
          Side
        </div>
      )}
      {cropping && !compact && (
        <div className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white/90">
          Drag on the video to crop to the dancer
        </div>
      )}
    </div>
  );
}
