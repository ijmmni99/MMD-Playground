import * as RPopover from '@radix-ui/react-popover';
import {
  AlignCenterVertical,
  Copy,
  CopyPlus,
  Download,
  FlipHorizontal2,
  Gauge,
  Magnet,
  Minus,
  Pencil,
  Plus,
  Redo2,
  Repeat,
  RotateCcw,
  Scissors,
  SlidersHorizontal,
  Trash2,
  Undo2,
  Volume2,
  Wand2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { findClip } from '@/lib/clips/ops';
import { SPEED_RANGE, type Clip } from '@/lib/clips/types';
import { redo, undo } from '@/store/actions';
import { ct, useClipTimeline } from '@/store/clipTimeline';
import { useHistory } from '@/store/history';
import {
  addAudioFile,
  addFacePreset,
  addTextClip,
  copySelected,
  deleteSelected,
  duplicateSelected,
  exportTimelineVmd,
  importSubtitles,
  pasteAtPlayhead,
  pickAndAddMotion,
  revertTimeline,
  setClipJoin,
  setClipLoop,
  setClipSpeed,
  setClipVolume,
  splitAtPlayhead,
  toggleMirror,
} from './actions';
import { FACE_PRESETS } from './sources';

function Tool({
  label,
  icon,
  onClick,
  disabled,
  active,
  testid,
}: {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  testid?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      data-testid={testid}
      title={label}
      className={cn(
        'flex h-11 min-w-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md px-1.5 text-[10px] leading-none disabled:opacity-35',
        active ? 'bg-accent-soft text-fg' : 'text-fg-muted hover:bg-bg-hover hover:text-fg',
      )}
    >
      {icon}
      <span className="max-w-[64px] truncate">{label}</span>
    </button>
  );
}

function Pop({ trigger, children, testid }: { trigger: ReactNode; children: ReactNode; testid?: string }) {
  return (
    <RPopover.Root>
      <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content
          side="top"
          sideOffset={6}
          collisionPadding={8}
          className="z-50 w-64 rounded-lg border border-line bg-bg-panel p-3 text-[12px] shadow-2xl"
          data-testid={testid}
        >
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export function ClipToolbar() {
  const selection = useClipTimeline((s) => s.selection);
  const doc = useClipTimeline((s) => s.doc);
  const center = useClipTimeline((s) => s.centerPlayhead);
  const snap = useClipTimeline((s) => s.snap);
  const canUndo = useHistory((h) => h.past.length > 0);
  const canRedo = useHistory((h) => h.future.length > 0);
  const clip: Clip | undefined = findClip(doc, selection[0] ?? '');
  const kind = clip ? doc.tracks.find((t) => t.id === clip.trackId)?.kind : undefined;
  const motion = kind === 'dance' || kind === 'camera' || kind === 'face';
  const zoom = (f: number): void => ct.set((s) => ({ ppf: Math.min(40, Math.max(0.2, s.ppf * f)) }));

  return (
    <div
      className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-t border-line px-1 py-1"
      role="toolbar"
      aria-label="Clip tools"
      data-testid="clip-toolbar"
    >
      <Tool label="Undo" icon={<Undo2 size={18} />} onClick={undo} disabled={!canUndo} testid="ct-undo" />
      <Tool label="Redo" icon={<Redo2 size={18} />} onClick={redo} disabled={!canRedo} testid="ct-redo" />
      <div className="mx-1 h-8 w-px shrink-0 bg-line" />
      <Pop
        testid="ct-add-menu"
        trigger={
          <button
            type="button"
            data-testid="ct-add"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-strong text-white"
            aria-label="Add"
          >
            <Plus size={22} />
          </button>
        }
      >
        <div className="flex flex-col gap-1">
          <AddItem
            label="Dance motion (.vmd)"
            onClick={() => void pickAndAddMotion()}
            testid="ct-add-motion"
          />
          <AddItem label="Camera motion (.vmd)" onClick={() => void pickAndAddMotion()} />
          <div className="px-2 pt-1 text-[11px] text-fg-dim">Face presets</div>
          {FACE_PRESETS.map((p) => (
            <AddItem
              key={p.id}
              label={p.label}
              onClick={() => void addFacePreset(p.id)}
              testid={`ct-add-face-${p.id}`}
            />
          ))}
          <AddItem label="Music / audio" onClick={() => void addAudioFile()} />
          <AddItem label="3D text" onClick={() => addTextClip()} testid="ct-add-text" />
          <AddItem
            label="Subtitles / lyrics (.srt, .lrc)"
            onClick={() => void importSubtitles()}
            testid="ct-add-subs"
          />
        </div>
      </Pop>
      {clip ? (
        <>
          <Tool label="Split" icon={<Scissors size={18} />} onClick={splitAtPlayhead} testid="ct-split" />
          <Tool label="Delete" icon={<Trash2 size={18} />} onClick={deleteSelected} testid="ct-delete" />
          <Tool
            label="Duplicate"
            icon={<CopyPlus size={18} />}
            onClick={duplicateSelected}
            testid="ct-duplicate"
          />
          <Tool label="Copy" icon={<Copy size={18} />} onClick={copySelected} />
          {kind !== 'text' && (
            <Pop
              trigger={
                <span>
                  <Tool label={`Speed ${clip.speed}×`} icon={<Gauge size={18} />} testid="ct-speed" />
                </span>
              }
              testid="ct-speed-pop"
            >
              <div className="mb-2 font-medium">Speed {clip.speed}×</div>
              <input
                type="range"
                aria-label="Speed"
                className="w-full"
                min={Math.log2(SPEED_RANGE[0])}
                max={Math.log2(SPEED_RANGE[1])}
                step={0.01}
                value={Math.log2(clip.speed)}
                onChange={(e) => setClipSpeed(Math.round(2 ** Number(e.target.value) * 100) / 100)}
              />
              <div className="mt-2 flex flex-wrap gap-1">
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={cn('btn', s === clip.speed && 'border-accent')}
                    onClick={() => setClipSpeed(s)}
                  >
                    {s}×
                  </button>
                ))}
              </div>
            </Pop>
          )}
          {(kind === 'dance' || kind === 'camera') && (
            <Tool
              label="Mirror"
              icon={<FlipHorizontal2 size={18} />}
              onClick={toggleMirror}
              active={clip.mirror}
              testid="ct-mirror"
            />
          )}
          {motion && (
            <Pop
              trigger={
                <span>
                  <Tool label={`Loop ×${clip.loopCount}`} icon={<Repeat size={18} />} testid="ct-loop" />
                </span>
              }
            >
              <div className="mb-2 font-medium">Play {clip.loopCount} time(s)</div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn"
                  aria-label="Fewer loops"
                  onClick={() => setClipLoop(clip.loopCount - 1)}
                >
                  <Minus size={14} />
                </button>
                <span className="w-8 text-center font-mono">{clip.loopCount}</span>
                <button
                  type="button"
                  className="btn"
                  aria-label="More loops"
                  onClick={() => setClipLoop(clip.loopCount + 1)}
                >
                  <Plus size={14} />
                </button>
              </div>
              <p className="mt-2 text-[11px] text-fg-dim">
                Seams blend over a few frames so loops don't pop.
              </p>
            </Pop>
          )}
          {motion && (
            <Pop
              trigger={
                <span>
                  <Tool label="Join" icon={<SlidersHorizontal size={18} />} testid="ct-join" />
                </span>
              }
              testid="ct-join-pop"
            >
              <div className="mb-2 font-medium">Join from the previous clip</div>
              {kind === 'camera' && (
                <div className="mb-2 flex gap-1" role="radiogroup" aria-label="Camera transition">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={clip.join.cut}
                    className={cn('btn', clip.join.cut && 'border-accent')}
                    onClick={() => setClipJoin({ cut: true })}
                  >
                    Hard cut
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={!clip.join.cut}
                    className={cn('btn', !clip.join.cut && 'border-accent')}
                    onClick={() => setClipJoin({ cut: false })}
                  >
                    Blend
                  </button>
                </div>
              )}
              {(kind !== 'camera' || !clip.join.cut) && (
                <label className="flex flex-col gap-1">
                  Crossfade {clip.join.fade} frames
                  <input
                    type="range"
                    aria-label="Crossfade frames"
                    min={0}
                    max={60}
                    value={clip.join.fade}
                    onChange={(e) => setClipJoin({ fade: Number(e.target.value) })}
                  />
                </label>
              )}
              {kind === 'dance' && (
                <div className="mt-2 flex flex-col gap-1" role="radiogroup" aria-label="Root position">
                  <span className="text-[11px] text-fg-dim">Root position</span>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={clip.join.root === 'continue'}
                    className={cn('btn', clip.join.root === 'continue' && 'border-accent')}
                    onClick={() => setClipJoin({ root: 'continue' })}
                  >
                    Continue from where it ended
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={clip.join.root === 'origin'}
                    className={cn('btn', clip.join.root === 'origin' && 'border-accent')}
                    onClick={() => setClipJoin({ root: 'origin' })}
                  >
                    Reset to origin
                  </button>
                </div>
              )}
            </Pop>
          )}
          {kind === 'audio' && (
            <Pop
              trigger={
                <span>
                  <Tool label="Volume" icon={<Volume2 size={18} />} />
                </span>
              }
            >
              <label className="flex flex-col gap-1">
                Volume {Math.round((clip.volume ?? 1) * 100)}%
                <input
                  type="range"
                  aria-label="Clip volume"
                  min={0}
                  max={1}
                  step={0.01}
                  value={clip.volume ?? 1}
                  onChange={(e) => setClipVolume(Number(e.target.value))}
                />
              </label>
            </Pop>
          )}
          {kind === 'text' && (
            <Tool
              label="Edit text"
              icon={<Pencil size={18} />}
              onClick={() => ct.set({ textEditing: clip.id })}
              testid="ct-edit-text"
            />
          )}
          {motion && (
            <Tool
              label="Keyframes"
              icon={<Wand2 size={18} />}
              onClick={() => void import('./advanced').then((a) => a.openAdvanced(clip.id))}
              testid="ct-advanced"
            />
          )}
        </>
      ) : (
        <Tool label="Paste" icon={<Copy size={18} />} onClick={pasteAtPlayhead} />
      )}
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <Tool
          label={center ? 'Center' : 'Free'}
          icon={<AlignCenterVertical size={18} />}
          onClick={() => ct.set({ centerPlayhead: !center })}
          active={center}
          testid="ct-center"
        />
        <Tool
          label="Snap"
          icon={<Magnet size={18} />}
          onClick={() => ct.set({ snap: !snap })}
          active={snap}
          testid="ct-snap"
        />
        <Tool label="Zoom out" icon={<ZoomOut size={18} />} onClick={() => zoom(1 / 1.5)} />
        <Tool label="Zoom in" icon={<ZoomIn size={18} />} onClick={() => zoom(1.5)} />
        <Tool
          label="Export VMD"
          icon={<Download size={18} />}
          onClick={() => void exportTimelineVmd()}
          testid="ct-export-vmd"
        />
        <Tool label="Revert" icon={<RotateCcw size={18} />} onClick={revertTimeline} testid="ct-revert" />
      </div>
    </div>
  );
}

function AddItem({ label, onClick, testid }: { label: string; onClick: () => void; testid?: string }) {
  return (
    <RPopover.Close asChild>
      <button
        type="button"
        data-testid={testid}
        onClick={onClick}
        className="rounded px-2 py-1.5 text-left hover:bg-bg-hover coarse:min-h-[44px]"
      >
        {label}
      </button>
    </RPopover.Close>
  );
}
