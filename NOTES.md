# NOTES

Expo + TypeScript, development builds (not Expo Go): the app needs `react-native-webview` and native
config for Android cleartext HTTP and iOS local networking. **Parts 1 and 2 built; Part 3 designed,
not built.** Decision logic lives in pure, tested modules under `src/lib`; components are wiring. 361
tests.

## Events reaching the collector, and the ones from before the reader chose

Everything goes through one gate (`lib/trackerGate.ts`). Until `/consent` answers with a non-empty
string it creates **no tracker at all**, so nothing reaches `/collect`; it queues screen views,
self-describing events and the pages' tracker messages in order, capped at 500, oldest dropped. When
consent arrives it creates the tracker once and replays in order, each in its own `try`/`catch` so one
failure cannot block the rest; afterwards everything forwards immediately.

The queue is needed because `sdk/tracker.ts` drops web view events when no tracker exists and fans
each out to *every* tracker, and `newTracker` throws on a duplicate namespace — hence
`getTracker('news-app') ?? newTracker(...)`. If creation throws, the queue survives and a later answer
retries.

## The loading state and the consent rule

A load is a state machine (`lib/pageSession.ts`): `waiting-for-consent → loading → ready | error`.
It owns no timers — it requests them as effects, so every rule is testable without a clock, and each
timer carries its `loadId` so a superseded load's timeout is ignored. A duplicate `ready` does **not**
resend state (article 5); one that never readies errors with a retry after 10 s (article 4).
Navigation *inside* a page is not a load.

**Why five seconds then reload once:** waiting indefinitely strands the reader behind a service that
may never answer; loading at once shows a page whose ad slot can never fill, since a page reads
`#consent=` only at document start. A late answer still counts, so a page loaded with *no* consent
reloads **once** — only once, so a flapping service cannot loop it. A string that merely *changes*
while a page is open never reloads it.

**Assumption:** a `null` answer when a string is already known keeps the string rather than treating it
as withdrawal. The brief is silent; this reading does not silently kill ads on every later load.

## How the two layouts share code, and where they differ

Both screens render `components/PageWebView.tsx`: session, consent-aware URL, message channel,
navigation rules, injected scripts and the tracker handover. **Front:** a native `ScrollView` holding
the strip, the web view (`scrollEnabled={false}`, sized to the height the page reports) and a footer;
gets `app:read`, no insets. **Article:** the web view fills the screen and scrolls itself under a
transparent header; gets `app:insets`, never `app:read`. `lib/stateSync.ts` enforces that split and
sends each change exactly once.

**Pull-to-refresh on the article took three attempts.** A `RefreshControl` has nothing to pull, the
web view's `pullToRefreshEnabled` bypasses the session, and a gesture over the web view never received
the drag. What works is asking the page: `pullProbeScript` reports touches with passive listeners that
block nothing, and nothing depends on iOS rubber-banding.

## How the app finds the end of the article text

The page says neither where its text ends nor how far the reader got, and its own "end of text" line
is for checking our work, not reading. So the app injects a probe (`lib/endOfText.ts`) over the last
`<p>` inside `.articlecomponent.text` — everything after it is the ask box, related links and "More
from the newsroom" — reporting when its bottom edge is inside the viewport minus the insets, checked
on scroll, resize and a timer because layout moves on its own. **Once means once per article screen**:
a reload reports nothing further, reopening counts again.

**What we would ask the web team for:** one explicit signal — a stable marker element, or an event
the page posts when its own check fires, since it already does this calculation. Today we depend on
their markup, which any deploy could change without us knowing.

## Part 3 (offline): not built, how it would be built

One folder per article under the app's document directory, named by id, files at the `path`s the
manifest gives so `index.html` resolves its siblings. All-or-nothing: download into a temporary folder
and **atomically rename** into place only once every file has arrived; a failure deletes that folder,
so a partial copy is never shown or left behind. **The truth for "saved"** is a complete folder
containing the manifest's version, read from the file system rather than a record that could drift. On
opening a saved article with the server reachable, compare `version`; if it differs, fetch beside the
old copy and switch only when the reader taps to. Eviction at five, oldest first.

## Verified on iOS / Android

**iOS 26.5, iPhone 17 simulator, Xcode 26.6:** both screens, loading / ready / error and retry, consent
in all five control-panel modes, reload-once on late consent, tracking with no flagged events, read
detection against the Reading table, the strip, jump links, text size and theme on both pages, and
pull-to-refresh on both pages.

**Android**, API 37 emulator: it builds, and the front page, article, text size, theme,
pull-to-refresh and back all work. Builds need JDK 17 or 21 — JDK 25 fails in the CMake steps.

## Backgrounded web views (not built)

If the OS kills a web view's content process the screen returns blank and no `ready` arrives, so
nothing recovers. It *should* detect the termination, treat it as a load error and reload with the
newest consent. The read reporter is per screen, so a restored article would not double-count it.

## What was left out, and known bugs

Left out: Part 3, and restoring scroll position after a reload.

Known bugs are all **in the kit**, reported not fixed: the Jump button toggles to `summary`, which no
element has; the "Link + message" teaser always points at article 3; plus the two `sdk/tracker.ts`
problems above.

## Where AI tools helped, and where they had to be corrected

AI wrote most of the logic layer and its tests. The corrections worth recording:

- A gesture laid over a web view is never offered the touches inside it; two attempts failed before
  asking the page itself.
- Two tests asserted the wrong thing: a function body does not return its last expression, and a
  hostile string legitimately *appears* inside a quoted JSON literal, which is what makes it safe.
- The pull indicator wrote an animated value from JS while springing it with the native driver.
- U+2028/U+2029 escapes were written as literal characters, so the regexes matched nothing.
