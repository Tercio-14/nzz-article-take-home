import {
  END_OF_TEXT_MESSAGE,
  TEXT_SELECTOR,
  endOfTextProbeScript,
  isEndOfTextVisible,
} from './endOfText';

const INSETS = { top: 96, bottom: 34 };
const VIEWPORT = 800;

const check = (top: number, bottom: number, height = bottom - top) =>
  isEndOfTextVisible({ box: { top, bottom, height }, viewportHeight: VIEWPORT, insets: INSETS });

describe('isEndOfTextVisible', () => {
  it('sees the last line when it sits in the clear part of the screen', () => {
    expect(check(700, 740)).toBe(true);
  });

  it('does not see it while it is still below the fold', () => {
    expect(check(900, 940)).toBe(false);
  });

  it('does not see it while it is hidden behind the bottom inset', () => {
    // The visible area ends at 800 - 34 = 766.
    expect(check(740, 780)).toBe(false);
  });

  it('sees it when its bottom lands exactly on the bottom inset', () => {
    expect(check(726, 766)).toBe(true);
  });

  it('allows a single pixel over, because browsers report fractional positions', () => {
    expect(check(727, 767)).toBe(true);
    expect(check(728, 768)).toBe(false);
  });

  it('still counts it once scrolled up, as long as it has not gone behind the header', () => {
    expect(check(60, 100)).toBe(true);
  });

  it('does not count it once it has scrolled up behind the header', () => {
    // The visible area starts at the top inset, 96.
    expect(check(40, 80)).toBe(false);
  });

  it('does not count an element that has not been laid out yet', () => {
    expect(check(700, 700, 0)).toBe(false);
    expect(isEndOfTextVisible({ box: { top: 700, bottom: 740, height: -1 }, viewportHeight: VIEWPORT, insets: INSETS })).toBe(false);
  });

  it('uses the whole screen when the app covers nothing', () => {
    const insets = { top: 0, bottom: 0 };

    expect(isEndOfTextVisible({ box: { top: 760, bottom: 800, height: 40 }, viewportHeight: VIEWPORT, insets })).toBe(true);
  });
});

/** Runs the injected probe against a fake page, the way a web view would. */
function runProbe(options: {
  articleId?: string;
  paragraphBoxes: { top: number; bottom: number; height: number }[];
  innerHeight?: number;
  cssInsets?: { top: string; bottom: string };
  pollMs?: number;
}) {
  const posted: string[] = [];
  const listeners: Record<string, (() => void)[]> = {};
  const timers: (() => void)[] = [];

  const paragraphs = options.paragraphBoxes.map(box => ({ getBoundingClientRect: () => box }));

  const win = {
    innerHeight: options.innerHeight ?? VIEWPORT,
    ReactNativeWebView: { postMessage: (data: string) => posted.push(data) },
    addEventListener(name: string, handler: () => void) {
      (listeners[name] ??= []).push(handler);
    },
  } as Record<string, unknown>;

  const document = {
    documentElement: {},
    querySelectorAll: (selector: string) => (selector === TEXT_SELECTOR ? paragraphs : []),
  };

  const getComputedStyle = () => ({
    getPropertyValue: (name: string) =>
      name === '--inset-top' ? (options.cssInsets?.top ?? '') : (options.cssInsets?.bottom ?? ''),
  });

  const setInterval = (handler: () => void) => {
    timers.push(handler);

    return 1;
  };

  const script = endOfTextProbeScript(options.articleId ?? '3', INSETS, options.pollMs);

  new Function('window', 'document', 'getComputedStyle', 'setInterval', script)(
    win,
    document,
    getComputedStyle,
    setInterval,
  );

  return {
    posted,
    fire: (name: string) => (listeners[name] ?? []).forEach(handler => handler()),
    tick: () => timers.forEach(handler => handler()),
    win,
  };
}

