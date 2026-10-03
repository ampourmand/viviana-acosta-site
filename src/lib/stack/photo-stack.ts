/**
 * Photo stack: a pile of prints you can flick through.
 *
 * The top print tracks the pointer 1:1 from wherever it was grabbed. On
 * release the *projected* endpoint (not the release point) decides whether it
 * sails off and tucks to the back of the pile or springs home, and the
 * release velocity is handed to the springs so there is no seam between
 * dragging and animating. Everything is interruptible: a print in flight can
 * be caught again and carries on from its live transform. Bounce is reserved
 * for moments where a gesture actually carried momentum.
 */
import { Spring } from '../motion/spring';
import { springs, type SpringParams } from '../motion/tokens';
import { project } from '../motion/projection';
import { prefersReducedMotion } from '../motion/prefs';

export interface Pose {
  x: number;
  y: number;
  /** Rotation in degrees. */
  r: number;
  /** Uniform scale. */
  s: number;
}

/* Resting poses per depth: prints left loosely on a desk. Deterministic. */
const ROT = [-3, 2.5, -6, 5.5, -1, 3.5];
const OFF_X = [0, 10, -12, 15, -4, 7];
const OFF_Y = [0, 6, 10, 4, 14, 9];
const DEPTH_SHRINK = 0.015;
const MAX_SHRINK_DEPTH = 5;

/** Touch must travel this far sideways before a drag is recognized. */
const HYSTERESIS = 10;
const TAP_SLOP = 8;
const TAP_MS = 250;
const VELOCITY_WINDOW_MS = 100;
const MAX_SPEED = 4500;
/** Projected travel, as a fraction of print width, that sends a print off. */
const DISMISS_FRACTION = 0.45;
/** Degrees of tilt per print-width of sideways travel. */
const TILT = 13;
const EARNED_SPEED = 150;
/** Synthetic flick for tap, keys, and buttons (px/s). */
const COMMAND_SPEED = 1300;
const STAGGER_MS = 45;
const FADE_MS = 170;
/** Sliding back under the pile: arrives without overshoot. */
const TUCK: SpringParams = { response: 0.44, dampingRatio: 1 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, places: number) => {
  const f = 10 ** places;
  return Math.round(v * f) / f;
};

export function restPose(depth: number): Pose {
  const i = ((depth % ROT.length) + ROT.length) % ROT.length;
  return {
    x: OFF_X[i]!,
    y: OFF_Y[i]!,
    r: ROT[i]!,
    s: 1 - DEPTH_SHRINK * Math.min(Math.max(depth, 0), MAX_SHRINK_DEPTH),
  };
}

export function poseTransform(p: Pose): string {
  return `translate3d(${round(p.x, 2)}px, ${round(p.y, 2)}px, 0) rotate(${round(p.r, 3)}deg) scale(${round(p.s, 4)})`;
}

type Axis = 'x' | 'y' | 'r' | 's';

interface Flight {
  /** out: dismissed, still above the pile. emerge: coming out from under it. */
  kind: 'out' | 'emerge';
  dir: 1 | -1;
  /** Sideways distance at which the print is fully clear of the pile. */
  clearX: number;
  seq: number;
  /** Past the clear line and waiting for its turn. */
  clear: boolean;
}

interface Print {
  el: HTMLElement;
  index: number;
  caption: string;
  x: Spring;
  y: Spring;
  r: Spring;
  s: Spring;
  flight: Flight | null;
  /** Dismissed or surfacing and not yet settled in its place. */
  away: boolean;
  timer: number;
}

interface Sample {
  x: number;
  y: number;
  t: number;
}

