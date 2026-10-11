import { parseUrl } from './parseUrl';

describe('parseUrl', () => {
  it('splits an article URL with a query string and a consent fragment', () => {
    expect(parseUrl('http://localhost:8787/article/3?ref=teaser#consent=abc')).toEqual({
      scheme: 'http',
      host: 'localhost',
      port: '8787',
      origin: 'http://localhost:8787',
      path: '/article/3',
      query: 'ref=teaser',
      hash: 'consent=abc',
    });
  });

  it('splits the Android emulator address, where the host reaches the fixture server', () => {
    expect(parseUrl('http://10.0.2.2:8787/front')).toEqual({
      scheme: 'http',
      host: '10.0.2.2',
      port: '8787',
      origin: 'http://10.0.2.2:8787',
      path: '/front',
      query: '',
      hash: '',
    });
  });

  it('reads a relative path with an empty scheme and origin, so links in a page can be classified', () => {
    expect(parseUrl('/article/2?ref=related')).toEqual({
      scheme: '',
      host: '',
      port: '',
      origin: '',
      path: '/article/2',
      query: 'ref=related',
      hash: '',
    });
  });

  it('treats mailto: as opaque, with the address as the path and no origin', () => {
    expect(parseUrl('mailto:x@y.z')).toMatchObject({ scheme: 'mailto', host: '', origin: '', path: 'x@y.z' });
  });

  it('treats tel: as opaque', () => {
    expect(parseUrl('tel:+1')).toMatchObject({ scheme: 'tel', host: '', origin: '', path: '+1' });
  });

  it('treats about:blank as opaque', () => {
    expect(parseUrl('about:blank')).toMatchObject({ scheme: 'about', host: '', origin: '', path: 'blank' });
  });

  it('treats a data: URL as opaque and keeps its payload in the path', () => {
    expect(parseUrl('data:text/html,<p>hi</p>')).toMatchObject({
      scheme: 'data',
      host: '',
      origin: '',
      path: 'text/html,<p>hi</p>',
    });
  });

  it('lowercases the scheme, because schemes are case-insensitive', () => {
    expect(parseUrl('HTTPS://example.org/x')?.scheme).toBe('https');
  });

  it('omits the port from the origin when none is written, rather than inferring a default', () => {
    expect(parseUrl('https://example.org/x')).toMatchObject({ port: '', origin: 'https://example.org' });
  });

  it('keeps an empty path when the URL is a bare origin', () => {
    expect(parseUrl('http://localhost:8787')).toMatchObject({ origin: 'http://localhost:8787', path: '' });
  });

  it('keeps an empty query when a URL ends in a bare question mark', () => {
    expect(parseUrl('http://localhost:8787/front?')).toMatchObject({ query: '', path: '/front' });
  });

  it('keeps an empty hash when a URL ends in a bare hash', () => {
    expect(parseUrl('http://localhost:8787/front#')).toMatchObject({ hash: '', path: '/front' });
  });

  it('does not treat a question mark inside the fragment as the query', () => {
    expect(parseUrl('http://localhost:8787/front#a?b')).toMatchObject({ query: '', hash: 'a?b' });
  });

  it('keeps an IPv6 literal intact, brackets included', () => {
    expect(parseUrl('http://[::1]:8787/front')).toMatchObject({
      host: '[::1]',
      port: '8787',
      origin: 'http://[::1]:8787',
    });
  });

  it('returns null for an empty or blank string, which cannot be a URL', () => {
    expect(parseUrl('')).toBeNull();
    expect(parseUrl('   ')).toBeNull();
  });

  it('returns null for a malformed scheme', () => {
    expect(parseUrl('://x')).toBeNull();
  });
});