describe('endOfTextProbeScript', () => {
  const visible = [{ top: 700, bottom: 740, height: 40 }];
  const belowTheFold = [{ top: 900, bottom: 940, height: 40 }];

  it('reports straight away when a short article already shows its last line', () => {
    const probe = runProbe({ paragraphBoxes: visible });

    expect(probe.posted).toEqual([JSON.stringify({ type: END_OF_TEXT_MESSAGE, articleId: '3' })]);
  });

  it('says nothing while the end of the text is still below the fold', () => {
    expect(runProbe({ paragraphBoxes: belowTheFold }).posted).toEqual([]);
  });

  it('says nothing when the article has no text at all', () => {
    expect(runProbe({ paragraphBoxes: [] }).posted).toEqual([]);
  });

  it('reports once the reader scrolls the last line into view', () => {
    let box = { top: 900, bottom: 940, height: 40 };
    const posted: string[] = [];
    const listeners: Record<string, (() => void)[]> = {};

    const win = {
      innerHeight: VIEWPORT,
      ReactNativeWebView: { postMessage: (data: string) => posted.push(data) },
      addEventListener(name: string, handler: () => void) {
        (listeners[name] ??= []).push(handler);
      },
    } as Record<string, unknown>;

    new Function(
      'window',
      'document',
      'getComputedStyle',
      'setInterval',
      endOfTextProbeScript('3', INSETS),
    )(
      win,
      { documentElement: {}, querySelectorAll: () => [{ getBoundingClientRect: () => box }] },
      () => ({ getPropertyValue: () => '' }),
      () => 1,
    );

    expect(posted).toEqual([]);

    box = { top: 700, bottom: 740, height: 40 };
    listeners.scroll.forEach(handler => handler());

    expect(posted).toHaveLength(1);
  });

  it('reports at most once however often it is checked', () => {
    const probe = runProbe({ paragraphBoxes: visible });

    probe.fire('scroll');
    probe.fire('resize');
    probe.tick();

    expect(probe.posted).toHaveLength(1);
  });

  it('carries the article id it was built for', () => {
    const probe = runProbe({ articleId: '7', paragraphBoxes: visible });

    expect(JSON.parse(probe.posted[0])).toEqual({ type: END_OF_TEXT_MESSAGE, articleId: '7' });
  });

  it('prefers the live inset values the app set on the page over the ones built in', () => {
    // A top inset of 760 leaves almost nothing visible, so a line at 740 is behind the header.
    const probe = runProbe({ paragraphBoxes: visible, cssInsets: { top: '760px', bottom: '0px' } });

    expect(probe.posted).toEqual([]);
  });

  it('falls back to the built-in insets before the page has any', () => {
    const probe = runProbe({ paragraphBoxes: visible, cssInsets: { top: '', bottom: '' } });

    expect(probe.posted).toHaveLength(1);
  });

  it('does not install twice, so a second injection cannot start a second poller', () => {
    const probe = runProbe({ paragraphBoxes: visible });

    expect(probe.posted).toHaveLength(1);

    // Running the same script again against the same window must do nothing.
    new Function('window', 'document', 'getComputedStyle', 'setInterval', endOfTextProbeScript('3', INSETS))(
      probe.win,
      { documentElement: {}, querySelectorAll: () => [{ getBoundingClientRect: () => visible[0] }] },
      () => ({ getPropertyValue: () => '' }),
      () => 1,
    );

    expect(probe.posted).toHaveLength(1);
  });

  it('ends with true, so the web view does not warn about what it evaluated to', () => {
    expect(endOfTextProbeScript('3', INSETS).trimEnd().endsWith('true;')).toBe(true);
  });

  it('escapes the article id, so a hostile id cannot break out of the script', () => {
    const hostile = '3";window.pwned=1;"';
    const probe = runProbe({ articleId: hostile, paragraphBoxes: visible });

    // The id travels as data: it comes back intact and nothing of it ran.
    expect(JSON.parse(probe.posted[0]).articleId).toBe(hostile);
    expect(probe.win.pwned).toBeUndefined();
  });
});
