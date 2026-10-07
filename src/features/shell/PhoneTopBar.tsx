import { Box, Redo2, Undo2 } from 'lucide-react';
import { cn } from '@/components/ui/cn';
import { redo, undo } from '@/store/actions';
import { useHistory } from '@/store/history';
import { useStudio } from '@/store/studio';

/** Slim phone header: project name, save state, undo/redo (on-screen equivalents of Ctrl+Z/Y). */
export function PhoneTopBar() {
  const project = useStudio((s) => s.project);
  const canUndo = useHistory((h) => h.past.length > 0);
  const canRedo = useHistory((h) => h.future.length > 0);
  const btn =
    'grid h-11 w-11 place-items-center rounded-lg text-fg-muted active:bg-bg-hover disabled:opacity-30';
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-bg-panel pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.25rem,env(safe-area-inset-right))]">
      <div
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent-strong text-white"
        aria-hidden
      >
        <Box size={15} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold leading-tight">{project.name}</div>
        <div
          className={cn('text-[11px] leading-tight', project.dirty ? 'text-warn' : 'text-fg-dim')}
          data-testid="save-status"
          aria-live="polite"
        >
          {project.dirty ? 'Unsaved' : project.lastSavedAt ? 'Saved' : 'MMD Studio'}
        </div>
      </div>
      <button type="button" aria-label="Undo" className={btn} disabled={!canUndo} onClick={undo}>
        <Undo2 size={19} />
      </button>
      <button type="button" aria-label="Redo" className={btn} disabled={!canRedo} onClick={redo}>
        <Redo2 size={19} />
      </button>
    </header>
  );
}
