// Runs the page-session state machine and carries out the effects it asks for.
//
// `lib/pageSession` is pure and owns no timers; it returns effects instead. This hook is the small
// impure half: it keeps the state, starts and cancels the ready timer, and calls back when the state
// has to be handed to the page. Keeping the state in a ref as well as in React state lets `dispatch`
// work from the newest value even when several events arrive in one tick, as they do when a page
// announces itself twice.

import { useCallback, useEffect, useRef, useState } from 'react';

import { SessionEffect, SessionEvent, SessionState, initSession, reduce } from '../lib/pageSession';

export type PageSession = {
  state: SessionState;
  dispatch(event: SessionEvent): void;
};

export function usePageSession(gateOpen: boolean, onSendInitialState: () => void): PageSession {
  const initial = useRef<SessionState | null>(null);
  if (initial.current === null) initial.current = initSession(gateOpen).state;

  const stateRef = useRef<SessionState>(initial.current);
  const [state, setState] = useState<SessionState>(initial.current);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendInitialState = useRef(onSendInitialState);
  sendInitialState.current = onSendInitialState;

  // Declared before `dispatch` so the ready timer can dispatch its own timeout.
  const dispatchRef = useRef<(event: SessionEvent) => void>(() => undefined);

  const runEffects = useCallback((effects: SessionEffect[]) => {
    for (const effect of effects) {
      switch (effect.type) {
        case 'cancel-ready-timer':
          if (timer.current) clearTimeout(timer.current);
          timer.current = null;
          break;
        case 'start-ready-timer':
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(
            () => dispatchRef.current({ type: 'READY_TIMEOUT', loadId: effect.loadId }),
            effect.ms,
          );
          break;
        case 'send-initial-state':
          sendInitialState.current();
          break;
      }
    }
  }, []);

  const dispatch = useCallback(
    (event: SessionEvent) => {
      const result = reduce(stateRef.current, event);

      stateRef.current = result.state;
      setState(result.state);
      runEffects(result.effects);
    },
    [runEffects],
  );

  dispatchRef.current = dispatch;

  // The very first load is started by `initSession`, whose effects nobody has run yet.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;

    started.current = true;
    runEffects(initSession(gateOpen).effects);
    // `gateOpen` is read once on purpose: a later opening arrives as GATE_OPEN.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runEffects]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { state, dispatch };
}
