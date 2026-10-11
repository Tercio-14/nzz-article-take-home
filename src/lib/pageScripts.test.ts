import type { AppContext } from '../config';
import {
  ANCHOR_OFFSET_MESSAGE,
  APP_EVENTS,
  appEventsScript,
  measureAnchorScript,
  AppEventName,
  Insets,
  PageState,
  beforeContentLoadedScript,
  dispatchAppEventScript,
  initialStateScript,
} from './pageScripts';

type Dispatched = { name: string; detail: unknown };

type FakeWindow = {
  appContext?: unknown;
  appInsets?: unknown;
  dispatchEvent(event: { name: string; detail: unknown }): void;
};

/**
 * Runs a generated script the way a web view would: as source, against a window it does not control.
 * Nothing here imports the module under test, so a script that does not really work cannot pass.
 */
function evaluate(script: string): { window: FakeWindow; dispatched: Dispatched[] } {
  const dispatched: Dispatched[] = [];
  const window: FakeWindow = {
    dispatchEvent(event) {
      dispatched.push({ name: event.name, detail: event.detail });
    },
  };

  class FakeCustomEvent {
    name: string;
    detail: unknown;

    constructor(name: string, options?: { detail?: unknown }) {
      this.name = name;
      this.detail = options?.detail;
    }
  }

  // A web view evaluates the source and takes the completion value of its last statement, so every
  // script has to end with `true;` or the web view warns about what it evaluated to.
  expect(script.trimEnd().endsWith('true;')).toBe(true);

  new Function('window', 'CustomEvent', script)(window, FakeCustomEvent);

  return { window, dispatched };
}

const APP_CONTEXT: AppContext = {
  appVersion: '1.0.0',
  appBuild: '1',
  os: 'ios',
  deviceType: 'phone',
};

const STATE: PageState = {
  fontScale: 1.2,
  theme: 'light',
  bookmarks: ['1', '3'],
  read: ['7'],
};

const INSETS: Insets = { top: 96, bottom: 34 };

describe('beforeContentLoadedScript', () => {
  it('sets the app context the web tracker adds to every event', () => {
    const { window } = evaluate(beforeContentLoadedScript({ appContext: APP_CONTEXT }));

    expect(window.appContext).toEqual(APP_CONTEXT);
  });

  it('leaves the insets unset when none are given, as on the front page', () => {
    const { window } = evaluate(beforeContentLoadedScript({ appContext: APP_CONTEXT }));

    expect(window.appInsets).toBeUndefined();
  });

  it('sets the insets so the article reserves the app chrome from its first paint', () => {
    const { window } = evaluate(beforeContentLoadedScript({ appContext: APP_CONTEXT, insets: INSETS }));

    expect(window.appInsets).toEqual(INSETS);
  });
});

describe('dispatchAppEventScript', () => {
  it('dispatches one event with the detail the protocol defines', () => {
    const { dispatched } = evaluate(dispatchAppEventScript('app:fontScale', { value: 1.3 }));

    expect(dispatched).toEqual([{ name: 'app:fontScale', detail: { value: 1.3 } }]);
  });

  it('dispatches the bookmark list', () => {
    const { dispatched } = evaluate(dispatchAppEventScript('app:bookmarks', { ids: ['1', '2'] }));

    expect(dispatched).toEqual([{ name: 'app:bookmarks', detail: { ids: ['1', '2'] } }]);
  });

  it('accepts every event the protocol defines', () => {
    for (const name of APP_EVENTS) {
      expect(() => dispatchAppEventScript(name, { value: 1 })).not.toThrow();
    }
  });

  it('refuses an event the protocol does not define, because a typo would fail silently', () => {
    expect(() => dispatchAppEventScript('app:nonsense' as AppEventName, {})).toThrow(/Unknown app event/);
  });
});

describe('initialStateScript', () => {
  it('sends the front page its state, read articles included, in protocol order', () => {
    const { dispatched } = evaluate(initialStateScript('front', STATE));

    expect(dispatched).toEqual([
      { name: 'app:fontScale', detail: { value: 1.2 } },
      { name: 'app:theme', detail: { value: 'light' } },
      { name: 'app:bookmarks', detail: { ids: ['1', '3'] } },
      { name: 'app:read', detail: { ids: ['7'] } },
    ]);
  });

  it('sends an article its state and the insets, but never the read list', () => {
    const { dispatched } = evaluate(initialStateScript('article', STATE, INSETS));

    expect(dispatched).toEqual([
      { name: 'app:fontScale', detail: { value: 1.2 } },
      { name: 'app:theme', detail: { value: 'light' } },
      { name: 'app:bookmarks', detail: { ids: ['1', '3'] } },
      { name: 'app:insets', detail: { top: 96, bottom: 34 } },
    ]);
  });

  it('leaves the insets out of an article script when none are known yet', () => {
    const { dispatched } = evaluate(initialStateScript('article', STATE));

    expect(dispatched.map(event => event.name)).toEqual(['app:fontScale', 'app:theme', 'app:bookmarks']);
  });

  it('sends empty lists rather than nothing, so a page can clear what it shows', () => {
    const empty: PageState = { fontScale: 1, theme: 'dark', bookmarks: [], read: [] };
    const { dispatched } = evaluate(initialStateScript('front', empty));

    expect(dispatched).toContainEqual({ name: 'app:bookmarks', detail: { ids: [] } });
    expect(dispatched).toContainEqual({ name: 'app:read', detail: { ids: [] } });
  });
});

