import { Play, Square } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/components/ui/cn';
import { engineOrNull } from '@/store/engineRef';
import { EXAMPLES } from './examples';
import { AsyncFunction, formatLog } from './runner';
import { createStudioApi, type ScriptConsole } from './studioApi';

interface Line {
  id: number;
  level: 'log' | 'warn' | 'error' | 'info';
  text: string;
}
let seq = 0;

/**
 * Phone playground: pick one of the example scripts, read it, run/stop it. No editor —
 * Monaco is a poor fit for touch keyboards and a heavy download on mobile networks.
 */
export default function PlaygroundLite() {
  const [selected, setSelected] = useState(EXAMPLES[0].id);
  const [running, setRunning] = useState<string | null>(null);
  const [logs, setLogs] = useState<Line[]>([]);
  const dispose = useRef<(() => void) | null>(null);
  const example = EXAMPLES.find((e) => e.id === selected) ?? EXAMPLES[0];

  const push = useCallback((level: Line['level'], args: unknown[]) => {
    setLogs((l) => [...l.slice(-100), { id: ++seq, level, text: args.map(formatLog).join(' ') }]);
  }, []);

  const stop = useCallback(() => {
    dispose.current?.();
    dispose.current = null;
    setRunning(null);
  }, []);
  useEffect(() => stop, [stop]);

  const run = async (): Promise<void> => {
    const engine = engineOrNull();
    if (!engine) return;
    stop();
    const out: ScriptConsole = {
      log: (...a) => push('log', a),
      warn: (...a) => push('warn', a),
      error: (...a) => push('error', a),
    };
    const { api, dispose: d } = createStudioApi(engine, out);
    dispose.current = d;
    setRunning(example.id);
    push('info', [`▶ ${example.title}`]);
    try {
      // Examples are plain JavaScript, so no TypeScript transpile step is needed here.
      await new AsyncFunction('studio', 'console', `"use strict";\n${example.code}`)(api, out);
    } catch (e) {
      push('error', [e]);
      stop();
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="playground-lite">
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Example scripts">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.id}
            type="button"
            role="tab"
            aria-selected={selected === ex.id}
            onClick={() => setSelected(ex.id)}
            className={cn(
              'min-h-[44px] shrink-0 rounded-full border px-4 text-[13px]',
              selected === ex.id ? 'border-accent bg-accent-soft text-fg' : 'border-line text-fg-muted',
            )}
          >
            {ex.title}
            {running === ex.id && <span className="ml-1 text-ok">●</span>}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void run()}
          data-testid="run-script"
          className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg bg-accent-strong font-medium text-white"
        >
          <Play size={16} /> Run “{example.title}”
        </button>
        <button
          type="button"
          onClick={stop}
          disabled={!running}
          className="flex min-h-[44px] items-center gap-2 rounded-lg border border-line px-4 disabled:opacity-40"
        >
          <Square size={14} /> Stop
        </button>
      </div>
      <pre className="max-h-56 overflow-auto rounded-lg border border-line bg-bg p-3 font-mono text-[11px] leading-relaxed text-fg-muted">
        {example.code}
      </pre>
      <div
        className="max-h-40 overflow-auto rounded-lg border border-line bg-bg p-2 font-mono text-[11px]"
        role="log"
        aria-live="polite"
        data-testid="console"
      >
        {logs.length === 0 ? (
          <span className="text-fg-dim">Console output appears here.</span>
        ) : (
          logs.map((l) => (
            <div
              key={l.id}
              className={cn(
                'whitespace-pre-wrap break-words',
                l.level === 'error' && 'text-danger',
                l.level === 'warn' && 'text-warn',
                l.level === 'info' && 'text-fg-dim',
              )}
            >
              {l.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
