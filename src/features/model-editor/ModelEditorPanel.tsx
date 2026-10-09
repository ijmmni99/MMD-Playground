import { Loader2, Redo2, RotateCcw, Undo2 } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { Button, IconButton, Switch } from '@/components/ui/controls';
import { cn } from '@/components/ui/cn';
import { partOfBone } from '@/lib/model-edit/proportions';
import { useHistory } from '@/store/history';
import { useLayout } from '@/store/layout';
import { me, PANELS, useModelEditor, useOps, type EditorPanel } from '@/store/modelEditor';
import { useStudio } from '@/store/studio';
import { closeEditor, editorRedo, editorUndo, openEditor, revertAll, setShowOriginal } from './actions';
import { BonesPanel } from './BonesPanel';
import { InfoPanel } from './InfoPanel';
import { MaterialsPanel } from './MaterialsPanel';
import { MorphsPanel } from './MorphsPanel';
import { OutfitPanel } from './OutfitPanel';
import { PhysicsPanel } from './PhysicsPanel';
import { ProportionsPanel } from './ProportionsPanel';
import { Notice } from './ui';

const BODY: Record<EditorPanel, () => ReactNode> = {
  proportions: () => <ProportionsPanel />,
  outfit: () => <OutfitPanel />,
  materials: () => <MaterialsPanel />,
  bones: () => <BonesPanel />,
  morphs: () => <MorphsPanel />,
  physics: () => <PhysicsPanel />,
  info: () => <InfoPanel />,
};

function StatusChip() {
  const building = useModelEditor((s) => s.building);
  const dirty = useStudio((s) => s.project.dirty);
  const errors = useModelEditor((s) => s.issues.filter((i) => i.level === 'error').length);
  const label = building ? 'Updating…' : errors ? `${errors} problem(s)` : dirty ? 'Unsaved' : 'Saved';
  return (
    <span
      data-testid="me-status"
      className={cn(
        'flex h-6 items-center gap-1 rounded-full border px-2 text-[11px]',
        errors ? 'border-warn/50 text-warn' : 'border-line text-fg-muted',
      )}
    >
      {building && <Loader2 size={11} className="animate-spin" />}
      {label}
    </span>
  );
}

export default function ModelEditorPanel({ embedded = false }: { embedded?: boolean }) {
  const allModels = useStudio((s) => s.models);
  const models = allModels.filter((m) => !m.stage);
  const selectedModelId = useStudio((s) => s.selectedModelId);
  const selectedBone = useStudio((s) => s.selectedBone);
  const modelId = useModelEditor((s) => s.modelId);
  const status = useModelEditor((s) => s.status);
  const error = useModelEditor((s) => s.error);
  const panel = useModelEditor((s) => s.panel);
  const showOriginal = useModelEditor((s) => s.showOriginal);
  const original = useModelEditor((s) => s.original);
  const ops = useOps();
  const canUndo = useHistory((h) => h.past.length > 0);
  const canRedo = useHistory((h) => h.future.length > 0);
  const phone = useLayout((s) => s.mode === 'phone' || s.mode === 'phone-landscape');

  // Follow the scene selection; the first visit opens the selected (or first) model.
  useEffect(() => {
    const target =
      selectedModelId && models.some((m) => m.id === selectedModelId)
        ? selectedModelId
        : (models[0]?.id ?? null);
    if (target && target !== me.get().modelId) void openEditor(target);
    if (!target && me.get().modelId) closeEditor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModelId, models.length]);

  // Tapping the model jumps to the body part (or bone) under the finger.
  useEffect(() => {
    if (selectedBone === null || !original || selectedModelId !== modelId) return;
    const name = original.bones[selectedBone]?.name;
    if (me.get().panel === 'bones') me.set({ bone: name ?? null });
    else {
      const part = partOfBone(original, selectedBone);
      if (part) me.set({ part, panel: 'proportions' });
    }
  }, [selectedBone, original, selectedModelId, modelId]);

  const vertexCount = useStudio((s) => s.models.find((m) => m.id === modelId)?.info.vertexCount ?? 0);

  return (
    <div
      className={cn('flex h-full min-h-0 flex-col bg-bg-panel', embedded && 'bg-transparent')}
      data-testid="me-panel"
    >
      <div className="flex items-center gap-1.5 border-b border-line px-2 py-1.5">
        <select
          className="input h-7 min-w-0 flex-1 text-[12px] coarse:h-11"
          aria-label="Model to edit"
          data-testid="me-model"
          value={modelId ?? ''}
          onChange={(e) => useStudio.setState({ selectedModelId: e.target.value })}
        >
          {!models.length && <option value="">No model loaded</option>}
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <StatusChip />
      </div>
      <div className="flex items-center gap-1 border-b border-line px-2 py-1">
        <IconButton label="Undo edit" disabled={!canUndo} onClick={editorUndo} data-testid="me-undo">
          <Undo2 size={15} />
        </IconButton>
        <IconButton label="Redo edit" disabled={!canRedo} onClick={editorRedo} data-testid="me-redo">
          <Redo2 size={15} />
        </IconButton>
        <Button
          size="sm"
          variant="ghost"
          disabled={!ops.length}
          data-testid="me-revert"
          onClick={() =>
            window.confirm('Revert every edit on this model? (Undo can bring them back.)') && revertAll()
          }
        >
          <RotateCcw size={13} /> Revert
        </Button>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 text-[11px] text-fg-muted">
          {showOriginal ? 'Original' : 'Edited'}
          <Switch label="Show the original (A/B)" checked={showOriginal} onChange={setShowOriginal} />
        </label>
      </div>
      <div
        role="tablist"
        aria-label="Editor sections"
        className="flex gap-1 overflow-x-auto border-b border-line px-2 py-1.5"
      >
        {PANELS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={panel === p.id}
            data-testid={`me-tab-${p.id}`}
            onClick={() => me.set({ panel: p.id })}
            className={cn(
              'h-7 shrink-0 rounded-full px-2.5 text-[12px] coarse:h-11 coarse:px-3.5',
              panel === p.id ? 'bg-accent-soft text-fg' : 'text-fg-muted hover:text-fg',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!models.length ? (
          <div className="p-4">
            <Notice>Load a PMX model first (Studio → Add model), then edit it here.</Notice>
          </div>
        ) : status === 'error' ? (
          <div className="p-4">
            <Notice tone="warn">{error}</Notice>
          </div>
        ) : status === 'loading' || !original ? (
          <div className="grid place-items-center p-6 text-fg-muted">
            <Loader2 className="animate-spin" />
          </div>
        ) : (
          <>
            {phone && (panel === 'physics' || panel === 'bones') && (
              <div className="px-3 pt-2">
                <Notice>
                  Bones and physics have many small fields — they’re easier on a tablet or desktop.
                </Notice>
              </div>
            )}
            {phone && vertexCount > 150_000 && (
              <div className="px-3 pt-2">
                <Notice tone="warn">
                  This model is large ({vertexCount.toLocaleString()} vertices). Each edit rebuilds it, which
                  needs a lot of memory on a phone.
                </Notice>
              </div>
            )}
            {BODY[panel]()}
          </>
        )}
      </div>
    </div>
  );
}
