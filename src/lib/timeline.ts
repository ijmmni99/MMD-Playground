/** MMD animations run at 30 frames per second. */
export const MMD_FPS = 30;

export const frameToSeconds = (frame: number): number => frame / MMD_FPS;
export const secondsToFrame = (seconds: number): number => seconds * MMD_FPS;

/** Snap a (possibly fractional) frame to the nearest integer frame within [0, duration]. */
export function snapFrame(frame: number, duration: number): number {
  if (!Number.isFinite(frame)) return 0;
  return Math.min(Math.max(0, Math.round(frame)), Math.max(0, Math.floor(duration)));
}

export function clampFrame(frame: number, duration: number): number {
  return Math.min(Math.max(0, frame), Math.max(0, duration));
}

/** Format a frame as mm:ss.ff (ff = frame within second). */
export function formatTimecode(frame: number): string {
  const f = Math.max(0, Math.floor(frame));
  const totalSeconds = Math.floor(f / MMD_FPS);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  const ff = f % MMD_FPS;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ff).padStart(2, '0')}`;
}

export interface TimelineView {
  /** First visible frame. */
  start: number;
  /** Pixels per frame. */
  zoom: number;
}

export const frameToX = (frame: number, view: TimelineView): number => (frame - view.start) * view.zoom;
export const xToFrame = (x: number, view: TimelineView): number => x / view.zoom + view.start;

/** Choose a "nice" ruler step (in frames) so labels are at least `minPx` apart. */
export function rulerStep(zoom: number, minPx = 60): number {
  const steps = [1, 2, 5, 10, 15, 30, 60, 150, 300, 600, 1800, 3600];
  for (const s of steps) if (s * zoom >= minPx) return s;
  return steps[steps.length - 1];
}

/** Zoom around an anchor frame so it stays under the cursor. */
export function zoomAt(view: TimelineView, anchorFrame: number, factor: number, min = 0.2, max = 40): TimelineView {
  const zoom = Math.min(max, Math.max(min, view.zoom * factor));
  const start = Math.max(0, anchorFrame - (anchorFrame - view.start) * (view.zoom / zoom));
  return { start, zoom };
}

/** Collapse sorted keyframes to unique integer pixel columns for efficient drawing. */
export function keyframeColumns(frames: readonly number[], view: TimelineView, width: number): number[] {
  const cols: number[] = [];
  let last = -1;
  for (const f of frames) {
    const x = Math.round(frameToX(f, view));
    if (x < 0 || x > width) continue;
    if (x !== last) {
      cols.push(x);
      last = x;
    }
  }
  return cols;
}

/** Compute the next playhead frame when stepping with loop semantics. */
export function stepFrame(frame: number, delta: number, duration: number, loop: boolean): number {
  const next = frame + delta;
  if (duration <= 0) return 0;
  if (next > duration) return loop ? next % duration : duration;
  if (next < 0) return loop ? duration + (next % duration) : 0;
  return next;
}
