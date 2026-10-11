// The app's own state — font scale, theme, bookmarks, read articles — for both screens.
//
// Thin on purpose: every rule lives in `lib/appState`, which is pure and tested. This only binds it to
// React and to AsyncStorage.
//
// Children are rendered only once the stored state has been read. A page is told the state once, when
// it becomes ready, so if the app rendered defaults first the reader would see the wrong font size and
// the wrong theme for a moment and the page would count an extra event.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { ReactNode, createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { AppState, INITIAL_STATE, Theme, loadState, reduce, saveState } from '../lib/appState';
import { PageState } from '../lib/pageScripts';

export type AppStateActions = {
  fontScaleUp(): void;
  fontScaleDown(): void;
  setTheme(value: Theme): void;
  toggleBookmark(id: string): void;
  markRead(id: string): void;
};

export type AppStateContextValue = AppStateActions & {
  state: AppState;
};

const AppStateContext = createContext<AppStateContextValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const [hydrated, setHydrated] = useState(false);

  // Nothing is written back until the stored state has been read, or the first save would overwrite it.
  const canSave = useRef(false);

  useEffect(() => {
    let cancelled = false;

    void loadState(AsyncStorage).then(stored => {
      if (cancelled) return;

      setState(stored);
      canSave.current = true;
      setHydrated(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!canSave.current) return;

    void saveState(AsyncStorage, state);
  }, [state]);

  const actions = useMemo<AppStateActions>(
    () => ({
      fontScaleUp: () => setState(current => reduce(current, { type: 'fontScaleUp' })),
      fontScaleDown: () => setState(current => reduce(current, { type: 'fontScaleDown' })),
      setTheme: (value: Theme) => setState(current => reduce(current, { type: 'setTheme', value })),
      toggleBookmark: (id: string) => setState(current => reduce(current, { type: 'toggleBookmark', id })),
      markRead: (id: string) => setState(current => reduce(current, { type: 'markRead', id })),
    }),
    [],
  );

  const value = useMemo<AppStateContextValue>(() => ({ state, ...actions }), [state, actions]);

  if (!hydrated) return null;

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateContextValue {
  const value = useContext(AppStateContext);
  if (!value) throw new Error('useAppState must be used inside an AppStateProvider');

  return value;
}

/** The slice the pages are told about, in the shape `lib/pageScripts` expects. */
export function usePageState(): PageState {
  const { state } = useAppState();

  return useMemo(
    () => ({
      fontScale: state.fontScale,
      theme: state.theme,
      bookmarks: state.bookmarks,
      read: state.read,
    }),
    [state.fontScale, state.theme, state.bookmarks, state.read],
  );
}
