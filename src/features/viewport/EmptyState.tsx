import { ExternalLink, FolderOpen, Sparkles, Upload } from 'lucide-react';
import { Button } from '@/components/ui/controls';
import { AddButtons } from '@/features/models/ModelsPanel';
import { useLayout } from '@/store/layout';
import {
  folderPickSupported,
  loadSample,
  openFilePicker,
  openFolderPicker,
} from '@/features/app/filePickers';

const SOURCES = [
  { name: 'BowlRoll', url: 'https://bowlroll.net/', note: 'Large MMD model & motion archive (JP)' },
  { name: 'Niconi Solid', url: 'https://3d.nicovideo.jp/', note: 'Official model sharing by creators' },
  {
    name: 'DeviantArt — MMD',
    url: 'https://www.deviantart.com/tag/mmd',
    note: 'Community models; check each license',
  },
  {
    name: 'VPVP wiki',
    url: 'https://w.atwiki.jp/vpvpwiki/',
    note: 'Classic official models (Tda, Animasa…)',
  },
];

export function EmptyState() {
  const coarse = useLayout((s) => s.coarse);
  return (
    <div className="absolute inset-0 grid place-items-center overflow-auto p-6 max-sm:place-items-start max-sm:p-3 max-sm:pt-16">
      <div
        className="pointer-events-auto w-full max-w-xl rounded-xl border border-line bg-bg-panel/95 p-6 shadow-2xl backdrop-blur max-sm:p-4"
        data-testid="empty-state"
      >
        <h1 className="text-[18px] font-semibold">Welcome to MMD Studio</h1>
        {coarse ? (
          <>
            <p className="mt-1.5 leading-relaxed text-fg-muted">
              Add a model (a <b className="text-fg">.zip</b> of the model folder works best on phones), then a{' '}
              <b className="text-fg">.vmd</b> motion and music. Everything stays on your device.
            </p>
            <div className="-mx-3 mt-2">
              <AddButtons />
            </div>
            <button
              type="button"
              onClick={() => void loadSample()}
              data-testid="load-sample"
              className="mt-1 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg border border-accent/40 bg-accent-soft text-[14px] font-medium"
            >
              <Sparkles size={16} /> Try the built-in sample
            </button>
          </>
        ) : null}
        <p className={coarse ? 'hidden' : 'mt-1.5 leading-relaxed text-fg-muted'}>
          Drag a <b className="text-fg">model folder or ZIP</b> (.pmx/.pmd with textures), a{' '}
          <b className="text-fg">.vmd motion</b>, a camera VMD and an <b className="text-fg">audio file</b>{' '}
          anywhere onto this window. Everything stays in your browser.
        </p>
        {!folderPickSupported && (
          <p className="mt-2 rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-[12px] text-fg">
            On iPhone/iPad: zip the model folder (Files app → long-press → Compress) and upload the .zip.
          </p>
        )}
        {!coarse && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => void openFilePicker()}>
              <Upload size={14} /> {folderPickSupported ? 'Open files / ZIP…' : 'Upload ZIP or files…'}
            </Button>
            {folderPickSupported && (
              <Button onClick={() => void openFolderPicker()}>
                <FolderOpen size={14} /> Open folder…
              </Button>
            )}
            <Button onClick={() => void loadSample()} data-testid="load-sample">
              <Sparkles size={14} /> Try the built-in sample
            </Button>
          </div>
        )}
        <ol className={coarse ? 'hidden' : 'mt-5 grid gap-2 text-[12px] text-fg-muted sm:grid-cols-3'}>
          <li className="rounded-md border border-line p-2.5">
            <b className="block text-fg">1 · Model</b>Drop the whole model folder so textures resolve.
          </li>
          <li className="rounded-md border border-line p-2.5">
            <b className="block text-fg">2 · Motion</b>Drop a VMD — it attaches to the selected model.
          </li>
          <li className="rounded-md border border-line p-2.5">
            <b className="block text-fg">3 · Play</b>Add music, press <kbd className="font-mono">Space</kbd>,
            record a video.
          </li>
        </ol>
        <div className="mt-5">
          <div className="panel-title mb-2">Where to get MMD assets legally</div>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {SOURCES.map((s) => (
              <li key={s.url}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="group flex items-start gap-1.5 rounded p-1 hover:bg-bg-hover"
                >
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
            MMD Studio ships no third-party models or motions. Always read and respect each asset’s readme /
            terms of use (credit, redistribution, commercial use, R-18 restrictions).
          </p>
        </div>
      </div>
    </div>
  );
}
