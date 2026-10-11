import {
  READ_SCHEMA,
  ScreenViewEvent,
  SelfDescribingEvent,
  TrackerLike,
  createTrackerGate,
} from './trackerGate';

type Recorded =
  | { kind: 'screenView'; event: ScreenViewEvent }
  | { kind: 'selfDescribing'; event: SelfDescribingEvent }
  | { kind: 'page'; raw: string };

/** A fake tracker and web view callback that record what reached them, in order. */
function harness(options: { maxQueue?: number; failCreate?: boolean; failOn?: (item: Recorded) => boolean } = {}) {
  const sent: Recorded[] = [];
  let created = 0;

  const record = (item: Recorded): void => {
    if (options.failOn?.(item)) throw new Error('delivery failed');

    sent.push(item);
  };

  const tracker: TrackerLike = {
    trackScreenViewEvent(event) {
      record({ kind: 'screenView', event });
    },
    trackSelfDescribingEvent(event) {
      record({ kind: 'selfDescribing', event });
    },
  };

  const gate = createTrackerGate({
    maxQueue: options.maxQueue,
    ensureTracker: () => {
      created += 1;
      if (options.failCreate) throw new Error('namespace already exists');

      return tracker;
    },
    webViewCallback: message => record({ kind: 'page', raw: message.nativeEvent.data }),
  });

  return { gate, sent, creations: () => created };
}

const trackerMessage = (command: string, articleId = '1'): string =>
  JSON.stringify({ command, event: { schema: 'iglu:x/y/jsonschema/1-0-0', data: { articleId } }, context: [] });

describe('before the reader has chosen', () => {
  it('creates no tracker at all, so nothing can reach the collector', () => {
    const { gate, sent, creations } = harness();

    gate.trackScreenView({ name: 'front' });
    gate.pushPageMessage(trackerMessage('trackPageView'));
    gate.trackArticleRead('3');

    expect(creations()).toBe(0);
    expect(sent).toEqual([]);
    expect(gate.isActive()).toBe(false);
  });

  it('queues the events that matter so none of them are lost', () => {
    const { gate } = harness();

    gate.trackScreenView({ name: 'front' });
    gate.pushPageMessage(trackerMessage('trackPageView'));

    expect(gate.queueLength()).toBe(2);
  });

  it('never queues the noise the pages share the channel with', () => {
    const { gate } = harness();

    gate.pushPageMessage('tp:heartbeat');
    gate.pushPageMessage(JSON.stringify({ type: 'height', value: 'auto' }));
    gate.pushPageMessage(JSON.stringify({ type: 'ad:viewable', slot: 'top' }));
    gate.pushPageMessage(JSON.stringify({ event: 'metrics', at: 1 }));
    gate.pushPageMessage('{not json');

    expect(gate.queueLength()).toBe(0);
  });

  it('drops the oldest once the queue is full, rather than growing without limit', () => {
    const { gate, sent } = harness({ maxQueue: 3 });

    gate.trackScreenView({ name: 'a' });
    gate.trackScreenView({ name: 'b' });
    gate.trackScreenView({ name: 'c' });
    gate.trackScreenView({ name: 'd' });

    expect(gate.queueLength()).toBe(3);

    gate.onConsent('cs1-ab');

    expect(sent).toEqual([
      { kind: 'screenView', event: { name: 'b' } },
      { kind: 'screenView', event: { name: 'c' } },
      { kind: 'screenView', event: { name: 'd' } },
    ]);
  });
});

