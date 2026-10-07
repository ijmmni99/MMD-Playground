import { useShallow } from 'zustand/react/shallow';
import {
  ArrowLeftRight,
  ChevronsLeft,
  ChevronsRight,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Download,
  Flag,
  Footprints,
  KeyRound,
  Magnet,
  Maximize2,
  Redo2,
  RotateCcw,
  Smile,
  Spline,
  Trash2,
  Undo2,
  Video,
  Wand2,
  X,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { IconButton } from '@/components/ui/controls';
import { cn } from '@/components/ui/cn';
import { redo, undo } from '@/store/actions';
import { engineOrNull } from '@/store/engineRef';
import { useHistory } from '@/store/history';
import { useLayout } from '@/store/layout';
import { me, useMotionEditor } from '@/store/motionEditor';
import { useStudio } from '@/store/studio';
import {
  closeEditor,
  copySelection,
  deleteSelected,
  duplicateSelection,
  editedEndFrame,
  exportCamera,
  exportMotion,
  exportSidecar,
  keyMorphs,
  keySelected,
  nudge,
  pasteClipboard,
  revertToOriginal,
  selectAll,
  setCompareOriginal,
  setEditedModel,
  setSelection,
} from './actions';
import { DopeSheet } from './DopeSheet';
import { frameAll } from './view';

const GraphEditor = lazy(() => import('./GraphEditor'));
const ToolsPanel = lazy(() => import('./ToolsPanel'));
const DirectorPanel = lazy(() => import('./DirectorPanel'));
const MarkersPanel = lazy(() => import('./MarkersPanel'));
const IkPanel = lazy(() => import('./IkPanel'));

export type SidePanel = 'tools' | 'director' | 'markers' | 'ik' | 'export' | null;

function Sep() {
  return <div className="mx-0.5 h-5 w-px shrink-0 bg-line" />;
}

function ExportPanel() {
  const [tracks, setTracks] = useState({ bones: true, morphs: true, props: true });
  return (
    <div className="flex flex-col gap-2 p-3 text-[12px]" data-testid="me-export">
      <div className="font-semibold">Export</div>
      {(['bones', 'morphs', 'props'] as const).map((k) => (
        <label key={k} className="flex items-center gap-2">
          <input type="checkbox" checked={tracks[k]} onChange={(e) => setTracks({ ...tracks, [k]: e.target.checked })} />
          {k === 'bones' ? 'Bone tracks (FK + IK)' : k === 'morphs' ? 'Morph tracks' : 'IK on/off (display) keys'}
        </label>
      ))}
      <button type="button" className="btn-primary" onClick={() => exportMotion(tracks)} data-testid="me-export-motion">
        Download motion .vmd
      </button>
      <button type="button" className="btn" onClick={exportCamera} data-testid="me-export-camera">
        Download camera .vmd
      </button>
      <button type="button" className="btn" onClick={exportSidecar}>
        Download markers / shots / pins (.json)
      </button>
      <p className="text-fg-dim">Pins are baked into the exported motion. Light and shadow tracks are kept.</p>
    </div>
  );
}

/** Motion editor: toolbar, dope sheet (+ graph), side panels and a status bar. Shares the timeline dock. */
export default function EditorDock() {
  const s = useMotionEditor();
  const models = useStudio(useShallow((st) => st.models.filter((m) => !m.stage)));
  const dirty = useStudio((st) => st.project.dirty);
  const undoDepth = useHistory((h) => h.past.length);
  const redoDepth = useHistory((h) => h.future.length);
  const coarse = useLayout((st) => st.coarse);
  const narrow = useLayout((st) => st.mode === 'phone' || st.mode === 'phone-landscape');
  const [panel, setPanel] = useState<SidePanel>(null);
  const frameRef = useRef<HTMLSpanElement>(null);

  // Frame readout via rAF.
  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const f = engineOrNull()?.getPlayback().frame ?? 0;
      if (frameRef.current) frameRef.current.textContent = String(Math.round(f));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Editor shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const handled = (fn: () => void): void => {
        e.preventDefault();
        e.stopImmediatePropagation();
        fn();
      };
      if (mod && k === 'c') return handled(copySelection);
      if (mod && k === 'v') return handled(() => pasteClipboard());
      if (mod && k === 'd') return handled(duplicateSelection);
      if (mod && k === 'a') return handled(() => selectAll());
      if (mod) return;
      if (k === 'k') return handled(keySelected);
      if (e.key === 'Delete' || e.key === 'Backspace') return handled(deleteSelected);
      if (e.key === '[') return handled(() => nudge(-1));
      if (e.key === ']') return handled(() => nudge(1));
      if (k === 'a') return handled(() => frameAll(editedEndFrame()));
      if (e.key === 'Escape' && me.get().selection.size) return handled(() => setSelection([]));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const toggle = (p: SidePanel): void => setPanel((cur) => (cur === p ? null : p));
  const btn = (label: string, icon: ReactNode, onClick: () => void, opts: { active?: boolean; testid?: string; disabled?: boolean } = {}) => (
    <IconButton
      label={label}
      onClick={onClick}
      active={opts.active}
      disabled={opts.disabled}
      data-testid={opts.testid}
      size={coarse ? 'md' : 'sm'}
    >
      {icon}
    </IconButton>
  );
  const sel = s.selection.size;
  const panelEl =
    panel === 'tools' ? (
      <ToolsPanel />
    ) : panel === 'director' ? (
      <DirectorPanel />
    ) : panel === 'markers' ? (
      <MarkersPanel />
    ) : panel === 'ik' ? (
      <IkPanel />
    ) : panel === 'export' ? (
      <ExportPanel />
    ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg-panel" data-testid="motion-editor">
      <div
        className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line px-1.5 py-1"
        role="toolbar"
        aria-label="Motion editor"
      >
        <select
          aria-label="Edited model"
          className="input h-7 max-w-[9rem] shrink-0 text-[12px] coarse:h-10"
          value={s.modelId ?? ''}
          onChange={(e) => void setEditedModel(e.target.value || null)}
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
          <option value="">Camera only</option>
        </select>
        <Sep />
        {btn('Key selected bone / animated bones (K)', <KeyRound size={15} />, keySelected, { testid: 'me-key' })}
        {btn('Key morph sliders', <Smile size={15} />, () => keyMorphs(), { testid: 'me-key-morphs' })}
        <button
          type="button"
          onClick={() => me.set({ autoKey: !s.autoKey })}
          aria-pressed={s.autoKey}
          title="Auto-key: gizmo and slider edits create keys at the playhead"
          className={cn(
            'flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] coarse:h-10 coarse:px-2.5',
            s.autoKey ? 'bg-danger/20 text-danger' : 'text-fg-muted hover:bg-bg-hover',
          )}
          data-testid="me-autokey"
        >
          <span className={cn('h-2 w-2 rounded-full', s.autoKey ? 'bg-danger' : 'bg-fg-dim')} />
          Auto
        </button>
        <Sep />
        {btn('Delete keys (Del)', <Trash2 size={15} />, deleteSelected, { disabled: !sel, testid: 'me-delete' })}
        {btn('Copy keys (Ctrl+C)', <Copy size={15} />, copySelection, { disabled: !sel })}
        {btn('Paste at playhead (Ctrl+V)', <ClipboardPaste size={15} />, () => pasteClipboard(), { disabled: !s.clipboard })}
        {btn('Duplicate (Ctrl+D)', <CopyPlus size={15} />, duplicateSelection, { disabled: !sel })}
        {btn('Nudge left ([)', <ChevronsLeft size={15} />, () => nudge(-1), { disabled: !sel })}
        {btn('Nudge right (])', <ChevronsRight size={15} />, () => nudge(1), { disabled: !sel })}
        {btn('Frame all (A)', <Maximize2 size={14} />, () => frameAll(editedEndFrame()))}
        {btn('Snap to beats & markers', <Magnet size={15} />, () => me.set({ snapToBeats: !s.snapToBeats }), { active: s.snapToBeats, testid: 'me-snap' })}
        <Sep />
        {btn('Graph editor', <Spline size={15} />, () => me.set({ graphOpen: !s.graphOpen }), { active: s.graphOpen, testid: 'me-graph' })}
        {btn('Motion tools', <Wand2 size={15} />, () => toggle('tools'), { active: panel === 'tools', testid: 'me-tools' })}
        {btn('IK & foot pinning', <Footprints size={15} />, () => toggle('ik'), { active: panel === 'ik', testid: 'me-ik' })}
        {btn('Camera Director', <Video size={15} />, () => toggle('director'), { active: panel === 'director', testid: 'me-director' })}
        {btn('Markers & BPM', <Flag size={15} />, () => toggle('markers'), { active: panel === 'markers', testid: 'me-markers' })}
        <Sep />
        {btn('Compare with original (A/B)', <ArrowLeftRight size={15} />, () => setCompareOriginal(!s.compareOriginal), {
          active: s.compareOriginal,
          testid: 'me-compare',
        })}
        {btn('Revert to original', <RotateCcw size={15} />, revertToOriginal)}
        {btn('Undo (Ctrl+Z)', <Undo2 size={15} />, undo, { disabled: !undoDepth, testid: 'me-undo' })}
        {btn('Redo (Ctrl+Shift+Z)', <Redo2 size={15} />, redo, { disabled: !redoDepth, testid: 'me-redo' })}
        {btn('Export', <Download size={15} />, () => toggle('export'), { active: panel === 'export', testid: 'me-export-open' })}
        <div className="flex-1" />
        {btn('Back to playback timeline', <X size={15} />, closeEditor, { testid: 'me-close' })}
      </div>
      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <DopeSheet />
          {s.graphOpen && !narrow && (
            <div className="h-[45%] min-h-[120px] border-t border-line">
              <Suspense fallback={null}>
                <GraphEditor />
              </Suspense>
            </div>
          )}
        </div>
        {s.graphOpen && narrow && (
          <div className="absolute inset-0 z-20 flex flex-col bg-bg-panel">
            <Suspense fallback={null}>
              <GraphEditor />
            </Suspense>
          </div>
        )}
        {panelEl && (
          <div
            className={cn(
              'z-30 overflow-y-auto border-l border-line bg-bg-panel',
              narrow ? 'absolute inset-0' : 'w-72 shrink-0',
            )}
          >
            {narrow && (
              <div className="flex justify-end p-1">
                <IconButton label="Close panel" onClick={() => setPanel(null)}>
                  <X size={16} />
                </IconButton>
              </div>
            )}
            <Suspense fallback={<div className="p-3 text-fg-muted">Loading…</div>}>{panelEl}</Suspense>
          </div>
        )}
      </div>
      <div
        className="flex h-6 shrink-0 items-center gap-3 border-t border-line px-2 font-mono text-[11px] text-fg-muted coarse:h-8"
        data-testid="me-status"
      >
        <span data-testid="me-selected">{sel} selected</span>
        <span>
          frame <span ref={frameRef}>0</span>
        </span>
        <span className="truncate">{s.channel ? `${s.channel.track}${s.channel.kind === 'bone' ? ` · ch ${s.channel.channel}` : ''}` : '—'}</span>
        <span>undo {undoDepth}</span>
        {s.compareOriginal && <span className="text-warn">showing original</span>}
        <span className={dirty ? 'text-warn' : 'text-fg-dim'}>{dirty ? '● unsaved' : 'saved'}</span>
      </div>
    </div>
  );
}
