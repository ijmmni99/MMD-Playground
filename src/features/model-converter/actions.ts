// Model Converter: drives the worker, keeps a live preview model in the scene, and loads / exports the
// result (PMX + textures + README + report).

import type { VFile } from '@/engine/types';
import { downloadBlob, pickFiles } from '@/features/app/filePickers';
import type { FromWorker, InputFile, ToWorker, WorkerOptions } from '@/lib/convert/protocol';
import { testDance } from '@/lib/convert/testDance';
import type { SourceLicense } from '@/lib/convert/types';
import { isCoarsePointer } from '@/lib/device';
import { zipFiles } from '@/lib/zip';
import { importFiles, removeModel } from '@/store/actions';
import { cv, initialConverter } from '@/store/converter';
import { engineOrNull, whenEngine } from '@/store/engineRef';
import { studio, toast, updateModel, useStudio } from '@/store/studio';

let worker: Worker | null = null;
let seq = 0;
let latest = 0;
const originals = new Map<number, (m: Extract<FromWorker, { type: 'original' }>['mesh']) => void>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../../lib/convert/convert.worker.ts', import.meta.url), { type: 'module', name: 'model-converter' });
  worker.onmessage = (e: MessageEvent<FromWorker>) => onMessage(e.data);
  worker.onerror = (e) => {
    cv.set({ status: 'error', error: e.message || 'The converter stopped unexpectedly (out of memory?).', progress: null });
  };
  return worker;
}

const send = (msg: ToWorker, transfer: Transferable[] = []): void => getWorker().postMessage(msg, transfer);

function onMessage(msg: FromWorker): void {
  switch (msg.type) {
    case 'progress':
      cv.set({ progress: { stage: msg.stage, value: msg.progress } });
      break;
    case 'parsed': {
      const big = msg.summary.bytes > 150 * 1024 * 1024 || msg.summary.vertices > 300_000;
      if (big) toast('warning', 'This is a very large model: conversion may be slow and use a lot of memory. Textures will be downscaled.', 9000);
      cv.set((s) => ({
        summary: msg.summary,
        options: { ...s.options, maxTexture: s.options.maxTexture ?? (isCoarsePointer() || big ? 2048 : 0) },
      }));
      convertNow();
      break;
    }
    case 'converted': {
      if (msg.id !== latest) return;
      const first = !cv.get().result;
      cv.set({ result: msg.payload, status: 'ready', progress: null, error: null, ...(first ? { step: 'check' as const } : {}) });
      if (msg.payload.errors.length) toast('warning', `The PMX has problems: ${msg.payload.errors[0]}`, 9000);
      schedulePreview();
      break;
    }
    case 'original':
      originals.get(msg.id)?.(msg.mesh);
      originals.delete(msg.id);
      break;
    case 'error':
      if (msg.id !== undefined && msg.id !== latest) return;
      cv.set({ status: 'error', error: msg.message, progress: null });
      break;
  }
}

/** Start a conversion session from dropped / picked files (model or ZIP with textures). */
export async function importConverterFiles(files: VFile[]): Promise<void> {
  if (!files.length) return;
  await discardPreview();
  const keep = cv.get().options;
  cv.set({ ...initialConverter(), options: { maxTexture: keep.maxTexture }, status: 'parsing', progress: { stage: 'Reading files', value: 0 } });
  const input: InputFile[] = files.map((f) => ({ path: f.path, data: f.blob }));
  send({ type: 'parse', files: input });
}

export async function pickConverterFiles(): Promise<void> {
  const files = await pickFiles('.zip,.vrm,.glb,.gltf,.fbx,.bin,.png,.jpg,.jpeg,.tga,.bmp,.webp', true);
  await importConverterFiles(files);
}

