import { FetchLike, ResponseLike } from './consentClient';
import { createTitleLookup, fallbackTitle } from './articleTitles';

const BASE = 'http://localhost:8787';

const respond = (status: number, body: unknown): ResponseLike => ({
  status,
  async json() {
    return body;
  },
});

const manifest = (title: string) => respond(200, { articleId: '3', title, version: 'abc', files: [] });

describe('createTitleLookup', () => {
  it('reads the title from the article manifest', async () => {
    const lookup = createTitleLookup(async () => manifest('Bolsonaro-Clan'), BASE);

    await expect(lookup.titleFor('2')).resolves.toBe('Bolsonaro-Clan');
  });

  it('asks the manifest endpoint for that article', async () => {
    const urls: string[] = [];
    const fetchFn: FetchLike = async url => {
      urls.push(url);

      return manifest('A title');
    };

    await createTitleLookup(fetchFn, `${BASE}/`).titleFor('7');

    expect(urls).toEqual([`${BASE}/bundle/7/manifest.json`]);
  });

  it('caches a resolved title and never fetches it twice', async () => {
    let calls = 0;
    const lookup = createTitleLookup(async () => {
      calls += 1;

      return manifest('Once only');
    }, BASE);

    await lookup.titleFor('3');
    await lookup.titleFor('3');

    expect(calls).toBe(1);
  });

  it('joins a second request for the same id to the first rather than starting another', async () => {
    let calls = 0;
    const lookup = createTitleLookup(async () => {
      calls += 1;

      return manifest('Shared');
    }, BASE);

    const [first, second] = await Promise.all([lookup.titleFor('3'), lookup.titleFor('3')]);

    expect(calls).toBe(1);
    expect([first, second]).toEqual(['Shared', 'Shared']);
  });

  it('fetches different articles separately', async () => {
    const asked: string[] = [];
    const lookup = createTitleLookup(async url => {
      asked.push(url);

      return manifest('A title');
    }, BASE);

    await lookup.titleFor('1');
    await lookup.titleFor('2');

    expect(asked).toHaveLength(2);
  });

  it('falls back to a readable placeholder when the server errors', async () => {
    const lookup = createTitleLookup(async () => respond(500, {}), BASE);

    await expect(lookup.titleFor('4')).resolves.toBe('Article 4');
  });

  it('falls back when the article is unknown', async () => {
    const lookup = createTitleLookup(async () => respond(404, {}), BASE);

    await expect(lookup.titleFor('99')).resolves.toBe('Article 99');
  });

  it('falls back when the network throws, so the strip still renders', async () => {
    const lookup = createTitleLookup(async () => {
      throw new Error('offline');
    }, BASE);

    await expect(lookup.titleFor('5')).resolves.toBe('Article 5');
  });

  it('falls back when the body is not JSON', async () => {
    const lookup = createTitleLookup(
      async () => ({
        status: 200,
        async json() {
          throw new SyntaxError('bad');
        },
      }),
      BASE,
    );

    await expect(lookup.titleFor('6')).resolves.toBe('Article 6');
  });

  it('falls back when the manifest has no usable title', async () => {
    const missing = createTitleLookup(async () => respond(200, { version: 'abc' }), BASE);
    const empty = createTitleLookup(async () => respond(200, { title: '' }), BASE);
    const wrongType = createTitleLookup(async () => respond(200, { title: 7 }), BASE);

    await expect(missing.titleFor('1')).resolves.toBe('Article 1');
    await expect(empty.titleFor('1')).resolves.toBe('Article 1');
    await expect(wrongType.titleFor('1')).resolves.toBe('Article 1');
  });

  it('caches a fallback too, so a dead server is not retried on every render', async () => {
    let calls = 0;
    const lookup = createTitleLookup(async () => {
      calls += 1;

      return respond(500, {});
    }, BASE);

    await lookup.titleFor('4');
    await lookup.titleFor('4');

    expect(calls).toBe(1);
  });

  it('reports nothing cached before a lookup, and the title afterwards', async () => {
    const lookup = createTitleLookup(async () => manifest('Known'), BASE);

    expect(lookup.cached('3')).toBeUndefined();

    await lookup.titleFor('3');

    expect(lookup.cached('3')).toBe('Known');
  });
});

describe('fallbackTitle', () => {
  it('names the article by its id', () => {
    expect(fallbackTitle('8')).toBe('Article 8');
  });
});

describe('forget', () => {
  it('asks again for a title that failed, which is the point of a refresh', async () => {
    let failing = true;
    const lookup = createTitleLookup(
      async () => (failing ? respond(500, {}) : manifest('Now it works')),
      BASE,
    );

    await expect(lookup.titleFor('4')).resolves.toBe('Article 4');

    // Without forgetting, the placeholder would be served forever.
    failing = false;

    await expect(lookup.titleFor('4')).resolves.toBe('Article 4');

    lookup.forget();

    await expect(lookup.titleFor('4')).resolves.toBe('Now it works');
  });

  it('picks up a title that changed, for example after the article was republished', async () => {
    let title = 'First version';
    const lookup = createTitleLookup(async () => manifest(title), BASE);

    await lookup.titleFor('2');
    title = 'Second version';
    lookup.forget();

    await expect(lookup.titleFor('2')).resolves.toBe('Second version');
  });

  it('empties what it had cached', async () => {
    const lookup = createTitleLookup(async () => manifest('Known'), BASE);

    await lookup.titleFor('3');

    expect(lookup.cached('3')).toBe('Known');

    lookup.forget();

    expect(lookup.cached('3')).toBeUndefined();
  });

  it('does not let a request already in flight refill the cache it just cleared', async () => {
    // Definite assignment: the promise executor runs synchronously, so this is set before it is used.
    let release!: (value: ResponseLike) => void;
    const lookup = createTitleLookup(
      () =>
        new Promise<ResponseLike>(resolve => {
          release = resolve;
        }),
      BASE,
    );

    const pending = lookup.titleFor('5');

    lookup.forget();
    release(manifest('Stale answer'));
    await pending;

    expect(lookup.cached('5')).toBeUndefined();
  });

  it('is harmless when there is nothing cached yet', () => {
    const lookup = createTitleLookup(async () => manifest('Any'), BASE);

    expect(() => lookup.forget()).not.toThrow();
  });
});