interface Drag {
  print: Print;
  pointerId: number;
  pointerType: string;
  /** Tracking has begun (immediately for a mouse, after hysteresis for touch). */
  locked: boolean;
  /** Pressed on the resting top print: a quick release counts as a tap. */
  tap: boolean;
  startX: number;
  startY: number;
  startT: number;
  travel: number;
  /** Pile center in client coordinates (the print's home). */
  cx: number;
  cy: number;
  /** Vector from the print's center to the grabbed point, at lock. */
  grabX: number;
  grabY: number;
  r0: number;
  s0: number;
  lockX: number;
  x0: number;
  lastX: number;
  lastY: number;
  /** Signed leverage: grabbing above center tilts with travel, below against. */
  lever: number;
  w: number;
  samples: Sample[];
}

/* The viewport must not gain horizontal scroll while a print flies past its
   edge. Held for as long as any stack is mounted, then restored. */
let clipHolders = 0;
let clipPrevious = '';

function holdViewportClip(): void {
  if (clipHolders++ > 0) return;
  const html = document.documentElement;
  clipPrevious = html.style.overflowX;
  const supportsClip = typeof CSS !== 'undefined' && CSS.supports('overflow-x', 'clip');
  html.style.overflowX = supportsClip ? 'clip' : 'hidden';
}

function releaseViewportClip(): void {
  if (--clipHolders > 0) return;
  clipHolders = 0;
  document.documentElement.style.overflowX = clipPrevious;
}

