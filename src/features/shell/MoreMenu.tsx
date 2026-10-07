import {
  Code2,
  Download,
  FilePlus2,
  FolderOpen,
  Info,
  Keyboard,
  PersonStanding,
  Redo2,
  Save,
  Smartphone,
  Undo2,
  Upload,
} from 'lucide-react';
import { lazy, Suspense, useState, type ReactNode } from 'react';
import { Section, Select, ToggleRow } from '@/components/ui/controls';
import type { QualityPreset } from '@/engine/types';
import { importProjectPicker, saveOrShare } from '@/features/app/filePickers';
import { exportProjectArchive, newProject, renameProject, saveNow } from '@/features/project/persistence';
import { installState, promptInstall, useInstall } from '@/features/pwa/install';
import { redo, undo, updateSettings } from '@/store/actions';
import { useHistory } from '@/store/history';
import { openSheet, setSideTab, useLayout } from '@/store/layout';
import { setPref, usePrefs } from '@/store/prefs';
import { studio, toast, useStudio } from '@/store/studio';

const PlaygroundLite = lazy(() => import('@/features/playground/PlaygroundLite'));
const Playground = lazy(() => import('@/features/playground/Playground'));

function Action({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-[48px] items-center gap-2 rounded-lg border border-line bg-bg-raised px-3 text-left text-[13px] active:bg-bg-hover disabled:opacity-40"
    >
      <span className="text-accent">{icon}</span>
      {label}
    </button>
  );
}

/** Phone "More" sheet: project, edit, view, playground, install. */
export default function MoreMenu() {
  const project = useStudio((s) => s.project);
  const quality = useStudio((s) => s.settings.viewport.quality);
  const viewport = useStudio((s) => s.settings.viewport);
  const adaptive = usePrefs((s) => s.adaptiveQuality);
  const canUndo = useHistory((h) => h.past.length > 0);
  const canRedo = useHistory((h) => h.future.length > 0);
  const mode = useLayout((s) => s.mode);
  const install = useInstall();
  const [showPlayground, setShowPlayground] = useState(false);
  const phone = mode === 'phone' || mode === 'phone-landscape';

  return (
    <div className="pb-4" data-testid="more-menu">
      <Section title="Project">
        <label className="mb-2 block">
          <span className="mb-1 block text-[12px] text-fg-muted">Name</span>
          <input
            aria-label="Project name"
            defaultValue={project.name}
            onBlur={(e) => renameProject(e.target.value)}
            className="input h-11 w-full text-[14px]"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <Action
            icon={<Save size={18} />}
            label="Save now"
            onClick={() => void saveNow({ thumbnail: true, announce: true })}
          />
          <Action icon={<FilePlus2 size={18} />} label="New project" onClick={() => void newProject()} />
          <Action
            icon={<FolderOpen size={18} />}
            label="Projects…"
            onClick={() => studio.set({ dialog: 'projects' })}
          />
          <Action
            icon={<Upload size={18} />}
            label="Import project"
            onClick={() => void importProjectPicker()}
          />
          <Action
            icon={<Download size={18} />}
            label="Export project"
            onClick={async () => {
              try {
                const { blob, fileName } = await exportProjectArchive();
                await saveOrShare(blob, fileName);
              } catch (e) {
                toast('error', `Export failed: ${e instanceof Error ? e.message : String(e)}`);
              }
            }}
          />
        </div>
      </Section>
      <Section title="Tools">
        <Action
          icon={<PersonStanding size={18} />}
          label="Video to VMD (dance video → motion)"
          onClick={() =>
            mode === 'phone-landscape' ? setSideTab('video2vmd') : openSheet('video2vmd', 'full')
          }
        />
      </Section>
      <Section title="Edit">
        <div className="grid grid-cols-2 gap-2">
          <Action icon={<Undo2 size={18} />} label="Undo" onClick={undo} disabled={!canUndo} />
          <Action icon={<Redo2 size={18} />} label="Redo" onClick={redo} disabled={!canRedo} />
        </div>
      </Section>
      <Section title="View & performance">
        <Select<QualityPreset>
          label="Render quality"
          value={quality}
          onChange={(q) => updateSettings((s) => void (s.viewport.quality = q))}
          options={[
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
          ]}
        />
        <ToggleRow
          label="Adaptive quality"
          hint="Lower quality automatically when the frame rate stays under 30 fps"
          checked={adaptive}
          onChange={(v) => setPref('adaptiveQuality', v)}
        />
        <ToggleRow
          label="Grid"
          checked={viewport.showGrid}
          onChange={(v) => updateSettings((s) => void (s.viewport.showGrid = v))}
        />
        <ToggleRow
          label="Axis gizmo"
          checked={viewport.showAxes}
          onChange={(v) => updateSettings((s) => void (s.viewport.showAxes = v))}
        />
        <ToggleRow
          label="Stats overlay"
          checked={viewport.showStats}
          onChange={(v) => updateSettings((s) => void (s.viewport.showStats = v))}
        />
      </Section>
      <Section title="Playground" defaultOpen={false}>
        {showPlayground ? (
          <Suspense fallback={<div className="p-4 text-fg-muted">Loading…</div>}>
            {phone ? (
              <PlaygroundLite />
            ) : (
              <div className="h-[60vh]">
                <Playground />
              </div>
            )}
          </Suspense>
        ) : (
          <Action
            icon={<Code2 size={18} />}
            label={phone ? 'Open example scripts' : 'Open code editor'}
            onClick={() => setShowPlayground(true)}
          />
        )}
      </Section>
      <Section title="App">
        <div className="grid grid-cols-2 gap-2">
          {install !== 'installed' && (
            <Action
              icon={<Smartphone size={18} />}
              label={install === 'available' ? 'Install app' : 'Add to Home Screen'}
              onClick={() => void promptInstall()}
            />
          )}
          <Action
            icon={<Keyboard size={18} />}
            label="Shortcuts"
            onClick={() => studio.set({ dialog: 'shortcuts' })}
          />
          <Action icon={<Info size={18} />} label="About" onClick={() => studio.set({ dialog: 'about' })} />
        </div>
        {install === 'ios' && (
          <p className="mt-2 text-[12px] leading-relaxed text-fg-muted">{installState.iosHint}</p>
        )}
      </Section>
    </div>
  );
}
