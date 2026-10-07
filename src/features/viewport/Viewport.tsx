import { Axis3D, BarChart3, Camera, Focus, Grid3x3, Move3D, Plane, Rotate3D, Video } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createStudioEngine } from '@/engine/StudioEngine';
import type { CameraMode } from '@/engine/types';
import { IconButton } from '@/components/ui/controls';
import { cn } from '@/components/ui/cn';
import { setEngine } from '@/store/engineRef';
import { useStudio, studio } from '@/store/studio';
import {
  focusSelected,
  importDataTransfer,
  setCameraMode,
  setGizmoMode,
  updateSettings,
} from '@/store/actions';
import { connectEngine } from '@/features/app/bridge';
import { restoreLastProject, startAutosave } from '@/features/project/persistence';
import { EmptyState } from './EmptyState';

export function Viewport() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ready = useStudio((s) => s.engineReady);
  const error = useStudio((s) => s.engineError);
  const hasModels = useStudio((s) => s.models.length > 0);
  const restoring = useStudio((s) => s.project.restoring);
  const tasks = useStudio((s) => s.tasks);
  const dragActive = useStudio((s) => s.dragActive);
  const [dragDepth, setDragDepth] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let cleanup: (() => void) | null = null;
    createStudioEngine(canvas)
      .then(async (engine) => {
        if (disposed) {
          engine.dispose();
          return;
        }
        const disconnect = connectEngine(engine);
        setEngine(engine);
        engine.applySettings(studio.get().settings);
        studio.set({ engineReady: true });
        (window as unknown as { __studio?: unknown }).__studio = engine;
        await restoreLastProject();
        const stopAutosave = startAutosave();
        cleanup = () => {
          stopAutosave();
          disconnect();
          setEngine(null);
          engine.dispose();
        };
      })
      .catch((e: unknown) => {
        console.error(e);
        studio.set({ engineError: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  const taskList = Object.entries(tasks);

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-[#0c0e12]"
      onDragEnter={(e) => {
        e.preventDefault();
        setDragDepth((d) => d + 1);
        studio.set({ dragActive: true });
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        setDragDepth((d) => {
          if (d <= 1) studio.set({ dragActive: false });
          return Math.max(0, d - 1);
        });
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragDepth(0);
        studio.set({ dragActive: false });
        void importDataTransfer(e.dataTransfer);
      }}
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full outline-none"
        tabIndex={0}
        aria-label="3D viewport. Drag to orbit, right-drag to pan, scroll to zoom."
        data-testid="viewport-canvas"
        onContextMenu={(e) => e.preventDefault()}
      />
      {ready && <ViewportToolbar />}
      {ready && <StatsOverlay />}
      {ready && !hasModels && !restoring && taskList.length === 0 && <EmptyState />}
      {!ready && !error && (
        <div className="absolute inset-0 grid place-items-center text-fg-muted">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            <span>Starting 3D engine…</span>
          </div>
        </div>
      )}
      {error && (
        <div role="alert" className="absolute inset-0 grid place-items-center p-6 text-center">
          <div className="max-w-md rounded-lg border border-danger/40 bg-bg-panel p-5">
            <h2 className="mb-2 text-[15px] font-semibold text-danger">The 3D engine could not start</h2>
            <p className="text-fg-muted">{error}</p>
            <p className="mt-3 text-[12px] text-fg-dim">
              MMD Studio requires WebGL2. Try an up-to-date Chrome, Edge, Firefox or Safari with hardware
              acceleration enabled.
            </p>
          </div>
        </div>
      )}
      {taskList.length > 0 && (
        <div
          className="pointer-events-none absolute bottom-3 left-1/2 flex w-72 -translate-x-1/2 flex-col gap-2"
          aria-live="polite"
        >
          {taskList.map(([id, t]) => (
            <div key={id} className="rounded-md border border-line bg-bg-panel/95 px-3 py-2 shadow-lg">
              <div className="mb-1.5 truncate text-[12px]">{t.label}</div>
              <div
                className="h-1 overflow-hidden rounded bg-bg-hover"
                role="progressbar"
                aria-valuenow={Math.round(t.progress * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className={cn(
                    'h-full bg-accent transition-[width]',
                    t.progress <= 0 && 'w-1/3 animate-pulse',
                  )}
                  style={t.progress > 0 ? { width: `${Math.round(t.progress * 100)}%` } : undefined}
                />
              </div>
            </div>
          ))}
        </div>
      )}
      {(dragActive || dragDepth > 0) && (
        <div className="pointer-events-none absolute inset-3 grid place-items-center rounded-xl border-2 border-dashed border-accent bg-accent/10">
          <div className="rounded-lg bg-bg-panel/90 px-5 py-3 text-center">
            <div className="text-[15px] font-semibold">Drop to import</div>
            <div className="text-[12px] text-fg-muted">
              PMX/PMD models · VMD motions · audio · ZIP packs · folders
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ViewportToolbar() {
  const settings = useStudio((s) => s.settings.viewport);
  const cameraMode = useStudio((s) => s.camera.mode);
  const hasCamMotion = useStudio((s) => s.cameraMotion !== null);
  const bone = useStudio((s) => s.selectedBone);
  const gizmo = useStudio((s) => s.gizmoMode);
  const modes: { mode: CameraMode; label: string; icon: React.ReactNode; disabled?: boolean }[] = [
    { mode: 'orbit', label: 'Orbit camera', icon: <Rotate3D size={15} /> },
    { mode: 'fly', label: 'Free-fly camera (WASD + Q/E)', icon: <Plane size={15} /> },
    {
      mode: 'vmd',
      label: hasCamMotion ? 'Camera motion (VMD)' : 'Camera motion (load a camera VMD first)',
      icon: <Video size={15} />,
      disabled: !hasCamMotion,
    },
  ];
  return (
    <div
      className="absolute left-2 top-2 flex items-center gap-1 rounded-md border border-line bg-bg-panel/90 p-1 shadow backdrop-blur"
      role="toolbar"
      aria-label="Viewport tools"
    >
      {modes.map((m) => (
        <IconButton
          key={m.mode}
          label={m.label}
          active={cameraMode === m.mode}
          disabled={m.disabled}
          onClick={() => setCameraMode(m.mode)}
        >
          {m.icon}
        </IconButton>
      ))}
      <div className="mx-1 h-5 w-px bg-line" />
      <IconButton label="Focus selected model (F)" onClick={focusSelected}>
        <Focus size={15} />
      </IconButton>
      <IconButton
        label="Toggle grid"
        active={settings.showGrid}
        onClick={() => updateSettings((s) => void (s.viewport.showGrid = !s.viewport.showGrid))}
      >
        <Grid3x3 size={15} />
      </IconButton>
      <IconButton
        label="Toggle axis gizmo"
        active={settings.showAxes}
        onClick={() => updateSettings((s) => void (s.viewport.showAxes = !s.viewport.showAxes))}
      >
        <Axis3D size={15} />
      </IconButton>
      <IconButton
        label="Toggle stats overlay"
        active={settings.showStats}
        onClick={() => updateSettings((s) => void (s.viewport.showStats = !s.viewport.showStats))}
      >
        <BarChart3 size={15} />
      </IconButton>
      {bone !== null && (
        <>
          <div className="mx-1 h-5 w-px bg-line" />
          <IconButton
            label="Rotate bone (R)"
            active={gizmo === 'rotate'}
            onClick={() => setGizmoMode('rotate')}
          >
            <Rotate3D size={15} />
          </IconButton>
          <IconButton
            label="Move bone (T)"
            active={gizmo === 'translate'}
            onClick={() => setGizmoMode('translate')}
          >
            <Move3D size={15} />
          </IconButton>
        </>
      )}
      {cameraMode === 'vmd' && (
        <span className="ml-1 flex items-center gap-1 rounded bg-accent-soft px-2 py-0.5 text-[11px] text-accent">
          <Camera size={12} /> VMD camera
        </span>
      )}
    </div>
  );
}

function StatsOverlay() {
  const show = useStudio((s) => s.settings.viewport.showStats);
  const stats = useStudio((s) => s.stats);
  if (!show) return null;
  return (
    <div
      className="pointer-events-none absolute right-2 top-2 rounded-md border border-line bg-black/60 px-2.5 py-1.5 font-mono text-[11px] leading-5 text-fg"
      data-testid="stats"
    >
      <div>
        FPS{' '}
        <span className={cn('font-semibold', (stats?.fps ?? 60) < 30 ? 'text-warn' : 'text-ok')}>
          {stats?.fps ?? '–'}
        </span>
      </div>
      <div>Frame {stats?.frameTimeMs ?? '–'} ms</div>
      <div>Draw calls {stats?.drawCalls ?? '–'}</div>
      <div>Meshes {stats?.activeMeshes ?? '–'}</div>
    </div>
  );
}
