/// <reference lib="webworker" />
// Converter worker: unzip → parse (glTF / GLB / VRM / FBX) → convert → textures → PMX bytes.

import { unzipBuffer } from '../zip';
import { parseFbx } from './fbx';
import { parseGltf } from './gltf';
import { convertModel } from './pipeline';
import { writePmx } from './pmx/writer';
import type { FromWorker, InputFile, ToWorker, WorkerOptions } from './protocol';
import type { SourceModel } from './types';

const post = (msg: FromWorker, transfer: Transferable[] = []): void =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

let source: SourceModel | null = null;
let lastModel: SourceModel | null = null;

const MODEL_EXT = /\.(vrm|glb|gltf|fbx)$/i;
const rank = (p: string): number => ['.vrm', '.glb', '.gltf', '.fbx'].findIndex((e) => p.toLowerCase().endsWith(e));

async function expand(files: InputFile[]): Promise<{ path: string; data: Uint8Array }[]> {
  const out: { path: string; data: Uint8Array }[] = [];
  for (const f of files) {
    const buf = await f.data.arrayBuffer();
    if (/\.zip$/i.test(f.path)) {
      post({ type: 'progress', stage: 'Unpacking ZIP', progress: 0.05 });
      for (const e of await unzipBuffer(buf)) out.push({ path: e.path, data: new Uint8Array(e.data) });
    } else out.push({ path: f.path, data: new Uint8Array(buf) });
  }
  return out;
}

