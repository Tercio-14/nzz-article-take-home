import {
  AT_TOP_TOLERANCE,
  PULL_MESSAGE,
  MAX_PULL,
  PULL_THRESHOLD,
  RESISTANCE,
  isAtTop,
  pullProbeScript,
  pullState,
  shouldTriggerOnRelease,
} from './pullToRefresh';

/** The finger travel that puts the indicator exactly on the threshold. */
const DRAG_TO_ARM = PULL_THRESHOLD / RESISTANCE;

const pull = (dragY: number, atTop = true, busy = false) => pullState({ dragY, atTop, busy });

describe('pullState', () => {
  describe('at the top of the page', () => {
    it('moves the indicator a fraction of the finger, so the pull has resistance', () => {
      expect(pull(40).offset).toBe(20);
    });

    it('is not armed before the threshold', () => {
      const state = pull(DRAG_TO_ARM - 10);

      expect(state.armed).toBe(false);
      expect(state.progress).toBeLessThan(1);
    });

    it('arms exactly at the threshold', () => {
      const state = pull(DRAG_TO_ARM);

      expect(state.offset).toBe(PULL_THRESHOLD);
      expect(state.armed).toBe(true);
      expect(state.progress).toBe(1);
    });

    it('stays armed past the threshold', () => {
      expect(pull(DRAG_TO_ARM + 50).armed).toBe(true);
    });

    it('stops at the limit however hard the reader pulls', () => {
      expect(pull(10000).offset).toBe(MAX_PULL);
    });

    it('never reports progress above one', () => {
      expect(pull(10000).progress).toBe(1);
    });

    it('reports progress proportional to the pull, for the indicator to grow with', () => {
      expect(pull(DRAG_TO_ARM / 2).progress).toBeCloseTo(0.5);
    });

    it('rests at the very start of a drag', () => {
      expect(pull(0)).toEqual({ offset: 0, progress: 0, armed: false });
    });

    it('rests while the finger moves up, which is the page scrolling', () => {
      expect(pull(-50)).toEqual({ offset: 0, progress: 0, armed: false });
    });
  });

  describe('when a pull means nothing', () => {
    it('rests when the page is scrolled down, so reading is never interrupted', () => {
      expect(pull(DRAG_TO_ARM + 100, false)).toEqual({ offset: 0, progress: 0, armed: false });
    });

    it('rests while a load is already running, so one pull cannot start two', () => {
      expect(pull(DRAG_TO_ARM + 100, true, true)).toEqual({ offset: 0, progress: 0, armed: false });
    });

    it('rests on a nonsense drag rather than moving the indicator somewhere strange', () => {
      expect(pull(Number.NaN)).toEqual({ offset: 0, progress: 0, armed: false });
      expect(pull(Number.POSITIVE_INFINITY)).toEqual({ offset: 0, progress: 0, armed: false });
    });
  });
});

describe('shouldTriggerOnRelease', () => {
  it('reloads when the pull reached the threshold', () => {
    expect(shouldTriggerOnRelease(pull(DRAG_TO_ARM))).toBe(true);
  });

  it('springs back without reloading when it did not', () => {
    expect(shouldTriggerOnRelease(pull(DRAG_TO_ARM - 1))).toBe(false);
  });

  it('does not reload from a pull that was never active', () => {
    expect(shouldTriggerOnRelease(pull(DRAG_TO_ARM + 100, false))).toBe(false);
    expect(shouldTriggerOnRelease(pull(DRAG_TO_ARM + 100, true, true))).toBe(false);
  });
});

describe('the numbers themselves', () => {
  it('asks for a deliberate pull rather than a twitch', () => {
    expect(DRAG_TO_ARM).toBeGreaterThanOrEqual(100);
  });

  it('lets the indicator travel past the point where it arms, so the pull has somewhere to go', () => {
    expect(MAX_PULL).toBeGreaterThan(PULL_THRESHOLD);
  });
});

