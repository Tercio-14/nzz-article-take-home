// Pure module: no React Native imports, so it can be unit-tested directly.
//
// Pulling down at the top of an article reloads it. The article's web view scrolls itself, so there is
// no native scroll view to hang a refresh control on and the app has to read the drag itself. The
// numbers that decide how that feels live here rather than in the screen, so they can be tested and
// changed in one place.
//
// Resistance is what makes a pull feel like a pull: the indicator follows the finger at a fraction of
// its speed and stops at a limit, so dragging further gives less and less, the way the platform's own
// refresh controls behave.

import { embed } from './pageScripts';

/** How far the indicator must travel before letting go reloads. */
export const PULL_THRESHOLD = 64;

/** The furthest the indicator travels, however hard the reader pulls. */
export const MAX_PULL = 96;

/** The fraction of the finger's travel the indicator follows. */
export const RESISTANCE = 0.5;

/**
 * How far down the finger must move before the gesture takes over from the page.
 *
 * Small enough to feel responsive, large enough that a tap or a flick never steals the touch from the
 * web view's own scrolling.
 */
export const ACTIVATION_OFFSET = 12;

/**
 * How close to the top still counts as the top.
 *
 * Scroll positions come back fractional, so an exact zero would miss by a fraction of a pixel and the
 * pull would refuse to start when the reader can plainly see they are at the top.
 */
export const AT_TOP_TOLERANCE = 1;

/**
 * Whether the page is scrolled to the very top, from a reported scroll position.
 *
 * A negative position is iOS overscrolling past the top, which is still the top. A position that is
 * not a number tells us nothing, so the pull stays out of the way rather than guessing.
 */
export function isAtTop(offsetY: number): boolean {
  return Number.isFinite(offsetY) && offsetY <= AT_TOP_TOLERANCE;
}

export type PullRequest = {
  /** How far the finger has moved down since the gesture began. Negative when moving up. */
  dragY: number;
  /** Whether the page is scrolled to the very top. A pull means nothing anywhere else. */
  atTop: boolean;
  /** Whether a load is already running. A second pull must not start another. */
  busy: boolean;
};

export type PullState = {
  /** Where to draw the indicator, in points below its resting place. */
  offset: number;
  /** How close the pull is to triggering, from 0 to 1. Drives the indicator's look. */
  progress: number;
  /** Whether letting go now would reload. */
  armed: boolean;
};

const RESTING: PullState = { offset: 0, progress: 0, armed: false };

/**
 * Turns a drag into what the indicator should show.
 *
 * Anywhere but the top, while a load is running, or dragging upward, there is nothing to show: the
 * page keeps the gesture and the indicator stays put.
 */
export function pullState({ dragY, atTop, busy }: PullRequest): PullState {
  if (!atTop || busy) return RESTING;
  if (!Number.isFinite(dragY) || dragY <= 0) return RESTING;

  const offset = Math.min(dragY * RESISTANCE, MAX_PULL);

  return {
    offset,
    progress: Math.min(1, offset / PULL_THRESHOLD),
    armed: offset >= PULL_THRESHOLD,
  };
}

/** Whether letting go should reload. A pull that never reached the threshold simply springs back. */
export function shouldTriggerOnRelease(state: PullState): boolean {
  return state.armed;
}

/** The message the probe below posts. App-owned, so the pages never send it themselves. */
export const PULL_MESSAGE = 'nzzapp:pull';

export type PullPhase = 'start' | 'move' | 'end' | 'cancel';

/**
 * The script that watches for a pull from inside the page.
 *
 * Watching from outside did not work: a gesture laid over the web view never receives the drag,
 * because the web view's own scrolling takes the touch first. The page, on the other hand, sees every
 * touch, so it reports them and the app decides what they mean.
 *
 * It never blocks anything. The listeners are passive and nothing is ever prevented, so ordinary
 * scrolling, sideways drags and the swipe-back from the edge all behave exactly as before. A pull only
 * counts from a single finger, starting at the very top, moving downward more than sideways.
 */
export function pullProbeScript(): string {
  return `(function () {
  if (window.__nzzPull) return;
  window.__nzzPull = true;

  var active = false;
  var startX = 0;
  var startY = 0;
  var distance = 0;
  var frame = 0;

  function atTop() {
    var y = window.pageYOffset || document.documentElement.scrollTop || 0;

    return y <= ${AT_TOP_TOLERANCE};
  }

  function send(phase, value) {
    if (!window.ReactNativeWebView) return;

    window.ReactNativeWebView.postMessage(
      JSON.stringify({ type: ${embed(PULL_MESSAGE)}, phase: phase, distance: value }),
    );
  }

  function clearFrame() {
    if (!frame) return;

    if (window.cancelAnimationFrame) window.cancelAnimationFrame(frame);
    frame = 0;
  }

  function stop(phase) {
    if (!active) return;

    active = false;
    clearFrame();
    send(phase, distance);
    distance = 0;
  }

  function onStart(event) {
    active = false;
    distance = 0;
    clearFrame();

    if (!event.touches || event.touches.length !== 1) return;
    if (!atTop()) return;

    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
    active = true;
    send('start', 0);
  }

  function onMove(event) {
    if (!active) return;

    if (!event.touches || event.touches.length !== 1) {
      stop('cancel');

      return;
    }

    var dx = event.touches[0].clientX - startX;
    var dy = event.touches[0].clientY - startY;

    // A sideways drag belongs to the app's navigation, never to a pull.
    if (Math.abs(dx) > Math.abs(dy)) {
      stop('cancel');

      return;
    }

    // Upward is the page scrolling; there is nothing to report.
    if (dy <= 0) {
      distance = 0;

      return;
    }

    distance = dy;

    if (frame) return;

    frame = window.requestAnimationFrame(function () {
      frame = 0;
      if (active) send('move', distance);
    });
  }

  window.addEventListener('touchstart', onStart, { passive: true });
  window.addEventListener('touchmove', onMove, { passive: true });
  window.addEventListener('touchend', function () { stop('end'); }, { passive: true });
  window.addEventListener('touchcancel', function () { stop('cancel'); }, { passive: true });
})();
true;`;
}
