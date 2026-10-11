// Pure module: no React Native imports, so it can be unit-tested directly.
//
// "Each later change reaches the page once. The status box counts." That is the rule this module
// exists for. A page counts every `app:*` event it receives, so re-sending a value that did not change
// is visible as a wrong count — and re-sending the whole state on every render would be worse.
//
// It compares what was last sent with what is current and returns only the difference, in the shapes
// the protocol defines. The caller keeps `nextSent` and hands it back next time.

import { AppEventName, Insets, PageKind, PageState } from './pageScripts';

/** What the page has already been told. `null` before the first send. */
export type SentState = PageState & { insets?: Insets };

export type PlannedEvent = {
  name: AppEventName;
  detail: unknown;
};

export type StateUpdatePlan = {
  events: PlannedEvent[];
  nextSent: SentState;
};

/**
 * Works out which `app:*` events a page still needs.
 *
 * With `lastSent === null` this is a fresh document and it returns the full initial set, in the same
 * order and the same shapes as `initialStateScript`. Afterwards it returns only what changed.
 */
export function planStateUpdates(
  lastSent: SentState | null,
  current: PageState,
  page: PageKind,
  insets?: Insets,
): StateUpdatePlan {
  const events: PlannedEvent[] = [];
  const first = lastSent === null;

  if (first || lastSent.fontScale !== current.fontScale) {
    events.push({ name: 'app:fontScale', detail: { value: current.fontScale } });
  }

  if (first || lastSent.theme !== current.theme) {
    events.push({ name: 'app:theme', detail: { value: current.theme } });
  }

  // Compared by content: the reducer hands back new arrays, and identity would re-send every time.
  if (first || !sameList(lastSent.bookmarks, current.bookmarks)) {
    events.push({ name: 'app:bookmarks', detail: { ids: current.bookmarks } });
  }

  // Only the front page marks read teasers; the article page has no listener for it.
  if (page === 'front' && (first || !sameList(lastSent.read, current.read))) {
    events.push({ name: 'app:read', detail: { ids: current.read } });
  }

  // Only the article page reserves the app's chrome.
  if (page === 'article' && insets && (first || !sameInsets(lastSent.insets, insets))) {
    events.push({ name: 'app:insets', detail: { top: insets.top, bottom: insets.bottom } });
  }

  return { events, nextSent: snapshot(current, page, insets) };
}

function snapshot(current: PageState, page: PageKind, insets?: Insets): SentState {
  const next: SentState = {
    fontScale: current.fontScale,
    theme: current.theme,
    bookmarks: [...current.bookmarks],
    read: [...current.read],
  };

  if (page === 'article' && insets) next.insets = { ...insets };

  return next;
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}

function sameInsets(a: Insets | undefined, b: Insets): boolean {
  return a !== undefined && a.top === b.top && a.bottom === b.bottom;
}
