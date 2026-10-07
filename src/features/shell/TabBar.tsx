import { cn } from '@/components/ui/cn';
import { haptic } from '@/lib/haptics';
import { toggleSheet, useLayout, type SheetTab } from '@/store/layout';
import { TABS } from './tabsMeta';

export function TabBar({ sheetId }: { sheetId: string }) {
  const sheet = useLayout((s) => s.sheet);
  return (
    <nav
      className="flex shrink-0 border-t border-line bg-bg-panel pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
      aria-label="Panels"
      data-testid="tab-bar"
    >
      {TABS.map((t) => {
        const active = sheet.tab === t.id && sheet.snap !== 'closed';
        return (
          <button
            key={t.id}
            type="button"
            aria-expanded={active}
            aria-controls={sheetId}
            data-tab={t.id}
            onClick={() => {
              haptic(6);
              toggleSheet(t.id as SheetTab);
            }}
            className={cn(
              'flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium',
              active ? 'text-accent' : 'text-fg-muted active:text-fg',
            )}
          >
            {t.icon}
            <span className="truncate">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
