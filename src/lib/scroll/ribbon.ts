/**
 * Ribbon bookmark: the reading position as a length of satin, and a scroll
 * scrubber with real physics.
 *
 * - The ribbon's length mirrors scroll progress 1:1 (no spring on that path).
 * - Grabbing the tail scrubs the page 1:1 and respects where it was grabbed.
 * - Past either end the tail rubber-bands while the page stays clamped.
 * - Releasing hands the finger's velocity to a spring aimed at the projected
 *   resting point, so a flick throws the page and the motion has no seam.
 *   A throw that reaches an end arrives with speed: the page stops, the tail
 *   overshoots softly and comes back.
 * - Wheel, touch, scroll keys, a pointer press, or any outside scroll stops
 *   the throw immediately. The ribbon never fights the reader.
 *
 * State is two numbers: `base`, the in-bounds length that mirrors the scroll
 * position, and `over`, the raw overshoot past an end (visual only).
 */
import { Spring } from '../motion/spring';
import { springs, type SpringParams } from '../motion/tokens';
import { project } from '../motion/projection';
import { rubberband } from '../motion/rubberband';
import { prefersReducedMotion } from '../motion/prefs';

/** Ribbon length at the very top of the page. */
const PEEK = 56;
/** Gap between the ribbon's tip and the viewport bottom at the very end. */
const BOTTOM_GAP = 28;
/** Rubber-band dimension: the most the tail can visually give past an end. */
const BAND = 56;
/** Tail speed (px/s) below which a release is a placement, not a throw. */
const FLICK_MIN = 90;
const VELOCITY_CAP = 4000;
const HISTORY_MS = 100;
/** No movement for this long before release means the hand had stopped. */
const STALE_MS = 60;
const LABEL_LINGER_MS = 600;
const TWO_PI = Math.PI * 2;

/** Distance project() adds per unit of velocity (0.499 at the default rate). */
const PROJECTION_GAIN = project(0, 1);
/**
 * The throw. A critically damped spring aimed at the projected endpoint
 * starts with zero acceleration when omega = 2v / distance, and the
 * projection makes that distance v * PROJECTION_GAIN, so omega is a
 * constant. The page continues at the finger's exact velocity and then only
 * ever slows down, like scroll deceleration: no seam, no lurch.
 */
const COAST: SpringParams = {
  response: TWO_PI / (2 / PROJECTION_GAIN),
  dampingRatio: 1,
};
/** Firm, bounceless return to an end (overshoot comes from real velocity). */
const RETURN: SpringParams = { response: springs.default.response, dampingRatio: 1 };

const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const clamp01 = (v: number) => clamp(v, 0, 1);

type Mode = 'idle' | 'drag' | 'drive';

