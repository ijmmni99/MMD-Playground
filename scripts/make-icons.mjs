// Renders the MMD Studio app icons (PWA + Apple touch) as PNGs with no image dependencies.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

function crc32(buf) {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BG = [76, 107, 234];
const M = [
  [8, 23],
  [8, 9],
  [16, 17],
  [24, 9],
  [24, 23],
];
function segDist(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax,
    dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
/** @param maskable full-bleed background and logo inside the 80% safe zone */
function icon(size, maskable) {
  const out = Buffer.alloc(size * size * 4);
  const ss = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0,
        fg = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = ((x + (sx + 0.5) / ss) / size) * 32;
          const v = ((y + (sy + 0.5) / ss) / size) * 32;
          // rounded square (radius 7 of 32) unless maskable
          const r = 7;
          const cx = Math.max(r, Math.min(32 - r, u)),
            cy = Math.max(r, Math.min(32 - r, v));
          const inside = maskable || Math.hypot(u - cx, v - cy) <= r;
          if (!inside) continue;
          bg++;
          // logo coordinates: shrink into the safe zone for maskable icons
          const k = maskable ? 0.7 : 1;
          const lu = (u - 16) / k + 16,
            lv = (v - 16) / k + 16;
          let d = Infinity;
          for (let i = 0; i < M.length - 1; i++) d = Math.min(d, segDist(lu, lv, M[i], M[i + 1]));
          if (d <= 1.6) fg++;
        }
      }
      const n = ss * ss;
      const i = (y * size + x) * 4;
      const a = bg / n,
        w = fg / Math.max(1, bg);
      out[i] = Math.round(BG[0] + (255 - BG[0]) * w);
      out[i + 1] = Math.round(BG[1] + (255 - BG[1]) * w);
      out[i + 2] = Math.round(BG[2] + (255 - BG[2]) * w);
      out[i + 3] = Math.round(a * 255);
    }
  }
  return png(size, size, out);
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', icon(192, false));
writeFileSync('public/icons/icon-512.png', icon(512, false));
writeFileSync('public/icons/maskable-512.png', icon(512, true));
writeFileSync('public/icons/apple-touch-icon.png', icon(180, true));
writeFileSync('public/icons/favicon-32.png', icon(32, false));
console.log('icons written to public/icons');
