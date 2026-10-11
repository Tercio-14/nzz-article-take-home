import {
  AppState,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  INITIAL_STATE,
  MAX_READ,
  STORAGE_KEY,
  StorageLike,
  deserializeState,
  isBookmarked,
  loadState,
  recentlyRead,
  reduce,
  recentlyRead as selectRecentlyRead,
  saveState,
  serializeState,
} from './appState';

const stateWith = (overrides: Partial<AppState>): AppState => ({ ...INITIAL_STATE, ...overrides });

describe('reduce', () => {
  it('starts dark at scale 1 with nothing bookmarked or read, matching how the pages start', () => {
    expect(INITIAL_STATE).toEqual({ fontScale: 1, theme: 'dark', bookmarks: [], read: [] });
  });

  describe('font scale', () => {
    it('steps up by a tenth', () => {
      expect(reduce(INITIAL_STATE, { type: 'fontScaleUp' }).fontScale).toBe(1.1);
    });

    it('steps down by a tenth', () => {
      expect(reduce(INITIAL_STATE, { type: 'fontScaleDown' }).fontScale).toBe(0.9);
    });

    it('clamps at the maximum and returns the same state, so nothing is re-sent to the page', () => {
      const atMax = stateWith({ fontScale: FONT_SCALE_MAX });

      expect(reduce(atMax, { type: 'fontScaleUp' })).toBe(atMax);
    });

    it('clamps at the minimum and returns the same state', () => {
      const atMin = stateWith({ fontScale: FONT_SCALE_MIN });

      expect(reduce(atMin, { type: 'fontScaleDown' })).toBe(atMin);
    });

    it('does not drift after many steps up and down, because each result is rounded', () => {
      let state = INITIAL_STATE;

      for (let step = 0; step < 40; step += 1) state = reduce(state, { type: 'fontScaleUp' });
      for (let step = 0; step < 40; step += 1) state = reduce(state, { type: 'fontScaleDown' });

      expect(state.fontScale).toBe(FONT_SCALE_MIN);

      for (let step = 0; step < 2; step += 1) state = reduce(state, { type: 'fontScaleUp' });

      expect(state.fontScale).toBe(1);
    });

    it('reaches exactly the maximum when stepping up from the default', () => {
      let state = INITIAL_STATE;

      for (let step = 0; step < 6; step += 1) state = reduce(state, { type: 'fontScaleUp' });

      expect(state.fontScale).toBe(FONT_SCALE_MAX);
    });
  });

  describe('theme', () => {
    it('switches to light', () => {
      expect(reduce(INITIAL_STATE, { type: 'setTheme', value: 'light' }).theme).toBe('light');
    });

    it('returns the same state when the theme is already that value', () => {
      expect(reduce(INITIAL_STATE, { type: 'setTheme', value: 'dark' })).toBe(INITIAL_STATE);
    });
  });

  describe('bookmarks', () => {
    it('adds an article', () => {
      expect(reduce(INITIAL_STATE, { type: 'toggleBookmark', id: '3' }).bookmarks).toEqual(['3']);
    });

    it('removes an article that was already bookmarked', () => {
      const bookmarked = stateWith({ bookmarks: ['1', '3'] });

      expect(reduce(bookmarked, { type: 'toggleBookmark', id: '1' }).bookmarks).toEqual(['3']);
    });

    it('never mutates the state it was given', () => {
      const before = stateWith({ bookmarks: ['1'] });
      const snapshot = [...before.bookmarks];

      reduce(before, { type: 'toggleBookmark', id: '2' });

      expect(before.bookmarks).toEqual(snapshot);
    });
  });

  describe('read', () => {
    it('records a read article', () => {
      expect(reduce(INITIAL_STATE, { type: 'markRead', id: '4' }).read).toEqual(['4']);
    });

    it('puts the most recent first and keeps no duplicates', () => {
      let state = reduce(INITIAL_STATE, { type: 'markRead', id: '1' });
      state = reduce(state, { type: 'markRead', id: '2' });
      state = reduce(state, { type: 'markRead', id: '1' });

      expect(state.read).toEqual(['1', '2']);
    });

    it('returns the same state when the newest read article is read again', () => {
      const state = reduce(INITIAL_STATE, { type: 'markRead', id: '1' });

      expect(reduce(state, { type: 'markRead', id: '1' })).toBe(state);
    });

    it('caps the history, dropping the oldest', () => {
      let state = INITIAL_STATE;

      for (let index = 0; index < MAX_READ + 10; index += 1) {
        state = reduce(state, { type: 'markRead', id: `a${index}` });
      }

      expect(state.read).toHaveLength(MAX_READ);
      expect(state.read[0]).toBe(`a${MAX_READ + 9}`);
    });
  });

  describe('hydrate', () => {
    it('replaces the state', () => {
      const stored = stateWith({ theme: 'light', bookmarks: ['9'] });

      expect(reduce(INITIAL_STATE, { type: 'hydrate', state: stored })).toEqual(stored);
    });

    it('returns the same state when the stored values match, so nothing is re-sent', () => {
      const equal = stateWith({});

      expect(reduce(INITIAL_STATE, { type: 'hydrate', state: equal })).toBe(INITIAL_STATE);
    });
  });
});

