import { create } from 'zustand';
import { computeLayoutMode, type LayoutMode } from '@/lib/layoutMode';

export type SheetTab = 'scene' | 'models' | 'inspector' | 'timeline' | 'capture' | 'more' | 'video2vmd';
export type SheetSnap = 'closed' | 'peek' | 'half' | 'full';

export interface LayoutState {
  mode: LayoutMode;
  /** Primary pointer is coarse (touch). */
  coarse: boolean;
  /** Phone portrait bottom sheet. */
  sheet: { tab: SheetTab | null; snap: SheetSnap };
  /** Phone landscape side panel. */
  side: { tab: SheetTab; open: boolean };
  /** Tablet drawers. */
  drawers: { left: boolean; right: boolean; bottom: boolean };
}

const initialWidth = typeof window !== 'undefined' ? window.innerWidth : 1440;
const initialHeight = typeof window !== 'undefined' ? window.innerHeight : 900;

export const detectCoarse = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(pointer: coarse)').matches;

export const useLayout = create<LayoutState>(() => ({
  mode: computeLayoutMode(initialWidth, initialHeight),
  coarse: detectCoarse(),
  sheet: { tab: null, snap: 'closed' },
  side: { tab: 'models', open: true },
  drawers: { left: false, right: false, bottom: true },
}));

/** Open a sheet tab; tapping the active tab again closes it. */
export function toggleSheet(tab: SheetTab): void {
  useLayout.setState((s) => {
    if (s.sheet.tab === tab && s.sheet.snap !== 'closed') return { sheet: { tab: null, snap: 'closed' } };
    const snap = s.sheet.snap === 'closed' ? (tab === 'timeline' ? 'peek' : 'half') : s.sheet.snap;
    return { sheet: { tab, snap } };
  });
}

export function setSheetSnap(snap: SheetSnap): void {
  useLayout.setState((s) => ({ sheet: snap === 'closed' ? { tab: null, snap } : { ...s.sheet, snap } }));
}

export function openSheet(tab: SheetTab, snap: SheetSnap = 'half'): void {
  useLayout.setState({ sheet: { tab, snap } });
}

export function setSideTab(tab: SheetTab): void {
  useLayout.setState((s) => ({ side: { tab, open: s.side.tab === tab ? !s.side.open : true } }));
}

export function toggleDrawer(d: 'left' | 'right' | 'bottom'): void {
  useLayout.setState((s) => ({ drawers: { ...s.drawers, [d]: !s.drawers[d] } }));
}
