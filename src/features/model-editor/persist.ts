// Model Editor sessions in the project document (op lists, original file refs, added textures, donors).

import { emptyHistory } from '@/lib/model-edit/history';
import { me, type EditSession, type ModelEditorDoc } from '@/store/modelEditor';
import { restoreSessions, sessionsForDoc } from './actions';

export function buildModelEditorDoc(): ModelEditorDoc | undefined {
  const sessions = sessionsForDoc().filter(
    (s) => s.history.ops.length || Object.keys(s.donors).length || s.outfitPresets.length,
  );
  const presets = me.get().proportionPresets;
  if (!sessions.length && !presets.length) return undefined;
  return {
    sessions: sessions.map((s) => ({
      modelId: s.modelId,
      mainPath: s.mainPath,
      files: s.files,
      ops: s.history.ops,
      assets: Object.values(s.assets),
      donors: Object.values(s.donors),
      outfitPresets: s.outfitPresets.length ? s.outfitPresets : undefined,
    })),
    proportionPresets: presets.length ? presets : undefined,
  };
}

export async function restoreModelEditor(doc: ModelEditorDoc | undefined): Promise<void> {
  const list: EditSession[] = (doc?.sessions ?? []).map((s) => ({
    modelId: s.modelId,
    mainPath: s.mainPath,
    files: s.files,
    history: emptyHistory(s.ops),
    assets: Object.fromEntries(s.assets.map((a) => [a.blobId, a])),
    donors: Object.fromEntries(s.donors.map((d) => [d.id, d])),
    outfitPresets: s.outfitPresets ?? [],
  }));
  await restoreSessions(list, doc?.proportionPresets ?? []);
}
