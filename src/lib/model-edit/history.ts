// Undo / redo over op-list snapshots. A drag commits with a `coalesce` key: while the key repeats, the last
// op is replaced in place instead of pushing a new step. Singleton ops (proportions, outfit, frames) replace
// any earlier op of their type, since only the last one counts.

import { isSingleton, type Op } from './ops';

export const HISTORY_DEPTH = 250;

export interface EditHistory {
  ops: Op[];
  past: Op[][];
  future: Op[][];
  /** Key of the last coalescing commit. */
  coalesce: string | null;
}

export const emptyHistory = (ops: Op[] = []): EditHistory => ({ ops, past: [], future: [], coalesce: null });

const pushPast = (past: Op[][], ops: Op[]): Op[][] => {
  const next = [...past, ops];
  return next.length > HISTORY_DEPTH ? next.slice(next.length - HISTORY_DEPTH) : next;
};

/** Add an op (or replace the last one while `coalesce` repeats). */
export function commit(h: EditHistory, op: Op, coalesce?: string): EditHistory {
  const same = coalesce !== undefined && coalesce === h.coalesce && h.ops.length > 0;
  const base = same ? h.ops.slice(0, -1) : h.ops;
  const kept = isSingleton(op.type) ? base.filter((o) => o.type !== op.type) : base;
  const ops = [...kept, op];
  return {
    ops,
    past: same ? h.past : pushPast(h.past, h.ops),
    future: [],
    coalesce: coalesce ?? null,
  };
}

/** Replace the whole list as one step (revert, import, reset part). */
export function replaceAll(h: EditHistory, ops: Op[]): EditHistory {
  return { ops, past: pushPast(h.past, h.ops), future: [], coalesce: null };
}

/** End a coalescing run (pointer up), so the next commit is a new step. */
export const endCoalesce = (h: EditHistory): EditHistory => (h.coalesce ? { ...h, coalesce: null } : h);

export function undo(h: EditHistory): EditHistory {
  if (!h.past.length) return h;
  return {
    ops: h.past[h.past.length - 1],
    past: h.past.slice(0, -1),
    future: [h.ops, ...h.future],
    coalesce: null,
  };
}

export function redo(h: EditHistory): EditHistory {
  if (!h.future.length) return h;
  return { ops: h.future[0], past: pushPast(h.past, h.ops), future: h.future.slice(1), coalesce: null };
}

export const canUndo = (h: EditHistory): boolean => h.past.length > 0;
export const canRedo = (h: EditHistory): boolean => h.future.length > 0;