describe('isAtTop', () => {
  it('counts a page resting at the top', () => {
    expect(isAtTop(0)).toBe(true);
  });

  it('counts a fraction of a pixel, because scroll positions are not whole numbers', () => {
    expect(isAtTop(0.5)).toBe(true);
    expect(isAtTop(AT_TOP_TOLERANCE)).toBe(true);
  });

  it('counts overscrolling past the top, which iOS reports as a negative position', () => {
    expect(isAtTop(-40)).toBe(true);
  });

  it('does not count a page that has been scrolled down', () => {
    expect(isAtTop(AT_TOP_TOLERANCE + 1)).toBe(false);
    expect(isAtTop(2000)).toBe(false);
  });

  it('stays out of the way when the position tells us nothing', () => {
    expect(isAtTop(Number.NaN)).toBe(false);
    expect(isAtTop(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

type Posted = { type: string; phase: string; distance: number };

/** Runs the injected probe against a fake page and lets a test drive touches through it. */
function runProbe(options: { scrollY?: number } = {}) {
  const posted: Posted[] = [];
  const listeners: Record<string, ((event: unknown) => void)[]> = {};
  let scrollY = options.scrollY ?? 0;
  const frames: (() => void)[] = [];

  const win = {
    get pageYOffset() {
      return scrollY;
    },
    ReactNativeWebView: { postMessage: (data: string) => posted.push(JSON.parse(data)) },
    addEventListener(name: string, handler: (event: unknown) => void) {
      (listeners[name] ??= []).push(handler);
    },
    requestAnimationFrame(callback: () => void) {
      frames.push(callback);

      return frames.length;
    },
    cancelAnimationFrame() {
      // Nothing to do: the test drains frames explicitly.
    },
  } as Record<string, unknown>;

  new Function('window', 'document', pullProbeScript())(win, { documentElement: { scrollTop: 0 } });

  const fire = (name: string, event: unknown) => (listeners[name] ?? []).forEach(h => h(event));
  const touch = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }] });

  return {
    posted,
    win,
    setScroll: (y: number) => {
      scrollY = y;
    },
    /** Runs any animation frames the probe asked for, which is when a move is actually posted. */
    flush: () => {
      const pending = frames.splice(0, frames.length);
      pending.forEach(callback => callback());
    },
    start: (x: number, y: number) => fire('touchstart', touch(x, y)),
    move: (x: number, y: number) => fire('touchmove', touch(x, y)),
    end: () => fire('touchend', {}),
    cancelTouch: () => fire('touchcancel', {}),
    multiTouch: () => fire('touchstart', { touches: [{ clientX: 0, clientY: 0 }, { clientX: 1, clientY: 1 }] }),
  };
}

describe('pullProbeScript', () => {
  it('is valid JavaScript and installs without throwing', () => {
    expect(() => runProbe()).not.toThrow();
  });

  it('ends with true, so the web view does not warn about what it evaluated to', () => {
    expect(pullProbeScript().trimEnd().endsWith('true;')).toBe(true);
  });

  it('reports a pull starting when a finger lands at the top', () => {
    const probe = runProbe();

    probe.start(100, 100);

    expect(probe.posted).toEqual([{ type: PULL_MESSAGE, phase: 'start', distance: 0 }]);
  });

  it('says nothing when the finger lands on a page that is scrolled down', () => {
    const probe = runProbe({ scrollY: 500 });

    probe.start(100, 100);
    probe.move(100, 200);
    probe.flush();
    probe.end();

    expect(probe.posted).toEqual([]);
  });

  it('reports the distance as the finger moves down', () => {
    const probe = runProbe();

    probe.start(100, 100);
    probe.move(100, 160);
    probe.flush();

    expect(probe.posted[1]).toEqual({ type: PULL_MESSAGE, phase: 'move', distance: 60 });
  });

  it('reports the final distance when the finger lifts', () => {
    const probe = runProbe();

    probe.start(100, 100);
    probe.move(100, 180);
    probe.flush();
    probe.end();

    expect(probe.posted[probe.posted.length - 1]).toEqual({
      type: PULL_MESSAGE,
      phase: 'end',
      distance: 80,
    });
  });

  it('throttles moves, so one frame posts once however many touches arrive', () => {
    const probe = runProbe();

    probe.start(100, 100);
    probe.move(100, 120);
    probe.move(100, 140);
    probe.move(100, 160);
    probe.flush();

    expect(probe.posted.filter(message => message.phase === 'move')).toHaveLength(1);
  });

  it('cancels a drag that is mostly sideways, so the swipe back is never stolen', () => {
    const probe = runProbe();

    probe.start(100, 100);
    probe.move(200, 120);
    probe.flush();

    expect(probe.posted[1]).toEqual({ type: PULL_MESSAGE, phase: 'cancel', distance: 0 });
  });

  it('reports nothing for an upward drag, which is the page scrolling', () => {
    const probe = runProbe();

    probe.start(100, 200);
    probe.move(100, 120);
    probe.flush();

    expect(probe.posted.filter(message => message.phase === 'move')).toEqual([]);
  });

  it('ignores a second finger', () => {
    const probe = runProbe();

    probe.multiTouch();

    expect(probe.posted).toEqual([]);
  });

  it('cancels when the system takes the touch away', () => {
    const probe = runProbe();

    probe.start(100, 100);
    probe.move(100, 160);
    probe.flush();
    probe.cancelTouch();

    expect(probe.posted[probe.posted.length - 1].phase).toBe('cancel');
  });

  it('says nothing on a lift that never started a pull', () => {
    const probe = runProbe({ scrollY: 500 });

    probe.end();

    expect(probe.posted).toEqual([]);
  });

  it('does not install twice, so a second injection cannot double the messages', () => {
    const probe = runProbe();

    new Function('window', 'document', pullProbeScript())(probe.win, { documentElement: { scrollTop: 0 } });
    probe.start(100, 100);

    expect(probe.posted.filter(message => message.phase === 'start')).toHaveLength(1);
  });
});
