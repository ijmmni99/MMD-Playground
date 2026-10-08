import { downloadBlob, pickFiles } from '@/features/app/filePickers';
import type { LabelOverrides } from '@/lib/names';
import { getLabels, importLabels } from '@/store/names';
import { studio, toast } from '@/store/studio';

/** Export one model's labels as a small JSON file (shareable dictionary for that model). */
export function exportLabelsFile(modelId: string): void {
  const model = studio.get().models.find((m) => m.id === modelId);
  if (!model) return;
  const labels = getLabels(modelId);
  const body = { format: 'mmd-studio-labels', version: 1, model: model.info.name, labels };
  downloadBlob(
    new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }),
    `${model.name.replace(/[\\/:*?"<>|]+/g, '_')}.labels.json`,
  );
}

/** Import a labels JSON file into a model (merged with existing labels). */
export async function importLabelsFile(modelId: string): Promise<void> {
  const files = await pickFiles('.json,application/json');
  const f = files?.[0];
  if (!f) return;
  try {
    const json = JSON.parse(await f.blob.text()) as { labels?: LabelOverrides } & LabelOverrides;
    const n = importLabels(modelId, json.labels ?? json);
    toast(n ? 'success' : 'warning', n ? `Imported ${n} labels` : 'No labels found in that file');
  } catch (e) {
    toast('error', `Not a labels file: ${(e as Error).message}`);
  }
}
