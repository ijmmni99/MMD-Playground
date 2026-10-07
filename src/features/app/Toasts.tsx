import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '@/components/ui/cn';
import { dismissToast, useStudio } from '@/store/studio';

const ICONS = {
  info: <Info size={15} className="text-accent" />,
  success: <CheckCircle2 size={15} className="text-ok" />,
  warning: <AlertTriangle size={15} className="text-warn" />,
  error: <XCircle size={15} className="text-danger" />,
};

export function Toasts() {
  const toasts = useStudio((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2" aria-live="polite" role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          className={cn(
            'pointer-events-auto flex items-start gap-2 rounded-md border bg-bg-panel px-3 py-2 text-[12px] shadow-xl',
            t.kind === 'error' ? 'border-danger/40' : t.kind === 'warning' ? 'border-warn/40' : 'border-line',
          )}
        >
          <span className="mt-0.5 shrink-0">{ICONS[t.kind]}</span>
          <span className="min-w-0 flex-1 break-words leading-relaxed">{t.message}</span>
          <button type="button" aria-label="Dismiss" className="shrink-0 rounded p-0.5 text-fg-dim hover:text-fg" onClick={() => dismissToast(t.id)}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
