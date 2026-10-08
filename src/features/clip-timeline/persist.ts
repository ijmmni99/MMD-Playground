// Clip timeline ↔ project document.

import { emptyTimeline, type TimelineDoc } from '@/lib/clips/types';
import { ct } from '@/store/clipTimeline';
import { engineOrNull } from '@/store/engineRef';
import { bakeNow, resetBakeState } from './runtime';
import { loadSources } from './sources';

export function buildClipTimelineDoc(): TimelineDoc | undefined {
  const doc = ct.get().doc;
  return doc.clips.length || doc.tracks.length ? doc : undefined;
}

/** Restore (or clear, for a project without one) the clip timeline; returns sources that failed to load. */
export async function restoreClipTimeline(doc: TimelineDoc | undefined): Promise<string[]> {
  resetBakeState();
  engineOrNull()?.setMinDuration(0);
  const next = doc ?? emptyTimeline();
  const missing = await loadSources(next.sources);
  ct.set({ doc: next, selection: [], clipboard: [], editing: null, textEditing: null, sessionStart: next, scroll: 0 });
  bakeNow();
  return missing;
}
