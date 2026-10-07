import { X } from 'lucide-react';
import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { Toolbar } from '@/features/app/Toolbar';
import { Inspector } from '@/features/inspector/Inspector';
import { ModelsPanel } from '@/features/models/ModelsPanel';
import { Timeline } from '@/features/timeline/Timeline';
import { Viewport } from '@/features/viewport/Viewport';
import { toggleDrawer, useLayout } from '@/store/layout';
import { useStudio } from '@/store/studio';
import type { PanelToggles } from './DesktopShell';

const Playground = lazy(() => import('@/features/playground/Playground'));
const Video2VmdPanel = lazy(() => import('@/features/video2vmd/Video2VmdPanel'));

function Drawer({
  side,
  open,
  label,
  onClose,
  children,
}: {
  side: 'left' | 'right';
  open: boolean;
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <aside
      aria-label={label}
      aria-hidden={!open}
      data-testid={`drawer-${side}`}
      data-open={open}
      className={cn(
        'absolute bottom-0 top-0 z-30 flex w-[min(360px,85%)] flex-col bg-bg-panel shadow-2xl motion-safe:transition-transform motion-safe:duration-300',
        side === 'left' ? 'left-0 border-r border-line' : 'right-0 border-l border-line',
        open ? 'translate-x-0' : side === 'left' ? '-translate-x-full' : 'translate-x-full',
        !open && 'pointer-events-none invisible',
      )}
    >
      <div className="flex h-11 shrink-0 items-center justify-end border-b border-line px-1">
        <button
          type="button"
          aria-label={`Close ${label}`}
          onClick={onClose}
          className="grid h-11 w-11 place-items-center rounded-lg text-fg-muted active:bg-bg-hover hover:bg-bg-hover"
        >
          <X size={18} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </aside>
  );
}

/** Tablet (640–1024 px): viewport with overlay drawers (auto-collapsed) and a bottom timeline. */
export function TabletShell() {
  const drawers = useLayout((s) => s.drawers);
  const mode = useStudio((s) => s.mode);
  useEffect(() => {
    if (mode !== 'studio') useLayout.setState((s) => ({ drawers: { ...s.drawers, left: true } }));
  }, [mode]);
  const toggles: PanelToggles = { ...drawers, toggle: toggleDrawer };
  return (
    <div
      className="flex h-full flex-col bg-bg pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
      data-testid="tablet-shell"
    >
      <Toolbar panels={toggles} />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <Viewport />
          <Drawer
            side="left"
            open={drawers.left}
            label={
              mode === 'playground' ? 'Playground' : mode === 'video2vmd' ? 'Video to VMD' : 'Scene panel'
            }
            onClose={() => toggleDrawer('left')}
          >
            {mode === 'video2vmd' ? (
              <Suspense fallback={<div className="p-4 text-fg-muted">Loading…</div>}>
                <Video2VmdPanel />
              </Suspense>
            ) : mode === 'playground' ? (
              <Suspense fallback={<div className="p-4 text-fg-muted">Loading editor…</div>}>
                <Playground />
              </Suspense>
            ) : (
              <ModelsPanel />
            )}
          </Drawer>
          <Drawer side="right" open={drawers.right} label="Inspector" onClose={() => toggleDrawer('right')}>
            <Inspector />
          </Drawer>
        </div>
        {drawers.bottom && (
          <div className="h-[30%] min-h-[170px] shrink-0 border-t border-line pb-[env(safe-area-inset-bottom)]">
            <Timeline />
          </div>
        )}
      </div>
    </div>
  );
}
