import { articleIdFromPath, classifyNavigation, createOpenArticleDeduper } from './links';

const BASE = 'http://localhost:8787';
const ARTICLE_URL = `${BASE}/article/1`;

const classify = (url: string, currentUrl = ARTICLE_URL, isTopFrame?: boolean) =>
  classifyNavigation({ url, baseOrigin: BASE, currentUrl, isTopFrame });

describe('classifyNavigation', () => {
  describe('articles on the server', () => {
    it('pushes a screen for a related link and keeps its query string', () => {
      expect(classify(`${BASE}/article/2?ref=related`)).toEqual({
        action: 'openArticle',
        path: '/article/2?ref=related',
        articleId: '2',
      });
    });

    it('pushes a screen for the teaser link', () => {
      expect(classify(`${BASE}/article/3?ref=teaser`)).toEqual({
        action: 'openArticle',
        path: '/article/3?ref=teaser',
        articleId: '3',
      });
    });

    it('drops the fragment, because the app decides what consent the next load carries', () => {
      expect(classify(`${BASE}/article/2?ref=related#consent=old`)).toEqual({
        action: 'openArticle',
        path: '/article/2?ref=related',
        articleId: '2',
      });
    });

    it('pushes a screen for an article with no query string', () => {
      expect(classify(`${BASE}/article/7`)).toEqual({
        action: 'openArticle',
        path: '/article/7',
        articleId: '7',
      });
    });

    it('treats a relative article link as being on the server it came from', () => {
      expect(classify('/article/2?ref=related')).toEqual({
        action: 'openArticle',
        path: '/article/2?ref=related',
        articleId: '2',
      });
    });

    it('treats the same article with a different query as a different page', () => {
      const decision = classifyNavigation({
        url: `${BASE}/article/1?ref=more`,
        baseOrigin: BASE,
        currentUrl: `${BASE}/article/1?ref=front`,
      });

      expect(decision).toEqual({ action: 'openArticle', path: '/article/1?ref=more', articleId: '1' });
    });
  });

  describe('navigation the page handles itself', () => {
    it('allows the load the web view was opened for', () => {
      expect(classify(ARTICLE_URL)).toEqual({ action: 'allow' });
    });

    it('allows a hash-only change, which is the contents links and the Jump button', () => {
      expect(classify(`${ARTICLE_URL}#related`)).toEqual({ action: 'allow' });
    });

    it('allows a reload of the same page carrying a consent fragment', () => {
      expect(classify(`${ARTICLE_URL}#consent=cs1-ab`)).toEqual({ action: 'allow' });
    });

    it('allows a hash change when the current URL already has one', () => {
      expect(classify(`${ARTICLE_URL}#summary`, `${ARTICLE_URL}#related`)).toEqual({ action: 'allow' });
    });

    it('allows a hash change on a page that has a query string', () => {
      const url = `${BASE}/article/1?ref=front`;

      expect(classify(`${url}#related`, url)).toEqual({ action: 'allow' });
    });

    it('allows about:blank', () => {
      expect(classify('about:blank')).toEqual({ action: 'allow' });
    });

    it('allows a data: URL, which never leaves the page', () => {
      expect(classify('data:text/html,<p>hi</p>')).toEqual({ action: 'allow' });
    });

    it('allows anything in a subframe, because a subframe never drives the app', () => {
      expect(classify('https://ads.example.org/banner', ARTICLE_URL, false)).toEqual({ action: 'allow' });
    });

    it('allows an article link in a subframe too, rather than pushing a screen', () => {
      expect(classify(`${BASE}/article/2`, ARTICLE_URL, false)).toEqual({ action: 'allow' });
    });
  });

  describe('everything the operating system should handle', () => {
    it('sends another origin outside', () => {
      expect(classify('https://example.org/x')).toEqual({ action: 'external' });
    });

    it('sends mailto: outside', () => {
      expect(classify('mailto:newsdesk@example.org')).toEqual({ action: 'external' });
    });

    it('sends tel: outside', () => {
      expect(classify('tel:+41000000000')).toEqual({ action: 'external' });
    });

    it('sends another path on the server outside, because only articles get a screen', () => {
      expect(classify(`${BASE}/front`)).toEqual({ action: 'external' });
    });

    it('sends a nested article path outside, because the id must not contain a slash', () => {
      expect(classify(`${BASE}/article/2/comments`)).toEqual({ action: 'external' });
    });

    it('sends an article on a look-alike origin outside', () => {
      expect(classify('http://localhost.example.org:8787/article/9')).toEqual({ action: 'external' });
    });

    it('sends the same path on a different port outside', () => {
      expect(classify('http://localhost:9999/article/2')).toEqual({ action: 'external' });
    });
  });
});

describe('createOpenArticleDeduper', () => {
  it('opens the first time a path is seen', () => {
    const deduper = createOpenArticleDeduper(1000, () => 0);

    expect(deduper.shouldOpen('/article/3?ref=teaser')).toBe(true);
  });

  it('suppresses the second signal for the same path inside the window', () => {
    let clock = 0;
    const deduper = createOpenArticleDeduper(1000, () => clock);

    expect(deduper.shouldOpen('/article/3?ref=teaser')).toBe(true);

    clock = 50;

    expect(deduper.shouldOpen('/article/3?ref=teaser')).toBe(false);
  });

  it('opens again once the window has passed, because that is a new tap', () => {
    let clock = 0;
    const deduper = createOpenArticleDeduper(1000, () => clock);

    deduper.shouldOpen('/article/3?ref=teaser');
    clock = 1000;

    expect(deduper.shouldOpen('/article/3?ref=teaser')).toBe(true);
  });

  it('does not suppress a different article tapped immediately after', () => {
    let clock = 0;
    const deduper = createOpenArticleDeduper(1000, () => clock);

    deduper.shouldOpen('/article/3?ref=teaser');
    clock = 10;

    expect(deduper.shouldOpen('/article/2?ref=related')).toBe(true);
  });

  it('treats the same article with a different query as a different path', () => {
    let clock = 0;
    const deduper = createOpenArticleDeduper(1000, () => clock);

    deduper.shouldOpen('/article/3?ref=teaser');
    clock = 10;

    expect(deduper.shouldOpen('/article/3?ref=more')).toBe(true);
  });
});

describe('articleIdFromPath', () => {
  it('reads the id from a plain article path', () => {
    expect(articleIdFromPath('/article/3')).toBe('3');
  });

  it('reads the id when a query string travels with it', () => {
    expect(articleIdFromPath('/article/3?ref=teaser')).toBe('3');
  });

  it('ignores a fragment', () => {
    expect(articleIdFromPath('/article/2#related')).toBe('2');
  });

  it('accepts an id that is not a number', () => {
    expect(articleIdFromPath('/article/a-slug-id')).toBe('a-slug-id');
  });

  it('returns null for the front page', () => {
    expect(articleIdFromPath('/front')).toBeNull();
  });

  it('returns null for a nested path, because the id must not contain a slash', () => {
    expect(articleIdFromPath('/article/2/comments')).toBeNull();
  });

  it('returns null for an empty path', () => {
    expect(articleIdFromPath('')).toBeNull();
  });
});
