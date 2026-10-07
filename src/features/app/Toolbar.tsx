import {
  Code2,
  Download,
  FilePlus2,
  FolderOpen,
  Keyboard,
  LayoutPanelLeft,
  PanelBottom,
  PanelRight,
  Redo2,
  Save,
  Upload,
  Undo2,
  Box,
} from 'lucide-react';
import { useState } from 'react';
import type { PanelToggles } from '@/App';
import { Button, IconButton, Select } from '@/components/ui/controls';
import { cn } from '@/components/ui/cn';
import type { QualityPreset } from '@/engine/types';
import { downloadBlob, openFilePicker } from '@/features/app/filePickers';
import { exportProjectArchive, newProject, renameProject, saveNow } from '@/features/project/persistence';
import { redo, undo, updateSettings } from '@/store/actions';
import { useHistory } from '@/store/history';
import { studio, toast, useStudio } from '@/store/studio';

export function Toolbar({ panels }: { panels: PanelToggles }) {
  const project = useStudio((s) => s.project);
  const mode = useStudio((s) => s.mode);
  const quality = useStudio((s) => s.settings.viewport.quality);
  const canUndo = useHistory((h) => h.past.length > 0);
  const canRedo = useHistory((h) => h.future.length > 0);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <header className="flex h-11 shrink-0 items-center gap-1 border-b border-line bg-bg-panel px-2" role="toolbar" aria-label="Main toolbar">
      <div className="mr-2 flex items-center gap-2 pl-1">
        <div className="grid h-6 w-6 place-items-center rounded-md bg-accent text-white">
          <Box size={14} />
        </div>
        <span className="hidden font-semibold sm:inline">MMD Studio</span>
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        {editing ? (
          <input
            autoFocus
            aria-label="Project name"
            defaultValue={project.name}
            className="input h-7 w-48"
            onBlur={(e) => {
              renameProject(e.target.value);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
        ) : (
          <button
            type="button"
            className="max-w-[220px] truncate rounded px-1.5 py-0.5 text-fg-muted hover:bg-bg-hover hover:text-fg"
            onClick={() => setEditing(true)}
            title="Rename project"
          >
            {project.name}
          </button>
        )}
        <span className={cn('text-[11px]', project.dirty ? 'text-warn' : 'text-fg-dim')} aria-live="polite" data-testid="save-status">
          {project.dirty ? 'Unsaved' : project.lastSavedAt ? 'Saved' : ''}
        </span>
      </div>
      <div className="mx-2 h-5 w-px bg-line" />
      <IconButton label="New project" onClick={() => void newProject()}>
        <FilePlus2 size={15} />
      </IconButton>
      <IconButton label="Projects…" onClick={() => studio.set({ dialog: 'projects' })}>
        <FolderOpen size={15} />
      </IconButton>
      <IconButton label="Save project (Ctrl+S)" onClick={() => void saveNow({ thumbnail: true, announce: true })}>
        <Save size={15} />
      </IconButton>
      <IconButton
        label="Export project as .mmdstudio.zip"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const { blob, fileName } = await exportProjectArchive();
            downloadBlob(blob, fileName);
          } catch (e) {
            toast('error', `Export failed: ${e instanceof Error ? e.message : String(e)}`);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Download size={15} />
      </IconButton>
      <IconButton label="Import files / project" onClick={() => void openFilePicker()}>
        <Upload size={15} />
      </IconButton>
      <div className="mx-2 h-5 w-px bg-line" />
      <IconButton label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
        <Undo2 size={15} />
      </IconButton>
      <IconButton label="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>
        <Redo2 size={15} />
      </IconButton>
      <div className="flex-1" />
      <div className="mr-2 flex rounded-md border border-line p-0.5" role="tablist" aria-label="Mode">
        {(['studio', 'playground'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => studio.set({ mode: m })}
            className={cn('flex h-6 items-center gap-1 rounded px-2.5 text-[12px] capitalize', mode === m ? 'bg-bg-hover text-fg' : 'text-fg-muted hover:text-fg')}
          >
            {m === 'playground' && <Code2 size={13} />}
            {m}
          </button>
        ))}
      </div>
      <div className="hidden md:block">
        <Select<QualityPreset>
          hideLabel
          label="Render quality"
          value={quality}
          onChange={(q) => updateSettings((s) => void (s.viewport.quality = q))}
          options={[
            { value: 'low', label: 'Quality: Low' },
            { value: 'medium', label: 'Quality: Medium' },
            { value: 'high', label: 'Quality: High' },
          ]}
        />
      </div>
      <div className="mx-1 h-5 w-px bg-line" />
      <IconButton label="Toggle left panel" active={panels.left} onClick={() => panels.toggle('left')}>
        <LayoutPanelLeft size={15} />
      </IconButton>
      <IconButton label="Toggle timeline" active={panels.bottom} onClick={() => panels.toggle('bottom')}>
        <PanelBottom size={15} />
      </IconButton>
      <IconButton label="Toggle inspector" active={panels.right} onClick={() => panels.toggle('right')}>
        <PanelRight size={15} />
      </IconButton>
      <IconButton label="Keyboard shortcuts (?)" onClick={() => studio.set({ dialog: 'shortcuts' })}>
        <Keyboard size={15} />
      </IconButton>
      <Button variant="ghost" size="sm" className="hidden lg:inline-flex" onClick={() => studio.set({ dialog: 'about' })}>
        About
      </Button>
    </header>
  );
}
