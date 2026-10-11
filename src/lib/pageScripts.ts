// Pure module: no React Native imports, so it can be unit-tested directly.
//
// Everything the app tells a page goes through one of these strings. Two rules shape them:
//
// - `window.appContext` and `window.appInsets` have to exist *before* the page's own scripts run, so
//   the article reserves the app's chrome from its first paint. They go in a before-content script.
// - A page ignores every `app:*` event dispatched before it announces itself, counting them as
//   "ignored before ready". So the state is sent once, after ready, not sprayed hopefully at the page.
//
// Values are embedded as JSON and `<` is escaped, the same defence `fixture/server.mjs` uses on its
// own injected config, so no string in the app's state can break out of the script.

import type { AppContext } from '../config';

export type Insets = {
  top: number;
  bottom: number;
};

/** The state the pages accept, in the shapes the protocol defines. */
export type PageState = {
  fontScale: number;
  theme: 'light' | 'dark';
  bookmarks: string[];
  read: string[];
};

export type PageKind = 'front' | 'article';

/** The only events the protocol defines. Anything else is a mistake, not a feature. */
export const APP_EVENTS = [
  'app:fontScale',
  'app:theme',
  'app:bookmarks',
  'app:read',
  'app:insets',
] as const;

export type AppEventName = (typeof APP_EVENTS)[number];

/**
 * Runs before the page's own scripts. Sets what the page reads at startup and nothing else.
 *
 * Ends with `true;` because a web view warns when injected script evaluates to an object.
 */
export function beforeContentLoadedScript(options: { appContext: AppContext; insets?: Insets }): string {
  const lines = [`window.appContext = ${embed(options.appContext)};`];

  if (options.insets) lines.push(`window.appInsets = ${embed(options.insets)};`);

  return `${lines.join('\n')}\ntrue;`;
}

/** One `app:*` event, for a change the reader made after the page was ready. */
export function dispatchAppEventScript(name: AppEventName, detail: unknown): string {
  if (!APP_EVENTS.includes(name)) throw new Error(`Unknown app event: ${name}`);

  return `window.dispatchEvent(new CustomEvent(${embed(name)}, { detail: ${embed(detail)} }));\ntrue;`;
}

/**
 * The whole app state, as one script, sent once a page has announced itself.
 *
 * The order matches the protocol table, and each page gets only what it uses: the front page tracks
 * read articles, the article page reserves the app's chrome.
 */
export function initialStateScript(page: PageKind, state: PageState, insets?: Insets): string {
  const events: [AppEventName, unknown][] = [
    ['app:fontScale', { value: state.fontScale }],
    ['app:theme', { value: state.theme }],
    ['app:bookmarks', { ids: state.bookmarks }],
  ];

  if (page === 'front') events.push(['app:read', { ids: state.read }]);
  if (page === 'article' && insets) events.push(['app:insets', { top: insets.top, bottom: insets.bottom }]);

  const dispatches = events.map(
    ([name, detail]) => `window.dispatchEvent(new CustomEvent(${embed(name)}, { detail: ${embed(detail)} }));`,
  );

  return `${dispatches.join('\n')}\ntrue;`;
}

/**
 * Embeds a value as a JavaScript literal.
 *
 * `JSON.stringify` already escapes quotes and newlines; `<` is escaped too so a value containing
 * `</script>` cannot end the script, and the two line separators JSON leaves bare are escaped because
 * JavaScript does not accept them inside a string.
 */
function embed(value: unknown): string {
  return JSON.stringify(value ?? null)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
