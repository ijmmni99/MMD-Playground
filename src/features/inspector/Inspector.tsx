import * as Tabs from '@radix-ui/react-tabs';
import { Camera, Clapperboard, Sun, User } from 'lucide-react';
import { useStudio, studio, type RightTab } from '@/store/studio';
import { ModelInspector } from './ModelInspector';
import { ScenePanel } from './ScenePanel';
import { CameraPanel } from './CameraPanel';
import { ExportPanel } from '@/features/export/ExportPanel';

const TABS: { id: RightTab; label: string; icon: React.ReactNode }[] = [
  { id: 'model', label: 'Model', icon: <User size={13} /> },
  { id: 'scene', label: 'Scene', icon: <Sun size={13} /> },
  { id: 'camera', label: 'Camera', icon: <Camera size={13} /> },
  { id: 'export', label: 'Export', icon: <Clapperboard size={13} /> },
];

export function Inspector() {
  const tab = useStudio((s) => s.rightTab);
  return (
    <Tabs.Root value={tab} onValueChange={(v) => studio.set({ rightTab: v as RightTab })} className="flex h-full flex-col bg-bg-panel">
      <Tabs.List aria-label="Inspector" className="flex h-9 shrink-0 border-b border-line px-1">
        {TABS.map((t) => (
          <Tabs.Trigger
            key={t.id}
            value={t.id}
            className="flex flex-1 items-center justify-center gap-1.5 border-b-2 border-transparent text-[12px] text-fg-muted transition-colors hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg"
          >
            {t.icon}
            {t.label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Tabs.Content value="model" className="outline-none">
          <ModelInspector />
        </Tabs.Content>
        <Tabs.Content value="scene" className="outline-none">
          <ScenePanel />
        </Tabs.Content>
        <Tabs.Content value="camera" className="outline-none">
          <CameraPanel />
        </Tabs.Content>
        <Tabs.Content value="export" className="outline-none">
          <ExportPanel />
        </Tabs.Content>
      </div>
    </Tabs.Root>
  );
}
