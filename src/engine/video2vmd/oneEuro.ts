/**
 * One Euro filter (Casiez et al., 2012): an adaptive low-pass filter. Slow movements are smoothed
 * strongly (removes jitter); fast movements raise the cutoff (keeps responsiveness).
 */
export class OneEuroFilter {
  private x: number | null = null;
  private dx = 0;

  constructor(
    private readonly minCutoff = 1,
    private readonly beta = 0,
    private readonly dCutoff = 1,
  ) {}

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  reset(): void {
    this.x = null;
    this.dx = 0;
  }

  filter(value: number, dt: number): number {
    if (this.x === null || !(dt > 0)) {
      this.x = value;
      return value;
    }
    const rawDx = (value - this.x) / dt;
    const ad = OneEuroFilter.alpha(this.dCutoff, dt);
    this.dx = ad * rawDx + (1 - ad) * this.dx;
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    const a = OneEuroFilter.alpha(cutoff, dt);
    this.x = a * value + (1 - a) * this.x;
    return this.x;
  }
}

/** Filter a whole series. Runs forward then backward and averages, so there is no phase lag. */
export function oneEuroSeries(values: number[], fps: number, minCutoff: number, beta: number): number[] {
  const dt = 1 / fps;
  const fwd = new OneEuroFilter(minCutoff, beta);
  const bwd = new OneEuroFilter(minCutoff, beta);
  const a = values.map((v) => fwd.filter(v, dt));
  const b = new Array<number>(values.length);
  for (let i = values.length - 1; i >= 0; i--) b[i] = bwd.filter(values[i], dt);
  return a.map((v, i) => (v + b[i]) / 2);
}
