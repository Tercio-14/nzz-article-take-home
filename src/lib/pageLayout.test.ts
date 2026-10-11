import { SessionPhase } from './pageSession';
import { overlayFor, pageAreaHeight } from './pageLayout';

const PHASES: SessionPhase[] = ['waiting-for-consent', 'loading', 'ready', 'error'];

describe('overlayFor', () => {
  it('shows the spinner while a page is loading', () => {
    expect(overlayFor({ phase: 'loading', showLoadingOverlay: true })).toBe('loading');
  });

  it('shows the spinner while waiting for the consent gate, when no page exists yet', () => {
    expect(overlayFor({ phase: 'waiting-for-consent', showLoadingOverlay: true })).toBe('loading');
  });

  it('shows nothing once the page is ready', () => {
    expect(overlayFor({ phase: 'ready', showLoadingOverlay: true })).toBe('none');
  });

  it('shows the error view when the page could not be loaded', () => {
    expect(overlayFor({ phase: 'error', showLoadingOverlay: true })).toBe('error');
  });

  describe('when the caller is already showing a spinner of its own', () => {
    it('draws no spinner, so the reader never sees two at once', () => {
      expect(overlayFor({ phase: 'loading', showLoadingOverlay: false })).toBe('none');
      expect(overlayFor({ phase: 'waiting-for-consent', showLoadingOverlay: false })).toBe('none');
    });

    it('still shows the error view, which the caller has no other way to report', () => {
      expect(overlayFor({ phase: 'error', showLoadingOverlay: false })).toBe('error');
    });

    it('still shows nothing when the page is ready', () => {
      expect(overlayFor({ phase: 'ready', showLoadingOverlay: false })).toBe('none');
    });
  });

  it('never hides the error view, whatever the caller asks for', () => {
    for (const showLoadingOverlay of [true, false]) {
      expect(overlayFor({ phase: 'error', showLoadingOverlay })).toBe('error');
    }
  });

  it('answers for every phase the session can be in', () => {
    for (const phase of PHASES) {
      expect(['none', 'loading', 'error']).toContain(overlayFor({ phase, showLoadingOverlay: true }));
    }
  });
});

describe('pageAreaHeight', () => {
  const fallbackHeight = 800;

  it('uses the height the page reported while it is being shown', () => {
    expect(pageAreaHeight({ phase: 'ready', reportedHeight: 4200, fallbackHeight })).toBe(4200);
  });

  it('falls back while loading, because there is no page to measure yet', () => {
    expect(pageAreaHeight({ phase: 'loading', reportedHeight: null, fallbackHeight })).toBe(800);
  });

  it('falls back while waiting for consent', () => {
    expect(pageAreaHeight({ phase: 'waiting-for-consent', reportedHeight: null, fallbackHeight })).toBe(800);
  });

  it('ignores the height of the document before it when a load fails', () => {
    // The bug this prevents: a long page is replaced by an error, and the error is centred thousands
    // of pixels down a scroll view that is still as tall as the page that is gone.
    expect(pageAreaHeight({ phase: 'error', reportedHeight: 4200, fallbackHeight })).toBe(800);
  });

  it('ignores a stale height while the next document is loading', () => {
    expect(pageAreaHeight({ phase: 'loading', reportedHeight: 4200, fallbackHeight })).toBe(800);
  });

  it('falls back when a page is ready but has not reported a height yet', () => {
    expect(pageAreaHeight({ phase: 'ready', reportedHeight: null, fallbackHeight })).toBe(800);
  });

  it('falls back on a height that could not size anything', () => {
    expect(pageAreaHeight({ phase: 'ready', reportedHeight: 0, fallbackHeight })).toBe(800);
    expect(pageAreaHeight({ phase: 'ready', reportedHeight: -10, fallbackHeight })).toBe(800);
  });

  it('keeps a short page short, rather than stretching it to the viewport', () => {
    expect(pageAreaHeight({ phase: 'ready', reportedHeight: 120, fallbackHeight })).toBe(120);
  });
});
