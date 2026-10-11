// Pure module: no React Native imports, so it can be unit-tested directly.
//
// Nothing may reach the collector before the reader has chosen, but events from before that moment are
// not lost either — they are sent once the tracker exists. That is awkward with this SDK for two
// reasons, both of them in `sdk/tracker.ts`: its web view callback silently *drops* events when no
// tracker exists yet, and it fans each one out to every tracker that does. So the app holds everything
// in one ordered queue, creates exactly one tracker, and replays into it.
//
// The queue is capped. A reader who never chooses must not grow it without limit, so the oldest go
// first — the same rule the SDK uses for its own queue.

import { parseWebViewMessage } from './messages';

/** The schema the newsroom reads article reads from. */
export const READ_SCHEMA = 'iglu:com.example.news/article_read/jsonschema/1-0-0';

export type SelfDescribingEvent = {
  schema: string;
  data: Record<string, unknown>;
};

export type ScreenViewEvent = {
  name: string;
  id?: string;
};

/**
 * The part of the SDK's `Tracker` this module uses, written structurally so tests can pass a fake and
 * the real tracker stays assignable to it.
 */
export type TrackerLike = {
  trackScreenViewEvent(event: ScreenViewEvent, contexts?: SelfDescribingEvent[]): void;
  trackSelfDescribingEvent(event: SelfDescribingEvent, contexts?: SelfDescribingEvent[]): void;
};

/** The shape `getWebViewCallback()` returns. */
export type WebViewCallback = (message: { nativeEvent: { data: string } }) => void;

export type TrackerGateOptions = {
  /** Creates the single tracker, or returns the existing one. Never called before consent. */
  ensureTracker: () => TrackerLike;
  webViewCallback: WebViewCallback;
  maxQueue?: number;
};

export type TrackerGate = {
  /** Hands one raw web-view message over. Queued before consent, forwarded after. */
  pushPageMessage(raw: string): void;
  trackScreenView(event: ScreenViewEvent): void;
  trackSelfDescribing(event: SelfDescribingEvent, contexts?: SelfDescribingEvent[]): void;
  /** The read event from part 1. */
  trackArticleRead(articleId: string): void;
  /** Tells the gate what `/consent` answered. A non-empty string creates the tracker. */
  onConsent(consent: string | null): void;
  /** Whether the tracker exists and events are going out. */
  isActive(): boolean;
  /** How many events are waiting. Exposed for tests and diagnostics. */
  queueLength(): number;
};

type QueuedEvent =
  | { kind: 'page'; raw: string }
  | { kind: 'screenView'; event: ScreenViewEvent }
  | { kind: 'selfDescribing'; event: SelfDescribingEvent; contexts?: SelfDescribingEvent[] };

export function createTrackerGate(options: TrackerGateOptions): TrackerGate {
  const { ensureTracker, webViewCallback, maxQueue = 500 } = options;

  let tracker: TrackerLike | null = null;
  let queue: QueuedEvent[] = [];

  const enqueue = (item: QueuedEvent): void => {
    queue.push(item);

    // Over the limit, the oldest go first.
    if (queue.length > maxQueue) queue.splice(0, queue.length - maxQueue);
  };

  const deliver = (item: QueuedEvent, target: TrackerLike): void => {
    switch (item.kind) {
      case 'page':
        webViewCallback({ nativeEvent: { data: item.raw } });
        break;
      case 'screenView':
        target.trackScreenViewEvent(item.event);
        break;
      case 'selfDescribing':
        target.trackSelfDescribingEvent(item.event, item.contexts);
        break;
    }
  };

  const send = (item: QueuedEvent): void => {
    if (!tracker) {
      enqueue(item);

      return;
    }

    deliver(item, tracker);
  };

  return {
    pushPageMessage(raw: string): void {
      // Once the tracker exists the SDK does the filtering, so everything is handed over. Before that
      // the app filters itself, so the queue holds only what the SDK would have accepted anyway.
      if (tracker) {
        webViewCallback({ nativeEvent: { data: raw } });

        return;
      }

      if (parseWebViewMessage(raw).kind !== 'tracker') return;

      enqueue({ kind: 'page', raw });
    },

    trackScreenView(event: ScreenViewEvent): void {
      send({ kind: 'screenView', event });
    },

    trackSelfDescribing(event: SelfDescribingEvent, contexts?: SelfDescribingEvent[]): void {
      send({ kind: 'selfDescribing', event, contexts });
    },

    trackArticleRead(articleId: string): void {
      send({ kind: 'selfDescribing', event: { schema: READ_SCHEMA, data: { articleId } } });
    },

    onConsent(consent: string | null): void {
      if (consent === null || consent === '') return;
      if (tracker) return;

      let created: TrackerLike;
      try {
        created = ensureTracker();
      } catch {
        // The tracker could not be created. The queue is left untouched so a later answer can retry
        // rather than the events being lost.
        return;
      }

      tracker = created;

      const pending = queue;
      queue = [];

      // One failure must not cost the rest of the queue.
      for (const item of pending) {
        try {
          deliver(item, created);
        } catch {
          // Dropped: the SDK already has it, or it was unusable.
        }
      }
    },

    isActive(): boolean {
      return tracker !== null;
    },

    queueLength(): number {
      return queue.length;
    },
  };
}
