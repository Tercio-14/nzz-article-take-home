// Pure module: no React Native imports, so it can be unit-tested directly.
//
// Two small rules about what the page area looks like while it is not showing a page. Both were got
// wrong first time round and only turned up in manual testing, so they live here where they can be
// pinned down:
//
// - Only ever one loading indicator. The front page has a pull-to-refresh spinner of its own, and a
//   load that the reader did not ask for must not light up both that and the overlay.
// - A page area that is not showing a page must not keep the height of the one that was. A document
//   that failed is not as tall as the document before it, and sizing it that way buries the error
//   message somewhere far down an otherwise blank scroll view.

import { SessionPhase } from './pageSession';

export type PageOverlay = 'none' | 'loading' | 'error';

export type OverlayRequest = {
  phase: SessionPhase;
  /**
   * Whether this host should draw the loading spinner. False when the caller is already showing one
   * of its own, such as the front page's pull-to-refresh control.
   */
  showLoadingOverlay: boolean;
};

/**
 * Which overlay the page area should draw.
 *
 * The error view is never suppressed: `showLoadingOverlay` governs the spinner only. A caller that is
 * showing its own spinner still needs the reader to be told when the page could not be loaded.
 */
export function overlayFor({ phase, showLoadingOverlay }: OverlayRequest): PageOverlay {
  if (phase === 'error') return 'error';
  if (phase === 'ready') return 'none';

  return showLoadingOverlay ? 'loading' : 'none';
}

export type PageHeightRequest = {
  phase: SessionPhase;
  /** The height the current document reported, or null when it has not reported one yet. */
  reportedHeight: number | null;
  /** The visible area to fall back to, so loading and error views land on screen. */
  fallbackHeight: number;
};

/**
 * How tall a page area should be that is sized by the page itself, as the front page's is.
 *
 * A reported height counts only while the page is actually being shown. While loading, failed, or
 * waiting for consent, there is no page to measure and the fallback keeps whatever is drawn in view.
 */
export function pageAreaHeight({ phase, reportedHeight, fallbackHeight }: PageHeightRequest): number {
  if (phase !== 'ready') return fallbackHeight;
  if (reportedHeight === null || reportedHeight <= 0) return fallbackHeight;

  return reportedHeight;
}
