// Pure module: no React Native imports, so it can be unit-tested directly.
//
// Font scale, theme, bookmarks and the read articles belong to the app, not to the pages: both screens
// show the same values and they survive a restart. Keeping them in one reducer means the two screens
// cannot drift apart, and keeping it pure means the storage binding is a detail the UI layer supplies.
//
// Actions that change nothing return the *same* state object. The UI uses that to decide whether an
// `app:*` event has to be sent to a page at all, and the pages count every event they receive.

export type Theme = 'light' | 'dark';

export type AppState = {
  fontScale: number;
  theme: Theme;
  bookmarks: string[];
  read: string[];
};

export type AppAction =
  | { type: 'hydrate'; state: AppState }
  | { type: 'fontScaleUp' }
  | { type: 'fontScaleDown' }
  | { type: 'setTheme'; value: Theme }
  | { type: 'toggleBookmark'; id: string }
  | { type: 'markRead'; id: string };

export const FONT_SCALE_STEP = 0.1;
export const FONT_SCALE_MIN = 0.8;
export const FONT_SCALE_MAX = 1.6;

/** How many read articles are kept. The strip shows five; the rest is history for the front page. */
export const MAX_READ = 500;

/** The pages start dark, so the app starts dark too and the first paint matches. */
export const INITIAL_STATE: AppState = {
  fontScale: 1,
  theme: 'dark',
  bookmarks: [],
  read: [],
};

/** The storage key. Versioned, so a future shape change cannot be read as this one. */
export const STORAGE_KEY = 'news-app/state/v1';

const STATE_VERSION = 1;

/** The slice of AsyncStorage this module needs, so tests can pass a fake. */
export type StorageLike = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export function reduce(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'hydrate':
      return sameOrNext(state, action.state);
    case 'fontScaleUp':
      return withFontScale(state, state.fontScale + FONT_SCALE_STEP);
    case 'fontScaleDown':
      return withFontScale(state, state.fontScale - FONT_SCALE_STEP);
    case 'setTheme':
      return state.theme === action.value ? state : { ...state, theme: action.value };
    case 'toggleBookmark':
      return { ...state, bookmarks: toggle(state.bookmarks, action.id) };
    case 'markRead':
      return withRead(state, action.id);
    default:
      return state;
  }
}

/** The most recently read articles, newest first. */
export function recentlyRead(state: AppState, limit: number): string[] {
  return state.read.slice(0, Math.max(0, limit));
}

export function isBookmarked(state: AppState, id: string): boolean {
  return state.bookmarks.includes(id);
}

export function serializeState(state: AppState): string {
  return JSON.stringify({ version: STATE_VERSION, ...state });
}

/**
 * Reads stored state, falling back to the default **per field**: one corrupt value never costs the
 * reader their bookmarks as well.
 */
export function deserializeState(raw: string | null): AppState {
  if (raw === null) return INITIAL_STATE;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return INITIAL_STATE;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return INITIAL_STATE;

  const record = parsed as Record<string, unknown>;
  if (record.version !== STATE_VERSION) return INITIAL_STATE;

  return {
    fontScale: isValidFontScale(record.fontScale) ? round(record.fontScale) : INITIAL_STATE.fontScale,
    theme: record.theme === 'light' || record.theme === 'dark' ? record.theme : INITIAL_STATE.theme,
    bookmarks: isStringList(record.bookmarks) ? unique(record.bookmarks) : INITIAL_STATE.bookmarks,
    read: isStringList(record.read) ? unique(record.read).slice(0, MAX_READ) : INITIAL_STATE.read,
  };
}

/** Never throws: storage that fails or holds nonsense simply means the defaults. */
export async function loadState(storage: StorageLike): Promise<AppState> {
  try {
    return deserializeState(await storage.getItem(STORAGE_KEY));
  } catch {
    return INITIAL_STATE;
  }
}

export async function saveState(storage: StorageLike, state: AppState): Promise<void> {
  await storage.setItem(STORAGE_KEY, serializeState(state));
}

function withFontScale(state: AppState, next: number): AppState {
  const clamped = round(Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, next)));

  return clamped === state.fontScale ? state : { ...state, fontScale: clamped };
}

/** One decimal, so stepping up and down many times cannot drift to 1.0000000000000002. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function toggle(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter(entry => entry !== id) : [...ids, id];
}

/** Most recent first, no duplicates, capped. Re-reading the newest article changes nothing. */
function withRead(state: AppState, id: string): AppState {
  if (state.read[0] === id) return state;

  const read = [id, ...state.read.filter(entry => entry !== id)].slice(0, MAX_READ);

  return { ...state, read };
}

function sameOrNext(state: AppState, next: AppState): AppState {
  const unchanged =
    state.fontScale === next.fontScale &&
    state.theme === next.theme &&
    sameList(state.bookmarks, next.bookmarks) &&
    sameList(state.read, next.read);

  return unchanged ? state : next;
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}

function isValidFontScale(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && value >= FONT_SCALE_MIN && value <= FONT_SCALE_MAX
  );
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string');
}

function unique(ids: string[]): string[] {
  return ids.filter((id, index) => ids.indexOf(id) === index);
}
