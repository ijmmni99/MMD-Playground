import { create } from 'zustand';

/** Per-device preferences (not part of projects). */
export interface Prefs {
  adaptiveQuality: boolean;
}

const KEY = 'mmd-prefs';
const isTouch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

function load(): Prefs {
  const defaults: Prefs = { adaptiveQuality: !!isTouch };
  try {
    return { ...defaults, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>) };
  } catch {
    return defaults;
  }
}

export const usePrefs = create<Prefs>(load);

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  usePrefs.setState({ [key]: value } as Pick<Prefs, K>);
  try {
    localStorage.setItem(KEY, JSON.stringify(usePrefs.getState()));
  } catch {
    /* private mode */
  }
}