export function mountPhotoStack(root: HTMLElement): () => void {
  const pile = root.querySelector<HTMLElement>('[data-stack-pile]');
  const els = Array.from(root.querySelectorAll<HTMLElement>('[data-stack-print]'));
  if (!pile || els.length === 0) return () => {};

  const captionEl = root.querySelector<HTMLElement>('[data-stack-caption]');
  const positionEl = root.querySelector<HTMLElement>('[data-stack-position]');
  const counterEl = root.querySelector<HTMLElement>('[data-stack-counter]');
  const prevBtn = root.querySelector<HTMLButtonElement>('[data-stack-prev]');
  const nextBtn = root.querySelector<HTMLButtonElement>('[data-stack-next]');
  const n = els.length;

  /** Print indices from the top of the pile (depth 0) to the back. */
  const order: number[] = els.map((_, i) => i);
  const timers = new Set<number>();
  let drag: Drag | null = null;
  let flightSeq = 0;
  let fadeToken = 0;
  let destroyed = false;

  const prints: Print[] = els.map((el, index) => {
    const pose = restPose(index);
    const print = {
      el,
      index,
      caption: el.dataset.caption ?? '',
      flight: null,
      away: false,
      timer: 0,
    } as Print;
    const make = (value: number, axis: Axis, epsilon: number) =>
      new Spring(value, springs.default, () => onSpring(print, axis), {
        epsilon,
        onRest: () => onRest(print),
      });
    print.x = make(pose.x, 'x', 0.02);
    print.y = make(pose.y, 'y', 0.02);
    print.r = make(pose.r, 'r', 0.01);
    print.s = make(pose.s, 's', 0.0005);
    return print;
  });

  /* ---------------------------------------------------------------- */
  /* Rendering                                                         */
  /* ---------------------------------------------------------------- */

  function apply(p: Print): void {
    p.el.style.transform = poseTransform({
      x: p.x.current,
      y: p.y.current,
      r: p.r.current,
      s: p.s.current,
    });
  }

  function onSpring(p: Print, axis: Axis): void {
    if (destroyed) return;
    if (drag && drag.locked && drag.print === p) {
      // While held, tilt and scale ease toward their targets; re-solve the
      // translation each frame so the grabbed point stays under the finger.
      if (axis === 'r' || axis === 's') solveDrag();
      return;
    }
    apply(p);
    if (axis === 'x') checkClear(p);
  }

  function isSettled(p: Print): boolean {
    return (
      p.x.current === p.x.restingAt &&
      p.y.current === p.y.restingAt &&
      p.r.current === p.r.restingAt &&
      p.s.current === p.s.restingAt
    );
  }

  function onRest(p: Print): void {
    // Deferred: never start or stop springs from inside the shared ticker's
    // own loop.
    queueMicrotask(() => {
      if (destroyed || !isSettled(p)) return;
      if (p.flight) {
        // Came to rest at the far point: it is clear, and may be waiting.
        p.flight.clear = true;
        resolveTurns();
        return;
      }
      if (p.away) {
        p.away = false;
        assignZ();
        refreshHints();
      }
    });
  }

  const depthOf = (p: Print) => order.indexOf(p.index);

  function toFront(p: Print): void {
    order.splice(depthOf(p), 1);
    order.unshift(p.index);
  }

  function toBack(p: Print): void {
    order.splice(depthOf(p), 1);
    order.push(p.index);
  }

  function assignZ(): void {
    order.forEach((index, depth) => {
      const p = prints[index]!;
      const held = drag !== null && drag.locked && drag.print === p;
      let z = n - depth;
      if (held) z = 3000;
      // Earlier departures stay above later ones; later arrivals from below
      // stay above earlier ones. Exactly the order they held in the pile.
      else if (p.flight?.kind === 'out') z = 2000 - (p.flight.seq % 900);
      else if (p.flight?.kind === 'emerge') z = -1000 + (p.flight.seq % 900);
      p.el.style.zIndex = String(z);
      p.el.toggleAttribute('data-deep', depth >= 3 && !p.flight && !p.away && !held);
    });
  }

  /** Compositor hints for the two prints that can move next, and travelers. */
  function refreshHints(): void {
    order.forEach((index, depth) => {
      const p = prints[index]!;
      const hot = depth < 2 || p.away || p.flight !== null || drag?.print === p;
      p.el.style.willChange = hot ? 'transform' : '';
    });
  }

  function updateMeta(): void {
    const top = prints[order[0]!]!;
    if (captionEl && captionEl.textContent !== top.caption) captionEl.textContent = top.caption;
    if (positionEl) positionEl.textContent = `. Photo ${top.index + 1} of ${n}`;
    if (counterEl) counterEl.textContent = `${top.index + 1} / ${n}`;
    for (const p of prints) {
      if (p === top) p.el.removeAttribute('aria-hidden');
      else p.el.setAttribute('aria-hidden', 'true');
    }
  }

  /* ---------------------------------------------------------------- */
  /* Motion                                                            */
  /* ---------------------------------------------------------------- */

  function settle(
    p: Print,
    pose: Pose,
    params: SpringParams,
    velocity?: { x: number; y: number },
  ): void {
    p.x.setTarget(pose.x, { params, velocity: velocity?.x });
    p.y.setTarget(pose.y, { params, velocity: velocity?.y });
    p.r.setTarget(pose.r, { params });
    p.s.setTarget(pose.s, { params: springs.default });
  }

  function jumpTo(p: Print, pose: Pose): void {
    p.x.jump(pose.x);
    p.y.jump(pose.y);
    p.r.jump(pose.r);
    p.s.jump(pose.s);
  }

  function clearTimer(p: Print): void {
    if (!p.timer) return;
    window.clearTimeout(p.timer);
    timers.delete(p.timer);
    p.timer = 0;
  }

  /** Send every free print to the resting pose for its depth. */
  function layout(stagger: boolean): void {
    let k = 0;
    for (const index of order) {
      const p = prints[index]!;
      clearTimer(p);
      if (p.flight || (drag !== null && drag.locked && drag.print === p)) continue;
      const go = () => {
        clearTimer(p);
        if (destroyed || p.flight || (drag !== null && drag.locked && drag.print === p)) return;
        settle(p, restPose(depthOf(p)), p.away ? TUCK : springs.default);
      };
      const delay = stagger ? k * STAGGER_MS : 0;
      k += 1;
      if (delay === 0) {
        go();
      } else {
        p.timer = window.setTimeout(go, delay);
        timers.add(p.timer);
      }
    }
  }

  /** Sideways distance at which even a steeply tilted print no longer overlaps the pile. */
  const clearDistance = (p: Print) => p.el.offsetWidth * 1.32 + 16;

  function checkClear(p: Print): void {
    const f = p.flight;
    if (!f || f.clear) return;
    if (f.dir * p.x.current < f.clearX) return;
    f.clear = true;
    scheduleTurns();
  }

  let turnsQueued = false;

  /** Deferred: never start or stop springs from inside the shared ticker's loop. */
  function scheduleTurns(): void {
    if (turnsQueued) return;
    turnsQueued = true;
    queueMicrotask(() => {
      turnsQueued = false;
      if (!destroyed) resolveTurns();
    });
  }

  /**
   * Prints that left in quick succession overlap in mid-air, so they turn
   * last-out-first: each one waits past the clear line until every later
   * departure has turned. That way no two prints ever swap places while
   * they overlap, and the bunch comes home in the order it left.
   */
  function resolveTurns(): void {
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const p of prints) {
        const f = p.flight;
        if (!f || !f.clear) continue;
        const waiting = prints.some(
          (q) => q !== p && q.flight !== null && q.flight.kind === f.kind && q.flight.seq > f.seq,
        );
        if (waiting) continue;
        turn(p);
        progressed = true;
      }
    }
  }

  /**
   * The far point of a flight. The print is clear of the pile here, so its
   * z-order can change without ever popping over (or under) another print.
   * The same springs are re-targeted, so the turn is one continuous arc.
   */
  function turn(p: Print): void {
    const kind = p.flight?.kind;
    p.flight = null;
    assignZ();
    settle(p, restPose(depthOf(p)), kind === 'out' ? TUCK : springs.default);
  }

  function dismiss(p: Print, dir: 1 | -1, vx: number, vy: number): void {
    if (n < 2) {
      goHome(p, vx, vy);
      return;
    }
    toBack(p);
    updateMeta();
    if (prefersReducedMotion()) {
      crossfade('next', p);
      return;
    }
    const w = p.el.offsetWidth;
    const h = p.el.offsetHeight;
    const clearX = clearDistance(p);
    p.flight = { kind: 'out', dir, clearX, seq: ++flightSeq, clear: false };
    p.away = true;
    p.x.setTarget(dir * (clearX + w * 0.3), { velocity: vx, params: springs.momentum });
    p.y.setTarget(clamp(p.y.current + vy * 0.12, -h * 0.22, h * 0.22), {
      velocity: vy,
      params: springs.momentum,
    });
    p.r.setTarget(clamp(p.r.current + dir * 12, -30, 30), { params: springs.momentum });
    p.s.setTarget(1, { params: springs.default });
    assignZ();
    refreshHints();
    layout(true);
    checkClear(p);
  }

  function goHome(p: Print, vx: number, vy: number): void {
    const pose = restPose(depthOf(p));
    if (prefersReducedMotion()) {
      jumpTo(p, pose);
      return;
    }
    // Bounce only when the gesture carried real momentum.
    const earned = Math.hypot(vx, vy) > EARNED_SPEED;
    settle(p, pose, earned ? springs.momentum : springs.default, { x: vx, y: vy });
  }

  function next(): void {
    if (n < 2) return;
    const p = prints[order[0]!]!;
    if (drag !== null && drag.print === p) return;
    if (p.flight?.kind === 'emerge') {
      // It was still surfacing: send it straight back under.
      p.flight = null;
      toBack(p);
      updateMeta();
      assignZ();
      refreshHints();
      layout(true);
      scheduleTurns();
      return;
    }
    dismiss(p, 1, COMMAND_SPEED, 0);
  }

  function previous(): void {
    if (n < 2 || (drag !== null && drag.locked)) return;
    const p = prints[order[n - 1]!]!;
    toFront(p);
    updateMeta();
    if (prefersReducedMotion()) {
      crossfade('prev', p);
      return;
    }
    if (p.flight?.kind === 'out') {
      // Still on its way out and still on top: simply call it back.
      p.flight = null;
    } else {
      const w = p.el.offsetWidth;
      const clearX = clearDistance(p);
      const dir: 1 | -1 = p.x.current > w * 0.25 ? 1 : -1;
      p.away = true;
      if (dir * p.x.current < clearX) {
        // Slide out from under the pile, then land on top of it.
        p.flight = { kind: 'emerge', dir, clearX, seq: ++flightSeq, clear: false };
        p.x.setTarget(dir * (clearX + w * 0.3), {
          velocity: dir * COMMAND_SPEED,
          params: springs.momentum,
        });
        p.r.setTarget(clamp(restPose(0).r + dir * 10, -30, 30), { params: springs.momentum });
        p.s.setTarget(1, { params: springs.default });
      }
    }
    assignZ();
    refreshHints();
    layout(true);
    scheduleTurns();
  }

  /* Reduced motion: the order changes with a short crossfade; nothing travels. */
  function crossfade(kind: 'next' | 'prev', p: Print): void {
    const token = ++fadeToken;
    const later = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        if (!destroyed && token === fadeToken) fn();
      }, ms);
      timers.add(id);
    };
    for (const q of prints) {
      clearTimer(q);
      q.flight = null;
      q.away = false;
      if (q === p) continue;
      q.el.style.transition = '';
      q.el.style.opacity = '';
      jumpTo(q, restPose(depthOf(q)));
    }
    assignZ();
    refreshHints();
    if (kind === 'next') {
      // The old top fades where it is, then waits at the back.
      p.el.style.zIndex = '3000';
      p.el.style.transition = `opacity ${FADE_MS}ms ease`;
      p.el.style.opacity = '0';
      later(() => {
        jumpTo(p, restPose(depthOf(p)));
        assignZ();
        p.el.style.opacity = '';
        later(() => {
          p.el.style.transition = '';
        }, FADE_MS + 30);
      }, FADE_MS);
    } else {
      // The new top fades in, already in place.
      p.el.style.transition = 'none';
      p.el.style.opacity = '0';
      jumpTo(p, restPose(depthOf(p)));
      void p.el.offsetWidth;
      p.el.style.transition = `opacity ${FADE_MS}ms ease`;
      p.el.style.opacity = '';
      later(() => {
        p.el.style.transition = '';
      }, FADE_MS + 30);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Gesture                                                           */
  /* ---------------------------------------------------------------- */

  function printFrom(target: EventTarget | null): Print | null {
    const el = target instanceof Element ? target.closest('[data-stack-print]') : null;
    if (!el) return null;
    return prints.find((p) => p.el === el) ?? null;
  }

  function measure(d: Drag): void {
    const rect = pile!.getBoundingClientRect();
    d.cx = rect.left + rect.width / 2;
    d.cy = rect.top + rect.height / 2;
  }

  /** Begin 1:1 tracking from the print's live transform. Nothing jumps. */
  function lock(px: number, py: number, t: number): void {
    const d = drag!;
    const p = d.print;
    // Catching a print that had already left makes it the top print again.
    p.flight = null;
    p.away = false;
    if (order[0] !== p.index) {
      toFront(p);
      updateMeta();
    }
    measure(d);
    const x = p.x.current;
    const y = p.y.current;
    p.x.jump(x);
    p.y.jump(y);
    d.w = p.el.offsetWidth || 1;
    d.grabX = px - (d.cx + x);
    d.grabY = py - (d.cy + y);
    d.r0 = p.r.current;
    d.s0 = p.s.current || 1;
    d.lockX = px;
    d.x0 = x;
    d.lastX = px;
    d.lastY = py;
    const lever = clamp(-d.grabY / ((p.el.offsetHeight || 1) / 2), -1, 1);
    d.lever = (lever < 0 ? -1 : 1) * (0.35 + 0.65 * Math.abs(lever));
    d.samples = [{ x: px, y: py, t }];
    d.locked = true;
    p.r.setTarget(tiltFor(d, x), { params: springs.snappy });
    p.s.setTarget(1, { params: springs.snappy });
    pile!.classList.add('is-dragging');
    assignZ();
    refreshHints();
    layout(true);
    scheduleTurns();
  }

  function tiltFor(d: Drag, x: number): number {
    if (prefersReducedMotion()) return d.r0;
    return restPose(0).r + d.lever * clamp(x / d.w, -1.3, 1.3) * TILT;
  }

  /** Place the print so the grabbed point sits exactly under the pointer. */
  function solveDrag(): void {
    const d = drag!;
    const p = d.print;
    const angle = ((p.r.current - d.r0) * Math.PI) / 180;
    const k = p.s.current / d.s0;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const gx = k * (d.grabX * cos - d.grabY * sin);
    const gy = k * (d.grabX * sin + d.grabY * cos);
    p.x.jump(d.lastX - gx - d.cx);
    p.y.jump(d.lastY - gy - d.cy);
    apply(p);
  }

  function velocityAt(d: Drag, t: number): { x: number; y: number } {
    const recent = d.samples.filter((s) => t - s.t <= VELOCITY_WINDOW_MS);
    if (recent.length < 2) return { x: 0, y: 0 };
    const a = recent[0]!;
    const b = recent[recent.length - 1]!;
    // Measured up to the release itself, so a pointer that paused before
    // letting go reports the pause instead of its last burst of speed.
    const dt = Math.max(t - a.t, 8) / 1000;
    let vx = (b.x - a.x) / dt;
    let vy = (b.y - a.y) / dt;
    const speed = Math.hypot(vx, vy);
    if (speed > MAX_SPEED) {
      vx *= MAX_SPEED / speed;
      vy *= MAX_SPEED / speed;
    }
    return { x: vx, y: vy };
  }

  function endDrag(): Drag | null {
    const d = drag;
    if (!d) return null;
    drag = null;
    d.print.el.classList.remove('is-held');
    pile!.classList.remove('is-dragging');
    try {
      if (pile!.hasPointerCapture(d.pointerId)) pile!.releasePointerCapture(d.pointerId);
    } catch {
      // capture already gone
    }
    return d;
  }

  function onPointerDown(e: PointerEvent): void {
    if (drag || destroyed) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = printFrom(e.target);
    if (!p) return;
    const isTop = order[0] === p.index;
    const traveling = p.flight !== null || p.away;
    // A deeper print's peeking edge is not a handle.
    if (!isTop && !traveling) return;
    const home = restPose(depthOf(p));
    const adrift = Math.hypot(p.x.current - home.x, p.y.current - home.y) > 4;
    drag = {
      print: p,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      locked: false,
      tap: isTop && !traveling,
      startX: e.clientX,
      startY: e.clientY,
      startT: e.timeStamp,
      travel: 0,
      cx: 0,
      cy: 0,
      grabX: 0,
      grabY: 0,
      r0: 0,
      s0: 1,
      lockX: e.clientX,
      x0: 0,
      lastX: e.clientX,
      lastY: e.clientY,
      lever: 1,
      w: 1,
      samples: [],
    };
    try {
      pile!.setPointerCapture(e.pointerId);
    } catch {
      // synthetic pointers may not be capturable
    }
    // Feedback lives on the press, not the release.
    p.el.classList.add('is-held');
    // A mouse has no scroll to disambiguate from, and a moving print must
    // stop under the finger at once. A resting print under a touch waits for
    // sideways intent so vertical swipes still scroll the page.
    if (e.pointerType === 'mouse' || traveling || adrift) lock(e.clientX, e.clientY, e.timeStamp);
  }

  function onPointerMove(e: PointerEvent): void {
    const d = drag;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    d.travel = Math.max(d.travel, Math.hypot(dx, dy));
    if (!d.locked) {
      if (Math.abs(dx) > HYSTERESIS && Math.abs(dx) > Math.abs(dy)) {
        lock(e.clientX, e.clientY, e.timeStamp);
      } else if (Math.abs(dy) > HYSTERESIS) {
        endDrag(); // vertical intent: this one belongs to the page scroll
      }
      return;
    }
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    d.samples.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    if (d.samples.length > 24) d.samples.shift();
    d.print.r.setTarget(tiltFor(d, d.x0 + (e.clientX - d.lockX)), { params: springs.snappy });
    solveDrag();
  }

  function release(d: Drag, vx: number, vy: number): void {
    const p = d.print;
    const projected = project(p.x.current, vx);
    if (n > 1 && Math.abs(projected) > d.w * DISMISS_FRACTION) {
      dismiss(p, projected > 0 ? 1 : -1, vx, vy);
    } else {
      goHome(p, vx, vy);
      assignZ();
      refreshHints();
    }
  }

  function onPointerUp(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = endDrag()!;
    const quick = d.travel < TAP_SLOP && e.timeStamp - d.startT < TAP_MS;
    if (d.tap && quick) {
      // Tap the top print to see the next one.
      if (d.locked) {
        dismiss(d.print, 1, COMMAND_SPEED, 0);
      } else {
        next();
      }
      return;
    }
    if (!d.locked) return;
    const v = velocityAt(d, e.timeStamp);
    release(d, v.x, v.y);
  }

  function onPointerCancel(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = endDrag()!;
    if (d.locked) release(d, 0, 0);
  }

  function onTouchMove(e: TouchEvent): void {
    // Once a sideways drag is locked, the gesture is ours.
    if (drag !== null && drag.locked && drag.pointerType !== 'mouse' && e.cancelable) {
      e.preventDefault();
    }
  }

  function onScroll(): void {
    if (drag === null || !drag.locked) return;
    measure(drag);
    solveDrag();
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.target !== pile || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      next();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      previous();
    }
  }

  const onDragStart = (e: Event) => e.preventDefault();

  pile.addEventListener('pointerdown', onPointerDown);
  pile.addEventListener('pointermove', onPointerMove);
  pile.addEventListener('pointerup', onPointerUp);
  pile.addEventListener('pointercancel', onPointerCancel);
  pile.addEventListener('lostpointercapture', onPointerCancel);
  pile.addEventListener('touchmove', onTouchMove, { passive: false });
  pile.addEventListener('keydown', onKeyDown);
  pile.addEventListener('dragstart', onDragStart);
  window.addEventListener('scroll', onScroll, { passive: true });
  nextBtn?.addEventListener('click', next);
  prevBtn?.addEventListener('click', previous);

  holdViewportClip();
  updateMeta();
  assignZ();
  refreshHints();
  root.setAttribute('data-stack-ready', '');
  if (import.meta.env.DEV) {
    const w = window as Window & { __photoStackMounts?: number };
    w.__photoStackMounts = (w.__photoStackMounts ?? 0) + 1;
  }

  return () => {
    if (destroyed) return;
    destroyed = true;
    endDrag();
    for (const id of timers) window.clearTimeout(id);
    timers.clear();
    for (const p of prints) {
      p.x.destroy();
      p.y.destroy();
      p.r.destroy();
      p.s.destroy();
    }
    pile.removeEventListener('pointerdown', onPointerDown);
    pile.removeEventListener('pointermove', onPointerMove);
    pile.removeEventListener('pointerup', onPointerUp);
    pile.removeEventListener('pointercancel', onPointerCancel);
    pile.removeEventListener('lostpointercapture', onPointerCancel);
    pile.removeEventListener('touchmove', onTouchMove);
    pile.removeEventListener('keydown', onKeyDown);
    pile.removeEventListener('dragstart', onDragStart);
    window.removeEventListener('scroll', onScroll);
    nextBtn?.removeEventListener('click', next);
    prevBtn?.removeEventListener('click', previous);
    releaseViewportClip();
    root.removeAttribute('data-stack-ready');
    if (import.meta.env.DEV) {
      const w = window as Window & { __photoStackMounts?: number };
      w.__photoStackMounts = (w.__photoStackMounts ?? 1) - 1;
    }
  };
}
