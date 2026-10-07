import { AlertTriangle } from 'lucide-react';
import type { QualityReport } from '@/engine/video2vmd/types';

function Meter({ label, value, good, hint }: { label: string; value: string; good: boolean; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[12px]" title={hint}>
      <span className="text-fg-muted">{label}</span>
      <span className={good ? 'font-medium text-fg' : 'font-medium text-warn'}>{value}</span>
    </div>
  );
}

/** Quality report shown after processing. */
export function QualityReportView({ report, skeletonName }: { report: QualityReport; skeletonName: string }) {
  return (
    <div
      className="mx-3 flex flex-col gap-1.5 rounded-md border border-line bg-bg-raised p-2.5"
      data-testid="v2v-report"
    >
      <div className="mb-0.5 flex items-center justify-between">
        <span className="text-[12px] font-semibold">Quality report</span>
        <span className="truncate text-[11px] text-fg-dim" title={skeletonName}>
          → {skeletonName}
        </span>
      </div>
      <Meter
        label="Frames with a detected dancer"
        value={`${report.detectedPct.toFixed(0)}%`}
        good={report.detectedPct > 90}
      />
      <Meter
        label="Average landmark confidence"
        value={`${(report.avgConfidence * 100).toFixed(0)}%`}
        good={report.avgConfidence > 0.6}
      />
      <Meter
        label="Jitter (raw → clean)"
        value={`${report.jitterRaw.toFixed(1)} → ${report.jitterClean.toFixed(1)}`}
        good={report.jitterClean < 6}
        hint="Mean joint acceleration in mm/frame²; lower is smoother."
      />
      <Meter
        label="Foot skate (before → after)"
        value={`${report.footSkateBefore.toFixed(2)} → ${report.footSkateAfter.toFixed(2)}`}
        good={report.footSkateAfter < 2}
        hint="Mean sliding speed of planted feet, MMD units per second."
      />
      <Meter
        label="Repaired outlier frames"
        value={String(report.outlierFrames)}
        good={report.outlierFrames < report.frames * 0.1}
      />
      {report.warnings.length > 0 && (
        <ul className="mt-1 flex flex-col gap-1">
          {report.warnings.slice(0, 8).map((w, i) => (
            <li key={i} className="flex gap-1.5 text-[11px] leading-snug text-fg">
              <AlertTriangle size={12} className="mt-0.5 shrink-0 text-warn" />
              {w.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
