// SRT and LRC parsing → timed lines (seconds).

export interface Cue {
  start: number;
  end: number;
  text: string;
}

/** A leading byte-order mark. */
const BOM = /^\uFEFF/;

const time = (h: string, m: string, s: string, ms: string): number =>
  Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0').slice(0, 3)) / 1000;

/** SubRip: numbered blocks "hh:mm:ss,mmm --> hh:mm:ss,mmm" followed by text lines. */
export function parseSrt(text: string): Cue[] {
  const out: Cue[] = [];
  const blocks = text
    .replace(/\r\n?/g, '\n')
    .replace(BOM, '')
    .split(/\n\s*\n/);
  const re = /(\d+):(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*-->\s*(\d+):(\d{1,2}):(\d{1,2})[,.](\d{1,3})/;
  for (const b of blocks) {
    const lines = b.split('\n').filter((l) => l.trim() !== '');
    const i = lines.findIndex((l) => re.test(l));
    if (i < 0) continue;
    const m = re.exec(lines[i])!;
    const body = lines
      .slice(i + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (!body) continue;
    out.push({ start: time(m[1], m[2], m[3], m[4]), end: time(m[5], m[6], m[7], m[8]), text: body });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * LRC lyrics: "[mm:ss.xx] line" (several time tags per line allowed, [offset:±ms] honoured). A line
 * ends where the next starts (the last one lasts `lastDuration` seconds).
 */
export function parseLrc(text: string, lastDuration = 4): Cue[] {
  let offset = 0;
  const timed: { t: number; text: string }[] = [];
  for (const raw of text.replace(/\r\n?/g, '\n').replace(BOM, '').split('\n')) {
    const off = /^\[offset:\s*([+-]?\d+)\]/i.exec(raw.trim());
    if (off) {
      offset = Number(off[1]) / 1000;
      continue;
    }
    const tags = [...raw.matchAll(/\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    if (!tags.length) continue;
    const body = raw
      .replace(/\[[^\]]*\]/g, '')
      .replace(/<\d+:\d+(?:\.\d+)?>/g, '')
      .trim();
    for (const t of tags) timed.push({ t: time('0', t[1], t[2], t[3] ?? '0'), text: body });
  }
  timed.sort((a, b) => a.t - b.t);
  const out: Cue[] = [];
  timed.forEach((x, i) => {
    if (!x.text) return;
    // LRC offset: positive = lyrics appear earlier.
    const start = Math.max(0, x.t - offset);
    const next = timed[i + 1];
    const end = next ? Math.max(start + 0.1, next.t - offset) : start + lastDuration;
    out.push({ start, end, text: x.text });
  });
  return out;
}

/** Cues → frames (30 fps). */
export const cueFrames = (c: Cue, fps = 30): { start: number; length: number } => {
  const start = Math.round(c.start * fps);
  return { start, length: Math.max(1, Math.round(c.end * fps) - start) };
};
