import { useRef } from 'react';
import type { NameKind } from '@/lib/names';
import { openNameMenu } from '@/store/names';

/** Right-click / long-press (touch, 500 ms) handlers that open the name menu. */
export function useNameMenu(modelId: string | null | undefined, kind: NameKind, ja: string) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const cancel = (): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  if (!modelId || !ja) return {};
  return {
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      cancel();
      openNameMenu(modelId, kind, ja, e.clientX, e.clientY);
    },
    onPointerDown: (e: React.PointerEvent) => {
      fired.current = false;
      if (e.pointerType !== 'touch') return;
      start.current = { x: e.clientX, y: e.clientY };
      cancel();
      timer.current = setTimeout(() => {
        fired.current = true;
        openNameMenu(modelId, kind, ja, start.current!.x, start.current!.y);
      }, 500);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    // A long-press must not also click (select / toggle) the row underneath.
    onClickCapture: (e: React.MouseEvent) => {
      if (fired.current) {
        e.stopPropagation();
        e.preventDefault();
        fired.current = false;
      }
    },
  };
}
