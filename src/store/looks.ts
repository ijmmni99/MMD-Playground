import { create } from 'zustand';
import { DEFAULT_NPR_SETTINGS, type ModelLooks, type NprSettings } from '@/lib/npr/looks';

/** NPR looks: per-model material looks and the global options (saved with the project). */
export interface LooksState {
  models: Record<string, ModelLooks>;
  settings: NprSettings;
  /** Material whose look editor is open (by model). */
  open: { modelId: string; material: string } | null;
}

export const useLooks = create<LooksState>(() => ({
  models: {},
  settings: { ...DEFAULT_NPR_SETTINGS },
  open: null,
}));

export const looksStore = { get: useLooks.getState, set: useLooks.setState };

/** Persisted form in the project document. */
export interface LooksDoc {
  models: Record<string, ModelLooks>;
  settings: NprSettings;
}
