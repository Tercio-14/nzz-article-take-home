// Pure module: no React Native imports, so it can be unit-tested directly.
//
// `GET /consent` behaves like a consent service on a real phone: every answer arrives after an
// unpredictable delay, and now and then it fails or never arrives at all.
//
// This client deliberately does *not* give up after five seconds. The five-second rule is about when
// the app stops *waiting* and loads a page without consent, and an answer that arrives later still
// counts — so the caller runs that clock through the consent reducer while this request stays alive.
// The only timeout here is a generous one, so a hung request cannot pile up forever.

/** How long a single request may hang before it is abandoned. Not the five-second gate. */
export const CONSENT_ABORT_MS = 30000;

export type ConsentAnswer =
  | { kind: 'answer'; consent: string | null }
  | { kind: 'failed' };

/** The part of a `fetch` response this module reads, so tests can pass a fake. */
export type ResponseLike = {
  status: number;
  json(): Promise<unknown>;
};

/** The part of `fetch` this module uses. */
export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<ResponseLike>;

const FAILED: ConsentAnswer = { kind: 'failed' };

/**
 * Asks the consent service what the reader chose.
 *
 * Anything the app cannot read as an answer — a non-2xx status, a network error, a body that is not
 * JSON, or a `consent` field that is neither a non-empty string nor null — is a failure, not a guess.
 * `null` is a real answer: the reader has not chosen yet.
 */
export async function fetchConsent(fetchFn: FetchLike, baseUrl: string): Promise<ConsentAnswer> {
  const url = `${baseUrl.replace(/\/+$/, '')}/consent`;
  const controller = new AbortController();
  const abort = setTimeout(() => controller.abort(), CONSENT_ABORT_MS);

  try {
    const response = await fetchFn(url, { signal: controller.signal });

    if (response.status < 200 || response.status > 299) return FAILED;

    return readConsent(await response.json());
  } catch {
    // A network error, or the abort above.
    return FAILED;
  } finally {
    clearTimeout(abort);
  }
}

function readConsent(body: unknown): ConsentAnswer {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return FAILED;

  const { consent } = body as { consent?: unknown };

  if (consent === null) return { kind: 'answer', consent: null };

  // An empty string is not a consent the pages could use, so it is treated as a failure rather than
  // as a choice the reader made.
  if (typeof consent === 'string' && consent !== '') return { kind: 'answer', consent };

  return FAILED;
}
