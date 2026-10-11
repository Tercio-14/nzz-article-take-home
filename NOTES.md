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

Both screens render the same component, `src/components/PageWebView.tsx`. It owns everything the two
pages have in common: the session (loading, ready, error), the consent-aware URL, the message channel,
the navigation rules, the injected scripts and the handover to the tracker. It decides none of that
itself — each rule comes from a pure module in `src/lib`, so the component is wiring rather than logic.

They differ only in layout and in what the page is told:

- **Front:** a native `ScrollView` holds the Recently read strip, the web view and a footer. The web
  view has `scrollEnabled={false}` and is given exactly the height the page reports, so the native
  scroll view does all the scrolling and the footer really sits below the end of the page. It gets
  `app:read`; it gets no insets.
- **Article:** the web view fills the screen and scrolls itself under a transparent native header. It
  gets `app:insets` (header height and the bottom safe area) and never `app:read`, which it has no
  listener for. `src/lib/stateSync.ts` enforces that split, so neither page is sent an event it ignores.

**The loading overlay follows the session, never the web view's load events.** `onLoadStart` fires for
navigation *inside* a page too — a contents link, the Jump button — and the brief is explicit that
navigation inside a page is not a load. Driving the spinner from `onLoadStart` would flash it on every
in-page jump. The overlay is shown only while the session's phase is `loading`, which only a real load
can cause.

**The web view is keyed by `loadId`.** A reload has to produce a genuinely new document, because the
consent string lives in the URL fragment and a page reads it once at startup — changing only the
fragment of a live document would not reload anything. Keying by the load id forces React to mount a
new web view. For the same reason the URL is built once, when a load starts, from the consent known at
that moment: changing consent must never mutate the source of a document already on screen.

**A screen view is sent on the first `ready` of each load id.** The brief asks for one per loaded
document, and a reload is a new one. Article 5 announces itself twice; the second `ready` is counted
but sends neither a screen view nor the app state again.

**Titles in the Recently read strip come from `/bundle/<id>/manifest.json`.** The app stores only ids,
and that manifest is the only endpoint that gives a title for a single article. It exists for part 3,
so this uses just its `title` field and falls back to `Article <id>` on any failure; titles are cached
per id. What we would rather have is noted under *what we would ask the web team for*.

Two layout rules were wrong at first and only showed up in manual testing. Both now live in
`src/lib/pageLayout.ts`, where they are tested rather than inlined in the screen.

**Two loading indicators at once.** The front page's pull-to-refresh control was bound to
`phase === 'loading'`, so an ordinary load — a launch, a reload, a retry — drove both it and the web
view's overlay. The screen now tracks only a refresh the *reader* started, and `overlayFor` suppresses
the overlay while that pull spinner is up, so exactly one indicator shows either way. The error view is
never suppressed: that flag governs the spinner alone.

**The error view buried down a stale scroll view.** The front page's web view is sized by the height
the page reports, and that height was kept after the document it described had gone. A pull-to-refresh
against an unreachable server therefore left the scroll area as tall as the page that had just been
replaced, with the error centred thousands of pixels down it. The height is now dropped when a new load
starts, and `pageAreaHeight` returns a reported height only while a page is actually being shown;
otherwise the page area is the visible screen, so loading and error views land in view.

**The chosen text size goes in before the first paint.** The page sizes its text from a `--font-scale`
variable that defaults to 1, and the only thing that changes it is an `app:fontScale` event — which the
page ignores until it is ready. Sending it with the rest of the state after ready meant every load
painted once at the default size and then jumped, which is visible on a reload because the loading
overlay is not covering the page. The before-content script now sets the same variable up front, so the
size is right from the first frame; the event still carries later changes when the reader presses the
buttons. One mechanism, two triggers.

**The Recently read strip refreshes on a pull.** Its list of ids comes from app state, so it is always
current — returning from an article updates it with no extra work, because reading changes the state
the front page renders from. Its *titles* are a cache, and a lookup that failed cached its placeholder,
so an article whose title could not be fetched stayed "Article 4" until the app restarted. The front
page's existing pull-to-refresh now also throws that cache away, and a generation counter stops a
request that was already in flight from refilling it with the answer the reader just asked us to
discard.

**Jump links differ by page.** On the article the app does nothing: the page sets
`scroll-margin-top: var(--inset-top)` on every element with an id, and the app supplies that inset, so
the browser's own anchor scrolling already lands headings below the floating header. On the front page
it cannot work that way — the page does not scroll, the native scroll view does — so the app notices
the anchor navigation (`anchorTargetFor`), asks the page where that heading is
(`measureAnchorScript`), and scrolls the scroll view itself. The consent string also lives in the
fragment, so a load carrying `#consent=…` is explicitly not treated as a jump.

