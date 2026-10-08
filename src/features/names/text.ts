import { formatName, SOURCE_LABEL, type NameKind, type ResolvedName } from '@/lib/names';
import { useNameTable } from '@/store/names';
import { usePrefs } from '@/store/prefs';

/** Tooltip: the original Japanese name and where the label came from. */
export function nameTooltip(r: ResolvedName): string {
  if (r.source === 'original') return `${r.ja} · ${SOURCE_LABEL.original}`;
  return `${r.ja} → ${r.en} · ${SOURCE_LABEL[r.source]}`;
}

/** Plain-text label (selects, aria labels, toasts). */
export function useNameText(modelId: string | null | undefined) {
  const table = useNameTable(modelId);
  const mode = usePrefs((s) => s.nameDisplay);
  return (kind: NameKind, ja: string): string => formatName(table.get(kind, ja), mode) || ja;
}
