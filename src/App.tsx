import * as RTooltip from '@radix-ui/react-tooltip';
import { Dialogs } from '@/features/app/Dialogs';
import { Toasts } from '@/features/app/Toasts';
import { useShortcuts } from '@/features/app/useShortcuts';
import { DesktopShell } from '@/features/shell/DesktopShell';
import { PhoneLandscapeShell } from '@/features/shell/PhoneLandscapeShell';
import { PhoneShell } from '@/features/shell/PhoneShell';
import { TabletShell } from '@/features/shell/TabletShell';
import { useAppLifecycle } from '@/features/shell/useAppLifecycle';
import { useBreakpoint } from '@/hooks/useBreakpoint';

export type { PanelToggles } from '@/features/shell/DesktopShell';

export default function App() {
  const mode = useBreakpoint();
  useShortcuts();
  useAppLifecycle();
  return (
    <RTooltip.Provider>
      {mode === 'desktop' && <DesktopShell />}
      {mode === 'tablet' && <TabletShell />}
      {mode === 'phone' && <PhoneShell />}
      {mode === 'phone-landscape' && <PhoneLandscapeShell />}
      <Toasts />
      <Dialogs />
    </RTooltip.Provider>
  );
}
