import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioSync } from './AudioSync';

/** Minimal stand-in for HTMLAudioElement (jsdom has no media playback). */
function fakeElement() {
  const el = {
    paused: true,
    currentTime: 0,
    playbackRate: 1,
    seeking: false,
    readyState: 4,
    duration: 120,
    seeks: 0,
    play: vi.fn(() => {
      el.paused = false;
      return Promise.resolve();
    }),
    pause: vi.fn(() => {
      el.paused = true;
    }),
  };
  const proxy = new Proxy(el, {
    set(target, key, value) {
      if (key === 'currentTime') target.seeks++;
      (target as Record<string | symbol, unknown>)[key] = value;
      return true;
    },
  });
  return { proxy, raw: el };
}

let now = 0;
function setup() {
  const sync = new AudioSync();
  const { proxy, raw } = fakeElement();
  Object.defineProperty(sync, 'element', { value: proxy });
  (sync as unknown as { url: string }).url = 'blob:test';
  // Tests move the audio clock through `raw`, so only AudioSync's own writes count as seeks.
  return { sync, el: raw };
}

beforeEach(() => {
  now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => vi.restoreAllMocks());

describe('AudioSync', () => {
  it('starts the audio at the animation time', () => {
    const { sync, el } = setup();
    expect(sync.sync(10, true, 1)).toBe(1);
    expect(el.currentTime).toBe(10);
    expect(el.play).toHaveBeenCalledOnce();
  });

  it('absorbs small drift by nudging the animation instead of seeking the audio', () => {
    const { sync, el } = setup();
    sync.sync(10, true, 1);
    now = 1000;
    el.currentTime = 11.2; // audio ahead: the animation lagged 0.2 s
    const seeks = el.seeks;
    expect(sync.sync(11, true, 1)).toBeGreaterThan(1);
    now = 1100;
    el.currentTime = 11.2; // animation now ahead
    expect(sync.sync(11.5, true, 1)).toBeLessThan(1);
    expect(el.seeks).toBe(seeks);
  });

  it('returns 1 when in sync', () => {
    const { sync, el } = setup();
    sync.sync(10, true, 1);
    now = 1000;
    el.currentTime = 11;
    expect(sync.sync(11.01, true, 1)).toBe(1);
  });

  it('re-seeks only on large drift, and not again while the seek settles', () => {
    const { sync, el } = setup();
    sync.sync(10, true, 1);
    now = 1000;
    el.currentTime = 11;
    sync.sync(13, true, 1); // 2 s drift (e.g. a long hitch)
    expect(el.currentTime).toBe(13);
    const seeks = el.seeks;
    // Buffering after the seek: currentTime stuck while the animation moves on.
    for (let i = 1; i <= 5; i++) {
      now = 1000 + i * 100;
      sync.sync(13 + i * 0.1, true, 1);
    }
    expect(el.seeks).toBe(seeks);
  });

  it('extrapolates a coarse audio clock between updates', () => {
    const { sync, el } = setup();
    sync.sync(10, true, 1);
    now = 1000;
    el.currentTime = 11;
    expect(sync.sync(11, true, 1)).toBe(1);
    now = 1200; // element still reports 11 (coarse clock), animation advanced normally
    expect(sync.sync(11.2, true, 1)).toBe(1);
  });

  it('pauses with the animation', () => {
    const { sync, el } = setup();
    sync.sync(10, true, 1);
    expect(sync.sync(10, false, 1)).toBe(1);
    expect(el.paused).toBe(true);
  });
});
