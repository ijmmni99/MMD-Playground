// Renders the synthetic dancer (src/lib/video2vmd/synthetic.ts: fingers, face, hops, depth-heavy arms) from
// two virtual cameras 90° apart: e2e/fixtures/twoview-front.webm and twoview-side.webm. The side camera
// "started recording" SIDE_OFFSET seconds earlier, so every event happens SIDE_OFFSET later in its video
// (side time = front time + offset). The audio has a clap at the start plus a few hits, for audio sync.
// Run: pnpm fixtures:twoview (needs ffmpeg). The synthetic estimators (?pose=synthetic2&sideOffset=…) return
// the same cameras' observations, so the e2e test needs no ML models.
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureCameras, syntheticScene, viewFrame } from '../src/lib/video2vmd/synthetic';
import { HAND_EDGES } from '../src/lib/video2vmd/types';

const W = 640;
const H = 360;
const FPS = 30;
export const SIDE_OFFSET = 0.4;
const FRONT_SECONDS = 4;
const SIDE_SECONDS = 4.4;
const HITS = [0.5, 1.45, 2.2, 2.65, 3.4];
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'e2e/fixtures');
mkdirSync(outDir, { recursive: true });

const BODY: [number, number][] = [
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

function frame(view: 'front' | 'side', tLocal: number): Buffer {
  const [front, side] = fixtureCameras(90, [W, H]);
  const t = view === 'side' ? tLocal - SIDE_OFFSET : tLocal;
  const v = viewFrame(syntheticScene(t, { depthHeavy: true, hops: true }), {
    camera: view === 'side' ? side : front,
  });
  const px = Buffer.alloc(W * H * 3);
  const set = (x: number, y: number, r: number, g: number, b: number): void => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 3;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
  };
  for (let y = 0; y < H; y++) {
    const floor = y > H * 0.72;
    for (let x = 0; x < W; x++) set(x, y, floor ? 185 : 232, floor ? 178 : 228, floor ? 162 : 218);
  }
  const line = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    thick: number,
    c: [number, number, number],
  ): void => {
    const minX = Math.floor(Math.min(ax, bx) - thick);
    const maxX = Math.ceil(Math.max(ax, bx) + thick);
    const minY = Math.floor(Math.min(ay, by) - thick);
    const maxY = Math.ceil(Math.max(ay, by) + thick);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) {
        const u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
        if (Math.hypot(x - (ax + u * dx), y - (ay + u * dy)) <= thick) set(x, y, ...c);
      }
  };
  const p = (i: number): [number, number] => [v.image[i * 4] * W, v.image[i * 4 + 1] * H];
  for (const [a, b] of BODY) line(...p(a), ...p(b), 3.5, [43, 58, 103]);
  for (const h of v.hands) {
    if (!h) continue;
    for (const [a, b] of HAND_EDGES)
      line(
        h.image[a * 3] * W,
        h.image[a * 3 + 1] * H,
        h.image[b * 3] * W,
        h.image[b * 3 + 1] * H,
        1,
        [120, 70, 60],
      );
  }
  const [hx, hy] = p(0);
  for (let y = -11; y <= 11; y++)
    for (let x = -11; x <= 11; x++)
      if (x * x + y * y <= 110) set(Math.round(hx + x), Math.round(hy + y), 230, 196, 170);
  if (v.face) {
    for (let i = 0; i < v.face.points.length; i += 2)
      set(Math.round(v.face.points[i] * W), Math.round(v.face.points[i + 1] * H), 40, 30, 30);
  }
  return px;
}

/** 16-bit mono WAV: low hum plus short noise bursts at the hit times (shifted for the side camera). */
function wav(seconds: number, shift: number, seed: number): Buffer {
  const sr = 22050;
  const n = Math.round(seconds * sr);
  const data = Buffer.alloc(n * 2);
  let s = seed;
  const rnd = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647 - 0.5;
  };
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let v = Math.sin(2 * Math.PI * 110 * t) * 0.02 + rnd() * 0.01;
    for (const h of HITS) {
      const dt = t - (h + shift);
      if (dt >= 0 && dt < 0.05) v += rnd() * 1.6 * Math.exp(-dt / 0.008);
    }
    data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 32767))), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sr, 24);
  header.writeUInt32LE(sr * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function encode(view: 'front' | 'side', seconds: number, shift: number): void {
  const tmp = join(tmpdir(), `twoview-${view}.wav`);
  writeFileSync(tmp, wav(seconds, shift, view === 'front' ? 7 : 11));
  const frames = Buffer.concat(
    Array.from({ length: Math.round(FPS * seconds) }, (_, i) => frame(view, i / FPS)),
  );
  const out = join(outDir, `twoview-${view}.webm`);
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
      '-i',
      tmp,
      '-c:v',
      'libvpx-vp9',
      '-b:v',
      '0',
      '-crf',
      '42',
      '-g',
      '30',
      '-c:a',
      'libopus',
      '-b:a',
      '48k',
      '-shortest',
      out,
    ],
    { input: frames, maxBuffer: 1 << 30 },
  );
  rmSync(tmp, { force: true });
  if (res.status !== 0) {
    console.error(res.stderr.toString());
    process.exit(1);
  }
  console.log(`wrote ${out}`);
}

encode('front', FRONT_SECONDS, 0);
encode('side', SIDE_SECONDS, SIDE_OFFSET);
