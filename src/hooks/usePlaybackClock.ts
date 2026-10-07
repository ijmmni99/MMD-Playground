import { useEffect } from 'react';
import { engineOrNull } from '@/store/engineRef';
import { useStudio } from '@/store/studio';
import type { PlaybackState } from '@/engine/types';

/**
 * Calls `onFrame` with the live playback state every animation frame while playing, and once
 * whenever the (throttled) store playback changes. Lets clocks and scrub bars update via refs
 * without re-rendering React components 60 times a second.
 */
export function usePlaybackClock(onFrame: (p: PlaybackState) => void): void {
  const playing = useStudio((s) => s.playback.playing);
  const storePb = useStudio((s) => s.playback);
  useEffect(() => {
    onFrame(engineOrNull()?.getPlayback() ?? storePb);
  }, [storePb, onFrame]);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = (): void => {
      const pb = engineOrNull()?.getPlayback();
      if (pb) onFrame(pb);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, onFrame]);
}