describe('values that would break a naive script', () => {
  it('survives quotes and backslashes in an article id', () => {
    const hostile: PageState = {
      fontScale: 1,
      theme: 'dark',
      bookmarks: ['a"b', "c'd", 'e\\f'],
      read: [],
    };
    const { dispatched } = evaluate(initialStateScript('front', hostile));

    expect(dispatched[2].detail).toEqual({ ids: ['a"b', "c'd", 'e\\f'] });
  });

  it('survives a closing script tag, which would otherwise end an inline script', () => {
    const hostile: PageState = { fontScale: 1, theme: 'dark', bookmarks: ['</script><img>'], read: [] };
    const { dispatched } = evaluate(initialStateScript('front', hostile));

    expect(dispatched[2].detail).toEqual({ ids: ['</script><img>'] });
  });

  it('survives newlines, which would otherwise end the statement', () => {
    const hostile: PageState = { fontScale: 1, theme: 'dark', bookmarks: ['a\nb'], read: [] };
    const { dispatched } = evaluate(initialStateScript('front', hostile));

    expect(dispatched[2].detail).toEqual({ ids: ['a\nb'] });
  });

  it('survives the line separators that are legal in JSON but not inside JavaScript strings', () => {
    const hostile: PageState = {
      fontScale: 1,
      theme: 'dark',
      bookmarks: ['a\u2028b', 'c\u2029d'],
      read: [],
    };
    const { dispatched } = evaluate(initialStateScript('front', hostile));

    expect(dispatched[2].detail).toEqual({ ids: ['a\u2028b', 'c\u2029d'] });
  });

  it('survives a hostile app context, which reaches every tracking event', () => {
    const hostile: AppContext = {
      appVersion: '1.0.0";window.pwned=1;"',
      appBuild: '</script>',
      os: 'ios',
      deviceType: 'phone',
    };
    const { window } = evaluate(beforeContentLoadedScript({ appContext: hostile }));

    expect(window.appContext).toEqual(hostile);
    expect((window as unknown as Record<string, unknown>).pwned).toBeUndefined();
  });
});

describe('appEventsScript', () => {
  it('dispatches each planned event in order, as one script', () => {
    const { dispatched } = evaluate(
      appEventsScript([
        { name: 'app:theme', detail: { value: 'light' } },
        { name: 'app:bookmarks', detail: { ids: ['1'] } },
      ]),
    );

    expect(dispatched).toEqual([
      { name: 'app:theme', detail: { value: 'light' } },
      { name: 'app:bookmarks', detail: { ids: ['1'] } },
    ]);
  });

  it('dispatches a single change on its own', () => {
    const { dispatched } = evaluate(appEventsScript([{ name: 'app:fontScale', detail: { value: 1.1 } }]));

    expect(dispatched).toEqual([{ name: 'app:fontScale', detail: { value: 1.1 } }]);
  });

  it('is a harmless script when nothing changed, so the caller need not special-case it', () => {
    const { dispatched } = evaluate(appEventsScript([]));

    expect(dispatched).toEqual([]);
  });

  it('escapes hostile values here too', () => {
    const { dispatched } = evaluate(
      appEventsScript([{ name: 'app:bookmarks', detail: { ids: ['</script>', 'a"b'] } }]),
    );

    expect(dispatched[0].detail).toEqual({ ids: ['</script>', 'a"b'] });
  });
});

describe('measureAnchorScript', () => {
  /** Runs the measurement against a fake page holding one heading at a known place. */
  function measure(options: { fragment: string; id?: string; top?: number; scrollY?: number }) {
    const posted: string[] = [];
    const element = { getBoundingClientRect: () => ({ top: options.top ?? 400 }) };

    const win = {
      pageYOffset: options.scrollY ?? 0,
      ReactNativeWebView: { postMessage: (data: string) => posted.push(data) },
    };
    const document = {
      documentElement: { scrollTop: 0 },
      getElementById: (id: string) => (id === (options.id ?? 'top-stories') ? element : null),
    };

    new Function('window', 'document', measureAnchorScript(options.fragment))(win, document);

    return posted;
  }

  it('reports where the heading sits in the document', () => {
    const posted = measure({ fragment: 'top-stories', top: 400 });

    expect(JSON.parse(posted[0])).toEqual({
      type: ANCHOR_OFFSET_MESSAGE,
      fragment: 'top-stories',
      top: 400,
    });
  });

  it('adds how far the page is already scrolled, so the offset is from the top of the document', () => {
    const posted = measure({ fragment: 'top-stories', top: 100, scrollY: 300 });

    expect(JSON.parse(posted[0]).top).toBe(400);
  });

  it('rounds to whole pixels', () => {
    const posted = measure({ fragment: 'top-stories', top: 400.6 });

    expect(JSON.parse(posted[0]).top).toBe(401);
  });

  it('says nothing when the heading does not exist, so the app does not scroll somewhere wrong', () => {
    expect(measure({ fragment: 'summary', id: 'top-stories' })).toEqual([]);
  });

  it('ends with true, so the web view does not warn about what it evaluated to', () => {
    expect(measureAnchorScript('top-stories').trimEnd().endsWith('true;')).toBe(true);
  });

  it('escapes the fragment, so a hostile one cannot break out of the script', () => {
    const posted = measure({ fragment: '";window.pwned=1;"', id: '";window.pwned=1;"' });

    expect(JSON.parse(posted[0]).fragment).toBe('";window.pwned=1;"');
  });
});
