# NOTES

Running notes, kept to two pages at the end. Each task adds what was decided and why.

## Stack and why

Expo (TypeScript) with development builds (`npx expo run:ios` / `npx expo run:android`), not Expo Go,
because the app needs `react-native-webview` and custom native config (Android cleartext HTTP, iOS
local networking). React Navigation native stack, AsyncStorage for the persisted app state.

_To fill in: what was built, what was left out._

## How events reach the collector, and the ones from before the reader chose

Everything tracked goes through one gate (`src/lib/trackerGate.ts`). Until `/consent` answers with a
non-empty string the gate creates no tracker at all, so nothing can reach `/collect`; it holds screen
views, self-describing events and the pages' tracker messages in one ordered queue, capped at 500 with
the oldest dropped. When consent arrives it creates the tracker exactly once and replays the queue in
the order the events happened, each item in its own `try`/`catch` so one failure cannot block the rest.
After that everything is forwarded immediately, and *every* page message is handed to the SDK, which
does its own filtering.

The queue exists because of two things in `sdk/tracker.ts`: its web view callback silently drops events
when no tracker exists yet, and it fans each one out to every registered tracker. So the app queues
rather than forwarding early, and creates exactly one tracker. `newTracker` also throws on a duplicate
namespace with no way to remove one, so `src/tracking.ts` guards with
`getTracker('news-app') ?? newTracker(...)`, which is what makes a remount or a hot reload survivable.

If creating the tracker throws, the gate stays inactive and keeps the queue intact so a later answer
retries — events are never lost to a failed creation.

## The loading state and the consent rule

One page load is a state machine (`src/lib/pageSession.ts`) over `waiting-for-consent → loading →
ready | error`. It owns no timers: it asks for them with effects and is told when they fire, so every
rule is testable without a clock. Each timer carries the `loadId` it belongs to, so a timeout from a
load that has since been superseded is ignored rather than wrongly showing an error.