describe('when consent arrives', () => {
  it('creates the tracker and replays everything in the order it happened', () => {
    const { gate, sent, creations } = harness();
    const pageEvent = trackerMessage('trackPageView');

    gate.trackScreenView({ name: 'front' });
    gate.pushPageMessage(pageEvent);
    gate.trackArticleRead('3');

    gate.onConsent('cs1-ab');

    expect(creations()).toBe(1);
    expect(sent).toEqual([
      { kind: 'screenView', event: { name: 'front' } },
      { kind: 'page', raw: pageEvent },
      { kind: 'selfDescribing', event: { schema: READ_SCHEMA, data: { articleId: '3' } } },
    ]);
    expect(gate.queueLength()).toBe(0);
    expect(gate.isActive()).toBe(true);
  });

  it('forwards everything immediately afterwards', () => {
    const { gate, sent } = harness();

    gate.onConsent('cs1-ab');
    gate.trackScreenView({ name: 'article', id: '2' });

    expect(sent).toEqual([{ kind: 'screenView', event: { name: 'article', id: '2' } }]);
  });

  it('hands every message to the SDK once the tracker exists, since the SDK filters for itself', () => {
    const { gate, sent } = harness();

    gate.onConsent('cs1-ab');
    gate.pushPageMessage('tp:heartbeat');
    gate.pushPageMessage(JSON.stringify({ type: 'height', value: 'auto' }));

    expect(sent).toEqual([
      { kind: 'page', raw: 'tp:heartbeat' },
      { kind: 'page', raw: JSON.stringify({ type: 'height', value: 'auto' }) },
    ]);
  });

  it('creates the tracker only once however often consent arrives', () => {
    const { gate, creations } = harness();

    gate.onConsent('cs1-ab');
    gate.onConsent('cs2-cd');
    gate.onConsent('cs3-ef');

    expect(creations()).toBe(1);
  });

  it('does nothing for a null answer, because the reader has not chosen', () => {
    const { gate, creations } = harness();

    gate.trackScreenView({ name: 'front' });
    gate.onConsent(null);

    expect(creations()).toBe(0);
    expect(gate.queueLength()).toBe(1);
  });

  it('does nothing for an empty consent string, which is not a usable choice', () => {
    const { gate, creations } = harness();

    gate.onConsent('');

    expect(creations()).toBe(0);
    expect(gate.isActive()).toBe(false);
  });
});

describe('when things go wrong', () => {
  it('keeps the queue intact when the tracker cannot be created, so a later answer retries', () => {
    const { gate } = harness({ failCreate: true });

    gate.trackScreenView({ name: 'front' });
    gate.trackArticleRead('3');

    gate.onConsent('cs1-ab');

    expect(gate.isActive()).toBe(false);
    expect(gate.queueLength()).toBe(2);
  });

  it('replays the kept queue on a later answer once the tracker can be created', () => {
    const sent: Recorded[] = [];
    let failing = true;

    const tracker: TrackerLike = {
      trackScreenViewEvent: event => sent.push({ kind: 'screenView', event }),
      trackSelfDescribingEvent: event => sent.push({ kind: 'selfDescribing', event }),
    };

    const gate = createTrackerGate({
      ensureTracker: () => {
        if (failing) throw new Error('not yet');

        return tracker;
      },
      webViewCallback: message => sent.push({ kind: 'page', raw: message.nativeEvent.data }),
    });

    gate.trackScreenView({ name: 'front' });
    gate.onConsent('cs1-ab');

    expect(sent).toEqual([]);

    failing = false;
    gate.onConsent('cs1-ab');

    expect(sent).toEqual([{ kind: 'screenView', event: { name: 'front' } }]);
  });

  it('does not let one failed event block the rest of the replay', () => {
    const { gate, sent } = harness({
      failOn: item => item.kind === 'screenView' && item.event.name === 'bad',
    });

    gate.trackScreenView({ name: 'first' });
    gate.trackScreenView({ name: 'bad' });
    gate.trackScreenView({ name: 'last' });

    gate.onConsent('cs1-ab');

    expect(sent).toEqual([
      { kind: 'screenView', event: { name: 'first' } },
      { kind: 'screenView', event: { name: 'last' } },
    ]);
  });
});

describe('trackArticleRead', () => {
  it('builds the schema the newsroom reads article reads from', () => {
    const { gate, sent } = harness();

    gate.onConsent('cs1-ab');
    gate.trackArticleRead('7');

    expect(sent).toEqual([
      { kind: 'selfDescribing', event: { schema: READ_SCHEMA, data: { articleId: '7' } } },
    ]);
  });

  it('uses the schema the brief names', () => {
    expect(READ_SCHEMA).toBe('iglu:com.example.news/article_read/jsonschema/1-0-0');
  });
});
