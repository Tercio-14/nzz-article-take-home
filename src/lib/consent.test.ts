import {
  CONSENT_TIMEOUT_MS,
  ConsentState,
  INITIAL_CONSENT,
  buildPageUrl,
  decideOnConsentChange,
  reduceConsent,
} from './consent';

const BASE = 'http://localhost:8787';

describe('reduceConsent', () => {
  it('waits before any answer, so no page loads with the wrong consent', () => {
    expect(INITIAL_CONSENT).toEqual({ value: null, gateOpen: false });
  });

  it('waits five seconds, which is the rule the app follows', () => {
    expect(CONSENT_TIMEOUT_MS).toBe(5000);
  });

  it('opens the gate and keeps the string when the reader has chosen', () => {
    expect(reduceConsent(INITIAL_CONSENT, { type: 'ANSWER', consent: 'cs1-ab' })).toEqual({
      value: 'cs1-ab',
      gateOpen: true,
    });
  });

  it('opens the gate with no value when the reader has not chosen yet', () => {
    expect(reduceConsent(INITIAL_CONSENT, { type: 'ANSWER', consent: null })).toEqual({
      value: null,
      gateOpen: true,
    });
  });

  it('opens the gate on a failure, so the reader is not left waiting', () => {
    expect(reduceConsent(INITIAL_CONSENT, { type: 'FAILED' })).toEqual({ value: null, gateOpen: true });
  });

  it('opens the gate on the timeout', () => {
    expect(reduceConsent(INITIAL_CONSENT, { type: 'TIMEOUT' })).toEqual({ value: null, gateOpen: true });
  });

  it('takes a late answer after the timeout, because consent arriving later still counts', () => {
    const afterTimeout = reduceConsent(INITIAL_CONSENT, { type: 'TIMEOUT' });

    expect(reduceConsent(afterTimeout, { type: 'ANSWER', consent: 'cs2-cd' })).toEqual({
      value: 'cs2-cd',
      gateOpen: true,
    });
  });

  it('replaces a known string when the reader changes their choice', () => {
    const known: ConsentState = { value: 'cs1-ab', gateOpen: true };

    expect(reduceConsent(known, { type: 'ANSWER', consent: 'cs2-cd' }).value).toBe('cs2-cd');
  });

  it('keeps a known string when a later answer is null, which is the reader’s last known choice', () => {
    const known: ConsentState = { value: 'cs1-ab', gateOpen: true };

    expect(reduceConsent(known, { type: 'ANSWER', consent: null }).value).toBe('cs1-ab');
  });

  it('keeps a known string when a later request fails', () => {
    const known: ConsentState = { value: 'cs1-ab', gateOpen: true };

    expect(reduceConsent(known, { type: 'FAILED' })).toBe(known);
  });

  it('never closes the gate once it is open', () => {
    const open: ConsentState = { value: 'cs1-ab', gateOpen: true };

    expect(reduceConsent(open, { type: 'TIMEOUT' }).gateOpen).toBe(true);
    expect(reduceConsent(open, { type: 'FAILED' }).gateOpen).toBe(true);
    expect(reduceConsent(open, { type: 'ANSWER', consent: null }).gateOpen).toBe(true);
  });

  it('returns the same state when nothing changed', () => {
    const open: ConsentState = { value: 'cs1-ab', gateOpen: true };

    expect(reduceConsent(open, { type: 'ANSWER', consent: 'cs1-ab' })).toBe(open);
    expect(reduceConsent(open, { type: 'TIMEOUT' })).toBe(open);
  });

  it('never mutates the state it was given', () => {
    const before: ConsentState = { value: null, gateOpen: false };

    reduceConsent(before, { type: 'ANSWER', consent: 'cs1-ab' });

    expect(before).toEqual({ value: null, gateOpen: false });
  });
});

describe('buildPageUrl', () => {
  it('appends the consent string where the page reads it', () => {
    expect(buildPageUrl(BASE, '/front', 'cs1-ab')).toBe(`${BASE}/front#consent=cs1-ab`);
  });

  it('keeps the query string, which has to reach the page', () => {
    expect(buildPageUrl(BASE, '/article/2?ref=related', 'cs1-ab')).toBe(
      `${BASE}/article/2?ref=related#consent=cs1-ab`,
    );
  });

  it('leaves the URL bare when there is no consent, so the page shows an empty ad slot', () => {
    expect(buildPageUrl(BASE, '/front', null)).toBe(`${BASE}/front`);
  });

  it('treats an empty consent string as no consent', () => {
    expect(buildPageUrl(BASE, '/front', '')).toBe(`${BASE}/front`);
  });

  it('normalises a trailing slash on the base address', () => {
    expect(buildPageUrl(`${BASE}/`, '/front', null)).toBe(`${BASE}/front`);
    expect(buildPageUrl(`${BASE}///`, '/front', null)).toBe(`${BASE}/front`);
  });

  it('drops a fragment already on the path, because the app owns the fragment', () => {
    expect(buildPageUrl(BASE, '/article/2#related', 'cs1-ab')).toBe(`${BASE}/article/2#consent=cs1-ab`);
  });

  it('drops an old consent fragment rather than appending a second one', () => {
    expect(buildPageUrl(BASE, '/front#consent=old', 'new')).toBe(`${BASE}/front#consent=new`);
  });

  it('escapes characters that would otherwise break the fragment', () => {
    expect(buildPageUrl(BASE, '/front', 'a b&c=d#e')).toBe(`${BASE}/front#consent=a%20b%26c%3Dd%23e`);
  });
});

describe('decideOnConsentChange', () => {
  const context = (loadedWithConsent: string | null, alreadyReloadedForConsent = false) => ({
    loadedWithConsent,
    alreadyReloadedForConsent,
  });

  it('reloads a page that started without consent, so its ads can load', () => {
    expect(decideOnConsentChange(context(null), 'cs1-ab')).toBe('reload');
  });

  it('reloads only once, so a flapping consent service cannot loop the page', () => {
    expect(decideOnConsentChange(context(null, true), 'cs1-ab')).toBe('keep');
  });

  it('keeps a page that already had consent, even when the string changes', () => {
    expect(decideOnConsentChange(context('cs1-ab'), 'cs2-cd')).toBe('keep');
  });

  it('keeps the page when the new answer is still null', () => {
    expect(decideOnConsentChange(context(null), null)).toBe('keep');
  });

  it('keeps the page when the new answer is an empty string, which is not a usable consent', () => {
    expect(decideOnConsentChange(context(null), '')).toBe('keep');
  });
});
