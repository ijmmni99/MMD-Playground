import * as RTooltip from '@radix-ui/react-tooltip';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from 'react-resizable-panels';
import { Toolbar } from '@/features/app/Toolbar';
import { Toasts } from '@/features/app/Toasts';
import { Dialogs } from '@/features/app/Dialogs';
import { useShortcuts } from '@/features/app/useShortcuts';
import { ModelsPanel } from '@/features/models/ModelsPanel';
import { Inspector } from '@/features/inspector/Inspector';
import { Timeline } from '@/features/timeline/Timeline';
import { Viewport } from '@/features/viewport/Viewport';
import { useStudio } from '@/store/studio';

const Playground = lazy(() => import('@/features/playground/Playground'));

export interface PanelToggles {
  left: boolean;
  right: boolean;
  bottom: boolean;
  toggle: (p: 'left' | 'right' | 'bottom') => void;
}

const storage = typeof localStorage !== 'undefined' ? localStorage : undefined;

export default function App() {
  const mode = useStudio((s) => s.mode);
  useShortcuts();
  const leftRef = usePanelRef();
  const rightRef = usePanelRef();
  const bottomRef = usePanelRef();
  const [collapsed, setCollapsed] = useState({ left: false, right: false, bottom: false });
  const outer = useDefaultLayout({ id: 'mmd-layout-h', storage });
  const inner = useDefaultLayout({ id: 'mmd-layout-v', storage });

  const toggle = (p: 'left' | 'right' | 'bottom'): void => {
    const ref = p === 'left' ? leftRef : p === 'right' ? rightRef : bottomRef;
    const panel = ref.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand();
    else panel.collapse();
  };

  // The playground editor needs more room than the scene list.
  const sceneWidth = useRef<number | null>(null);
  useEffect(() => {
    const panel = leftRef.current;
    if (!panel) return;
    if (mode === 'playground') {
      sceneWidth.current = panel.getSize().asPercentage;
      if (panel.isCollapsed()) panel.expand();
      if (panel.getSize().asPercentage < 34) panel.resize('34%');
    } else if (sceneWidth.current !== null) {
      panel.resize(`${sceneWidth.current}%`);
      sceneWidth.current = null;
    }
  }, [mode, leftRef]);

  useEffect(() => {
    // Tablets: start with the scene panel collapsed.
    if (window.innerWidth < 1100 && !localStorage.getItem('mmd-layout-h')) leftRef.current?.collapse();
  }, [leftRef]);

  const toggles: PanelToggles = { left: !collapsed.left, right: !collapsed.right, bottom: !collapsed.bottom, toggle };

  return (
    <RTooltip.Provider>
      <div className="flex h-full flex-col">
        <Toolbar panels={toggles} />
        <MobileNotice />
        <div className="min-h-0 flex-1">
          <Group orientation="horizontal" id="mmd-layout-h" defaultLayout={outer.defaultLayout} onLayoutChanged={outer.onLayoutChanged}>
            <Panel
              id="left"
              panelRef={leftRef}
              defaultSize="18%"
              minSize="180px"
              maxSize="50%"
              collapsible
              collapsedSize={0}
              onResize={(size) => setCollapsed((c) => ({ ...c, left: size.inPixels < 2 }))}
            >
              {mode === 'playground' ? (
                <Suspense fallback={<div className="grid h-full place-items-center bg-bg-panel text-fg-muted">Loading editor…</div>}>
                  <Playground />
                </Suspense>
              ) : (
                <ModelsPanel />
              )}
            </Panel>
            <Separator className="resize-handle w-px" aria-label="Resize left panel" />
            <Panel id="center" minSize="30%">
              <Group orientation="vertical" id="mmd-layout-v" defaultLayout={inner.defaultLayout} onLayoutChanged={inner.onLayoutChanged}>
                <Panel id="viewport" minSize="25%">
                  <Viewport />
                </Panel>
                <Separator className="resize-handle h-px" aria-label="Resize timeline" />
                <Panel
                  id="timeline"
                  panelRef={bottomRef}
                  defaultSize="26%"
                  minSize="90px"
                  maxSize="60%"
                  collapsible
                  collapsedSize={0}
                  onResize={(size) => setCollapsed((c) => ({ ...c, bottom: size.inPixels < 2 }))}
                >
                  <Timeline />
                </Panel>
              </Group>
            </Panel>
            <Separator className="resize-handle w-px" aria-label="Resize inspector" />
            <Panel
              id="right"
              panelRef={rightRef}
              defaultSize="22%"
              minSize="240px"
              maxSize="40%"
              collapsible
              collapsedSize={0}
              onResize={(size) => setCollapsed((c) => ({ ...c, right: size.inPixels < 2 }))}
            >
              <Inspector />
            </Panel>
          </Group>
        </div>
        <Toasts />
        <Dialogs />
      </div>
    </RTooltip.Provider>
  );
}

function MobileNotice() {
  const [hidden, setHidden] = useState(() => window.innerWidth >= 700 || sessionStorage.getItem('mmd-mobile-ok') === '1');
  if (hidden) return null;
  return (
    <div role="status" className="flex items-center gap-3 border-b border-warn/30 bg-warn/10 px-3 py-2 text-[12px] text-warn">
      <span className="flex-1">MMD Studio is designed for desktop or tablet screens. Some panels may be cramped on a phone.</span>
      <button
        type="button"
        className="rounded border border-warn/40 px-2 py-0.5 hover:bg-warn/20"
        onClick={() => {
          sessionStorage.setItem('mmd-mobile-ok', '1');
          setHidden(true);
        }}
      >
        Continue anyway
      </button>
    </div>
  );
}
