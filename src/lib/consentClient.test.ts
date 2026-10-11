import { CONSENT_ABORT_MS, FetchLike, ResponseLike, fetchConsent } from './consentClient';

const BASE = 'http://localhost:8787';

const respond = (status: number, body: unknown): ResponseLike => ({
  status,
  async json() {
    return body;
  },
});

/** A fetch that answers after a delay, the way the fixture server does. */
const after = (ms: number, response: ResponseLike): FetchLike =>
  () =>
    new Promise(resolve => setTimeout(() => resolve(response), ms));

describe('fetchConsent', () => {
  it('asks the consent service on the configured server', async () => {
    const urls: string[] = [];
    const fetchFn: FetchLike = async url => {
      urls.push(url);

      return respond(200, { consent: 'cs1-ab' });
    };

    await fetchConsent(fetchFn, BASE);

    expect(urls).toEqual([`${BASE}/consent`]);
  });

  it('normalises a trailing slash on the base address', async () => {
    const urls: string[] = [];
    const fetchFn: FetchLike = async url => {
      urls.push(url);

      return respond(200, { consent: null });
    };

    await fetchConsent(fetchFn, `${BASE}/`);

    expect(urls).toEqual([`${BASE}/consent`]);
  });

  it('reads the consent string the reader chose', async () => {
    const answer = await fetchConsent(async () => respond(200, { consent: 'cs1-ab' }), BASE);

    expect(answer).toEqual({ kind: 'answer', consent: 'cs1-ab' });
  });

  it('reads null as a real answer, meaning the reader has not chosen yet', async () => {
    const answer = await fetchConsent(async () => respond(200, { consent: null }), BASE);

    expect(answer).toEqual({ kind: 'answer', consent: null });
  });

  it('fails on a server error, rather than guessing', async () => {
    const answer = await fetchConsent(async () => respond(500, { error: 'unavailable' }), BASE);

    expect(answer).toEqual({ kind: 'failed' });
  });

  it('fails on any other non-2xx status', async () => {
    expect(await fetchConsent(async () => respond(404, {}), BASE)).toEqual({ kind: 'failed' });
    expect(await fetchConsent(async () => respond(302, {}), BASE)).toEqual({ kind: 'failed' });
  });

  it('accepts any 2xx status', async () => {
    const answer = await fetchConsent(async () => respond(204, { consent: 'cs1-ab' }), BASE);

    expect(answer).toEqual({ kind: 'answer', consent: 'cs1-ab' });
  });

  it('fails when the network throws', async () => {
    const answer = await fetchConsent(async () => {
      throw new Error('network down');
    }, BASE);

    expect(answer).toEqual({ kind: 'failed' });
  });

  it('fails when the body is not JSON', async () => {
    const fetchFn: FetchLike = async () => ({
      status: 200,
      async json() {
        throw new SyntaxError('Unexpected token');
      },
    });

    expect(await fetchConsent(fetchFn, BASE)).toEqual({ kind: 'failed' });
  });

  it('fails when the consent field is missing', async () => {
    expect(await fetchConsent(async () => respond(200, {}), BASE)).toEqual({ kind: 'failed' });
  });

  it('fails when the consent field is the wrong type', async () => {
    expect(await fetchConsent(async () => respond(200, { consent: 7 }), BASE)).toEqual({ kind: 'failed' });
    expect(await fetchConsent(async () => respond(200, { consent: true }), BASE)).toEqual({ kind: 'failed' });
    expect(await fetchConsent(async () => respond(200, { consent: ['a'] }), BASE)).toEqual({ kind: 'failed' });
  });

  it('fails on an empty consent string, which the pages could not use', async () => {
    expect(await fetchConsent(async () => respond(200, { consent: '' }), BASE)).toEqual({ kind: 'failed' });
  });

  it('fails when the body is not an object at all', async () => {
    expect(await fetchConsent(async () => respond(200, null), BASE)).toEqual({ kind: 'failed' });
    expect(await fetchConsent(async () => respond(200, 'cs1-ab'), BASE)).toEqual({ kind: 'failed' });
    expect(await fetchConsent(async () => respond(200, [{ consent: 'cs1-ab' }]), BASE)).toEqual({
      kind: 'failed',
    });
  });

  describe('slow and hung requests', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('still takes an answer that arrives long after the five-second gate', async () => {
      const pending = fetchConsent(after(8000, respond(200, { consent: 'cs1-ab' })), BASE);

      jest.advanceTimersByTime(8000);

      await expect(pending).resolves.toEqual({ kind: 'answer', consent: 'cs1-ab' });
    });

    it('abandons a request that hangs, so hung requests cannot pile up', async () => {
      const neverAnswers: FetchLike = (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });

      const pending = fetchConsent(neverAnswers, BASE);

      jest.advanceTimersByTime(CONSENT_ABORT_MS);

      await expect(pending).resolves.toEqual({ kind: 'failed' });
    });

    it('does not abandon a request before the abort deadline', async () => {
      const pending = fetchConsent(after(CONSENT_ABORT_MS - 1, respond(200, { consent: 'late' })), BASE);

      jest.advanceTimersByTime(CONSENT_ABORT_MS - 1);

      await expect(pending).resolves.toEqual({ kind: 'answer', consent: 'late' });
    });

    it('waits far longer than the five-second gate, which the caller runs separately', () => {
      expect(CONSENT_ABORT_MS).toBeGreaterThan(5000);
    });
  });
});
