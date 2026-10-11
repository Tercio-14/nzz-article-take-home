import { parseWebViewMessage } from './messages';

const json = (value: unknown): string => JSON.stringify(value);

describe('parseWebViewMessage', () => {
  describe('ready', () => {
    it('reads a front page ready', () => {
      expect(parseWebViewMessage(json({ type: 'ready', protocol: 1, page: 'front' }))).toEqual({
        kind: 'ready',
        page: 'front',
      });
    });

    it('reads an article ready with its article id', () => {
      expect(parseWebViewMessage(json({ type: 'ready', protocol: 1, page: 'article', articleId: '3' }))).toEqual({
        kind: 'ready',
        page: 'article',
        articleId: '3',
      });
    });

    it('ignores an article ready with no article id, which cannot be attributed', () => {
      expect(parseWebViewMessage(json({ type: 'ready', protocol: 1, page: 'article' }))).toEqual({ kind: 'ignored' });
    });

    it('ignores an article ready with an empty article id', () => {
      const raw = json({ type: 'ready', protocol: 1, page: 'article', articleId: '' });

      expect(parseWebViewMessage(raw)).toEqual({ kind: 'ignored' });
    });

    it('ignores a ready announcing a protocol the app does not speak', () => {
      expect(parseWebViewMessage(json({ type: 'ready', protocol: 2, page: 'front' }))).toEqual({ kind: 'ignored' });
    });

    it('ignores a ready with a page the protocol does not define', () => {
      expect(parseWebViewMessage(json({ type: 'ready', protocol: 1, page: 'saved' }))).toEqual({ kind: 'ignored' });
    });
  });

  describe('height', () => {
    it('reads a numeric height', () => {
      expect(parseWebViewMessage(json({ type: 'height', value: 1234 }))).toEqual({ kind: 'height', value: 1234 });
    });

    it('accepts a height of zero, which is a legitimate measurement', () => {
      expect(parseWebViewMessage(json({ type: 'height', value: 0 }))).toEqual({ kind: 'height', value: 0 });
    });

    it("ignores the pages' bogus {value:'auto'} height", () => {
      expect(parseWebViewMessage(json({ type: 'height', value: 'auto' }))).toEqual({ kind: 'ignored' });
    });

    it('ignores a negative height, which cannot size a view', () => {
      expect(parseWebViewMessage(json({ type: 'height', value: -1 }))).toEqual({ kind: 'ignored' });
    });

    it('ignores a boolean height', () => {
      expect(parseWebViewMessage(json({ type: 'height', value: true }))).toEqual({ kind: 'ignored' });
    });

    it('ignores NaN and Infinity, which JSON delivers as null but a bridge may not', () => {
      expect(parseWebViewMessage('{"type":"height","value":NaN}')).toEqual({ kind: 'ignored' });
      expect(parseWebViewMessage('{"type":"height","value":Infinity}')).toEqual({ kind: 'ignored' });
      expect(parseWebViewMessage(json({ type: 'height', value: null }))).toEqual({ kind: 'ignored' });
    });
  });

  describe('toggleBookmark', () => {
    it('reads a bookmark tap from inside the page', () => {
      expect(parseWebViewMessage(json({ type: 'toggleBookmark', articleId: '7' }))).toEqual({
        kind: 'toggleBookmark',
        articleId: '7',
      });
    });

    it('ignores a bookmark tap with no article id', () => {
      expect(parseWebViewMessage(json({ type: 'toggleBookmark' }))).toEqual({ kind: 'ignored' });
    });
  });

  describe('openArticle', () => {
    it('reads a teaser tap and keeps the query string, which has to travel with the article', () => {
      expect(parseWebViewMessage(json({ type: 'openArticle', path: '/article/3?ref=teaser' }))).toEqual({
        kind: 'openArticle',
        path: '/article/3?ref=teaser',
      });
    });

    it('rejects a protocol-relative path, which would leave the server', () => {
      expect(parseWebViewMessage(json({ type: 'openArticle', path: '//evil.com' }))).toEqual({ kind: 'ignored' });
    });

    it('rejects an absolute URL, because the protocol says path', () => {
      const raw = json({ type: 'openArticle', path: 'https://evil.com/article/1' });

      expect(parseWebViewMessage(raw)).toEqual({ kind: 'ignored' });
    });

    it('ignores a teaser tap with no path', () => {
      expect(parseWebViewMessage(json({ type: 'openArticle' }))).toEqual({ kind: 'ignored' });
    });
  });

  describe('tracker', () => {
    it('passes a tracker command through whole, because the SDK does its own filtering', () => {
      const raw = json({ command: 'trackPageView', event: { pageUrl: 'http://x/front' }, context: [] });

      expect(parseWebViewMessage(raw)).toEqual({ kind: 'tracker', raw });
    });

    it('recognises the tracker before the type, so a message carrying both goes to the SDK', () => {
      const raw = json({ command: 'trackScreenView', type: 'height', value: 10 });

      expect(parseWebViewMessage(raw)).toEqual({ kind: 'tracker', raw });
    });

    it('ignores a non-string command', () => {
      expect(parseWebViewMessage(json({ command: 7 }))).toEqual({ kind: 'ignored' });
    });
  });

  describe('noise the pages put on the shared channel', () => {
    it("ignores the bare string 'tp:heartbeat', which is not JSON at all", () => {
      expect(parseWebViewMessage('tp:heartbeat')).toEqual({ kind: 'ignored' });
    });

    it('ignores an ad viewability ping', () => {
      expect(parseWebViewMessage(json({ type: 'ad:viewable', slot: 'top' }))).toEqual({ kind: 'ignored' });
    });

    it('ignores a metrics message, which has an event rather than a type', () => {
      expect(parseWebViewMessage(json({ event: 'metrics', at: 1 }))).toEqual({ kind: 'ignored' });
    });

    it('ignores invalid JSON without throwing', () => {
      expect(parseWebViewMessage('{not json')).toEqual({ kind: 'ignored' });
    });

    it('ignores JSON that is not an object', () => {
      expect(parseWebViewMessage(json([1, 2]))).toEqual({ kind: 'ignored' });
      expect(parseWebViewMessage(json(null))).toEqual({ kind: 'ignored' });
      expect(parseWebViewMessage(json(7))).toEqual({ kind: 'ignored' });
      expect(parseWebViewMessage(json('a string'))).toEqual({ kind: 'ignored' });
    });

    it('ignores a non-string input, because onMessage always hands over a string', () => {
      expect(parseWebViewMessage(undefined)).toEqual({ kind: 'ignored' });
      expect(parseWebViewMessage({ type: 'ready' })).toEqual({ kind: 'ignored' });
    });

    it('ignores an object with no type at all', () => {
      expect(parseWebViewMessage(json({ hello: 'world' }))).toEqual({ kind: 'ignored' });
    });
  });
});
