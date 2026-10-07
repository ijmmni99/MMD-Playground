import type { StudioEngine } from '@/engine/StudioEngine';

let current: StudioEngine | null = null;
const waiters: ((e: StudioEngine) => void)[] = [];
let booter: (() => void) | null = null;

/** Registers the function that starts the (lazily loaded) engine on first demand. */
export function setEngineBooter(fn: () => void): void {
  booter = fn;
}

export function setEngine(engine: StudioEngine | null): void {
  current = engine;
  if (engine) while (waiters.length) waiters.shift()!(engine);
}

/** The engine, or null while it is still booting. */
export function engineOrNull(): StudioEngine | null {
  return current;
}

/** Resolves once the engine is available; starts it unless `passive` (just wait for someone else). */
export function whenEngine(passive = false): Promise<StudioEngine> {
  if (current) return Promise.resolve(current);
  if (!passive) booter?.();
  return new Promise((resolve) => waiters.push(resolve));
}