**Article pull-to-refresh is driven by the page itself.** The article web view scrolls itself, so
there is no native scroll view to hang a `RefreshControl` on: on iOS it needs its own scroll view to
bounce, and a wrapper with scrolling disabled never fires. The web view's built-in
`pullToRefreshEnabled` reloads the web view directly, bypassing the session entirely — no new load id,
no fresh consent capture, no loading state, no screen view — so it was rejected too.

Laying a gesture over the web view was tried next, with `react-native-gesture-handler`, and **it did
not work**: the drag never reached the gesture. A web view owns its own scrolling, and on iOS its
recogniser takes the touch before a handler on an ancestor view is offered it. Naming the web view
with `simultaneousWithExternalGesture` did not change that. The dependency has been removed.

What works is asking the page, which sees every touch. `pullProbeScript` in
`src/lib/pullToRefresh.ts` is injected into the article alongside the read probe and reports four
things — a pull starting, its distance as it grows, its release and its cancellation — as app-owned
messages on the same channel everything else uses. It blocks nothing: the listeners are passive and
nothing is ever prevented, so ordinary scrolling, sideways drags and the swipe-back from the edge
behave exactly as before. A pull counts only from a single finger, starting within a pixel of the top,
moving downward more than sideways; moves are throttled to one animation frame.

The app decides what those reports mean. `pullState` turns the distance into an indicator position
with resistance and a cap, and arms past a threshold; a release while armed calls the same `reload()`
the front page uses, so the new load id, fresh consent, loading overlay and screen view all follow
from the existing session. Nothing depends on iOS rubber-banding — the distance comes from the
reported touch positions — so Android behaves the same, and `bounces` stays off. The read reporter is
created once per article screen, so a pull cannot produce a second read event, and the one-indicator
rule is kept through `showLoadingOverlay`.

## How the app finds the end of the article text

The page will not say: it exposes neither where its text ends nor how far the reader has got, and its
own "end of text" line is for checking our work, not for reading. So the app injects its own probe
(`src/lib/endOfText.ts`). The probe takes the last `<p>` inside `.articlecomponent.text` — everything
after it is the "Ask the newsroom" box, the related links and "More from the newsroom", none of which
is the article — and reports when that paragraph's bottom edge is inside the viewport minus the app's
insets. It checks on scroll, on resize and on a 500 ms timer, because the layout also moves without
either: the late map, the ask box and a font change all push the last line around. It reads the inset
values from the CSS variables the app already sets, so a later `app:insets` event is picked up without
re-injecting, and it guards against being installed twice.

**Once means once per article screen**, which is what the brief asks for: a reload reports nothing
further, while closing the article and opening it again is a new screen and counts again.
`src/lib/readOnce.ts` enforces that; the probe is free to fire once per document and the reporter
absorbs the difference. An article short enough to show its last line at load counts immediately — it
has been on screen — which is also what the page's own check does.

**What we would ask the web team for:** a single explicit signal — either an element we can rely on
(`<div data-end-of-text>` at the end of the text) or, better, an event the page posts when its own
check fires, since the page already does this calculation for itself. Today the app depends on the
`.articlecomponent.text p` selector, which is the web team's markup and could change in any deploy
without the app knowing; a contract would survive that.

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
- **`StyleSheet.absoluteFillObject` does not exist in React Native 0.86's types.** The overlay style now
  sets `position` and the four edges explicitly.
- **A test asserted the wrong thing about escaping.** It checked that the generated script did not
  *contain* the hostile string, but the string legitimately appears inside a quoted JSON literal, which
  is exactly what makes it safe. The test now runs the script and checks that nothing executed and the
  value came back intact.
- **Dead state left behind when article pull-to-refresh was reverted.** The phase and refreshing state
  were removed with the wrapper rather than left unused.
- **The consent fragment was briefly treated as a jump target.** `anchorTargetFor` matched
  `#consent=…`, so every consent reload triggered a pointless measurement. It is now excluded.
- **The pull indicator mixed the two animation drivers.** The spring back to rest used the native
  driver while the gesture wrote the same value from JS on every frame; a value the native driver has
  taken over cannot be written from JS. The spring is JS-driven now.
- **The first pull-to-refresh never started.** The pan gesture was added without telling it about the
  web view's own drag, so on iOS the web view's recogniser took the touch and the pan was never offered
  it. Nothing moved and nothing reloaded. The fix was to name the web view in
  `simultaneousWithExternalGesture` so both recognise at once. Worth remembering: a gesture placed over
  a native scrollable view has to declare its relationship to that view, or it is simply never asked.
- **The at-top test was exact.** Scroll positions come back fractional, so comparing against zero could
  refuse a pull when the reader is plainly at the top. `isAtTop` now allows a pixel of tolerance.
- **Naming the web view in the gesture was not enough either.** The second attempt declared the pan
  simultaneous with the web view's own drag, which is the library's intended answer, and the drag still
  never arrived. The lesson is the general one: a web view is not a React Native scroll view, and a
  gesture outside it cannot be relied on to see touches that happen inside it. Asking the page was the
  approach that worked.

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
