import { ExternalLink, FolderOpen, Sparkles, Upload } from 'lucide-react';
import { Button } from '@/components/ui/controls';
import { loadSample, openFilePicker, openFolderPicker } from '@/features/app/filePickers';

const SOURCES = [
  { name: 'BowlRoll', url: 'https://bowlroll.net/', note: 'Large MMD model & motion archive (JP)' },
  { name: 'Niconi Solid', url: 'https://3d.nicovideo.jp/', note: 'Official model sharing by creators' },
  { name: 'DeviantArt — MMD', url: 'https://www.deviantart.com/tag/mmd', note: 'Community models; check each license' },
  { name: 'VPVP wiki', url: 'https://w.atwiki.jp/vpvpwiki/', note: 'Classic official models (Tda, Animasa…)' },
];

export function EmptyState() {
  return (
    <div className="absolute inset-0 grid place-items-center overflow-auto p-6">
      <div className="pointer-events-auto w-full max-w-xl rounded-xl border border-line bg-bg-panel/95 p-6 shadow-2xl backdrop-blur" data-testid="empty-state">
        <h1 className="text-[18px] font-semibold">Welcome to MMD Studio</h1>
        <p className="mt-1.5 leading-relaxed text-fg-muted">
          Drag a <b className="text-fg">model folder or ZIP</b> (.pmx/.pmd with textures), a <b className="text-fg">.vmd motion</b>, a
          camera VMD and an <b className="text-fg">audio file</b> anywhere onto this window. Everything stays in your browser.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void openFilePicker()}>
            <Upload size={14} /> Open files…
          </Button>
          <Button onClick={() => void openFolderPicker()}>
            <FolderOpen size={14} /> Open folder…
          </Button>
          <Button onClick={() => void loadSample()} data-testid="load-sample">
            <Sparkles size={14} /> Try the built-in sample
          </Button>
        </div>
        <ol className="mt-5 grid gap-2 text-[12px] text-fg-muted sm:grid-cols-3">
          <li className="rounded-md border border-line p-2.5">
            <b className="block text-fg">1 · Model</b>Drop the whole model folder so textures resolve.
          </li>
          <li className="rounded-md border border-line p-2.5">
            <b className="block text-fg">2 · Motion</b>Drop a VMD — it attaches to the selected model.
          </li>
          <li className="rounded-md border border-line p-2.5">
            <b className="block text-fg">3 · Play</b>Add music, press <kbd className="font-mono">Space</kbd>, record a video.
          </li>
        </ol>
        <div className="mt-5">
          <div className="panel-title mb-2">Where to get MMD assets legally</div>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {SOURCES.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noreferrer noopener" className="group flex items-start gap-1.5 rounded p-1 hover:bg-bg-hover">
                  <ExternalLink size={12} className="mt-0.5 shrink-0 text-accent" />
                  <span>
                    <span className="text-fg group-hover:underline">{s.name}</span>
                    <span className="block text-[11px] text-fg-dim">{s.note}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] leading-relaxed text-fg-dim">
            MMD Studio ships no third-party models or motions. Always read and respect each asset’s readme / terms of use (credit,
            redistribution, commercial use, R-18 restrictions).
          </p>
        </div>
      </div>
    </div>
  );
}
