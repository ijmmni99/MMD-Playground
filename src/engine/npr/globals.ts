// Scene-wide values every NPR material reads (sun direction / colour, hemispheric sky and ground). Updated by
// the engine when lighting settings change; `version` lets materials skip re-uploading when nothing changed.

export const NprGlobals = {
  /** sun (dir to light xyz, intensity), sunColor (rgb, 0), sky (rgb, 0), ground (rgb, 0). */
  values: new Float32Array(16),
  version: 1,
};

export function setNprLight(
  dirToLight: [number, number, number],
  sunColor: [number, number, number],
  sky: [number, number, number],
  ground: [number, number, number],
): void {
  const v = NprGlobals.values;
  const l = Math.hypot(...dirToLight) || 1;
  const next = [
    dirToLight[0] / l,
    dirToLight[1] / l,
    dirToLight[2] / l,
    1,
    ...sunColor,
    0,
    ...sky,
    0,
    ...ground,
    0,
  ];
  let changed = false;
  for (let i = 0; i < 16; i++)
    if (Math.abs(v[i] - next[i]) > 1e-5) {
      v[i] = next[i];
      changed = true;
    }
  if (changed) NprGlobals.version++;
}
