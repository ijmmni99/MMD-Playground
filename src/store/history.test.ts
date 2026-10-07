import { describe, expect, it } from 'vitest';
import { COALESCE_MS, createHistoryStore, HISTORY_LIMIT } from './history';

function setup() {
  let t = 0;
  const store = createHistoryStore(() => t);
  return { store, advance: (ms: number) => (t += ms) };
}

describe('undo/redo history', () => {
  it('undoes and redoes in order', () => {
    const { store, advance } = setup();
    let value = 0;
    const set = (v: number) => {
      const prev = value;
      value = v;
      store.getState().push({ label: `set ${v}`, undo: () => (value = prev), redo: () => (value = v) });
      advance(COALESCE_MS * 2);
    };
    set(1);
    set(2);
    set(3);
    store.getState().undo();
    expect(value).toBe(2);
    store.getState().undo();
    expect(value).toBe(1);
    store.getState().redo();
    expect(value).toBe(2);
    expect(store.getState().past).toHaveLength(2);
    expect(store.getState().future).toHaveLength(1);
  });

  it('clears the redo stack on a new action', () => {
    const { store } = setup();
    store.getState().push({ label: 'a', undo: () => undefined, redo: () => undefined });
    store.getState().undo();
    expect(store.getState().future).toHaveLength(1);
    store.getState().push({ label: 'b', undo: () => undefined, redo: () => undefined });
    expect(store.getState().future).toHaveLength(0);
  });

  it('coalesces rapid edits with the same key (e.g. slider drags)', () => {
    const { store, advance } = setup();
    let value = 0;
    for (const v of [0.1, 0.2, 0.3]) {
      const prev = value;
      value = v;
      store
        .getState()
        .push({ label: 'morph', key: 'm:1', undo: () => (value = prev), redo: () => (value = v) });
      advance(50);
    }
    expect(store.getState().past).toHaveLength(1);
    store.getState().undo();
    expect(value).toBe(0);
    store.getState().redo();
    expect(value).toBe(0.3);
  });

  it('does not coalesce after the window expires or with different keys', () => {
    const { store, advance } = setup();
    store.getState().push({ label: 'a', key: 'k', undo: () => undefined, redo: () => undefined });
    advance(COALESCE_MS + 1);
    store.getState().push({ label: 'b', key: 'k', undo: () => undefined, redo: () => undefined });
    store.getState().push({ label: 'c', key: 'other', undo: () => undefined, redo: () => undefined });
    expect(store.getState().past).toHaveLength(3);
  });

  it('caps the history length', () => {
    const { store, advance } = setup();
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) {
      store.getState().push({ label: String(i), undo: () => undefined, redo: () => undefined });
      advance(COALESCE_MS * 2);
    }
    expect(store.getState().past).toHaveLength(HISTORY_LIMIT);
    expect(store.getState().past[0].label).toBe('20');
  });

  it('returns null when there is nothing to undo/redo', () => {
    const { store } = setup();
    expect(store.getState().undo()).toBeNull();
    expect(store.getState().redo()).toBeNull();
  });
});
