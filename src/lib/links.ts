// Pure module: no React Native imports, so it can be unit-tested directly.
//
// A web view must never leave the page it was opened for. Every navigation it proposes is sorted here
// into three outcomes: let the page do it, push a native article screen, or hand it to the operating
// system. The decision is pure so the whole table can be tested without a web view.

import { parseUrl } from './parseUrl';

export type NavigationDecision =
  | { action: 'allow' }
  | { action: 'openArticle'; path: string; articleId: string }
  | { action: 'external' };

export type NavigationRequest = {
  /** The URL the web view proposes to load. */
  url: string;
  /** The origin of the fixture server, from config. */
  baseOrigin: string;
  /** The URL the web view currently shows, used to recognise same-document navigation. */
  currentUrl: string;
  /** react-native-webview reports this; a subframe must never drive the app's navigation. */
  isTopFrame?: boolean;
};

const ALLOW: NavigationDecision = { action: 'allow' };
const EXTERNAL: NavigationDecision = { action: 'external' };

/** An article page on the server. The id stops at the first slash, question mark or hash. */
const ARTICLE_PATH = /^\/article\/([^/?#]+)$/;

/** Schemes a web view may load on its own without the app getting involved. */
const INERT_SCHEMES = ['about', 'data'];

/**
 * Decides what should happen to one proposed navigation.
 *
 * The order matters: subframes and inert schemes are settled first, then same-document navigation
 * (the initial load, a consent-fragment load and the pages' own hash links), then articles, and only
 * then is anything handed to the operating system.
 */
export function classifyNavigation(request: NavigationRequest): NavigationDecision {
  // Subframes (ads, embeds) navigate inside the page and never push a screen.
  if (request.isTopFrame === false) return ALLOW;

  const target = parseUrl(request.url);
  if (!target) return ALLOW;

  if (INERT_SCHEMES.includes(target.scheme)) return ALLOW;

  // A relative reference stays on the server the page was loaded from.
  const sameOrigin = target.scheme === '' || target.origin === request.baseOrigin;
  if (!sameOrigin) return EXTERNAL;

  const current = parseUrl(request.currentUrl);

  // Same document: only the fragment differs, so the page handles it itself. This covers the first
  // load, a reload carrying a new consent fragment, and the pages' own contents links.
  if (current && target.path === current.path && target.query === current.query) return ALLOW;

  const article = ARTICLE_PATH.exec(target.path);
  if (article) {
    // The query string has to travel with the article; the fragment is the app's to set.
    const path = target.query === '' ? target.path : `${target.path}?${target.query}`;

    return { action: 'openArticle', path, articleId: article[1] };
  }

  return EXTERNAL;
}

export type OpenArticleDeduper = {
  /** True when this path should open a screen; false while an identical path is still being handled. */
  shouldOpen(path: string): boolean;
};

/**
 * Suppresses a repeat of the same path inside a short window.
 *
 * The kit's "Link + message" teaser posts `openArticle` *and* follows its `href`, so one tap arrives
 * twice. Both signals funnel through here and only the first one pushes a screen.
 */
export function createOpenArticleDeduper(windowMs = 1000, now: () => number = Date.now): OpenArticleDeduper {
  const lastOpened = new Map<string, number>();

  return {
    shouldOpen(path: string): boolean {
      const at = now();
      const previous = lastOpened.get(path);

      if (previous !== undefined && at - previous < windowMs) return false;

      lastOpened.set(path, at);

      return true;
    },
  };
}
