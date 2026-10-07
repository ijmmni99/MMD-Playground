import { create } from 'zustand';

export interface HistoryEntry {
  label: string;
  undo: () => void;
  redo: () => void;
  /** Entries with the same key pushed within `COALESCE_MS` merge (keeps the first undo, latest redo). */
  key?: string;
  time?: number;
}

export const COALESCE_MS = 600;
export const HISTORY_LIMIT = 200;

interface HistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
  push: (entry: HistoryEntry) => void;
  undo: () => HistoryEntry | null;
  redo: () => HistoryEntry | null;
  clear: () => void;
}

export const createHistoryStore = (now: () => number = () => Date.now()) =>
  create<HistoryState>((set, get) => ({
    past: [],
    future: [],
    push: (entry) => {
      const t = now();
      const past = get().past;
      const last = past[past.length - 1];
      if (entry.key && last?.key === entry.key && last.time !== undefined && t - last.time < COALESCE_MS) {
        const merged: HistoryEntry = { ...last, redo: entry.redo, time: t, label: entry.label };
        set({ past: [...past.slice(0, -1), merged], future: [] });
        return;
      }
      const next = [...past, { ...entry, time: t }];
      if (next.length > HISTORY_LIMIT) next.shift();
      set({ past: next, future: [] });
    },
    undo: () => {
      const { past, future } = get();
      const entry = past[past.length - 1];
      if (!entry) return null;
      entry.undo();
      set({ past: past.slice(0, -1), future: [entry, ...future] });
      return entry;
    },
    redo: () => {
      const { past, future } = get();
      const entry = future[0];
      if (!entry) return null;
      entry.redo();
      set({ past: [...past, { ...entry, time: undefined }], future: future.slice(1) });
      return entry;
    },
    clear: () => set({ past: [], future: [] }),
  }));

export const useHistory = createHistoryStore();
