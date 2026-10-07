import Editor, { loader, type OnMount } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import { BookOpen, Eraser, Play, Square } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { Button, IconButton } from '@/components/ui/controls';
import { cn } from '@/components/ui/cn';
import { engineOrNull } from '@/store/engineRef';
import { createStudioApi, STUDIO_DTS, type ScriptConsole } from './studioApi';
import { DEFAULT_SCRIPT, EXAMPLES } from './examples';

// Bundle Monaco locally (no CDN) and wire its web workers through Vite.
self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    return label === 'typescript' || label === 'javascript' ? new TsWorker() : new EditorWorker();
  },
};
loader.config({ monaco });

const ts = monaco.typescript;
ts.typescriptDefaults.setCompilerOptions({
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  allowNonTsExtensions: true,
  strict: false,
  noImplicitAny: false,
  lib: ['es2020', 'dom'],
});
ts.typescriptDefaults.setDiagnosticsOptions({ diagnosticCodesToIgnore: [1375, 1378, 2304] });
ts.typescriptDefaults.addExtraLib(STUDIO_DTS, 'ts:studio.d.ts');

const STORAGE_KEY = 'mmd-playground-script';

interface LogLine {
  id: number;
  level: 'log' | 'warn' | 'error' | 'info';
  text: string;
}

function format(v: unknown): string {
  if (v instanceof Error) return v.stack ?? `${v.name}: ${v.message}`;
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 1);
  } catch {
    return String(v);
  }
}

let logSeq = 0;
const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (...args: string[]) => (...a: unknown[]) => Promise<unknown>;

export default function Playground() {
  const [code, setCode] = useState(() => localStorage.getItem(STORAGE_KEY) ?? DEFAULT_SCRIPT);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const disposeRef = useRef<(() => void) | null>(null);
  const logEnd = useRef<HTMLDivElement>(null);

  const push = useCallback((level: LogLine['level'], args: unknown[]) => {
    setLogs((l) => [...l.slice(-300), { id: ++logSeq, level, text: args.map(format).join(' ') }]);
  }, []);

  useEffect(() => logEnd.current?.scrollIntoView({ block: 'end' }), [logs]);
  useEffect(() => () => disposeRef.current?.(), []);

  const stop = useCallback(() => {
    if (disposeRef.current) {
      disposeRef.current();
      disposeRef.current = null;
      push('info', ['■ Script stopped']);
    }
    setRunning(false);
  }, [push]);

  const run = useCallback(async () => {
    const engine = engineOrNull();
    const editor = editorRef.current;
    if (!engine || !editor) return;
    disposeRef.current?.();
    disposeRef.current = null;
    const out: ScriptConsole = {
      log: (...a) => push('log', a),
      warn: (...a) => push('warn', a),
      error: (...a) => push('error', a),
    };
    const { api, dispose } = createStudioApi(engine, out);
    disposeRef.current = dispose;
    setRunning(true);
    push('info', ['▶ Running…']);
    try {
      const model = editor.getModel()!;
      const getWorker = await ts.getTypeScriptWorker();
      const client = await getWorker(model.uri);
      const emit = await client.getEmitOutput(model.uri.toString());
      const js = (emit.outputFiles[0]?.text ?? model.getValue()).replace(/^export\s*\{\s*\};?\s*$/gm, '');
      const fn = new AsyncFunction('studio', 'console', `"use strict";\n${js}`);
      await fn(api, out);
      push('info', ['✓ Done (callbacks keep running until Stop)']);
    } catch (e) {
      push('error', [e]);
      dispose();
      disposeRef.current = null;
      setRunning(false);
    }
  }, [push]);

  const onMount: OnMount = (editor) => {
    editorRef.current = editor;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => void run());
    editor.focus();
  };

  return (
    <div className="flex h-full flex-col bg-bg-panel" data-testid="playground">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
        <Button variant="primary" size="sm" onClick={() => void run()} data-testid="run-script">
          <Play size={12} /> Run
        </Button>
        <Button size="sm" onClick={stop} disabled={!running}>
          <Square size={11} /> Stop
        </Button>
        <select
          aria-label="Load example"
          className="input ml-1 h-6 max-w-[160px]"
          value=""
          onChange={(e) => {
            const ex = EXAMPLES.find((x) => x.id === e.target.value);
            if (ex) {
              stop();
              setCode(ex.code);
              localStorage.setItem(STORAGE_KEY, ex.code);
            }
          }}
        >
          <option value="">Examples…</option>
          {EXAMPLES.map((ex) => (
            <option key={ex.id} value={ex.id}>
              {ex.title}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <IconButton size="sm" label="API reference" active={showDocs} onClick={() => setShowDocs(!showDocs)}>
          <BookOpen size={13} />
        </IconButton>
      </div>
      <Group orientation="vertical" id="playground-split">
        <Panel id="pg-editor" minSize="20%">
          {showDocs ? (
            <pre className="h-full overflow-auto whitespace-pre-wrap p-3 font-mono text-[11px] leading-relaxed text-fg-muted">{STUDIO_DTS.trim()}</pre>
          ) : (
            <Editor
              height="100%"
              defaultLanguage="typescript"
              path="file:///playground.ts"
              theme="vs-dark"
              value={code}
              onChange={(v) => {
                setCode(v ?? '');
                localStorage.setItem(STORAGE_KEY, v ?? '');
              }}
              onMount={onMount}
              options={{ minimap: { enabled: false }, fontSize: 12, tabSize: 2, scrollBeyondLastLine: false, automaticLayout: true, wordWrap: 'on' }}
            />
          )}
        </Panel>
        <Separator className="resize-handle h-px" aria-label="Resize console" />
        <Panel id="pg-console" defaultSize="30%" minSize="60px">
          <div className="flex h-full flex-col">
            <div className="flex h-7 shrink-0 items-center justify-between border-b border-line px-2">
              <span className="panel-title">Console</span>
              <IconButton size="sm" label="Clear console" onClick={() => setLogs([])}>
                <Eraser size={12} />
              </IconButton>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2 font-mono text-[11px] leading-relaxed" role="log" aria-live="polite" data-testid="console">
              {logs.map((l) => (
                <div key={l.id} className={cn('whitespace-pre-wrap break-words border-b border-line/40 py-0.5', l.level === 'error' && 'text-danger', l.level === 'warn' && 'text-warn', l.level === 'info' && 'text-fg-dim')}>
                  {l.text}
                </div>
              ))}
              <div ref={logEnd} />
            </div>
          </div>
        </Panel>
      </Group>
    </div>
  );
}
