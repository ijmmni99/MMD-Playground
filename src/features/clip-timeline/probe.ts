/** Automation probe for the clip dock (tests drive clips by their screen positions). */
export const dockProbe: {
  clipPoint?: (id: string, at?: number) => { x: number; y: number } | null;
  frameX?: (f: number) => number;
} = {};
