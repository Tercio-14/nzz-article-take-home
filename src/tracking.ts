// The app's one tracker, wired to the vendor SDK.
//
// Thin on purpose: the rules live in `lib/trackerGate`, which is pure and tested. This file only
// supplies the two things that cannot be pure — the real tracker and the real web view callback.
//
// `newTracker` throws when a tracker with the same namespace already exists and the SDK has no way to
// remove one, so a remount or a hot reload would crash on a second call. `getTracker(...) ?? newTracker(...)`
// is the guard. The callback is created once, lazily, for the same reason.

import { APP_VERSION, BASE_URL, TRACKER_NAMESPACE, TRACKER_PLATFORM } from './config';
import { TrackerGate, TrackerLike, createTrackerGate } from './lib/trackerGate';
import { getTracker, getWebViewCallback, newTracker } from './vendor/tracker';

type SdkWebViewCallback = ReturnType<typeof getWebViewCallback>;

let callback: SdkWebViewCallback | null = null;

/** The SDK's web view callback, created on first use and reused afterwards. */
function sdkWebViewCallback(): SdkWebViewCallback {
  if (!callback) callback = getWebViewCallback();

  return callback;
}

function ensureTracker(): TrackerLike {
  return (
    getTracker(TRACKER_NAMESPACE) ??
    newTracker({
      namespace: TRACKER_NAMESPACE,
      endpoint: BASE_URL,
      appVersion: APP_VERSION,
      platform: TRACKER_PLATFORM,
    })
  );
}

/**
 * The gate every screen tracks through. Nothing reaches the collector until `onConsent` is given a
 * consent string; events from before that are queued and replayed in order.
 */
export const tracking: TrackerGate = createTrackerGate({
  ensureTracker,
  webViewCallback: message => sdkWebViewCallback()(message),
});