/** The procedural VRM test humanoid (no third-party assets). */
export async function loadSample(): Promise<void> {
  const { makeHumanoid } = await import('@/lib/convert/fixture');
  const { bytes } = makeHumanoid({ style: 'vrm', vrm: 1, name: 'Test humanoid' });
  await importConverterFiles([{ path: 'test-humanoid.vrm', blob: new Blob([bytes as BlobPart]) }]);
}

export function convertNow(): void {
  if (!cv.get().summary) return;
  latest = ++seq;
  cv.set({ status: 'converting', progress: { stage: 'Converting', value: 0.4 } });
  send({ type: 'convert', id: latest, options: cv.get().options });
}

let timer: ReturnType<typeof setTimeout> | null = null;
/** Change options and reconvert (debounced). */
export function setOptions(patch: Partial<WorkerOptions>): void {
  cv.set((s) => ({ options: { ...s.options, ...patch } }));
  if (timer) clearTimeout(timer);
  timer = setTimeout(convertNow, 250);
}

/** Stop the worker (cancel a long conversion). */
export function cancelConversion(): void {
  worker?.terminate();
  worker = null;
  cv.set({ status: cv.get().result ? 'ready' : 'idle', progress: null });
}

// ---------------------------------------------------------------- output files

const safeName = (s: string): string =>
  s.normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'model';

function outputFiles(folder: string): VFile[] {
  const r = cv.get().result;
  if (!r) return [];
  return [
    { path: `${folder}/model.pmx`, blob: new Blob([r.pmx]) },
    ...r.textures.map((t) => ({ path: `${folder}/${t.path}`, blob: new Blob([t.data], { type: t.mime }) })),
  ];
}

export function licenseLines(l: SourceLicense | undefined): string[] {
  if (!l) return [];
  const rows: [string, string | undefined][] = [
    ['Title', l.title],
    ['Author', l.author],
    ['Version', l.version],
    ['Allowed users', l.allowedUsers],
    ['Commercial use', l.commercial],
    ['Redistribution', l.redistribution],
    ['Modification', l.modification],
    ['Violent use', l.violence],
    ['Sexual use', l.sexual],
    ['License', l.licenseName],
    ['License URL', l.url],
    ['Other terms', l.otherUrl],
    ['Notes', l.text],
  ];
  return rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
}

function readme(): string {
  const { summary, result } = cv.get();
  const lic = licenseLines(summary?.license);
  return [
    `${summary?.name ?? 'Model'} — converted to PMX by MMD Studio`,
    '',
    `Source file: ${summary?.file} (${summary?.format.toUpperCase()})`,
    `Converted: ${new Date().toISOString()}`,
    '',
    'LICENSE OF THE ORIGINAL MODEL (unchanged — you must follow it):',
    ...(lic.length ? lic.map((x) => `  ${x}`) : ['  No license information was found in the file. Check the terms where you got the model.']),
    '',
    'Converter notes:',
    '  - Materials approximate the original shaders (MToon / PBR → MMD diffuse, ambient, edge).',
    '  - Physics (hair, skirt…) is generated automatically and is less tuned than a hand-made PMX.',
    ...(result?.report.fixes ?? []).map((f) => `  - ${f}`),
    ...(result?.report.warnings.length ? ['', 'Warnings:', ...result.report.warnings.map((w) => `  - ${w}`)] : []),
    '',
    'Files: model.pmx, tex/ (textures), conversion-report.json',
  ].join('\r\n');
}

export async function downloadZip(): Promise<void> {
  const { result, summary } = cv.get();
  if (!result || !summary) return;
  if (!checkLicense()) return;
  const name = safeName(summary.name);
  const files = outputFiles(name).map((f) => ({ path: f.path.slice(name.length + 1), data: f.blob }));
  files.push({ path: 'README.txt', data: new Blob([`\uFEFF${readme()}`]) });
  files.push({ path: 'conversion-report.json', data: new Blob([JSON.stringify({ ...result.report, license: summary.license ?? null }, null, 2)]) });
  downloadBlob(await zipFiles(files), `${name}_pmx.zip`);
  toast('success', 'PMX ZIP downloaded');
}

