// Copy MediaPipe's WASM runtime into public/ so it is self-hosted (version-locked with the npm package).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const dest = join(root, 'public/mediapipe/wasm');
mkdirSync(dest, { recursive: true });
for (const f of ['vision_wasm_module_internal.js', 'vision_wasm_module_internal.wasm']) {
  const to = join(dest, f);
  if (!existsSync(to)) copyFileSync(join(src, f), to);
}
console.log('MediaPipe WASM ready in public/mediapipe/wasm');
