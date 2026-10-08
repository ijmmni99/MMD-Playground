import { cn } from '@/components/ui/cn';
import type { NameDisplay } from '@/lib/names';
import { setPref, usePrefs } from '@/store/prefs';

const DISPLAY_OPTIONS: { id: NameDisplay; label: string; title: string }[] = [
  { id: 'en', label: 'EN', title: 'English names' },
  { id: 'ja', label: '日本語', title: 'Japanese names' },
  { id: 'both', label: 'Both', title: 'English (Japanese)' },
];

/** English / Japanese / both switch for bone, morph and material names. */
export function NameDisplaySwitch() {
  const mode = usePrefs((s) => s.nameDisplay);
  return (
    <div
      role="radiogroup"
      aria-label="Name language"
      className="flex shrink-0 rounded border border-line p-0.5"
      data-testid="name-display"
    >
      {DISPLAY_OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={mode === o.id}
          title={o.title}
          onClick={() => setPref('nameDisplay', o.id)}
          className={cn(
            'rounded px-1.5 py-0.5 text-[10px] coarse:min-h-[36px] coarse:px-2.5 coarse:text-[12px]',
            mode === o.id ? 'bg-accent-soft text-fg' : 'text-fg-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