function checkLicense(): boolean {
  if (cv.get().licenseAck) return true;
  cv.set({ step: 'export' });
  toast('warning', 'Confirm that the model’s license allows this use first (Export step).');
  return false;
}

// ---------------------------------------------------------------- preview / studio

let previewTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePreview(): void {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(() => void refreshPreview(), 400);
}

async function addModelFiles(files: VFile[]): Promise<string | null> {
  const before = new Set(studio.get().models.map((m) => m.id));
  await importFiles(files);
  return studio.get().models.find((m) => !before.has(m.id))?.id ?? null;
}

/** Replace the preview model with the latest conversion and start the test dance. */
export async function refreshPreview(): Promise<void> {
  const { result, summary } = cv.get();
  if (!result || !summary || studio.get().mode !== 'converter') return;
  await discardPreview(false);
  const id = await addModelFiles(outputFiles(`converted/${safeName(summary.name)}`));
  if (!id) return;
  updateModel(id, { name: `${summary.name} (preview)` });
  cv.set({ previewModelId: id });
  playTestDance();
  if (cv.get().showOriginal) void showOriginal(true);
}

export async function discardPreview(clearOriginal = true): Promise<void> {
  const id = cv.get().previewModelId;
  if (id && id !== cv.get().loadedModelId && studio.get().models.some((m) => m.id === id)) removeModel(id);
  cv.set({ previewModelId: null });
  if (clearOriginal) engineOrNull()?.setPreviewMesh(null);
}

export function playTestDance(): void {
  const id = cv.get().previewModelId;
  const engine = engineOrNull();
  if (!id || !engine) return;
  const info = engine.setMotionClip(id, testDance(), 'Test dance');
  updateModel(id, { motion: info });
  engine.seek(0);
  engine.play();
}

export async function playMotionFile(): Promise<void> {
  const id = cv.get().previewModelId;
  if (!id) return;
  const files = await pickFiles('motion');
  if (!files.length) return;
  studio.set({ selectedModelId: id });
  await importFiles(files);
  engineOrNull()?.seek(0);
  engineOrNull()?.play();
}

/** Side by side: the source geometry (static) next to the converted model. */
export async function showOriginal(on: boolean): Promise<void> {
  cv.set({ showOriginal: on });
  const engine = await whenEngine();
  if (!on || !cv.get().result) {
    engine.setPreviewMesh(null);
    return;
  }
  const id = ++seq;
  const mesh = await new Promise<Extract<FromWorker, { type: 'original' }>['mesh']>((resolve) => {
    originals.set(id, resolve);
    send({ type: 'original', id });
  });
  if (cv.get().showOriginal) engine.setPreviewMesh({ ...mesh, offset: [-14, 0, 0] });
}

/** Keep the converted model in the scene (saved with the project). */
export async function loadIntoStudio(): Promise<void> {
  const { result, summary, previewModelId } = cv.get();
  if (!result || !summary) return;
  if (!checkLicense()) return;
  let id = previewModelId;
  if (!id || !studio.get().models.some((m) => m.id === id)) id = await addModelFiles(outputFiles(`converted/${safeName(summary.name)}`));
  if (!id) return;
  updateModel(id, { name: summary.name });
  cv.set({ loadedModelId: id, previewModelId: null });
  engineOrNull()?.setPreviewMesh(null);
  studio.set({ mode: 'studio', selectedModelId: id });
  toast('success', `${summary.name} is in the scene — it’s saved with the project.`);
}

// Leaving the converter drops an un-kept preview.
useStudio.subscribe((s, prev) => {
  if (prev.mode === 'converter' && s.mode !== 'converter') void discardPreview();
  if (prev.mode !== 'converter' && s.mode === 'converter' && cv.get().result && !cv.get().previewModelId) schedulePreview();
});