A page only becomes ready when it says so. A duplicate `ready` for the same document counts but does
**not** send the app state again (the kit's article 5 sends two), and a page that never says so ends on
the error state with a retry after 10 s rather than on an endless spinner (article 4). Navigation
inside a page is explicitly not a load, so the loading state never comes back for it; a reload is.

The consent gate (`src/lib/consent.ts`) opens on the first answer, failure or timeout and never closes.
Waiting indefinitely would strand the reader behind a consent service that may never answer; loading at
once would show a page whose ad slot can never fill, because a page reads `#consent=` once at document
start and there is no second chance. Five seconds is the compromise: long enough that a normal answer
is usually in, short enough not to feel broken. An answer arriving later still counts, which is why a
page that loaded with *no* consent at all reloads once when one turns up — and only once, so a flapping
consent service cannot loop it. A consent string that merely changes while a page is open never reloads
it; the reader keeps reading and the new value applies to the next load.

**Assumption:** a `null` answer while a consent string is already known is treated as keeping the known
string, not as the reader withdrawing consent. The brief does not say which it is; keeping the last
known choice is the reading that does not silently switch the ads off on every later load.

## How the two page layouts share code, and where they differ

_To fill in: the shared web-view host and message plumbing; front page sized by its height messages
inside a native scroll view, article page scrolling itself under a floating header._

## How the app finds the end of the article text

_To fill in: the injected probe over `.articlecomponent.text p`, and what we would ask the web team
for instead (for example an explicit end-of-text marker or an event) so the app would not have to
guess from the DOM._

## Part 3 (offline): not built, how it would be built

_To fill in: where saved copies would live on disk, how a copy is saved completely or not at all, how
an update reaches the reader, and what the app would treat as the truth for "this article is saved"._

## What was verified on iOS and on Android

_To fill in: devices, simulators and OS versions; what behaved differently; what is assumed without
having been checked._

## Backgrounded web views

_To fill in: what happens to the screens when the OS kills a web view's content process while the app
is in the background, and what should happen. Not built._

## Talking to the pages: the injected scripts

Everything the app tells a page is a string built in `src/lib/pageScripts.ts`, so it can be tested by
evaluating it against a fake `window` rather than by running a web view. `window.appContext` and
`window.appInsets` go in a before-content script, because the article page reads them once at startup
and reserves the app's chrome from its first paint. The app state is sent as one script *after* the
page announces itself, in the order the protocol table gives, since a page counts and discards every
`app:*` event dispatched before it is ready. Each page gets only what it uses: `app:read` to the front
page, `app:insets` to the article.

Values are embedded with `JSON.stringify` and `<` is escaped to `<`, the same defence
`fixture/server.mjs` applies to its own injected config, plus the two line separators that are legal in
JSON but not inside a JavaScript string. A bookmark id containing `</script>` or a quote therefore
cannot break out of the script.

`src/lib/consentClient.ts` deliberately does not give up after five seconds: that rule is about when
the app stops *waiting*, and a late answer still counts, so the request stays alive while the consent
reducer runs the gate. Its only timeout is a 30 s abort so hung requests cannot pile up.

## Where AI tools helped, and where they had to be corrected

AI wrote most of the logic layer and its tests from the brief. Four things had to be corrected:

- **`Platform.isPad` did not typecheck.** `Platform` is a union of per-platform types and `isPad` only
  exists on the iOS one, so it needs `'isPad' in Platform` narrowing (`src/config.ts`).
- **`@types/jest` was not picked up** under Expo's `module: "preserve"` base config, so `tsconfig.json`
  needs an explicit `"types": ["jest"]`.
- **The U+2028/U+2029 escapes in `pageScripts.ts` were written as the literal characters** rather than
  as `\u2028`/`\u2029` escapes, which made the regexes match nothing. Caught by the test that feeds
  those separators through.
- **The first `pageScripts` test asserted the wrong thing.** It checked that `new Function(...)()`
  returned `true`, but a function body does not return its last expression; the trailing `true;` is a
  *completion value* convention that matters when a web view evaluates the source. The test now asserts
  the script ends with `true;` and separately evaluates it.

## Known bugs and observations (reported, not fixed)

All of these were observed in the kit during reconnaissance. Per the brief, nothing in `fixture/` or
`sdk/` was changed.

- **`fixture/article.html` — the Jump button scrolls nowhere in one direction.** The handler toggles
  `location.hash` between `'#related'` and `'summary'`, but no element has `id="summary"`, so that half
  of the toggle has no target. Observed, not fixed.
- **`fixture/article.html` — the "Link + message" teaser always points at article 3.** `#teaser` and its
  title/image placeholders are filled from article 3 in the template regardless of which article is
  open, so on article 3 the teaser links to the article the reader is already reading. Observed, not
  fixed.
- **`sdk/tracker.ts` — `newTracker` throws on a duplicate namespace and there is no teardown.** The
  trackers live in a module-level map and nothing removes them, so a remount or a hot reload hits
  `Error: A tracker named "news-app" already exists`. The app guards with
  `getTracker('news-app') ?? newTracker(...)`. Observed, not fixed.
- **`sdk/tracker.ts` — the web view callback drops events when no tracker exists yet, and fans out to
  every registered tracker.** Events that arrive before the tracker is created are lost rather than
  queued, and `trackers.forEach` sends each web view event to all trackers. The app therefore queues
  messages until the tracker exists and creates exactly one. Observed, not fixed.

## Page behaviours the app has to defend against (not bugs)

These are deliberate in the kit and are part of what the app has to handle.

- **A raw string on the message channel:** `'tp:heartbeat'` is posted as a bare string, not JSON, so
  the message handler parses in `try`/`catch` instead of assuming JSON.
- **A non-numeric height:** `{type:'height', value:'auto'}` arrives about 1.5 s after load. Heights are
  only accepted when they are a finite number `>= 0`.
- **A duplicate `ready`:** article 5 (`ready: 'twice'`) posts `ready` a second time 400 ms later. The
  initial app state must not be sent twice.
- **A missing `ready`:** article 4 (`ready: 'never'`) never posts it, and article 6 posts it after 3 s.
  The app needs a ready timeout leading to an error state with a retry, not an endless spinner.
- **`openArticle` alongside real navigation:** article 3's teaser posts `openArticle` *and* follows its
  `href`, so both signals have to funnel into a single screen push. Both go through
  `createOpenArticleDeduper` (`src/lib/links.ts`), which suppresses a repeat of the same full path —
  query string included — inside one second, so one tap opens one screen. The clock is injected, so the
  window is tested without waiting for it.

## URLs: why the global `URL` is not used

Nothing in `src/lib` or `src/tracking.ts` uses the global `URL` or `URLSearchParams`. React Native's
implementations are incomplete, and the failure mode is the worst kind: they behave correctly in Node
under Jest and then differently on a device, so a green test suite would prove nothing. Everything the
app needs from a URL is shallow — the origin to compare against the server, the path to match
`/article/<id>`, and the query string to carry along — so `src/lib/parseUrl.ts` does it with plain
string and regex work and is tested directly, including `mailto:`, `tel:`, `about:blank`, `data:` and
relative paths.
