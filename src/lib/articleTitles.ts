// Pure module: no React Native imports, so it can be unit-tested directly.
//
// The "Recently read" strip needs a title for each article the reader has finished, but the app only
// stores ids and there is no endpoint that lists articles. The saved-copy manifest is the one place a
// title can be had for a single id, so the strip reads it from there. It is a pragmatic choice rather
// than a natural one: the manifest exists for part 3, and the app uses only its `title` field.
//
// Titles never change under a reader mid-session often enough to matter, so a resolved id is cached
// and never fetched twice. A failure falls back to a readable placeholder rather than an empty row.

import { FetchLike } from './consentClient';

export type TitleLookup = {
  /** The title for an article id, from the cache when it is already known. */
  titleFor(articleId: string): Promise<string>;
  /** The cached title, or undefined when it has not been resolved yet. Never fetches. */
  cached(articleId: string): string | undefined;
};

/** What the strip shows when the title cannot be had. */
export function fallbackTitle(articleId: string): string {
  return `Article ${articleId}`;
}

export function createTitleLookup(fetchFn: FetchLike, baseUrl: string): TitleLookup {
  const base = baseUrl.replace(/\/+$/, '');
  const titles = new Map<string, string>();
  const inFlight = new Map<string, Promise<string>>();

  const load = async (articleId: string): Promise<string> => {
    try {
      const response = await fetchFn(`${base}/bundle/${articleId}/manifest.json`);

      if (response.status < 200 || response.status > 299) return fallbackTitle(articleId);

      const title = readTitle(await response.json());

      return title ?? fallbackTitle(articleId);
    } catch {
      return fallbackTitle(articleId);
    }
  };

  return {
    async titleFor(articleId: string): Promise<string> {
      const known = titles.get(articleId);
      if (known !== undefined) return known;

      // A second request for the same id joins the first rather than starting another.
      const pending = inFlight.get(articleId);
      if (pending) return pending;

      const request = load(articleId).then(title => {
        titles.set(articleId, title);
        inFlight.delete(articleId);

        return title;
      });

      inFlight.set(articleId, request);

      return request;
    },

    cached(articleId: string): string | undefined {
      return titles.get(articleId);
    },
  };
}

function readTitle(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

  const { title } = body as { title?: unknown };

  return typeof title === 'string' && title !== '' ? title : null;
}