export function mountRibbon(root: HTMLElement): () => void {
  const body = root.querySelector<HTMLElement>('[data-ribbon-body]');
  const tailWrap = root.querySelector<HTMLElement>('[data-ribbon-tail-wrap]');
  const tail = root.querySelector<HTMLElement>('[data-ribbon-tail]');
  const handle = root.querySelector<HTMLElement>('[data-ribbon-handle]');
  const label = root.querySelector<HTMLElement>('[data-ribbon-label]');
  if (!body || !tailWrap || !tail || !handle || !label) return () => {};

  // Geometry, re-measured on resize and whenever the document changes height.
  let tailH = 22;
  let bodyBase = 64;
  let lmin = PEEK;
  let lmax = PEEK + 1;
  let maxScroll = 0;
  let usable = false;

  // State.
  let base = PEEK;
  let over = 0;
  let mode: Mode = 'idle';
  /** While a throw is headed past an end: the end it will hit. */
  let edge: number | null = null;
  let lastSetScroll = -1;
  let grab = 0;
  let pointerId = -1;
  let samples: Array<{ y: number; t: number }> = [];
  let scrollFrame = 0;
  let labelTimer = 0;
  let lastPct = -1;
  let savedCursor = '';
  let savedSelect = '';

  const fraction = () => (lmax > lmin ? clamp01((base - lmin) / (lmax - lmin)) : 0);

  const baseFromScroll = () =>
    lmin + (maxScroll > 0 ? clamp01(window.scrollY / maxScroll) : 0) * (lmax - lmin);

  function setRaw(raw: number): void {
    base = clamp(raw, lmin, lmax);
    over = raw - base;
  }

  function render(): void {
    const visible = base + rubberband(over, BAND);
    const strap = Math.max(0, visible - tailH);
    // +1px tucks the strap under the tail so no hairline can open between them.
    body!.style.transform = `scaleY(${((strap + 1) / bodyBase).toFixed(4)})`;
    // The visible tail and its (unshadowed) hit target ride together.
    const ride = `translate3d(0, ${strap.toFixed(2)}px, 0)`;
    tailWrap!.style.transform = ride;
    handle!.style.transform = ride;
    const pct = Math.round(fraction() * 100);
    if (pct !== lastPct) {
      lastPct = pct;
      handle!.setAttribute('aria-valuenow', String(pct));
      handle!.setAttribute('aria-valuetext', `${pct} percent`);
      label!.textContent = `${pct}%`;
    }
  }

  function applyScroll(): void {
    const top = fraction() * maxScroll;
    if (Math.abs(top - lastSetScroll) < 0.25) return;
    lastSetScroll = top;
    // base.css sets scroll-behavior: smooth; per-frame writes must bypass it.
    window.scrollTo({ top, behavior: 'instant' });
  }

  function showLabel(): void {
    window.clearTimeout(labelTimer);
    root.dataset.label = 'true';
  }

  function lingerLabel(): void {
    window.clearTimeout(labelTimer);
    labelTimer = window.setTimeout(() => {
      root.dataset.label = 'false';
    }, LABEL_LINGER_MS);
  }

  /** Drives the page: animates the raw length, scroll follows the clamped part. */
  const drive: Spring = new Spring(
    base,
    springs.default,
    (raw) => {
      setRaw(raw);
      if (edge !== null && over !== 0) {
        // The throw just reached an end with speed to spare. Keep that
        // velocity and turn for home: the tail overshoots, then settles.
        const bound = edge;
        edge = null;
        drive.setTarget(bound, { params: RETURN });
      }
      applyScroll();
      render();
    },
    {
      epsilon: 0.3,
      onRest: () => {
        mode = 'idle';
        edge = null;
        if (over !== 0) {
          // Rested a hair past an end: square it away.
          over = 0;
          render();
        }
        lingerLabel();
      },
    },
  );

  /** Visual only: returns a leftover overshoot without touching the page. */
  const settle = new Spring(
    0,
    springs.default,
    (v) => {
      over = v;
      render();
    },
    { epsilon: 0.2 },
  );

  function releaseOver(): void {
    if (over === 0) return;
    if (prefersReducedMotion()) {
      over = 0;
      render();
      return;
    }
    settle.jump(over);
    settle.setTarget(0);
  }

  function startDrive(target: number, velocity: number, params: SpringParams): void {
    settle.destroy();
    drive.jump(base + over); // start from the presentation value
    mode = 'drive';
    lastSetScroll = window.scrollY;
    showLabel();
    drive.setTarget(target, { velocity, params });
  }

  /** Yield to the reader: stop where the page is, right now. */
  function stopDrive(): void {
    if (mode !== 'drive') return;
    drive.destroy();
    mode = 'idle';
    edge = null;
    releaseOver();
    lingerLabel();
  }

  function measure(): void {
    const before = `${lmax}|${maxScroll}|${usable}`;
    // Lay the ribbon out so it can be measured, then decide if it shows.
    root.dataset.hidden = 'false';
    const top = root.getBoundingClientRect().top;
    tailH = tail!.offsetHeight || tailH;
    bodyBase = body!.offsetHeight || bodyBase;
    const viewport = window.innerHeight;
    const docHeight = document.documentElement.scrollHeight;
    maxScroll = Math.max(0, docHeight - viewport);
    lmin = PEEK;
    lmax = viewport - top - BOTTOM_GAP;
    usable = docHeight > viewport * 1.25 && lmax - lmin > 80;
    root.dataset.hidden = usable ? 'false' : 'true';
    if (!usable) {
      if (mode === 'drive') stopDrive();
      return;
    }
    const changed = before !== `${lmax}|${maxScroll}|${usable}`;
    // The ground moved under a throw: stop rather than land somewhere odd.
    if (mode === 'drive' && changed) stopDrive();
    if (mode === 'idle') {
      base = baseFromScroll();
      render();
    }
  }

  /* ---------------------------------------------------------------- */
  /* Normal scrolling: the ribbon follows the page directly            */
  /* ---------------------------------------------------------------- */
  const onScroll = () => {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      if (!usable || mode === 'drag') return;
      if (mode === 'drive') {
        if (Math.abs(window.scrollY - lastSetScroll) <= 2) return; // our own write
        stopDrive(); // something else moved the page
      }
      base = baseFromScroll();
      render();
    });
  };

  /* ---------------------------------------------------------------- */
  /* Dragging the tail                                                 */
  /* ---------------------------------------------------------------- */
  function releaseVelocity(now: number): number {
    const recent = samples.filter((s) => now - s.t <= HISTORY_MS);
    if (recent.length < 2) return 0;
    const first = recent[0]!;
    const last = recent[recent.length - 1]!;
    // The hand stopped before it let go: a placement, not a throw.
    if (now - last.t > STALE_MS) return 0;
    const dt = (last.t - first.t) / 1000;
    if (dt <= 0) return 0;
    return clamp((last.y - first.y) / dt, -VELOCITY_CAP, VELOCITY_CAP);
  }

  function lockDocument(lock: boolean): void {
    const style = document.documentElement.style;
    if (lock) {
      savedCursor = style.cursor;
      savedSelect = style.userSelect;
      style.cursor = 'grabbing';
      style.userSelect = 'none';
    } else {
      style.cursor = savedCursor;
      style.userSelect = savedSelect;
    }
  }

  const onPointerDown = (e: PointerEvent) => {
    if (!usable || mode === 'drag') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Grab mid-flight: stop every animation and keep the presentation value.
    drive.destroy();
    settle.destroy();
    edge = null;
    mode = 'drag';
    pointerId = e.pointerId;
    try {
      // Keep tracking when the pointer leaves the tail, or the window.
      handle.setPointerCapture(pointerId);
    } catch {
      // No capture available: the drag still works while over the tail.
    }
    grab = e.clientY - (base + over); // respect where the tail was grabbed
    samples = [{ y: e.clientY, t: e.timeStamp }];
    lastSetScroll = window.scrollY;
    root.dataset.dragging = 'true';
    lockDocument(true);
    showLabel();
    // No preventDefault: the default mousedown gives the slider keyboard
    // focus (without a focus ring), and nothing here needs suppressing. The
    // tail is unselectable and the document is locked against selection
    // for the length of the drag.
  };

  const onPointerMove = (e: PointerEvent) => {
    if (mode !== 'drag' || e.pointerId !== pointerId) return;
    samples.push({ y: e.clientY, t: e.timeStamp });
    if (samples.length > 12) samples.shift();
    setRaw(e.clientY - grab);
    applyScroll();
    render();
  };

  function finishDrag(velocity: number): void {
    if (pointerId !== -1 && handle!.hasPointerCapture(pointerId)) {
      handle!.releasePointerCapture(pointerId);
    }
    pointerId = -1;
    samples = [];
    mode = 'idle';
    root.dataset.dragging = 'false';
    lockDocument(false);

    if (prefersReducedMotion()) {
      over = 0;
      render();
      lingerLabel();
      return;
    }
    if (over !== 0) {
      // Let go past an end: come home, carrying whatever speed the hand had.
      startDrive(base, velocity, RETURN);
      return;
    }
    if (Math.abs(velocity) < FLICK_MIN) {
      lingerLabel();
      return;
    }
    // Aim at where the throw would come to rest. If that is past an end,
    // still aim there: the page should reach the end at speed, not brake
    // early. The drive spring turns for home the moment it crosses.
    const projected = project(base, velocity);
    const bound = clamp(projected, lmin, lmax);
    edge = bound === projected ? null : bound;
    startDrive(projected, velocity, COAST);
  }

  const onPointerUp = (e: PointerEvent) => {
    if (mode !== 'drag' || e.pointerId !== pointerId) return;
    finishDrag(releaseVelocity(e.timeStamp));
  };

  const onPointerLost = (e: PointerEvent) => {
    if (mode !== 'drag' || e.pointerId !== pointerId) return;
    finishDrag(0);
  };

  /* ---------------------------------------------------------------- */
  /* Keyboard: the tail is a slider                                    */
  /* ---------------------------------------------------------------- */
  const onKeyDown = (e: KeyboardEvent) => {
    if (!usable || mode === 'drag') return;
    const span = lmax - lmin;
    // Repeated presses accumulate from where the page is already headed.
    const from = mode === 'drive' ? clamp(drive.restingAt, lmin, lmax) : base;
    let target: number;
    switch (e.key) {
      case 'ArrowDown':
        target = from + span * 0.1;
        break;
      case 'ArrowUp':
        target = from - span * 0.1;
        break;
      case 'PageDown':
        target = from + span * 0.25;
        break;
      case 'PageUp':
        target = from - span * 0.25;
        break;
      case 'Home':
        target = lmin;
        break;
      case 'End':
        target = lmax;
        break;
      default:
        return;
    }
    e.preventDefault();
    target = clamp(target, lmin, lmax);
    edge = null;
    showLabel();
    if (prefersReducedMotion()) {
      drive.destroy();
      settle.destroy();
      mode = 'idle';
      lastSetScroll = window.scrollY;
      setRaw(target);
      applyScroll();
      render();
      lingerLabel();
      return;
    }
    if (mode === 'drive') drive.setTarget(target, { params: springs.default });
    else startDrive(target, 0, springs.default);
  };

  /* ---------------------------------------------------------------- */
  /* Interruption: the reader always wins                              */
  /* ---------------------------------------------------------------- */
  const onUserScrollIntent = () => stopDrive();

  const onGlobalKey = (e: KeyboardEvent) => {
    if (e.target === handle) return; // the slider retargets its own spring
    if (SCROLL_KEYS.has(e.key)) stopDrive();
  };

  const onGlobalPointer = (e: PointerEvent) => {
    if (e.target instanceof Node && handle.contains(e.target)) return; // a grab, handled above
    stopDrive();
  };

  const onResize = () => measure();
  const resizeObserver = new ResizeObserver(() => measure());

  handle.addEventListener('pointerdown', onPointerDown);
  handle.addEventListener('pointermove', onPointerMove);
  handle.addEventListener('pointerup', onPointerUp);
  handle.addEventListener('pointercancel', onPointerUp);
  handle.addEventListener('lostpointercapture', onPointerLost);
  handle.addEventListener('keydown', onKeyDown);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
  window.addEventListener('wheel', onUserScrollIntent, { passive: true });
  window.addEventListener('touchstart', onUserScrollIntent, { passive: true });
  window.addEventListener('keydown', onGlobalKey);
  window.addEventListener('pointerdown', onGlobalPointer, true);
  resizeObserver.observe(document.body);

  measure();

  return () => {
    handle.removeEventListener('pointerdown', onPointerDown);
    handle.removeEventListener('pointermove', onPointerMove);
    handle.removeEventListener('pointerup', onPointerUp);
    handle.removeEventListener('pointercancel', onPointerUp);
    handle.removeEventListener('lostpointercapture', onPointerLost);
    handle.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('wheel', onUserScrollIntent);
    window.removeEventListener('touchstart', onUserScrollIntent);
    window.removeEventListener('keydown', onGlobalKey);
    window.removeEventListener('pointerdown', onGlobalPointer, true);
    resizeObserver.disconnect();
    drive.destroy();
    settle.destroy();
    cancelAnimationFrame(scrollFrame);
    window.clearTimeout(labelTimer);
    if (mode === 'drag') lockDocument(false);
  };
}
