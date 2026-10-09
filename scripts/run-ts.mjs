// Runs a TypeScript script with the app's "@/…" import alias, using the jiti that tailwindcss ships.
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const jitiPath = require.resolve('jiti', { paths: [dirname(require.resolve('tailwindcss/package.json'))] });
const createJiti = require(jitiPath);
const jiti = createJiti(import.meta.url, { alias: { '@': join(root, 'src') }, interopDefault: true });
jiti(resolve(process.argv[2]));
