// Pure module: no React Native imports, so it can be unit-tested directly.
//
// One page load, as a state machine. It exists because the pages make "loaded" genuinely ambiguous:
// one article never announces itself, another announces itself twice, a third takes three seconds, and
// navigation *inside* a page is not a load at all. Guessing from web-view callbacks alone produces a
// spinner that never ends or state sent twice.
//
// It owns no timers. It asks for them with effects and is told when they fire, so every rule here can
// be tested without a clock. Each timer carries the `loadId` it belongs to, so a timeout from a load
// that has since been superseded is recognised and ignored.

/** How long a page may take to announce itself before the reader is offered a retry. */
export const READY_TIMEOUT_MS = 10000;

export type SessionPhase = 'waiting-for-consent' | 'loading' | 'ready' | 'error';

export type SessionState = {
  phase: SessionPhase;
  /** Counts loads. A timer or a ready belonging to an older load is stale. */
  loadId: number;
  /** Whether the app state has been handed to the current document. */
  initialStateSent: boolean;
  /** How often the current document announced itself; the kit's article 5 does it twice. */
  readyCount: number;
};

export type SessionEvent =
  | { type: 'GATE_OPEN' }
  | { type: 'LOAD_STARTED' }
  | { type: 'READY' }
  | { type: 'READY_TIMEOUT'; loadId: number }
  | { type: 'LOAD_ERROR' }
  | { type: 'IN_PAGE_NAVIGATION' }
  | { type: 'CONNECTIVITY_RESTORED' }
  | { type: 'RETRY' };

export type SessionEffect =
  | { type: 'start-ready-timer'; loadId: number; ms: number }
  | { type: 'cancel-ready-timer' }
  | { type: 'send-initial-state' };

export type SessionResult = {
  state: SessionState;
  effects: SessionEffect[];
};

const NO_EFFECTS: SessionEffect[] = [];

/**
 * The state a page starts in. A page waits until the consent gate is open, because a load that starts
 * too early can never carry the consent string.
 */
export function initSession(gateOpen: boolean): SessionResult {
  if (!gateOpen) {
    return {
      state: { phase: 'waiting-for-consent', loadId: 0, initialStateSent: false, readyCount: 0 },
      effects: NO_EFFECTS,
    };
  }

  return beginLoad({ phase: 'waiting-for-consent', loadId: 0, initialStateSent: false, readyCount: 0 });
}

export function reduce(state: SessionState, event: SessionEvent): SessionResult {
  switch (event.type) {
    case 'GATE_OPEN':
      return state.phase === 'waiting-for-consent' ? beginLoad(state) : unchanged(state);

    // A reload, a pull-to-refresh, a retry or a consent reload: all of them are a new document.
    case 'LOAD_STARTED':
      return state.phase === 'waiting-for-consent' ? unchanged(state) : beginLoad(state);


    case 'READY':
      return onReady(state);

    case 'READY_TIMEOUT':
      if (state.phase !== 'loading' || state.loadId !== event.loadId) return unchanged(state);

      return { state: { ...state, phase: 'error' }, effects: NO_EFFECTS };

    // A page that is already readable stays readable; only a load can fail.
    case 'LOAD_ERROR':
      if (state.phase !== 'loading') return unchanged(state);

      return { state: { ...state, phase: 'error' }, effects: [{ type: 'cancel-ready-timer' }] };

    // Navigation inside a page is not a load, so the loading state must not come back.
    case 'IN_PAGE_NAVIGATION':
      return unchanged(state);

    case 'CONNECTIVITY_RESTORED':
    case 'RETRY':
      return state.phase === 'error' ? beginLoad(state) : unchanged(state);

    default:
      return unchanged(state);
  }
}

/**
 * Starts a new document: a fresh load id, nothing sent to it yet, and a fresh ready timer.
 *
 * A load leaving 'waiting-for-consent' is the first one, so there is no timer to cancel; every other
 * load supersedes one and cancels its timer first.
 */
function beginLoad(state: SessionState): SessionResult {
  const loadId = state.loadId + 1;
  const start: SessionEffect = { type: 'start-ready-timer', loadId, ms: READY_TIMEOUT_MS };
  const effects: SessionEffect[] =
    state.phase === 'waiting-for-consent' ? [start] : [{ type: 'cancel-ready-timer' }, start];

  return {
    state: { phase: 'loading', loadId, initialStateSent: false, readyCount: 0 },
    effects,
  };
}

function onReady(state: SessionState): SessionResult {
  // A page that has not been loaded cannot be ready.
  if (state.phase === 'waiting-for-consent') return unchanged(state);

  const readyCount = state.readyCount + 1;

  // A second ready for the same document (the kit's article 5) must not send the state again.
  if (state.initialStateSent) {
    return { state: { ...state, phase: 'ready', readyCount }, effects: NO_EFFECTS };
  }

  return {
    state: { ...state, phase: 'ready', initialStateSent: true, readyCount },
    effects: [{ type: 'cancel-ready-timer' }, { type: 'send-initial-state' }],
  };
}

function unchanged(state: SessionState): SessionResult {
  return { state, effects: NO_EFFECTS };
}
