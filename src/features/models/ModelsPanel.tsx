import {
  Copy,
  Eye,
  EyeOff,
  FileArchive,
  FileAudio,
  Film,
  FolderInput,
  Mountain,
  Music,
  Plus,
  Trash2,
  User,
  UserPlus,
  Video,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, Empty, IconButton, Section, SliderRow, NumberField, Row } from '@/components/ui/controls';
import { cn } from '@/components/ui/cn';
import {
  addAudioPicker,
  addModelPicker,
  addStagePicker,
  addMotionPicker,
  importProjectPicker,
  importZipPicker,
  openFilePicker,
  pickFiles,
} from '@/features/app/filePickers';
import { useLayout } from '@/store/layout';
import {
  assignMotion,
  assignStoredMotion,
  duplicateModel,
  removeModel,
  renameModel,
  selectModel,
  setAudio,
  setAudioOffset,
  setCameraMotion,
  setModelVisible,
  setVolume,
} from '@/store/actions';
import { useStudio, type ModelUI } from '@/store/studio';
import { useClipTimeline } from '@/store/clipTimeline';
import type { FileRef } from '@/lib/project';
import { formatTimecode } from '@/lib/timeline';

export function ModelsPanel({ embedded = false }: { embedded?: boolean }) {
  const models = useStudio((s) => s.models);
  const selected = useStudio((s) => s.selectedModelId);
  const coarse = useLayout((s) => s.coarse);
  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg-panel" aria-label="Scene panel">
      {!embedded && (
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3">
          <span className="panel-title">Scene</span>
          <div className="flex items-center">
            <IconButton label="Add stage (scenery model)" onClick={() => void addStagePicker()} size="sm">
              <Mountain size={14} />
            </IconButton>
            <IconButton label="Add model or files" onClick={() => void openFilePicker()} size="sm">
              <Plus size={14} />
            </IconButton>
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {(embedded || coarse) && <AddButtons />}
        <Section title={`Models (${models.length})`}>
          {models.length === 0 ? (
            <Empty>
              {coarse
                ? 'No models yet. Tap “Add model” or “Import ZIP” above.'
                : 'No models yet. Drop a PMX/PMD folder or ZIP onto the viewport.'}
            </Empty>
          ) : (
            <ul
              role="listbox"
              aria-label="Models"
              className="-mx-1 flex flex-col gap-0.5"
              data-testid="model-list"
            >
              {models.map((m) => (
                <ModelRow key={m.id} model={m} selected={m.id === selected} />
              ))}
            </ul>
          )}
        </Section>
        <MediaSection />
      </div>
    </div>
  );
}

/** Big, touch-friendly import buttons (phones have no drag and drop). */
export function AddButtons() {
  const items = [
    {
      label: 'Add model',
      hint: '.pmx + textures or .zip',
      icon: <UserPlus size={18} />,
      run: addModelPicker,
      testid: 'add-model',
    },
    {
      label: 'Add stage',
      hint: 'scenery .pmx or .zip',
      icon: <Mountain size={18} />,
      run: addStagePicker,
      testid: 'add-stage',
    },
    {
      label: 'Add motion',
      hint: '.vmd',
      icon: <Film size={18} />,
      run: addMotionPicker,
      testid: 'add-motion',
    },
    {
      label: 'Add audio',
      hint: 'mp3 / wav / m4a',
      icon: <Music size={18} />,
      run: addAudioPicker,
      testid: 'add-audio',
    },
    {
      label: 'Import ZIP',
      hint: 'recommended on phones',
      icon: <FileArchive size={18} />,
      run: importZipPicker,
      testid: 'import-zip',
    },
    {
      label: 'Import project',
      hint: '.mmdstudio.zip',
      icon: <FolderInput size={18} />,
      run: importProjectPicker,
      testid: 'import-project',
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 border-b border-line p-3" data-testid="add-buttons">
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          data-testid={it.testid}
          onClick={() => void it.run()}
          className="flex min-h-[52px] items-center gap-2 rounded-lg border border-line bg-bg-raised px-3 py-2 text-left active:bg-bg-hover hover:bg-bg-hover"
        >
          <span className="text-accent">{it.icon}</span>
          <span className="min-w-0">
            <span className="block text-[13px] font-medium">{it.label}</span>
            <span className="block truncate text-[11px] text-fg-dim">{it.hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function ModelRow({ model, selected }: { model: ModelUI; selected: boolean }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(model.name);
  return (
    <li
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={() => selectModel(model.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !editing) selectModel(model.id);
        if (e.key === 'F2') {
          setName(model.name);
          setEditing(true);
        }
      }}
      className={cn(
        'group rounded-md border px-2 py-1.5 outline-none transition-colors',
        selected ? 'border-accent/50 bg-accent-soft' : 'border-transparent hover:bg-bg-hover',
      )}
    >
      <div className="flex items-center gap-1.5">
        {model.stage ? (
          <Mountain size={14} className={selected ? 'text-accent' : 'text-fg-dim'} aria-label="Stage" />
        ) : (
          <User size={14} className={selected ? 'text-accent' : 'text-fg-dim'} />
        )}
        {editing ? (
          <input
            autoFocus
            aria-label="Model name"
            className="input h-6 min-w-0 flex-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={() => {
              renameModel(model.id, name);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
        ) : (
          <span
            className={cn('min-w-0 flex-1 truncate', !model.visible && 'text-fg-dim line-through')}
            title={`${model.name} — double-click to rename`}
            onDoubleClick={() => {
              setName(model.name);
              setEditing(true);
            }}
          >
            {model.name}
          </span>
        )}
        <div className="flex items-center opacity-70 group-hover:opacity-100 coarse:opacity-100">
          <IconButton
            size="sm"
            label={model.visible ? 'Hide model' : 'Show model'}
            onClick={(e) => (e.stopPropagation(), setModelVisible(model.id, !model.visible))}
          >
            {model.visible ? <Eye size={13} /> : <EyeOff size={13} />}
          </IconButton>
          <IconButton
            size="sm"
            label="Duplicate model"
            onClick={(e) => (e.stopPropagation(), void duplicateModel(model.id))}
          >
            <Copy size={13} />
          </IconButton>
          <IconButton
            size="sm"
            label="Delete model"
            className="hover:!text-danger"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Remove “${model.name}” from the scene?`)) removeModel(model.id);
            }}
          >
            <Trash2 size={13} />
          </IconButton>
        </div>
      </div>
      <div className="mt-1 flex items-center gap-1 pl-5 text-[11px] text-fg-dim">
        <Film size={11} />
        {model.motion ? (
          <span className="flex min-w-0 flex-1 items-center gap-1">
            <span className="truncate" title={model.motion.name}>
              {model.motion.name}
            </span>
            <span className="shrink-0 font-mono">· {formatTimecode(model.motion.frameCount)}</span>
            <button
              type="button"
              aria-label="Remove motion"
              className="ml-auto shrink-0 rounded p-0.5 hover:bg-bg-hover hover:text-fg"
              onClick={(e) => {
                e.stopPropagation();
                void assignMotion(model.id, null);
              }}
            >
              <X size={11} />
            </button>
          </span>
        ) : (
          <MotionPicker modelId={model.id} />
        )}
      </div>
      {model.info.missingTextures.length > 0 && (
        <div className="mt-0.5 pl-5 text-[11px] text-warn" title={model.info.missingTextures.join('\n')}>
          {model.info.missingTextures.length} missing texture(s)
        </div>
      )}
    </li>
  );
}

async function uploadMotion(modelId: string): Promise<void> {
  const [f] = await pickFiles('.vmd');
  if (f) await assignMotion(modelId, f);
}

/** "Assign motion…": motions already in the project first, then upload. */
function MotionPicker({ modelId }: { modelId: string }) {
  const [open, setOpen] = useState(false);
  const library = useStudio((s) => s.motionLibrary);
  const sources = useClipTimeline((s) => s.doc.sources);
  const motions = useMemo(() => {
    const seen = new Set<string>();
    const out: FileRef[] = [];
    const add = (r: FileRef, name = r.path): void => {
      if (seen.has(r.blobId)) return;
      seen.add(r.blobId);
      out.push({ blobId: r.blobId, path: name });
    };
    for (const r of library) add(r);
    for (const src of sources) if (src.kind === 'motion' && src.ref) add(src.ref, src.name);
    return out;
  }, [library, sources]);
  const short = (path: string): string => path.split('/').pop() ?? path;
  if (!open)
    return (
      <button
        type="button"
        data-testid="assign-motion"
        className="hover:text-accent hover:underline"
        onClick={(e) => {
          e.stopPropagation();
          if (motions.length) setOpen(true);
          else void uploadMotion(modelId);
        }}
      >
        Assign motion…
      </button>
    );
  return (
    <div
      className="flex min-w-0 flex-1 flex-col gap-0.5"
      data-testid="motion-picker"
      onClick={(e) => e.stopPropagation()}
    >
      {motions.map((m) => (
        <button
          key={m.blobId}
          type="button"
          title={m.path}
          className="truncate rounded px-1.5 py-1 text-left text-fg hover:bg-bg-hover coarse:py-2"
          onClick={() => {
            setOpen(false);
            void assignStoredMotion(modelId, m);
          }}
        >
          {short(m.path)}
        </button>
      ))}
      <div className="flex gap-1">
        <button
          type="button"
          className="rounded px-1.5 py-1 text-accent hover:bg-bg-hover coarse:py-2"
          onClick={() => {
            setOpen(false);
            void uploadMotion(modelId);
          }}
        >
          Upload VMD…
        </button>
        <button
          type="button"
          className="ml-auto rounded px-1.5 py-1 hover:bg-bg-hover coarse:py-2"
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function MediaSection() {
  const cameraMotion = useStudio((s) => s.cameraMotion);
  const audio = useStudio((s) => s.audio);
  const offset = useStudio((s) => s.audioOffsetMs);
  const volume = useStudio((s) => s.volume);
  return (
    <Section title="Camera & audio">
      <div className="flex flex-col gap-2">
        <MediaRow
          icon={<Video size={14} />}
          label="Camera motion"
          value={
            cameraMotion
              ? `${cameraMotion.info.name} · ${formatTimecode(cameraMotion.info.frameCount)}`
              : null
          }
          onPick={async () => {
            const [f] = await pickFiles('.vmd');
            if (f) await setCameraMotion(f);
          }}
          onClear={() => void setCameraMotion(null)}
        />
        <MediaRow
          icon={<Music size={14} />}
          label="Audio"
          value={audio ? `${audio.info.name} · ${audio.info.duration.toFixed(1)}s` : null}
          onPick={async () => {
            const [f] = await pickFiles('.mp3,.wav,.ogg,.m4a,.flac,audio/*');
            if (f) await setAudio(f);
          }}
          onClear={() => void setAudio(null)}
        />
        {audio && (
          <div className="rounded-md border border-line p-2">
            <Row label="Offset (ms)" hint="Positive values start the audio later than the motion">
              <div className="w-20">
                <NumberField
                  label="Audio offset in milliseconds"
                  value={offset}
                  step={10}
                  precision={0}
                  onChange={(v) => setAudioOffset(Math.round(v))}
                />
              </div>
            </Row>
            <SliderRow
              label="Volume"
              value={volume}
              min={0}
              max={1.5}
              step={0.01}
              onChange={setVolume}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </div>
        )}
      </div>
    </Section>
  );
}

function MediaRow({
  icon,
  label,
  value,
  onPick,
  onClear,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  onPick: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-line px-2 py-1.5">
      <span className="text-fg-dim">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-fg-dim">{label}</div>
        <div className={cn('truncate text-[12px]', !value && 'text-fg-dim')} title={value ?? undefined}>
          {value ?? 'None'}
        </div>
      </div>
      {value ? (
        <IconButton size="sm" label={`Remove ${label.toLowerCase()}`} onClick={onClear}>
          <X size={13} />
        </IconButton>
      ) : (
        <Button size="sm" onClick={onPick}>
          <FileAudio size={12} /> Load
        </Button>
      )}
    </div>
  );
}
