import { useEffect } from 'react';
import { AdaptiveQualityController, nextLowerQuality } from '@/lib/adaptiveQuality';
import { openProject, buildProjectDoc, saveNow } from '@/features/project/persistence';
import { initInstallPrompt } from '@/features/pwa/install';
import { consumeShareInbox } from '@/features/pwa/shareInbox';
import { updateSettings } from '@/store/actions';
import { engineOrNull, whenEngine } from '@/store/engineRef';
import { usePrefs } from '@/store/prefs';
import { studio, toast } from '@/store/studio';

/** App-wide platform plumbing that isn't tied to any one layout. */
export function useAppLifecycle(): void {
  // iOS: audio can only start after a user gesture. Unlock on the first tap/click anywhere.
  useEffect(() => {
    const unlock = (): void => {
      engineOrNull()?.unlockAudio();
      if (engineOrNull()) {
        window.removeEventListener('pointerdown', unlock, true);
        window.removeEventListener('keydown', unlock, true);
      }
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    return () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
  }, []);

  // Background tab / app switch: pause playback (audio would otherwise keep going) and save.
  useEffect(() => {
    const onVisibility = (): void => {
      if (document.visibilityState !== 'hidden') return;
      const engine = engineOrNull();
      if (engine?.getPlayback().playing) engine.pause();
      if (studio.get().project.dirty) void saveNow();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Adaptive quality: step down when the frame rate stays under 30 fps for 3 s.
  useEffect(() => {
    const controller = new AdaptiveQualityController();
    const timer = setInterval(() => {
      const engine = engineOrNull();
      if (!engine || !usePrefs.getState().adaptiveQuality || document.visibilityState === 'hidden') {
        controller.reset();
        return;
      }
      if (!controller.sample(engine.getFps(), performance.now())) return;
      const s = studio.get().settings;
      const next = nextLowerQuality({
        quality: s.viewport.quality,
        softShadows: s.lighting.softShadows,
        shadows: s.lighting.shadows,
      });
      if (!next) return;
      updateSettings((d) => {
        d.viewport.quality = next.quality;
        d.lighting.softShadows = next.softShadows;
        d.lighting.shadows = next.shadows;
      });
      const what =
        next.quality !== s.viewport.quality
          ? `quality → ${next.quality}`
          : next.softShadows !== s.lighting.softShadows
            ? 'soft shadows off'
            : 'shadows off';
      toast('info', `Low frame rate: ${what} (Adaptive quality)`, 3500);
    }, 500);
    return () => clearInterval(timer);
  }, []);

  // GPU context loss (common under mobile memory pressure): rebuild the scene from saved state.
  useEffect(() => {
    let offs: (() => void)[] = [];
    void whenEngine(true).then((engine) => {
      offs = [
        engine.events.on('contextLost', () =>
          toast('warning', 'Graphics were reset by the system — recovering…', 6000),
        ),
        engine.events.on('contextRestored', () => {
          void (async () => {
            try {
              await saveNow();
              await openProject(buildProjectDoc());
              toast('success', 'Scene restored after graphics reset');
            } catch (e) {
              toast(
                'error',
                `Could not restore the scene: ${e instanceof Error ? e.message : String(e)}. Reload the page — your project is saved.`,
                12000,
              );
            }
          })();
        }),
      ];
    });
    return () => offs.forEach((o) => o());
  }, []);

  // PWA: install prompt + files shared to the app (Android share target).
  useEffect(() => {
    initInstallPrompt();
    void whenEngine(true).then(() => consumeShareInbox());
  }, []);
}
