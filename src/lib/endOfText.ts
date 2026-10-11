// Pure module: no React Native imports, so it can be unit-tested directly.
//
// The newsroom wants to know when an article has actually been read, and the page will not say. It
// does not expose where its text ends or how far the reader has got, and its own "end of text" line
// is for checking our work, not for reading. So the app finds the end itself.
//
// The text is the paragraphs inside `.articlecomponent.text`. Everything after it — the "Ask the
// newsroom" box, the related links, "More from the newsroom" — is not the article, so the last
// paragraph is the last line that counts. That selector is the one thing we depend on the web team
// keeping; what we would rather have is noted in NOTES.md.
//
// The visibility rule lives here as a plain function so it can be tested, and the same rule is
// written into the injected script below.

import { embed } from './pageScripts';

/** Where the app's own chrome covers the page, in CSS pixels. */
export type ViewportInsets = {
  top: number;
  bottom: number;
};

export type ElementBox = {
  /** Distance from the top of the viewport to the top of the element. */
  top: number;
  /** Distance from the top of the viewport to the bottom of the element. */
  bottom: number;
  height: number;
};

export type VisibilityCheck = {
  box: ElementBox;
  /** The page's own viewport height. */
  viewportHeight: number;
  insets: ViewportInsets;
};

/**
 * Whether the last line of the text is fully on screen, clear of the app's chrome.
 *
 * Clear of the chrome is the point: a line hidden behind a translucent header has not been read. An
 * element with no height has not been laid out yet and never counts.
 */
export function isEndOfTextVisible({ box, viewportHeight, insets }: VisibilityCheck): boolean {
  if (box.height <= 0) return false;

  const visibleTop = insets.top;
  const visibleBottom = viewportHeight - insets.bottom;

  // A one-pixel allowance, because browsers report fractional positions.
  if (box.bottom > visibleBottom + 1) return false;

  // Scrolled up out of sight behind the header.
  return box.bottom >= visibleTop;
}

/** The message the probe posts when it has seen the end of the text. */
export const END_OF_TEXT_MESSAGE = 'nzzapp:endOfText';

/** The paragraphs that make up the article text. Everything after them is not the article. */
export const TEXT_SELECTOR = '.articlecomponent.text p';

/**
 * The script that watches for the end of the text and reports it once.
 *
 * It installs once per document and guards against being injected twice. It reads the inset values
 * from the CSS variables the app already sets on the page, so a later `app:insets` event is picked up
 * without re-injecting anything, and falls back to the values given here before the first one lands.
 *
 * It checks on scroll, on resize and on a timer, because the layout also moves without either: the
 * late map, the "Ask the newsroom" box and a font change all push the last line around.
 */
export function endOfTextProbeScript(articleId: string, insets: ViewportInsets, pollMs = 500): string {
  return `(function () {
  if (window.__nzzEndOfText) return;
  window.__nzzEndOfText = true;

  var articleId = ${embed(articleId)};
  var fallback = ${embed(insets)};
  var reported = false;

  function inset(name, fallbackValue) {
    var raw = getComputedStyle(document.documentElement).getPropertyValue(name);
    var value = parseFloat(raw);

    return isFinite(value) ? value : fallbackValue;
  }

  function check() {
    if (reported) return;

    var paragraphs = document.querySelectorAll(${embed(TEXT_SELECTOR)});
    if (!paragraphs.length) return;

    var box = paragraphs[paragraphs.length - 1].getBoundingClientRect();
    if (box.height <= 0) return;

    var visibleTop = inset('--inset-top', fallback.top);
    var visibleBottom = window.innerHeight - inset('--inset-bottom', fallback.bottom);

    if (box.bottom > visibleBottom + 1) return;
    if (box.bottom < visibleTop) return;

    reported = true;

    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(
        JSON.stringify({ type: ${embed(END_OF_TEXT_MESSAGE)}, articleId: articleId }),
      );
    }
  }

  window.addEventListener('scroll', check, { passive: true });
  window.addEventListener('resize', check);
  setInterval(check, ${pollMs});

  // A short article may already be showing its last line, so look straight away.
  check();
})();
true;`;
}
