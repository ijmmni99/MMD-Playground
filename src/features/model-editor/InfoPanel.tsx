import { CheckCircle2, Download, FileJson, Upload, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/controls';
import { describeOp } from '@/lib/model-edit/ops';
import { useModelEditor, useOps } from '@/store/modelEditor';
import { applyToScene, commitOp, exportEditList, importEditList, saveZip } from './actions';
import { Notice, SubHead, TextField } from './ui';

export function InfoPanel() {
  const ops = useOps();
  const result = useModelEditor((s) => s.result);
  const issues = useModelEditor((s) => s.issues);
  const [busy, setBusy] = useState(false);
  const pmx = result?.pmx;
  if (!pmx) return null;
  const errors = issues.filter((i) => i.level === 'error');
  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="px-3 pb-4" data-testid="me-info">
      <SubHead>Model info</SubHead>
      <TextField
        label="Name (日本語)"
        value={pmx.name}
        testid="me-info-name"
        onCommit={(v) => commitOp({ type: 'info', name: v }, { label: 'Model name' })}
      />
      <TextField
        label="English name"
        value={pmx.nameEn}
        onCommit={(v) => commitOp({ type: 'info', nameEn: v }, { label: 'English name' })}
      />
      <TextField
        label="Comment (日本語) — keep the author's license text"
        value={pmx.comment}
        multiline
        onCommit={(v) => commitOp({ type: 'info', comment: v }, { label: 'Comment' })}
      />
      <TextField
        label="Comment (English)"
        value={pmx.commentEn}
        multiline
        onCommit={(v) => commitOp({ type: 'info', commentEn: v }, { label: 'English comment' })}
      />
      <p className="text-[11px] text-fg-dim">
        {pmx.vertices.length.toLocaleString()} vertices · {pmx.materials.length} materials ·{' '}
        {pmx.bones.length} bones · {pmx.morphs.length} morphs · {pmx.rigidBodies.length} rigid bodies ·{' '}
        {pmx.frames.length} display frames
      </p>

      <SubHead>Checks</SubHead>
      {issues.length === 0 ? (
        <p className="flex items-center gap-1 text-[12px] text-fg-muted" data-testid="me-checks-ok">
          <CheckCircle2 size={13} className="text-ok" /> The model is valid.
        </p>
      ) : (
        <ul className="space-y-1" data-testid="me-issues">
          {issues.slice(0, 20).map((i, k) => (
            <li key={k}>
              <Notice tone={i.level === 'error' ? 'warn' : 'info'}>{i.message}</Notice>
            </li>
          ))}
        </ul>
      )}
      {result.warnings.length > 0 && (
        <ul className="mt-1 space-y-1">
          {result.warnings.map((w, k) => (
            <li key={k}>
              <Notice>{w}</Notice>
            </li>
          ))}
        </ul>
      )}

      <SubHead>Save</SubHead>
      <div className="grid gap-1.5">
        <Button
          variant="primary"
          disabled={busy || errors.length > 0 || !ops.length}
          data-testid="me-apply"
          onClick={() => void run(applyToScene)}
        >
          <Wand2 size={14} /> Apply to scene (keep in project)
        </Button>
        <Button
          disabled={busy || errors.length > 0}
          data-testid="me-save-zip"
          onClick={() => void run(saveZip)}
        >
          <Download size={14} /> Save as PMX ZIP
        </Button>
        <div className="grid grid-cols-2 gap-1.5">
          <Button variant="ghost" onClick={exportEditList} disabled={!ops.length}>
            <FileJson size={14} /> Export edits
          </Button>
          <Button variant="ghost" onClick={() => void importEditList()}>
            <Upload size={14} /> Import edits
          </Button>
        </div>
      </div>
      <Notice>
        Edited models are still the original author’s work: their license decides whether you may modify and
        share them. The README in the ZIP keeps the original comment and lists your edits.
      </Notice>

      <SubHead>Edit history ({ops.length})</SubHead>
      <ol
        className="max-h-48 list-decimal overflow-y-auto pl-5 text-[12px] text-fg-muted"
        data-testid="me-history"
      >
        {ops.map((op, i) => (
          <li key={i}>{describeOp(op)}</li>
        ))}
      </ol>
    </div>
  );
}
