import { useEffect, useRef, useState } from 'react';
import { SKELETON_EDGES } from '@/engine/video2vmd/landmarks';
import type { CropBox, PoseFrame } from '@/engine/video2vmd/types';
import { frameAt, stageVideo } from './stage';
import { engineOrNull } from '@/store/engineRef';
import { useV2V, v2v } from '@/store/video2vmd';
import { markDirty } from '@/store/studio';

/** Rectangle (CSS px) the video content occupies inside a box with object-fit: contain. */
function contentRect(boxW: number, boxH: number, vw: number, vh: number) {
  if (!vw || !vh) return { x: 0, y: 0, w: boxW, h: boxH };
  const s = Math.min(boxW / vw, boxH / vh);
  const w = vw * s;
  const h = vh * s;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  frame: PoseFrame,
  area: { x: number; y: number; w: number; h: number },
  crop: CropBox | null,
): void {
  if (!frame.detected || frame.image.length < 132) return;
  const c = crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const pt = (i: number): [number, number, number] => [
    area.x + (c.x + frame.image[i * 4] * c.w) * area.w,
    area.y + (c.y + frame.image[i * 4 + 1] * c.h) * area.h,
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

/**
 * Source video with the detected skeleton drawn on top. On the Import step a drag draws the crop box;
 * during detection the live analysed frame is shown; in Preview/Export the video follows the studio
 * playhead (and scrubbing the video seeks the studio).
 */
export function VideoStage() {
  const video = useV2V((s) => s.video);
  const step = useV2V((s) => s.step);
  const trim = useV2V((s) => s.trim);
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
      const info = s.video?.info;
      const area = contentRect(W, H, info?.width ?? 16, info?.height ?? 9);
      if (s.detect.status === 'running' || s.detect.status === 'loading') {
        const thumb = s.live.thumbnail;
        const c = s.crop ?? { x: 0, y: 0, w: 1, h: 1 };
        const sub = { x: area.x + c.x * area.w, y: area.y + c.y * area.h, w: c.w * area.w, h: c.h * area.h };
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, W, H);
        if (thumb) ctx.drawImage(thumb, sub.x, sub.y, sub.w, sub.h);
        if (s.live.frame) drawSkeleton(ctx, s.live.frame, area, s.crop);
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
        : s.crop;
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
      if (s.pose && v) {
        const f = frameAt(s.pose, v.currentTime);
        if (f) drawSkeleton(ctx, f, area, s.pose.crop);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [drag]);

  // Studio ↔ video sync (preview steps).
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !synced) return;
    let raf = 0;
    let ours = false;
    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const engine = engineOrNull();
      if (!engine || !v2v.get().appliedTo) return;
      const pb = engine.getPlayback();
      const target = v2v.get().trim[0] + pb.frame / 30;
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
    // Scrubbing the video's own controls moves the studio playhead.
    const onSeeked = (): void => {
      if (ours) {
        ours = false;
        return;
      }
      const engine = engineOrNull();
      if (engine && v2v.get().appliedTo) engine.seek(Math.max(0, (v.currentTime - v2v.get().trim[0]) * 30));
    };
    v.addEventListener('seeked', onSeeked);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener('seeked', onSeeked);
    };
  }, [synced, video?.url]);

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
      className="relative aspect-video max-h-[42vh] w-full overflow-hidden rounded-md bg-black"
      data-testid="v2v-stage"
    >
      <video
        ref={(el) => {
          videoRef.current = el;
          stageVideo.current = el;
        }}
        src={video.url}
        className="absolute inset-0 h-full w-full object-contain"
        muted
        playsInline
        controls={!cropping && !live}
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
          if (c.w > 0.05 && c.h > 0.05) {
            v2v.set({ crop: c });
            markDirty();
          }
        }}
      />
      {cropping && (
        <div className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white/90">
          Drag on the video to crop to the dancer
        </div>
      )}
    </div>
  );
}
