import { cn } from '@/components/ui/cn';
import { formatName, type NameKind } from '@/lib/names';
import { useNameTable } from '@/store/names';
import { usePrefs } from '@/store/prefs';
import { nameTooltip } from './text';
import { useNameMenu } from './useNameMenu';

/** A bone / morph / material name, shown per the English / Japanese / both setting. */
export function NameLabel({
  modelId,
  kind,
  ja,
  className,
  fallback,
}: {
  modelId: string | null | undefined;
  kind: NameKind;
  ja: string;
  className?: string;
  /** Shown for an empty name. */
  fallback?: string;
}) {
  const table = useNameTable(modelId);
  const mode = usePrefs((s) => s.nameDisplay);
  const menu = useNameMenu(modelId, kind, ja);
  const r = table.get(kind, ja);
  const guessed = r.source === 'pattern' && mode !== 'ja';
  return (
    <span
      className={cn(
        'min-w-0 truncate',
        guessed && 'decoration-fg-dim/70 underline decoration-dotted underline-offset-2',
        className,
      )}
      title={ja ? nameTooltip(r) : fallback}
      data-name-source={r.source}
      data-ja={ja}
      {...menu}
    >
      {formatName(r, mode) || fallback}
      {guessed && (
        <span aria-label="(guessed)" className="ml-0.5 text-[9px] text-fg-dim no-underline">
          ≈
        </span>
      )}
    </span>
  );
}
