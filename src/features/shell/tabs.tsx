import { lazy, Suspense } from 'react';
import type { SheetTab } from '@/store/layout';
import { ModelsPanel } from '@/features/models/ModelsPanel';
import { ModelInspector } from '@/features/inspector/ModelInspector';
import { ScenePanel } from '@/features/inspector/ScenePanel';
import { CameraPanel } from '@/features/inspector/CameraPanel';
import { Timeline } from '@/features/timeline/Timeline';

// Capture and More are only needed on demand; keep them out of the initial phone render.
const ExportPanel = lazy(() =>
  import('@/features/export/ExportPanel').then((m) => ({ default: m.ExportPanel })),
);
const MoreMenu = lazy(() => import('./MoreMenu'));
const Video2VmdPanel = lazy(() => import('@/features/video2vmd/Video2VmdPanel'));
const ConverterPanel = lazy(() => import('@/features/model-converter/ConverterPanel'));
const ModelEditorPanel = lazy(() => import('@/features/model-editor/ModelEditorPanel'));

const Loading = () => <div className="p-6 text-center text-fg-muted">Loading…</div>;

/** The same panel components used by the desktop layout, hosted in sheets / side panels. */
export function TabContent({ tab }: { tab: SheetTab }) {
  switch (tab) {
    case 'scene':
      return (
        <>
          <ScenePanel />
          <CameraPanel />
        </>
      );
    case 'models':
      return <ModelsPanel embedded />;
    case 'inspector':
      return <ModelInspector />;
    case 'timeline':
      return (
        <div className="h-full min-h-[220px]">
          <Timeline />
        </div>
      );
    case 'capture':
      return (
        <Suspense fallback={<Loading />}>
          <ExportPanel />
        </Suspense>
      );
    case 'converter':
      return (
        <Suspense fallback={<Loading />}>
          <ConverterPanel embedded />
        </Suspense>
      );
    case 'modeledit':
      return (
        <Suspense fallback={<Loading />}>
          <ModelEditorPanel embedded />
        </Suspense>
      );
    case 'video2vmd':
      return (
        <Suspense fallback={<Loading />}>
          <Video2VmdPanel embedded />
        </Suspense>
      );
    case 'more':
      return (
        <Suspense fallback={<Loading />}>
          <MoreMenu />
        </Suspense>
      );
  }
}
