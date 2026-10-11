// News tracker SDK, version 2.3.0.
//
// Vendor code: copy this file into your app and use it as it is. If you think it has a bug, tell us in NOTES.md.
//
// - Events are sent in batches to `<endpoint>/collect`, at most a second after they were tracked.
// - A batch that fails is retried with a growing delay. Events wait in memory while the app runs, up to 500 per
//   tracker; they do not survive a restart.
// - No dependencies: it needs `fetch` and `setTimeout`.
//
// Flutter: port it, or send the same requests yourself. The request format is `CollectorRequest` below.

export type Platform = 'ios' | 'android';

export type TrackerConfig = {
  /** Names your app's tracker. Only one tracker can have a given namespace. */
  namespace: string;
  /** Base address of the collector, for example `http://localhost:8787`. */
  endpoint: string;
  appVersion: string;
  platform: Platform;
};

export type SelfDescribingJson = {
  schema: string;
  data: Record<string, unknown>;
};

export type ScreenViewEvent = { name: string; id?: string };
export type PageViewEvent = { pageUrl: string; pageTitle?: string; referrer?: string };

export type Tracker = {
  readonly namespace: string;
  trackScreenViewEvent(event: ScreenViewEvent, contexts?: SelfDescribingJson[]): void;
  trackSelfDescribingEvent(event: SelfDescribingJson, contexts?: SelfDescribingJson[]): void;
  trackPageViewEvent(event: PageViewEvent, contexts?: SelfDescribingJson[]): void;
};

/** A message from a web view, in the shape `react-native-webview` hands it to `onMessage`. */
export type WebViewMessage = { nativeEvent: { data: string } };

type EventKind = 'screen_view' | 'self_describing' | 'page_view';

type CollectedEvent = {
  eid: string;
  e: EventKind;
  source: 'app' | 'webview';
  ts: number;
  event: unknown;
  contexts: SelfDescribingJson[];
};

/** What `POST <endpoint>/collect` receives, as JSON. The collector answers 204, or 400 with a reason. */
export type CollectorRequest = {
  namespace: string;
  appVersion: string;
  platform: Platform;
  sentAt: number;
  events: CollectedEvent[];
};

const BATCH_SIZE = 10;
const FLUSH_DELAY_MS = 1000;
const MAX_QUEUE = 500;
const MAX_RETRY_DELAY_MS = 30000;

// The web tracker's commands this SDK understands. Anything else from a web view is ignored.
const WEB_VIEW_COMMANDS: Record<string, EventKind> = {
  trackScreenView: 'screen_view',
  trackSelfDescribingEvent: 'self_describing',
  trackPageView: 'page_view',
};

const trackers = new Map<string, TrackerImpl>();

function newEventId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isSelfDescribingJson(value: unknown): value is SelfDescribingJson {
  const candidate = value as SelfDescribingJson | null;

  return (
    !!candidate &&
    typeof candidate.schema === 'string' &&
    !!candidate.data &&
    typeof candidate.data === 'object' &&
    !Array.isArray(candidate.data)
  );
}

class TrackerImpl implements Tracker {
  private queue: CollectedEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sending = false;
  private failures = 0;
  private readonly config: TrackerConfig;

  constructor(config: TrackerConfig) {
    this.config = config;
  }

  get namespace(): string {
    return this.config.namespace;
  }

  trackScreenViewEvent(event: ScreenViewEvent, contexts: SelfDescribingJson[] = []): void {
    this.add('screen_view', 'app', event, contexts);
  }

  trackSelfDescribingEvent(event: SelfDescribingJson, contexts: SelfDescribingJson[] = []): void {
    this.add('self_describing', 'app', event, contexts);
  }

  trackPageViewEvent(event: PageViewEvent, contexts: SelfDescribingJson[] = []): void {
    this.add('page_view', 'app', event, contexts);
  }

  add(e: EventKind, source: CollectedEvent['source'], event: unknown, contexts: SelfDescribingJson[]): void {
    this.queue.push({ eid: newEventId(), e, source, ts: Date.now(), event, contexts });

    // Over the limit, the oldest events go first.
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);

    this.schedule(this.queue.length >= BATCH_SIZE ? 0 : FLUSH_DELAY_MS);
  }

  private schedule(delay: number): void {
    if (this.timer || this.sending) return;

    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }

  private async flush(): Promise<void> {
    if (this.sending || this.queue.length === 0) return;

    this.sending = true;
    const batch = this.queue.slice(0, BATCH_SIZE);
    const body: CollectorRequest = {
      namespace: this.config.namespace,
      appVersion: this.config.appVersion,
      platform: this.config.platform,
      sentAt: Date.now(),
      events: batch,
    };

    let delivered = false;
    try {
      const response = await fetch(`${this.config.endpoint.replace(/\/+$/, '')}/collect`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      delivered = response.ok;
    } catch {
      delivered = false;
    }

    this.sending = false;

    if (delivered) {
      const sent = new Set(batch.map(event => event.eid));
      this.queue = this.queue.filter(event => !sent.has(event.eid));
      this.failures = 0;
      if (this.queue.length > 0) this.schedule(0);
    } else {
      this.failures += 1;
      this.schedule(Math.min(MAX_RETRY_DELAY_MS, 1000 * 2 ** this.failures));
    }
  }
}

/** Creates a tracker. Throws if one with the same namespace exists. */
export function newTracker(config: TrackerConfig): Tracker {
  if (trackers.has(config.namespace)) throw new Error(`A tracker named "${config.namespace}" already exists`);

  const tracker = new TrackerImpl(config);
  trackers.set(config.namespace, tracker);

  return tracker;
}

export function getTracker(namespace: string): Tracker | undefined {
  return trackers.get(namespace);
}

/**
 * Hands messages from a web view to the trackers. Pass it every message the web view receives, as the raw string.
 * Messages from the web tracker look like `{ "command": "trackPageView", "event": {…}, "context": [{…}] }`.
 * Anything else is ignored without a warning, so your own messages can share the channel.
 *
 * Events go to every tracker that exists when the message arrives. If there is none yet, they are dropped.
 */
export function getWebViewCallback(): (message: WebViewMessage) => void {
  return message => {
    const data = message?.nativeEvent?.data;
    if (typeof data !== 'string') return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }

    const { command, event, context } = (parsed ?? {}) as { command?: unknown; event?: unknown; context?: unknown };
    if (typeof command !== 'string' || !(command in WEB_VIEW_COMMANDS)) return;
    if (!event || typeof event !== 'object') return;

    const contexts = Array.isArray(context) ? context.filter(isSelfDescribingJson) : [];
    trackers.forEach(tracker => tracker.add(WEB_VIEW_COMMANDS[command], 'webview', event, contexts));
  };
}
