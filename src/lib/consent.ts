// Pure module: no React Native imports, so it can be unit-tested directly.
//
// A page reads `#consent=<value>` once, when the document starts, and there is no other way to give it
// one. So the app has to know the reader's choice *before* it loads a page — but `/consent` answers
// after an unpredictable delay and sometimes not at all. The gate squares that: it opens on the first
// answer, failure or timeout, and once open it never closes. Waiting forever would strand the reader
// on a spinner; loading at once would show a page that can never get its ads.

import { parseUrl } from './parseUrl';

/** How long the app waits for `/consent` before loading without a consent string. */
export const CONSENT_TIMEOUT_MS = 5000;

export type ConsentState = {
  /** The newest consent string the app knows, or null while the reader has not chosen. */
  value: string | null;
  /** Whether pages may start loading. Opens once and stays open. */
  gateOpen: boolean;
};

export type ConsentEvent =
  | { type: 'ANSWER'; consent: string | null }
  | { type: 'FAILED' }
  | { type: 'TIMEOUT' };

export const INITIAL_CONSENT: ConsentState = { value: null, gateOpen: false };

/**
 * Folds one consent event into the state.
 *
 * A null answer while a string is already known keeps the string: that is the reader's last known
 * choice, and dropping it would silently stop the ads on every later load.
 */
export function reduceConsent(state: ConsentState, event: ConsentEvent): ConsentState {
  switch (event.type) {
    case 'ANSWER': {
      const value = event.consent === null ? state.value : event.consent;

      return sameOrNext(state, { value, gateOpen: true });
    }
    // A failure or a timeout only means "stop waiting"; whatever is known is kept.
    case 'FAILED':
    case 'TIMEOUT':
      return state.gateOpen ? state : { ...state, gateOpen: true };
    default:
      return state;
  }
}

/**
 * Builds the URL for one page load, carrying the consent string in the fragment where the page reads
 * it. Any fragment already on `path` is dropped: the app owns the fragment.
 */
export function buildPageUrl(baseUrl: string, path: string, consent: string | null): string {
  const base = baseUrl.replace(/\/+$/, '');
  const withoutHash = dropHash(path);
  const url = `${base}${withoutHash}`;

  if (consent === null || consent === '') return url;

  return `${url}#consent=${encodeURIComponent(consent)}`;
}

export type ConsentReloadContext = {
  /** The consent string the open page was loaded with, if any. */
  loadedWithConsent: string | null;
  /** Whether this page has already been reloaded once to pick up a consent string. */
  alreadyReloadedForConsent: boolean;
};

/**
 * Whether an open page has to be loaded again because consent arrived.
 *
 * Only a page that started with no consent at all reloads, and only once: its ad slot can never fill
 * otherwise. A consent string that merely *changes* while a page is open never reloads it — the reader
 * keeps reading and the new value applies to the next load.
 */
export function decideOnConsentChange(
  context: ConsentReloadContext,
  newConsent: string | null,
): 'reload' | 'keep' {
  if (context.loadedWithConsent !== null) return 'keep';
  if (context.alreadyReloadedForConsent) return 'keep';
  if (newConsent === null || newConsent === '') return 'keep';

  return 'reload';
}

function dropHash(path: string): string {
  const parsed = parseUrl(path);
  if (!parsed) return path;

  return parsed.query === '' ? parsed.path : `${parsed.path}?${parsed.query}`;
}

function sameOrNext(state: ConsentState, next: ConsentState): ConsentState {
  return state.value === next.value && state.gateOpen === next.gateOpen ? state : next;
}
