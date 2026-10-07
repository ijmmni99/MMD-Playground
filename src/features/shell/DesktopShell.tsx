import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from 'react-resizable-panels';
import { Toolbar } from '@/features/app/Toolbar';
import { ModelsPanel } from '@/features/models/ModelsPanel';
import { Inspector } from '@/features/inspector/Inspector';
import { Timeline } from '@/features/timeline/Timeline';
import { Viewport } from '@/features/viewport/Viewport';
import { useStudio } from '@/store/studio';

const Playground = lazy(() => import('@/features/playground/Playground'));
const Video2VmdPanel = lazy(() => import('@/features/video2vmd/Video2VmdPanel'));

export interface PanelToggles {
  left: boolean;
  right: boolean;
  bottom: boolean;
  toggle: (p: 'left' | 'right' | 'bottom') => void;
}

const storage = typeof localStorage !== 'undefined' ? localStorage : undefined;

/** Desktop (> 1024 px): the original dockable, resizable three-panel layout. */
export function DesktopShell() {
  const mode = useStudio((s) => s.mode);
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

  // The playground editor and the video converter need more room than the scene list.
  const sceneWidth = useRef<number | null>(null);
  useEffect(() => {
    const panel = leftRef.current;
    if (!panel) return;
    if (mode !== 'studio') {
      sceneWidth.current ??= panel.getSize().asPercentage;
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

  const toggles: PanelToggles = {
    left: !collapsed.left,
    right: !collapsed.right,
    bottom: !collapsed.bottom,
    toggle,
  };

  return (
    <>
      <div className="flex h-full flex-col">
        <Toolbar panels={toggles} />
        <div className="min-h-0 flex-1">
          <Group
            orientation="horizontal"
            id="mmd-layout-h"
            defaultLayout={outer.defaultLayout}
            onLayoutChanged={outer.onLayoutChanged}
          >
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
              {mode === 'video2vmd' ? (
                <Suspense
                  fallback={
                    <div className="grid h-full place-items-center bg-bg-panel text-fg-muted">Loading…</div>
                  }
                >
                  <Video2VmdPanel />
                </Suspense>
              ) : mode === 'playground' ? (
                <Suspense
                  fallback={
                    <div className="grid h-full place-items-center bg-bg-panel text-fg-muted">
                      Loading editor…
                    </div>
                  }
                >
                  <Playground />
                </Suspense>
              ) : (
                <ModelsPanel />
              )}
            </Panel>
            <Separator className="resize-handle w-px" aria-label="Resize left panel" />
            <Panel id="center" minSize="30%">
              <Group
                orientation="vertical"
                id="mmd-layout-v"
                defaultLayout={inner.defaultLayout}
                onLayoutChanged={inner.onLayoutChanged}
              >
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
      </div>
    </>
  );
}
