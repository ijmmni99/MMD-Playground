import { Clapperboard, Film, MoreHorizontal, SlidersHorizontal, Sun, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import type { SheetTab } from '@/store/layout';

export const TABS: { id: SheetTab; label: string; icon: ReactNode }[] = [
  { id: 'scene', label: 'Scene', icon: <Sun size={20} /> },
  { id: 'models', label: 'Models', icon: <Users size={20} /> },
  { id: 'inspector', label: 'Inspector', icon: <SlidersHorizontal size={20} /> },
  { id: 'timeline', label: 'Timeline', icon: <Film size={20} /> },
  { id: 'capture', label: 'Capture', icon: <Clapperboard size={20} /> },
  { id: 'more', label: 'More', icon: <MoreHorizontal size={20} /> },
];

export const tabLabel = (t: SheetTab): string => TABS.find((x) => x.id === t)?.label ?? t;
