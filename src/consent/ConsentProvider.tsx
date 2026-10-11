// The reader's consent, and the gate that decides when pages may start loading.
//
// Thin on purpose: the rules live in `lib/consent` (the gate) and `lib/consentClient` (the request).
// This binds them to React, to the app's foreground/background lifecycle and to the tracker.
//
// Two things make the timing awkward and are handled here. The answer may arrive after the app has
// already given up waiting, so the gate opens on a timer but a late answer still updates the value.
// And the app asks again every time it comes back to the foreground, so two requests can be in flight
// at once — each carries a sequence number and an older answer can never overwrite a newer one.

import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState as RNAppState, AppStateStatus } from 'react-native';

import { BASE_URL } from '../config';
import { CONSENT_TIMEOUT_MS, ConsentState, INITIAL_CONSENT, reduceConsent } from '../lib/consent';
import { fetchConsent } from '../lib/consentClient';
import { tracking } from '../tracking';

export type ConsentContextValue = {
  /** The newest consent string the app knows, or null while the reader has not chosen. */
  consent: string | null;
  /** Whether pages may start loading. Opens once and never closes. */
  gateOpen: boolean;
};

const ConsentContext = createContext<ConsentContextValue | null>(null);

export function ConsentProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConsentState>(INITIAL_CONSENT);

  const stateRef = useRef(state);
  stateRef.current = state;

  // Which request is newest, and which one's answer has already been applied.
  const nextSequence = useRef(0);
  const appliedSequence = useRef(-1);

  const apply = useCallback((next: ConsentState) => {
    // Tell the tracker before anything renders: a consent string is what lets it exist at all.
    if (next.value !== null && next.value !== stateRef.current.value) tracking.onConsent(next.value);

    stateRef.current = next;
    setState(next);
  }, []);

  const ask = useCallback(() => {
    const sequence = nextSequence.current;
    nextSequence.current += 1;

    void fetchConsent(fetch, BASE_URL).then(answer => {
      // An older request answering after a newer one must not undo the newer value.
      if (sequence < appliedSequence.current) return;

      appliedSequence.current = sequence;

      apply(
        reduceConsent(
          stateRef.current,
          answer.kind === 'answer' ? { type: 'ANSWER', consent: answer.consent } : { type: 'FAILED' },
        ),
      );
    });
  }, [apply]);

  // At launch: ask, and open the gate after five seconds whatever happens.
  useEffect(() => {
    ask();

    const timer = setTimeout(() => {
      if (stateRef.current.gateOpen) return;

      apply(reduceConsent(stateRef.current, { type: 'TIMEOUT' }));
    }, CONSENT_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [ask, apply]);

  // And again every time the reader comes back to the app.
  useEffect(() => {
    let previous = RNAppState.currentState;

    const subscription = RNAppState.addEventListener('change', (next: AppStateStatus) => {
      const returning = previous !== 'active' && next === 'active';
      previous = next;

      if (returning) ask();
    });

    return () => subscription.remove();
  }, [ask]);

  const value = useMemo<ConsentContextValue>(
    () => ({ consent: state.value, gateOpen: state.gateOpen }),
    [state.value, state.gateOpen],
  );

  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
}

export function useConsent(): ConsentContextValue {
  const value = useContext(ConsentContext);
  if (!value) throw new Error('useConsent must be used inside a ConsentProvider');

  return value;
}
