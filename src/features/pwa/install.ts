import { create } from 'zustand';
import { toast } from '@/store/studio';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** 'available' = native prompt ready (Chromium), 'ios' = manual Add to Home Screen, 'installed', 'unsupported'. */
export type InstallStatus = 'available' | 'ios' | 'installed' | 'unsupported';

let deferred: BeforeInstallPromptEvent | null = null;

const standalone = (): boolean =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true);

const isIOS = (): boolean =>
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export const useInstall = create<InstallStatus>(() =>
  standalone() ? 'installed' : isIOS() ? 'ios' : 'unsupported',
);

export const installState = {
  iosHint: 'On iPhone/iPad: tap the Share button in Safari, then “Add to Home Screen”.',
};

export function initInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    useInstall.setState('available', true);
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    useInstall.setState('installed', true);
  });
}

export async function promptInstall(): Promise<void> {
  if (deferred) {
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === 'accepted') useInstall.setState('installed', true);
    deferred = null;
    return;
  }
  toast(
    'info',
    isIOS() ? installState.iosHint : 'Use your browser menu → “Install app” / “Add to Home screen”.',
    9000,
  );
}
