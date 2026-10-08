import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/controls';
import { Dialog } from '@/components/ui/Dialog';
import { formatName, SOURCE_LABEL, type NameKind } from '@/lib/names';
import { exportLabelsFile, importLabelsFile } from './labelsFile';
import {
  getNameTable,
  openRename,
  resetAllLabels,
  resetLabel,
  setLabel,
  useNames,
  useNameTable,
} from '@/store/names';

const KIND_LABEL: Record<NameKind, string> = { bone: 'bone', morph: 'morph', material: 'material' };

/** Right-click / long-press menu for a name. */
function NameMenu() {
  const menu = useNames((s) => s.menu);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event): void => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e.target instanceof Node && ref.current?.contains(e.target)) return;
      useNames.setState({ menu: null });
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', close, true);
    window.addEventListener('blur', close);
    ref.current?.querySelector('button')?.focus();
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', close, true);
      window.removeEventListener('blur', close);
    };
  }, [menu]);
  if (!menu) return null;
  const r = getNameTable(menu.modelId).get(menu.kind, menu.ja);
  const w = 220;
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - w - 8));
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - 160));
  const item =
    'flex w-full items-center rounded px-2 py-1.5 text-left text-[12px] hover:bg-bg-hover focus-visible:bg-bg-hover outline-none coarse:min-h-[44px]';
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`Label for ${menu.ja}`}
      data-testid="name-menu"
      className="fixed z-[60] rounded-md border border-line bg-bg-panel p-1 shadow-2xl"
      style={{ left, top, width: w }}
    >
      <div className="truncate px-2 py-1 text-[11px] text-fg-dim" title={menu.ja}>
        {menu.ja}
      </div>
      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={() => openRename(menu.modelId, menu.kind, menu.ja)}
      >
        Rename label…
      </button>
      {r.source === 'override' && (
        <button
          type="button"
          role="menuitem"
          className={item}
          onClick={() => {
            resetLabel(menu.modelId, menu.kind, menu.ja);
            useNames.setState({ menu: null });
          }}
        >
          Reset label
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={() => {
          void navigator.clipboard?.writeText(menu.ja).catch(() => undefined);
          useNames.setState({ menu: null });
        }}
      >
        Copy Japanese name
      </button>
    </div>
  );
}

function RenameDialog() {
  const renaming = useNames((s) => s.renaming);
  const table = useNameTable(renaming?.modelId);
  const [value, setValue] = useState('');
  const r = renaming ? table.get(renaming.kind, renaming.ja) : null;
  useEffect(() => {
    if (renaming) setValue(getNameTable(renaming.modelId).get(renaming.kind, renaming.ja).en);
  }, [renaming]);
  const close = (): void => useNames.setState({ renaming: null });
  const save = (): void => {
    if (!renaming) return;
    const auto = r?.source === 'override' ? null : r?.en;
    // Saving the automatic label unchanged doesn't create an override.
    if (value.trim() && value.trim() !== auto) setLabel(renaming.modelId, renaming.kind, renaming.ja, value);
    close();
  };
  return (
    <Dialog
      open={!!renaming}
      onOpenChange={(o) => !o && close()}
      title="Rename label"
      description="Only the label shown in MMD Studio changes. The model, motions and exports keep the Japanese name."
    >
      {renaming && r && (
        <form
          className="flex flex-col gap-3 text-[12px]"
          data-testid="rename-label"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1">
            <span className="text-fg-dim">Japanese {KIND_LABEL[renaming.kind]}</span>
            <span className="font-medium">{renaming.ja}</span>
            <span className="text-fg-dim">Current label</span>
            <span>
              {formatName(r, 'en')} <span className="text-fg-dim">({SOURCE_LABEL[r.source]})</span>
            </span>
          </div>
          <label className="flex flex-col gap-1">
            English label
            <input
              autoFocus
              aria-label="English label"
              className="input h-9 text-[13px]"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary">
              Save
            </Button>
            {r.source === 'override' && (
              <Button
                type="button"
                onClick={() => {
                  resetLabel(renaming.modelId, renaming.kind, renaming.ja);
                  close();
                }}
              >
                Reset label
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                resetAllLabels(renaming.modelId);
                close();
              }}
            >
              Reset all labels for this model
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => exportLabelsFile(renaming.modelId)}
            >
              Export labels (.json)
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => void importLabelsFile(renaming.modelId)}
            >
              Import labels…
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

export function NameDialogs() {
  return (
    <>
      <NameMenu />
      <RenameDialog />
    </>
  );
}
