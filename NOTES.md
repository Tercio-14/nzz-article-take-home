# NOTES

Running notes, kept to two pages at the end. Each task adds what was decided and why.

## Stack and why

Expo (TypeScript) with development builds (`npx expo run:ios` / `npx expo run:android`), not Expo Go,
because the app needs `react-native-webview` and custom native config (Android cleartext HTTP, iOS
local networking). React Navigation native stack, AsyncStorage for the persisted app state.

_To fill in: what was built, what was left out._

## How events reach the collector, and the ones from before the reader chose

_To fill in: the queue in front of the tracker, the cap, the replay order, and why nothing reaches
`/collect` before `/consent` has answered with a string._

## The loading state and the consent rule

_To fill in: how loading / ready / error were modelled, and why wait up to five seconds and then
reload once, rather than always waiting or always loading at once._

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

## Where AI tools helped, and where they had to be corrected

_To fill in each task._

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
  `href`, so both signals have to funnel into a single screen push.