async function parse(files: InputFile[]): Promise<void> {
  source = null;
  lastModel = null;
  const all = await expand(files);
  const models = all.filter((f) => MODEL_EXT.test(f.path) && !/(^|\/)__MACOSX\//.test(f.path)).sort((a, b) => rank(a.path) - rank(b.path));
  if (!models.length) throw new Error('No .vrm, .glb, .gltf or .fbx file found.');
  const main = models[0];
  const dir = main.path.includes('/') ? main.path.slice(0, main.path.lastIndexOf('/') + 1) : '';
  const byName = new Map<string, Uint8Array>();
  for (const f of all) {
    byName.set(f.path.toLowerCase(), f.data);
    byName.set(f.path.split('/').pop()!.toLowerCase(), f.data);
  }
  const resolve = (uri: string): Uint8Array | undefined => {
    const clean = uri.replace(/\\/g, '/').replace(/^\.\//, '');
    return byName.get((dir + clean).toLowerCase()) ?? byName.get(clean.toLowerCase()) ?? byName.get(clean.split('/').pop()!.toLowerCase());
  };
  post({ type: 'progress', stage: 'Reading the model', progress: 0.2 });
  const fileName = main.path.split('/').pop()!;
  source = /\.fbx$/i.test(main.path)
    ? await parseFbx(main.data.buffer.slice(main.data.byteOffset, main.data.byteOffset + main.data.byteLength) as ArrayBuffer, resolve, fileName)
    : parseGltf(main.data, resolve, fileName);
  if (models.length > 1) source.warnings.push(`Several models in the upload; converting ${fileName}.`);
  const bytes = all.reduce((s, f) => s + f.data.length, 0);
  post({
    type: 'parsed',
    summary: {
      name: source.name,
      format: source.format,
      file: fileName,
      bones: source.bones.map((b) => ({ name: b.name, parent: b.parent })),
      vertices: source.meshes.reduce((s, m) => s + m.positions.length / 3, 0),
      triangles: source.meshes.reduce((s, m) => s + m.indices.length / 3, 0),
      materials: source.materials.length,
      textures: source.textures.map((t) => ({ name: t.name, bytes: t.data.length })),
      license: source.license,
      warnings: source.warnings,
      bytes,
    },
  });
}

/** Decode, downscale and re-encode a texture when needed (OffscreenCanvas); otherwise pass it through. */
async function processTexture(data: Uint8Array, mime: string, path: string, max: number): Promise<{ data: Uint8Array; mime: string }> {
  const outMime = /\.jpg$/i.test(path) ? 'image/jpeg' : /\.tga$/i.test(path) ? 'image/tga' : /\.bmp$/i.test(path) ? 'image/bmp' : 'image/png';
  const needsReencode = !/png|jpe?g|tga|bmp/i.test(mime);
  if ((!max && !needsReencode) || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined' || /tga/i.test(mime))
    return { data, mime: outMime };
  try {
    const bmp = await createImageBitmap(new Blob([data as BlobPart], { type: mime }));
    const scale = max ? Math.min(1, max / Math.max(bmp.width, bmp.height)) : 1;
    if (scale >= 1 && !needsReencode) {
      bmp.close();
      return { data, mime: outMime };
    }
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const type = outMime === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    const blob = await canvas.convertToBlob({ type, quality: 0.92 });
    return { data: new Uint8Array(await blob.arrayBuffer()), mime: type };
  } catch {
    return { data, mime: outMime };
  }
}

async function convert(id: number, options: WorkerOptions): Promise<void> {
  if (!source) throw new Error('Nothing loaded.');
  post({ type: 'progress', stage: 'Converting', progress: 0.5 });
  const r = convertModel(source, options);
  lastModel = r.model;
  post({ type: 'progress', stage: 'Textures', progress: 0.75 });
  const textures: { path: string; mime: string; data: ArrayBuffer }[] = [];
  for (const t of r.textures) {
    const src = source.textures[t.source];
    const out = await processTexture(src.data, src.mime, t.path, options.maxTexture ?? 0);
    textures.push({ path: t.path, mime: out.mime, data: out.data.slice().buffer as ArrayBuffer });
  }
  post({ type: 'progress', stage: 'Writing PMX', progress: 0.9 });
  const pmx = writePmx(r.pmx);
  const morphNames: Record<string, string> = {};
  for (const m of r.morphPlan.morphs) morphNames[m.key] = m.name;
  post(
    {
      type: 'converted',
      id,
      payload: {
        report: r.report,
        map: r.map,
        weak: r.mapping.weak,
        humanoid: r.report.humanoid,
        morphEntries: r.morphPlan.entries,
        morphNames,
        chains: r.chains.map(({ vrm: _vrm, ...c }) => c),
        boneNames: r.pmx.bones.map((b) => b.name),
        pmx,
        textures,
        errors: r.validation.filter((v) => v.level === 'error').map((v) => v.message),
      },
    },
    [pmx, ...textures.map((t) => t.data)],
  );
}

/** The normalised source as one coloured mesh in MMD space (original-model preview). */
function original(id: number): void {
  const m = lastModel;
  if (!m) throw new Error('Convert first.');
  const nv = m.meshes.reduce((s, x) => s + x.positions.length / 3, 0);
  const positions = new Float32Array(nv * 3);
  const colors = new Float32Array(nv * 4);
  const idx: number[] = [];
  let off = 0;
  for (const mesh of m.meshes) {
    const n = mesh.positions.length / 3;
    const c = m.materials[mesh.material]?.color ?? [0.8, 0.8, 0.8, 1];
    for (let v = 0; v < n; v++) {
      positions.set([mesh.positions[v * 3], mesh.positions[v * 3 + 1], -mesh.positions[v * 3 + 2]], (off + v) * 3);
      colors.set([c[0], c[1], c[2], 1], (off + v) * 4);
    }
    for (let t = 0; t + 2 < mesh.indices.length; t += 3) idx.push(mesh.indices[t] + off, mesh.indices[t + 2] + off, mesh.indices[t + 1] + off);
    off += n;
  }
  const indices = Uint32Array.from(idx);
  post({ type: 'original', id, mesh: { positions, indices, colors } }, [positions.buffer, indices.buffer, colors.buffer]);
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  try {
    if (msg.type === 'parse') await parse(msg.files);
    else if (msg.type === 'convert') await convert(msg.id, msg.options);
    else if (msg.type === 'original') original(msg.id);
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err), id: 'id' in msg ? msg.id : undefined });
  }
};
