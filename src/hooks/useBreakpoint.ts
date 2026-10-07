import { useEffect } from 'react';
import { computeLayoutMode, type LayoutMode } from '@/lib/layoutMode';
import { detectCoarse, useLayout } from '@/store/layout';

function measure(): { width: number; height: number } {
  // visualViewport excludes on-screen keyboards / browser chrome on mobile.
  const vv = window.visualViewport;
  return {
    width: Math.round(vv?.width ?? window.innerWidth),
    height: Math.round(vv?.height ?? window.innerHeight),
  };
}

/**
 * Keeps `useLayout().mode` in sync with the viewport. Mounted once at the app root; components read
 * the mode from the store. While the on-screen keyboard is open (height shrinks but width doesn't),
 * the layout mode is kept to avoid flipping a phone into "landscape".
 */
export function useBreakpoint(): LayoutMode {
  const mode = useLayout((s) => s.mode);
  useEffect(() => {
    let lastWidth = window.innerWidth;
    let raf = 0;
    const update = (): void => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const { width } = measure();
        const typing =
          document.activeElement instanceof HTMLInputElement ||
          document.activeElement instanceof HTMLTextAreaElement;
        if (typing && width === lastWidth) return;
        lastWidth = width;
        const next = computeLayoutMode(window.innerWidth, window.innerHeight);
        const coarse = detectCoarse();
        const s = useLayout.getState();
        if (s.mode !== next || s.coarse !== coarse) useLayout.setState({ mode: next, coarse });
        document.documentElement.dataset.layout = next;
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, []);
  return mode;
}
