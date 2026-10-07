export type LayoutMode = 'phone' | 'phone-landscape' | 'tablet' | 'desktop';

export const PHONE_MAX = 640;
export const TABLET_MAX = 1024;
/** Landscape phones are short; tablets in landscape are not. */
export const LANDSCAPE_PHONE_MAX_HEIGHT = 500;

/** Pick the layout for a viewport size. Pure so it can be unit-tested. */
export function computeLayoutMode(width: number, height: number): LayoutMode {
  if (width > TABLET_MAX) return 'desktop';
  if (height < LANDSCAPE_PHONE_MAX_HEIGHT && width > height) return 'phone-landscape';
  if (width < PHONE_MAX) return 'phone';
  return 'tablet';
}

export const isPhoneMode = (m: LayoutMode): boolean => m === 'phone' || m === 'phone-landscape';
