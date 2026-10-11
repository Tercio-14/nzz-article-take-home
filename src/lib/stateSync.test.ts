import { PageState } from './pageScripts';
import { SentState, planStateUpdates } from './stateSync';

const STATE: PageState = { fontScale: 1, theme: 'dark', bookmarks: ['1'], read: ['2'] };

const sentFor = (state: PageState, insets?: { top: number; bottom: number }): SentState => ({
  fontScale: state.fontScale,
  theme: state.theme,
  bookmarks: [...state.bookmarks],
  read: [...state.read],
  ...(insets ? { insets } : {}),
});

const names = (state: PageState, last: SentState | null, page: 'front' | 'article', insets?: { top: number; bottom: number }) =>
  planStateUpdates(last, state, page, insets).events.map(event => event.name);

describe('planStateUpdates', () => {
  describe('the first send', () => {
    it('gives the front page the full set, in protocol order', () => {
      const { events } = planStateUpdates(null, STATE, 'front');

      expect(events).toEqual([
        { name: 'app:fontScale', detail: { value: 1 } },
        { name: 'app:theme', detail: { value: 'dark' } },
        { name: 'app:bookmarks', detail: { ids: ['1'] } },
        { name: 'app:read', detail: { ids: ['2'] } },
      ]);
    });

    it('gives an article the full set with insets and never the read list', () => {
      const { events } = planStateUpdates(null, STATE, 'article', { top: 96, bottom: 34 });

      expect(events).toEqual([
        { name: 'app:fontScale', detail: { value: 1 } },
        { name: 'app:theme', detail: { value: 'dark' } },
        { name: 'app:bookmarks', detail: { ids: ['1'] } },
        { name: 'app:insets', detail: { top: 96, bottom: 34 } },
      ]);
    });

    it('leaves insets out of an article when none are known yet', () => {
      expect(names(STATE, null, 'article')).toEqual(['app:fontScale', 'app:theme', 'app:bookmarks']);
    });
  });

  describe('afterwards', () => {
    it('sends nothing when nothing changed, so the page count stays right', () => {
      const { events } = planStateUpdates(sentFor(STATE), STATE, 'front');

      expect(events).toEqual([]);
    });

    it('sends one event for one change', () => {
      const changed: PageState = { ...STATE, fontScale: 1.1 };

      expect(planStateUpdates(sentFor(STATE), changed, 'front').events).toEqual([
        { name: 'app:fontScale', detail: { value: 1.1 } },
      ]);
    });

    it('sends only the theme when only the theme changed', () => {
      const changed: PageState = { ...STATE, theme: 'light' };

      expect(names(changed, sentFor(STATE), 'front')).toEqual(['app:theme']);
    });

    it('compares bookmarks by content, so a new array with the same ids sends nothing', () => {
      const changed: PageState = { ...STATE, bookmarks: ['1'] };

      expect(planStateUpdates(sentFor(STATE), changed, 'front').events).toEqual([]);
    });

    it('sends bookmarks when their content really changed', () => {
      const changed: PageState = { ...STATE, bookmarks: ['1', '3'] };

      expect(names(changed, sentFor(STATE), 'front')).toEqual(['app:bookmarks']);
    });

    it('sends bookmarks when one is removed', () => {
      const changed: PageState = { ...STATE, bookmarks: [] };

      expect(names(changed, sentFor(STATE), 'front')).toEqual(['app:bookmarks']);
    });

    it('notices a reordering of the read list, because most recent first is meaningful', () => {
      const last = sentFor({ ...STATE, read: ['1', '2'] });
      const changed: PageState = { ...STATE, read: ['2', '1'] };

      expect(names(changed, last, 'front')).toEqual(['app:read']);
    });

    it('never sends the read list to an article page, which has no listener for it', () => {
      const changed: PageState = { ...STATE, read: ['9', '2'] };

      expect(planStateUpdates(sentFor(STATE), changed, 'article').events).toEqual([]);
    });

    it('sends insets to an article when they change, for example on rotation', () => {
      const last = sentFor(STATE, { top: 96, bottom: 34 });

      expect(planStateUpdates(last, STATE, 'article', { top: 120, bottom: 34 }).events).toEqual([
        { name: 'app:insets', detail: { top: 120, bottom: 34 } },
      ]);
    });

    it('does not send insets that are unchanged', () => {
      const last = sentFor(STATE, { top: 96, bottom: 34 });

      expect(planStateUpdates(last, STATE, 'article', { top: 96, bottom: 34 }).events).toEqual([]);
    });

    it('never sends insets to the front page, which does not use them', () => {
      const last = sentFor(STATE);

      expect(planStateUpdates(last, STATE, 'front', { top: 96, bottom: 34 }).events).toEqual([]);
    });

    it('sends several events when several things changed at once', () => {
      const changed: PageState = { fontScale: 1.2, theme: 'light', bookmarks: ['9'], read: ['2'] };

      expect(names(changed, sentFor(STATE), 'front')).toEqual([
        'app:fontScale',
        'app:theme',
        'app:bookmarks',
      ]);
    });
  });

  describe('nextSent', () => {
    it('equals the current state, so the next call compares against what was just sent', () => {
      const { nextSent } = planStateUpdates(null, STATE, 'front');

      expect(nextSent).toEqual({ fontScale: 1, theme: 'dark', bookmarks: ['1'], read: ['2'] });
    });

    it('records the insets it sent to an article', () => {
      const { nextSent } = planStateUpdates(null, STATE, 'article', { top: 96, bottom: 34 });

      expect(nextSent.insets).toEqual({ top: 96, bottom: 34 });
    });

    it('copies the lists, so a later mutation of the state cannot corrupt the comparison', () => {
      const bookmarks = ['1'];
      const { nextSent } = planStateUpdates(null, { ...STATE, bookmarks }, 'front');

      bookmarks.push('tampered');

      expect(nextSent.bookmarks).toEqual(['1']);
    });

    it('feeds back into a second call that then reports no change', () => {
      const first = planStateUpdates(null, STATE, 'front');
      const second = planStateUpdates(first.nextSent, STATE, 'front');

      expect(second.events).toEqual([]);
    });
  });
});
