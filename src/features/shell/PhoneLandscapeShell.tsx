import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { cn } from '@/components/ui/cn';
import { Viewport } from '@/features/viewport/Viewport';
import { haptic } from '@/lib/haptics';
import { setSideTab, useLayout } from '@/store/layout';
import { CompactTransport } from './CompactTransport';
import { TabContent } from './tabs';
import { TABS, tabLabel } from './tabsMeta';

const PANEL_ID = 'landscape-panel';

/** Phone landscape: viewport on the left, one collapsible side panel + icon rail on the right. */
export function PhoneLandscapeShell() {
  const side = useLayout((s) => s.side);
  return (
    <div className="flex h-full w-full bg-bg pl-[env(safe-area-inset-left)]" data-testid="landscape-shell">
      <main className="relative min-w-0 flex-1">
        <Viewport compact />
        <div className="absolute inset-x-2 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-20">
          <CompactTransport overlay />
        </div>
      </main>
      {side.open && (
        <section
          id={PANEL_ID}
          aria-label={`${tabLabel(side.tab)} panel`}
          className="flex w-[min(35vw,380px)] min-w-[260px] flex-col border-l border-line bg-bg-panel"
          data-testid="side-panel"
        >
          <h2 className="flex h-11 shrink-0 items-center border-b border-line px-3 text-[14px] font-semibold">
            {tabLabel(side.tab)}
          </h2>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
            <TabContent tab={side.tab} />
          </div>
        </section>
      )}
      <nav
        className="flex w-14 shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-l border-line bg-bg-panel py-1 pr-[env(safe-area-inset-right)]"
        aria-label="Panels"
        data-testid="tab-bar"
      >
        <button
          type="button"
          aria-label={side.open ? 'Collapse panel' : 'Expand panel'}
          aria-expanded={side.open}
          aria-controls={PANEL_ID}
          onClick={() => useLayout.setState((s) => ({ side: { ...s.side, open: !s.side.open } }))}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-fg-muted active:bg-bg-hover"
        >
          {side.open ? <PanelRightClose size={20} /> : <PanelRightOpen size={20} />}
        </button>
        {TABS.map((t) => {
          const active = side.open && side.tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              aria-label={t.label}
              aria-expanded={active}
              aria-controls={PANEL_ID}
              data-tab={t.id}
              onClick={() => {
                haptic(6);
                setSideTab(t.id);
              }}
              className={cn(
                'grid h-11 w-11 shrink-0 place-items-center rounded-lg',
                active ? 'bg-accent-soft text-accent' : 'text-fg-muted active:bg-bg-hover',
              )}
            >
              {t.icon}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
