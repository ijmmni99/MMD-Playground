// Hex <-> 0–1 RGB for colour inputs.

export const toHex = (c: readonly number[]): string =>
  `#${c
    .slice(0, 3)
    .map((x) =>
      Math.round(Math.max(0, Math.min(1, x)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

export const fromHex = (h: string): [number, number, number] => {
  const n = Number.parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
