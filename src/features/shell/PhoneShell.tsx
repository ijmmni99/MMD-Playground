import { useEffect } from 'react';
import { Viewport } from '@/features/viewport/Viewport';
import { engineOrNull } from '@/store/engineRef';
import { useLayout } from '@/store/layout';
import { useStudio } from '@/store/studio';
import { BottomSheet } from './BottomSheet';
import { CompactTransport } from './CompactTransport';
import { PhoneTopBar } from './PhoneTopBar';
import { TabBar } from './TabBar';
import { TabContent } from './tabs';
import { tabLabel } from './tabsMeta';

const SHEET_ID = 'phone-sheet';

/** Phone portrait: full-bleed viewport, bottom sheets, transport and tab bar. */
export function PhoneShell() {
  const sheet = useLayout((s) => s.sheet);
  const ready = useStudio((s) => s.engineReady);

  // A full-height sheet hides the viewport: stop rendering (playback keeps it running).
  useEffect(() => {
    engineOrNull()?.setRenderPaused(sheet.snap === 'full');
    return () => engineOrNull()?.setRenderPaused(false);
  }, [sheet.snap, ready]);

  return (
    <div className="flex h-full flex-col bg-bg pt-[env(safe-area-inset-top)]" data-testid="phone-shell">
      <PhoneTopBar />
      <main className="relative min-h-0 flex-1 overflow-hidden">
        <Viewport compact />
        <BottomSheet id={SHEET_ID} title={sheet.tab ? tabLabel(sheet.tab) : ''} snap={sheet.snap}>
          {sheet.tab && <TabContent tab={sheet.tab} />}
        </BottomSheet>
      </main>
      <CompactTransport />
      <TabBar sheetId={SHEET_ID} />
    </div>
  );
}
