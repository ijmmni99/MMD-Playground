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
      {report.twoView && (
        <div
          className="mt-1 flex flex-col gap-1.5 border-t border-line pt-1.5"
          data-testid="v2v-report-twoview"
        >
          <div className="text-[11px] font-semibold text-fg-muted">Two-view</div>
          <Meter
            label="Detected (front / side)"
            value={`${report.twoView.detectedPct[0].toFixed(0)}% / ${report.twoView.detectedPct[1].toFixed(0)}%`}
            good={Math.min(...report.twoView.detectedPct) > 80}
          />
          <Meter
            label="Sync"
            value={`${report.twoView.syncOffsetMs >= 0 ? '+' : ''}${report.twoView.syncOffsetMs} ms · ${report.twoView.syncMethod}`}
            good={report.twoView.syncMethod === 'manual' || report.twoView.syncConfidence > 0.35}
            hint="Side time = front time + offset."
          />
          <Meter
            label="Calibration"
            value={`${Math.round(report.twoView.yawDeg)}° · ${Math.round(report.twoView.calibrationConfidence * 100)}%`}
            good={report.twoView.calibrationConfidence > 0.5}
          />
          <Meter
            label="Joints seen by both views"
            value={`${report.twoView.fusedPct.toFixed(0)}%`}
            good={report.twoView.fusedPct > 60}
            hint="The rest came from one view (single-view frames)."
          />
        </div>
      )}
      {report.face && (
        <div className="mt-1 flex flex-col gap-1.5 border-t border-line pt-1.5" data-testid="v2v-report-face">
          <div className="text-[11px] font-semibold text-fg-muted">Face</div>
          <Meter
            label="Frames with a face"
            value={`${report.face.detectedPct.toFixed(0)}%`}
            good={report.face.detectedPct > 80}
          />
          <Meter
            label="Morphs written"
            value={report.face.written.length ? report.face.written.join(' ') : 'none'}
            good={report.face.written.length > 0}
          />
        </div>
      )}
      {report.hands && (
        <div
          className="mt-1 flex flex-col gap-1.5 border-t border-line pt-1.5"
          data-testid="v2v-report-hands"
        >
          <div className="text-[11px] font-semibold text-fg-muted">Fingers</div>
          <Meter
            label="Hands detected (left / right)"
            value={`${report.hands.detectedPct[0].toFixed(0)}% / ${report.hands.detectedPct[1].toFixed(0)}%`}
            good={Math.min(...report.hands.detectedPct) > 70}
          />
        </div>
      )}
      {report.warnings.length > 0 && (
        <ul className="mt-1 flex flex-col gap-1">
          {report.warnings.slice(0, 12).map((w, i) => (
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
