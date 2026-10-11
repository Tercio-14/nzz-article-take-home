import { READY_TIMEOUT_MS, SessionState, initSession, reduce } from './pageSession';

/** Drives a session through a list of events, as the UI layer would. */
const run = (start: SessionState, events: Parameters<typeof reduce>[1][]): SessionState =>
  events.reduce((state, event) => reduce(state, event).state, start);

const loaded = (): SessionState => initSession(true).state;

/** A page that has loaded and announced itself. */
const ready = (): SessionState => reduce(loaded(), { type: 'READY' }).state;

describe('initSession', () => {
  it('waits for the consent gate, because a page loaded too early cannot carry the consent string', () => {
    const { state, effects } = initSession(false);

    expect(state).toEqual({ phase: 'waiting-for-consent', loadId: 0, initialStateSent: false, readyCount: 0 });
    expect(effects).toEqual([]);
  });

  it('loads at once when the gate is already open, and arms the ready timer', () => {
    const { state, effects } = initSession(true);

    expect(state).toEqual({ phase: 'loading', loadId: 1, initialStateSent: false, readyCount: 0 });
    expect(effects).toEqual([{ type: 'start-ready-timer', loadId: 1, ms: READY_TIMEOUT_MS }]);
  });

  it('gives the reader ten seconds, which is longer than the slowest page in the kit', () => {
    expect(READY_TIMEOUT_MS).toBe(10000);
  });
});

describe('the normal flow', () => {
  it('goes loading then ready, sending the app state once the page can receive it', () => {
    const { state, effects } = reduce(loaded(), { type: 'READY' });

    expect(state).toMatchObject({ phase: 'ready', readyCount: 1, initialStateSent: true });
    expect(effects).toEqual([{ type: 'cancel-ready-timer' }, { type: 'send-initial-state' }]);
  });

  it('opens the gate once and starts the first load', () => {
    const { state, effects } = reduce(initSession(false).state, { type: 'GATE_OPEN' });

    expect(state).toMatchObject({ phase: 'loading', loadId: 1 });
    expect(effects).toEqual([{ type: 'start-ready-timer', loadId: 1, ms: READY_TIMEOUT_MS }]);
  });

  it('ignores the gate opening again, because a page only starts once', () => {
    const open = reduce(initSession(false).state, { type: 'GATE_OPEN' }).state;
    const { state, effects } = reduce(open, { type: 'GATE_OPEN' });

    expect(state).toBe(open);
    expect(effects).toEqual([]);
  });

  it('ignores a ready while still waiting for consent, since no document was loaded', () => {
    const waiting = initSession(false).state;

    expect(reduce(waiting, { type: 'READY' }).state).toBe(waiting);
  });
});

describe('the pages that misbehave', () => {
  it('counts a duplicate ready but does not send the state again (article 5)', () => {
    const { state, effects } = reduce(ready(), { type: 'READY' });

    expect(state).toMatchObject({ phase: 'ready', readyCount: 2, initialStateSent: true });
    expect(effects).toEqual([]);
  });

  it('ends on the error state when a page never announces itself (article 4)', () => {
    const { state } = reduce(loaded(), { type: 'READY_TIMEOUT', loadId: 1 });

    expect(state.phase).toBe('error');
  });

  it('still succeeds when a page takes three seconds, because the timeout is ten (article 6)', () => {
    // The timer for load 1 has not fired; the page simply announces itself late.
    const { state } = reduce(loaded(), { type: 'READY' });

    expect(state.phase).toBe('ready');
  });

  it('ignores a timeout belonging to a load that has been superseded', () => {
    const reloaded = reduce(loaded(), { type: 'LOAD_STARTED' }).state;
    const { state, effects } = reduce(reloaded, { type: 'READY_TIMEOUT', loadId: 1 });

    expect(state).toBe(reloaded);
    expect(effects).toEqual([]);
  });

  it('ignores a timeout once the page is ready', () => {
    const page = ready();

    expect(reduce(page, { type: 'READY_TIMEOUT', loadId: page.loadId }).state).toBe(page);
  });

  it('recovers when a page announces itself after the error state, and sends the state then', () => {
    const failed = reduce(loaded(), { type: 'READY_TIMEOUT', loadId: 1 }).state;
    const { state, effects } = reduce(failed, { type: 'READY' });

    expect(state).toMatchObject({ phase: 'ready', readyCount: 1, initialStateSent: true });
    expect(effects).toEqual([{ type: 'cancel-ready-timer' }, { type: 'send-initial-state' }]);
  });
});

