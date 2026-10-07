// Renders the procedural stick-figure dancer (src/engine/video2vmd/synthetic.ts) to a video with a tone as
// audio track: e2e/fixtures/stick-dance.webm (VP9 + Opus — open-source Chromium used by Playwright has no
// H.264 decoder) and stick-dance.mp4 (H.264 + AAC). Run: pnpm fixtures:video (needs ffmpeg).
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syntheticFrame } from '../src/engine/video2vmd/synthetic';

const W = 480;
const H = 270;
const FPS = 30;
const SECONDS = 4;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'e2e/fixtures');
mkdirSync(outDir, { recursive: true });

const EDGES: [number, number][] = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [27, 31],
  [24, 26],
  [26, 28],
  [28, 32],
];

function frame(t: number): Buffer {
  const px = Buffer.alloc(W * H * 3);
  const set = (x: number, y: number, r: number, g: number, b: number): void => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 3;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
  };
  for (let y = 0; y < H; y++) {
    const floor = y > H * 0.78;
    for (let x = 0; x < W; x++) set(x, y, floor ? 185 : 232, floor ? 178 : 228, floor ? 162 : 218);
  }
  const f = syntheticFrame(t, { imageSize: [W, H] });
  const p = (i: number): [number, number] => [f.image[i * 4] * W, f.image[i * 4 + 1] * H];
  const thick = 3.5;
  for (const [a, b] of EDGES) {
    const [ax, ay] = p(a);
    const [bx, by] = p(b);
    const minX = Math.floor(Math.min(ax, bx) - thick);
    const maxX = Math.ceil(Math.max(ax, bx) + thick);
    const minY = Math.floor(Math.min(ay, by) - thick);
    const maxY = Math.ceil(Math.max(ay, by) + thick);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
        const d = Math.hypot(x - (ax + u * dx), y - (ay + u * dy));
        if (d <= thick) set(x, y, 43, 58, 103);
      }
    }
  }
  const [hx, hy] = p(0);
  for (let y = -10; y <= 10; y++)
    for (let x = -10; x <= 10; x++)
      if (x * x + y * y <= 81) set(Math.round(hx + x), Math.round(hy + y), 192, 80, 77);
  return px;
}

const frames = Buffer.concat(Array.from({ length: FPS * SECONDS }, (_, i) => frame(i / FPS)));
const encode = (file: string, codec: string[]): void => {
  const out = join(outDir, file);
  const res = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-s',
      `${W}x${H}`,
      '-r',
      String(FPS),
      '-i',
      '-',
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:duration=${SECONDS}`,
      ...codec,
      '-shortest',
      out,
    ],
    { input: frames },
  );
  if (res.status !== 0) {
    console.error(res.stderr.toString());
    process.exit(1);
  }
  console.log(`wrote ${out}`);
};
encode('stick-dance.webm', [
  '-c:v',
  'libvpx-vp9',
  '-b:v',
  '0',
  '-crf',
  '40',
  '-g',
  '30',
  '-c:a',
  'libopus',
  '-b:a',
  '32k',
]);
encode('stick-dance.mp4', [
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  '-preset',
  'slow',
  '-crf',
  '28',
  '-g',
  '30',
  '-c:a',
  'aac',
  '-b:a',
  '48k',
  '-movflags',
  '+faststart',
]);
