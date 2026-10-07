import type { StudioEngine } from '@/engine/StudioEngine';

let current: StudioEngine | null = null;
const waiters: ((e: StudioEngine) => void)[] = [];

export function setEngine(engine: StudioEngine | null): void {
  current = engine;
  if (engine) while (waiters.length) waiters.shift()!(engine);
}

/** The engine, or null while it is still booting. */
export function engineOrNull(): StudioEngine | null {
  return current;
}

/** Resolves once the engine is available. */
export function whenEngine(): Promise<StudioEngine> {
  return current ? Promise.resolve(current) : new Promise((resolve) => waiters.push(resolve));
}