describe('loads, reloads and errors', () => {
  it('treats a reload as a new document and sends the state to it again', () => {
    const { state, effects } = reduce(ready(), { type: 'LOAD_STARTED' });

    expect(state).toEqual({ phase: 'loading', loadId: 2, initialStateSent: false, readyCount: 0 });
    expect(effects).toEqual([
      { type: 'cancel-ready-timer' },
      { type: 'start-ready-timer', loadId: 2, ms: READY_TIMEOUT_MS },
    ]);

    expect(reduce(state, { type: 'READY' }).effects).toContainEqual({ type: 'send-initial-state' });
  });

  it('ignores a load starting while the app is still waiting for consent', () => {
    const waiting = initSession(false).state;

    expect(reduce(waiting, { type: 'LOAD_STARTED' }).state).toBe(waiting);
  });

  it('goes to the error state when a load fails', () => {
    const { state, effects } = reduce(loaded(), { type: 'LOAD_ERROR' });

    expect(state.phase).toBe('error');
    expect(effects).toEqual([{ type: 'cancel-ready-timer' }]);
  });

  it('ignores a load error once the page is readable, because the reader can carry on', () => {
    const page = ready();

    expect(reduce(page, { type: 'LOAD_ERROR' }).state).toBe(page);
  });

  it('ignores a load error while waiting for consent', () => {
    const waiting = initSession(false).state;

    expect(reduce(waiting, { type: 'LOAD_ERROR' }).state).toBe(waiting);
  });

  it('never changes anything on navigation inside a page, which is not a load', () => {
    const page = ready();
    const { state, effects } = reduce(page, { type: 'IN_PAGE_NAVIGATION' });

    expect(state).toBe(page);
    expect(effects).toEqual([]);

    const loading = loaded();

    expect(reduce(loading, { type: 'IN_PAGE_NAVIGATION' }).state).toBe(loading);
  });
});

describe('getting out of the error state', () => {
  const failed = (): SessionState => reduce(loaded(), { type: 'READY_TIMEOUT', loadId: 1 }).state;

  it('retries, which is a new load', () => {
    const { state, effects } = reduce(failed(), { type: 'RETRY' });

    expect(state).toEqual({ phase: 'loading', loadId: 2, initialStateSent: false, readyCount: 0 });
    expect(effects).toEqual([
      { type: 'cancel-ready-timer' },
      { type: 'start-ready-timer', loadId: 2, ms: READY_TIMEOUT_MS },
    ]);
  });

  it('retries by itself when the device is back online', () => {
    const { state } = reduce(failed(), { type: 'CONNECTIVITY_RESTORED' });

    expect(state).toMatchObject({ phase: 'loading', loadId: 2 });
  });

  it('ignores a retry when there is nothing to retry', () => {
    const page = ready();

    expect(reduce(page, { type: 'RETRY' }).state).toBe(page);
  });

  it('ignores connectivity coming back while a page is loading or readable', () => {
    const page = ready();
    const loading = loaded();

    expect(reduce(page, { type: 'CONNECTIVITY_RESTORED' }).state).toBe(page);
    expect(reduce(loading, { type: 'CONNECTIVITY_RESTORED' }).state).toBe(loading);
  });
});

describe('load ids over a longer session', () => {
  it('keeps increasing, so every timer can be matched to its own load', () => {
    const state = run(initSession(false).state, [
      { type: 'GATE_OPEN' },
      { type: 'READY' },
      { type: 'LOAD_STARTED' },
      { type: 'READY' },
      { type: 'LOAD_STARTED' },
    ]);

    expect(state).toMatchObject({ phase: 'loading', loadId: 3 });
  });
});