describe('selectors', () => {
  it('lists the most recently read first, limited', () => {
    const state = stateWith({ read: ['5', '4', '3', '2', '1', '0'] });

    expect(recentlyRead(state, 5)).toEqual(['5', '4', '3', '2', '1']);
  });

  it('returns everything when fewer have been read than the limit', () => {
    expect(selectRecentlyRead(stateWith({ read: ['1'] }), 5)).toEqual(['1']);
  });

  it('reports whether an article is bookmarked', () => {
    const state = stateWith({ bookmarks: ['2'] });

    expect(isBookmarked(state, '2')).toBe(true);
    expect(isBookmarked(state, '3')).toBe(false);
  });
});

describe('serializeState and deserializeState', () => {
  it('round-trips a state', () => {
    const state = stateWith({ fontScale: 1.2, theme: 'light', bookmarks: ['1'], read: ['2'] });

    expect(deserializeState(serializeState(state))).toEqual(state);
  });

  it('returns the defaults when nothing is stored yet', () => {
    expect(deserializeState(null)).toEqual(INITIAL_STATE);
  });

  it('returns the defaults for unparseable storage', () => {
    expect(deserializeState('{not json')).toEqual(INITIAL_STATE);
  });

  it('returns the defaults for JSON that is not an object', () => {
    expect(deserializeState('[1,2]')).toEqual(INITIAL_STATE);
    expect(deserializeState('null')).toEqual(INITIAL_STATE);
  });

  it('returns the defaults when the stored version is not this one', () => {
    const old = JSON.stringify({ version: 0, fontScale: 1.4, theme: 'light', bookmarks: ['1'], read: [] });

    expect(deserializeState(old)).toEqual(INITIAL_STATE);
  });

  it('falls back per field, so one corrupt value does not cost the reader the others', () => {
    const partial = JSON.stringify({ version: 1, fontScale: 'big', theme: 'light', bookmarks: ['1'] });

    expect(deserializeState(partial)).toEqual({
      fontScale: 1,
      theme: 'light',
      bookmarks: ['1'],
      read: [],
    });
  });

  it('rejects a font scale outside the allowed range', () => {
    const tooBig = JSON.stringify({ version: 1, fontScale: 99, theme: 'dark', bookmarks: [], read: [] });

    expect(deserializeState(tooBig).fontScale).toBe(1);
  });

  it('rejects a list holding anything that is not a string', () => {
    const mixed = JSON.stringify({ version: 1, fontScale: 1, theme: 'dark', bookmarks: ['1', 2], read: [] });

    expect(deserializeState(mixed).bookmarks).toEqual([]);
  });

  it('removes duplicates that a corrupt write may have left behind', () => {
    const dupes = JSON.stringify({ version: 1, fontScale: 1, theme: 'dark', bookmarks: ['1', '1'], read: [] });

    expect(deserializeState(dupes).bookmarks).toEqual(['1']);
  });
});

describe('loadState and saveState', () => {
  const fakeStorage = (initial: string | null): StorageLike & { written: string | null } => ({
    written: null,
    async getItem() {
      return initial;
    },
    async setItem(_key, value) {
      this.written = value;
    },
  });

  it('loads what was saved', async () => {
    const state = stateWith({ theme: 'light' });
    const storage = fakeStorage(null);

    await saveState(storage, state);

    expect(deserializeState(storage.written)).toEqual(state);
  });

  it('writes under the versioned key', async () => {
    const keys: string[] = [];
    const storage: StorageLike = {
      async getItem() {
        return null;
      },
      async setItem(key) {
        keys.push(key);
      },
    };

    await saveState(storage, INITIAL_STATE);

    expect(keys).toEqual([STORAGE_KEY]);
  });

  it('returns the defaults when storage throws, rather than failing the launch', async () => {
    const storage: StorageLike = {
      async getItem() {
        throw new Error('storage unavailable');
      },
      async setItem() {
        // not reached
      },
    };

    await expect(loadState(storage)).resolves.toEqual(INITIAL_STATE);
  });

  it('returns the defaults when storage holds nonsense', async () => {
    await expect(loadState(fakeStorage('nonsense'))).resolves.toEqual(INITIAL_STATE);
  });
});
