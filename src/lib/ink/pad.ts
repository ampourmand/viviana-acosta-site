/**
 * Guestbook ink pad: visitors write or doodle a note in real ink.
 *
 * Feel first: the pen responds on pointer-down, the live stroke follows the
 * pointer 1:1, pressure shapes the line (true pressure from a pencil,
 * speed-derived for mouse and finger: slow is heavy, fast is light), and
 * fresh ink dries from wet to its final color.
 *
 * The drawing lives in a fixed 600x320 viewBox, so the data is resolution
 * independent. On every change it is serialized into a hidden form field as
 * a compact, self-contained SVG string that travels with the contact form.
 */
import { getStroke } from 'perfect-freehand';
import { prefersReducedMotion } from '../motion/prefs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VB_W = 600;
const VB_H = 320;

/** Hard cap on the serialized field, in characters. */
export const GUESTBOOK_MAX_CHARS = 14000;

/**
 * The wire format counts in eighths of a viewBox unit, written as plain
 * integers inside one scaled group: the same precision as one decimal place
 * for about a quarter fewer characters, which is a quarter more page.
 */
const WIRE_SCALE = 8;
const SVG_OPEN = `<svg xmlns="${SVG_NS}" viewBox="0 0 ${VB_W} ${VB_H}"><g transform="scale(${1 / WIRE_SCALE})">`;
const SVG_CLOSE = '</g></svg>';
/** Characters around a run of same-ink strokes: <path fill="#rrggbb" d=""/> */
const PATH_OVERHEAD = 27;

/** The nib. Units are viewBox units (about one CSS pixel on desktop). */
const NIB = {
  size: 5.5,
  thinning: 0.6,
  smoothing: 0.5,
  streamline: 0.3,
  taperStart: 9,
  taperEnd: 13,
} as const;

/** Ignore samples closer than this to the last recorded one. */
const MIN_STEP = 0.7;
/** Shorter than this, a stroke is a dot. */
const DOT_LENGTH = 2.2;
/** The nib resting on paper before it moves: a pinpoint of ink. */
const REST_RADIUS = 1.3;
/** How far past the page edge a captured stroke may wander. */
const EDGE = 6;
/** Outline simplification tolerance for the serialized path. */
const RDP_TOLERANCE = 0.3;
/** Most the serialized curve may round off a sharp corner, in units. */
const CORNER_ROUNDING = 0.35;
/** Corners turning harder than this (about 35 degrees) get guard points. */
const SHARP_TURN = 0.6;
/** Wet ink lingers this long after the pen lifts, then dries. */
const DRY_DELAY_MS = 450;
/** While drawing, re-measure the live stroke's cost every N units of travel. */
const CHECK_EVERY = 40;
/** Room kept free for the growth between two cost checks. */
const GUARD_MARGIN = 420;
/** Below this much room the page counts as full. */
const MIN_ROOM = 140;

const FULL_MESSAGE = 'Page is full. Undo or clear to make room.';

const INKS = {
  wine: '--wine',
  burgundy: '--burgundy',
  mauve: '--mauve',
} as const;
type InkKey = keyof typeof INKS;

const INK_FALLBACK: Record<InkKey, string> = {
  wine: '#6e2a48',
  burgundy: '#7e2136',
  mauve: '#a86e93',
};

export type Sample = [x: number, y: number, pressure: number];

interface Committed {
  el: SVGPathElement;
  ink: InkKey;
  /** Compact serialized path data. */
  d: string;
  dryTimer: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* ------------------------------------------------------------------ */
/* Geometry: outline -> display path, outline -> compact path          */
/* ------------------------------------------------------------------ */

export function outlineOf(points: Sample[], complete: boolean): number[][] {
  return getStroke(points, {
    size: NIB.size,
    thinning: NIB.thinning,
    smoothing: NIB.smoothing,
    streamline: NIB.streamline,
    simulatePressure: false,
    start: { taper: NIB.taperStart, cap: true },
    end: { taper: NIB.taperEnd, cap: true },
    last: complete,
  });
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Smooth closed path for the screen (quadratics through edge midpoints). */
export function displayPath(outline: number[][]): string {
  const n = outline.length;
  if (n < 3) return '';
  let d = `M${r2(outline[0]![0]!)},${r2(outline[0]![1]!)} Q`;
  for (let i = 0; i < n; i++) {
    const a = outline[i]!;
    const b = outline[(i + 1) % n]!;
    d += `${r2(a[0]!)},${r2(a[1]!)} ${r2((a[0]! + b[0]!) / 2)},${r2((a[1]! + b[1]!) / 2)} `;
  }
  return d + 'Z';
}

/** A separator is only needed when the next number has no leading minus. */
const sep = (next: string) => (next.startsWith('-') ? '' : ' ');

/** Builds path data from integers with the fewest separators SVG allows. */
function pathWriter() {
  let d = '';
  let fresh = true; // no separator right after a command letter
  return {
    cmd(c: string) {
      d += c;
      fresh = true;
    },
    put(v: number) {
      const s = String(v);
      d += (fresh ? '' : sep(s)) + s;
      fresh = false;
    },
    done: () => d,
  };
}

/** A dot of ink for the screen: two half circles, in viewBox units. */
function dotPath(x: number, y: number, r: number): string {
  const f = (v: number) => String(Math.round(v * 100) / 100);
  return `M${f(x - r)} ${f(y)}a${f(r)} ${f(r)} 0 1 0 ${f(r * 2)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-r * 2)} 0z`;
}

/** The same dot for the wire, in integer wire units. */
function compactDot(x: number, y: number, r: number): string {
  const rr = Math.max(2, Math.round(r * WIRE_SCALE));
  const cx = Math.round(x * WIRE_SCALE);
  const cy = Math.round(y * WIRE_SCALE);
  return `M${cx - rr} ${cy}a${rr} ${rr} 0 1 0 ${rr * 2} 0a${rr} ${rr} 0 1 0 ${-rr * 2} 0z`;
}

/** Ramer-Douglas-Peucker on an open run of points (iterative). */
function simplify(pts: number[][], tolerance: number): number[][] {
  const n = pts.length;
  if (n <= 2) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const tol2 = tolerance * tolerance;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = pts[a]![0]!;
    const ay = pts[a]![1]!;
    const dx = pts[b]![0]! - ax;
    const dy = pts[b]![1]! - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i]![0]! - ax;
      const py = pts[i]![1]! - ay;
      let d2: number;
      if (len2 === 0) {
        d2 = px * px + py * py;
      } else {
        const t = clamp((px * dx + py * dy) / len2, 0, 1);
        const qx = px - t * dx;
        const qy = py - t * dy;
        d2 = qx * qx + qy * qy;
      }
      if (d2 > worst) {
        worst = d2;
        at = i;
      }
    }
    if (at !== -1 && worst > tol2) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return pts.filter((_, i) => keep[i] === 1);
}

/**
 * The wire format is a smooth curve through the simplified outline. A sharp
 * corner with long straight edges on either side (a zigzag peak, the tip of a
 * stroke) would make that curve bow along the edges, so pin each sharp corner
 * down with a guard point close by on both sides. Gentle bends need none.
 */
function guardCorners(pts: number[][]): number[][] {
  const n = pts.length;
  const reach = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    const a = pts[(i - 1 + n) % n]!;
    const b = pts[(i + 1) % n]!;
    const ax = a[0]! - p[0]!;
    const ay = a[1]! - p[1]!;
    const bx = b[0]! - p[0]!;
    const by = b[1]! - p[1]!;
    const la = Math.hypot(ax, ay) || 1;
    const lb = Math.hypot(bx, by) || 1;
    // 0 on a straight run, 2 on a full reversal.
    const turn = Math.hypot(ax / la + bx / lb, ay / la + by / lb);
    if (turn > SHARP_TURN) reach[i] = clamp((8 * CORNER_ROUNDING) / turn, 1.2, 4);
  }
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const p = pts[i]!;
    const q = pts[j]!;
    out.push(p);
    const dx = q[0]! - p[0]!;
    const dy = q[1]! - p[1]!;
    const len = Math.hypot(dx, dy);
    // Only worth a point when the neighbor is well beyond the guard's reach.
    const nearP = reach[i]! > 0 && len > reach[i]! * 1.5 ? reach[i]! : 0;
    const nearQ = reach[j]! > 0 && len > reach[j]! * 1.5 ? reach[j]! : 0;
    if (nearP && nearQ && nearP + nearQ >= len) {
      out.push([p[0]! + dx / 2, p[1]! + dy / 2]);
      continue;
    }
    if (nearP) out.push([p[0]! + (dx * nearP) / len, p[1]! + (dy * nearP) / len]);
    if (nearQ) out.push([q[0]! - (dx * nearQ) / len, q[1]! - (dy * nearQ) / len]);
  }
  return out;
}

/**
 * A quadratic B-spline runs inside its control polygon. Solve for the control
 * points whose curve passes through the outline points instead (a few Jacobi
 * sweeps of (P[i-1] + 6 P[i] + P[i+1]) / 8 = V[i]; strongly diagonal, so it
 * converges fast). Keeps the wire copy on top of the ink the visitor saw.
 */
function throughPoints(v: number[][]): number[][] {
  const n = v.length;
  let p = v;
  for (let sweep = 0; sweep < 3; sweep++) {
    const next: number[][] = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = p[(i - 1 + n) % n]!;
      const b = p[(i + 1) % n]!;
      next[i] = [(8 * v[i]![0]! - a[0]! - b[0]!) / 6, (8 * v[i]![1]! - a[1]! - b[1]!) / 6];
    }
    p = next;
  }
  return p;
}

/**
 * Compact closed path for the wire. The outline is simplified, its control
 * points snapped to an even grid of wire units, and written as one smooth
 * quadratic chain: `M mid q ctrl mid` followed by relative `t` endpoints,
 * each the midpoint of a polygon edge. A `t` reflects the previous control
 * point through the current point, which lands exactly on the next polygon
 * vertex, so the chain is a quadratic B-spline of the outline at two
 * integers per point. Midpoints of an even grid are whole numbers, so
 * nothing is rounded twice and nothing drifts.
 */
export function compactPath(outline: number[][], tolerance = RDP_TOLERANCE): string {
  const control = throughPoints(guardCorners(simplify(outline, tolerance)));
  const half = WIRE_SCALE / 2;
  const q: Array<[number, number]> = [];
  for (const p of control) {
    const x = Math.round(p[0]! * half) * 2;
    const y = Math.round(p[1]! * half) * 2;
    const last = q[q.length - 1];
    if (!last || last[0] !== x || last[1] !== y) q.push([x, y]);
  }
  if (q.length > 1 && q[0]![0] === q[q.length - 1]![0] && q[0]![1] === q[q.length - 1]![1]) q.pop();
  const n = q.length;
  if (n < 3) return '';

  const midX = (i: number) => (q[i]![0] + q[(i + 1) % n]![0]) / 2;
  const midY = (i: number) => (q[i]![1] + q[(i + 1) % n]![1]) / 2;
  const startX = midX(n - 1);
  const startY = midY(n - 1);

  const w = pathWriter();
  w.cmd('M');
  w.put(startX);
  w.put(startY);
  w.cmd('q');
  w.put(q[0]![0] - startX);
  w.put(q[0]![1] - startY);
  w.put(midX(0) - startX);
  w.put(midY(0) - startY);
  w.cmd('t');
  for (let i = 1; i < n; i++) {
    w.put(midX(i) - midX(i - 1));
    w.put(midY(i) - midY(i - 1));
  }
  return w.done() + 'z';
}

/* ------------------------------------------------------------------ */
/* Pressure                                                            */
/* ------------------------------------------------------------------ */

/**
 * Speed in viewBox units per millisecond -> pressure. Slow is heavy, fast
 * is light; a pen that pauses (corners, reversals) pools a little ink.
 */
function pressureFromSpeed(speed: number): number {
  const t = clamp((speed - 0.02) / 0.9, 0, 1);
  const eased = 1 - (1 - t) * (1 - t);
  return 0.74 - 0.5 * eased;
}

/** Hardware pencil pressure, lifted so light writing still reads. */
function pressureFromPen(raw: number): number {
  return clamp(0.15 + Math.pow(raw, 0.7) * 0.9, 0.12, 0.98);
}

/* ------------------------------------------------------------------ */
/* Color                                                               */
/* ------------------------------------------------------------------ */

let colorProbe: CanvasRenderingContext2D | null | undefined;

/** Resolve a CSS custom property to a concrete #rrggbb for serialization. */
function resolveHex(scope: Element, cssVar: string, fallback: string): string {
  const raw = getComputedStyle(scope).getPropertyValue(cssVar).trim();
  if (!raw) return fallback;
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
  if (colorProbe === undefined) {
    colorProbe = document.createElement('canvas').getContext('2d');
  }
  if (!colorProbe) return fallback;
  colorProbe.fillStyle = fallback;
  colorProbe.fillStyle = raw;
  const out = String(colorProbe.fillStyle);
  return /^#[0-9a-f]{6}$/i.test(out) ? out : fallback;
}

/* ------------------------------------------------------------------ */
/* The pad                                                             */
/* ------------------------------------------------------------------ */

export function mountGuestbookPad(root: HTMLElement): () => void {
  const svg = root.querySelector<SVGSVGElement>('[data-gb-svg]');
  const layer = root.querySelector<SVGGElement>('[data-gb-strokes]');
  const pad = root.querySelector<HTMLElement>('[data-gb-pad]');
  const field = root.querySelector<HTMLInputElement>('[data-gb-field]');
  const undoBtn = root.querySelector<HTMLButtonElement>('[data-gb-undo]');
  const clearBtn = root.querySelector<HTMLButtonElement>('[data-gb-clear]');
  const status = root.querySelector<HTMLElement>('[data-gb-status]');
  const inkBtns = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-gb-ink]'));
  if (!svg || !layer || !pad || !field || root.dataset.gbMounted === 'true') return () => {};
  root.dataset.gbMounted = 'true';

  const strokes: Committed[] = [];
  /** What Clear removed last, so Undo can bring the page back. */
  let cleared: Committed[] | null = null;
  let ink: InkKey =
    (inkBtns.find((b) => b.getAttribute('aria-pressed') === 'true')?.dataset.gbInk as InkKey) ?? 'wine';

  // Live stroke state.
  let liveInk: InkKey = ink;
  let pointerId: number | null = null;
  let points: Sample[] = [];
  let liveEl: SVGPathElement | null = null;
  /** Screen -> viewBox matrix, exact whatever the element's box does. */
  let toUnits: DOMMatrix | null = null;
  let liveLength = 0;
  let checkedAt = 0;
  let inkOut = false;
  let speed = 0;
  let prevX = 0;
  let prevY = 0;
  let prevT = 0;
  let penFirst = 0;
  let penReal = false;

  /* ----- bookkeeping ------------------------------------------------ */

  /**
   * Consecutive strokes in the same ink share one <path> (order is kept, so
   * the picture is identical), which saves its wrapper on every stroke.
   */
  function usedChars(): number {
    let total = SVG_OPEN.length + SVG_CLOSE.length;
    let prev: InkKey | null = null;
    for (const s of strokes) {
      total += s.d.length + (s.ink === prev ? 0 : PATH_OVERHEAD);
      prev = s.ink;
    }
    return total;
  }

  /** What a new stroke with this path data would add to the field. */
  const pathCost = (d: string) =>
    d.length + (strokes.length > 0 && strokes[strokes.length - 1]!.ink === liveInk ? 0 : PATH_OVERHEAD);

  const room = () => GUESTBOOK_MAX_CHARS - usedChars();

  function serialize(): string {
    if (strokes.length === 0) return '';
    let out = SVG_OPEN;
    let prev: InkKey | null = null;
    for (const s of strokes) {
      if (s.ink !== prev) {
        if (prev) out += '"/>';
        out += `<path fill="${resolveHex(root, INKS[s.ink], INK_FALLBACK[s.ink])}" d="`;
        prev = s.ink;
      }
      out += s.d;
    }
    return out + '"/>' + SVG_CLOSE;
  }

  function announce(message: string): void {
    if (status && status.textContent !== message) status.textContent = message;
  }

  function sync(): void {
    const value = serialize();
    if (field!.value !== value) {
      field!.value = value;
      field!.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const count = strokes.length;
    root.dataset.empty = count === 0 && pointerId === null ? 'true' : 'false';
    svg!.setAttribute(
      'aria-label',
      count === 0
        ? 'Guestbook page, empty'
        : `Guestbook page with ${count} ${count === 1 ? 'stroke' : 'strokes'}`,
    );
    setDisabled(undoBtn, count === 0 && !cleared);
    setDisabled(clearBtn, count === 0);
  }

  /** Disabling a focused button drops focus to <body>; keep it in the pad. */
  function setDisabled(btn: HTMLButtonElement | null, disabled: boolean): void {
    if (!btn || btn.disabled === disabled) return;
    const hadFocus = document.activeElement === btn;
    btn.disabled = disabled;
    if (disabled && hadFocus) pad!.focus({ preventScroll: true });
  }

  /* ----- ink ---------------------------------------------------------- */

  function makeStrokeEl(key: InkKey, wet: boolean): SVGPathElement {
    const el = document.createElementNS(SVG_NS, 'path');
    el.setAttribute('class', wet ? 'gb-stroke is-wet' : 'gb-stroke');
    el.style.setProperty('--stroke-ink', `var(${INKS[key]})`);
    return el;
  }

  /** A deliberate dot (a tap): about a stroke's width across. */
  const dotRadius = (pressure: number) => NIB.size * (0.3 + 0.3 * pressure);

  const isDot = () => points.length === 1 || liveLength < DOT_LENGTH;

  function renderLive(): void {
    if (!liveEl) return;
    if (isDot()) {
      const p = points[0]!;
      liveEl.setAttribute('d', dotPath(p[0], p[1], REST_RADIUS));
      return;
    }
    liveEl.setAttribute('d', displayPath(outlineOf(points, false)));
  }

  function toPad(ev: PointerEvent): [number, number] {
    let x: number;
    let y: number;
    if (toUnits) {
      x = toUnits.a * ev.clientX + toUnits.c * ev.clientY + toUnits.e;
      y = toUnits.b * ev.clientX + toUnits.d * ev.clientY + toUnits.f;
    } else {
      const rect = svg!.getBoundingClientRect();
      x = ((ev.clientX - rect.left) / rect.width) * VB_W;
      y = ((ev.clientY - rect.top) / rect.height) * VB_H;
    }
    return [clamp(x, -EDGE, VB_W + EDGE), clamp(y, -EDGE, VB_H + EDGE)];
  }

  function pressureFor(ev: PointerEvent, x: number, y: number): number {
    if (ev.pointerType === 'pen') {
      if (!penReal && ev.pressure > 0 && Math.abs(ev.pressure - penFirst) > 0.015) penReal = true;
      if (penReal) return pressureFromPen(ev.pressure);
    }
    // Rate-independent speed estimate, smoothed over ~45ms of pen travel.
    const dt = ev.timeStamp - prevT;
    if (dt > 0) {
      const inst = Math.hypot(x - prevX, y - prevY) / dt;
      speed += (inst - speed) * (1 - Math.exp(-dt / 45));
      prevX = x;
      prevY = y;
      prevT = ev.timeStamp;
    }
    return pressureFromSpeed(speed);
  }

  function addSample(ev: PointerEvent): void {
    const [x, y] = toPad(ev);
    const pressure = pressureFor(ev, x, y);
    const last = points[points.length - 1]!;
    const step = Math.hypot(x - last[0], y - last[1]);
    if (step < MIN_STEP) return;
    points.push([x, y, pressure]);
    liveLength += step;
    ((window as unknown as { __gbDbg?: unknown[] }).__gbDbg ??= []).push([+x.toFixed(1), +y.toFixed(1), +pressure.toFixed(3), +speed.toFixed(3), +(ev.timeStamp).toFixed(1)]);
  }

  /** While drawing, stop the ink before a stroke outgrows the page. */
  function guardRoom(): void {
    if (liveLength - checkedAt < CHECK_EVERY) return;
    checkedAt = liveLength;
    const cost = pathCost(compactPath(outlineOf(points, false)));
    if (cost > room() - GUARD_MARGIN) {
      inkOut = true;
      announce(FULL_MESSAGE);
    }
  }

  function refreshMatrix(): void {
    toUnits = svg!.getScreenCTM()?.inverse() ?? null;
  }

  function onDown(ev: PointerEvent): void {
    if (pointerId !== null) return;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    ev.preventDefault();
    pad!.focus({ preventScroll: true });
    if (room() < MIN_ROOM) {
      announce(FULL_MESSAGE);
      return;
    }
    try {
      svg!.setPointerCapture(ev.pointerId);
    } catch {
      // Synthetic pointers cannot be captured; drawing still works in-bounds.
    }
    pointerId = ev.pointerId;
    refreshMatrix();
    window.addEventListener('scroll', refreshMatrix, { passive: true });
    window.addEventListener('resize', refreshMatrix);

    const [x, y] = toPad(ev);
    speed = 0;
    prevX = x;
    prevY = y;
    prevT = ev.timeStamp;
    penFirst = ev.pressure;
    penReal = ev.pointerType === 'pen' && ev.pressure > 0 && ev.pressure !== 0.5;
    points = [[x, y, penReal ? pressureFromPen(ev.pressure) : 0.5]];
    liveLength = 0;
    checkedAt = 0;
    inkOut = false;

    // A fresh stroke means the cleared page is gone for good.
    cleared = null;
    announce('');
    liveInk = ink;
    liveEl = makeStrokeEl(liveInk, !prefersReducedMotion());
    layer!.appendChild(liveEl);
    renderLive(); // ink lands on pointer-down, not on release
    sync();
  }

  function onMove(ev: PointerEvent): void {
    if (ev.pointerId !== pointerId || inkOut) return;
    const batch = typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : [];
    if (batch.length > 0) for (const sub of batch) addSample(sub);
    else addSample(ev);
    guardRoom();
    renderLive();
  }

  /** Trim the stroke to the longest prefix that still fits on the page. */
  function fitToRoom(available: number): string {
    let lo = 4;
    let hi = points.length;
    let best = '';
    let bestLength = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const d = compactPath(outlineOf(points.slice(0, mid), true));
      if (d && pathCost(d) <= available) {
        best = d;
        bestLength = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (best) points = points.slice(0, bestLength);
    return best;
  }

  function finish(ev: PointerEvent): void {
    if (ev.pointerId !== pointerId) return;
    if (ev.type === 'pointerup' && !inkOut) addSample(ev);
    endStroke();
  }

  function endStroke(): void {
    if (pointerId === null) return;
    const id = pointerId;
    pointerId = null;
    window.removeEventListener('scroll', refreshMatrix);
    window.removeEventListener('resize', refreshMatrix);
    try {
      if (svg!.hasPointerCapture(id)) svg!.releasePointerCapture(id);
    } catch {
      // nothing to release
    }
    const el = liveEl;
    liveEl = null;
    if (!el) return;

    const available = room();
    let d = '';
    let shown = '';
    const dot = isDot();
    if (!dot) {
      const outline = outlineOf(points, true);
      d = compactPath(outline);
      shown = displayPath(outline);
    }
    if (!d) {
      // A tap, or a stroke too small to have an outline: a dot of ink.
      const p = points[0]!;
      d = compactDot(p[0], p[1], dotRadius(p[2]));
      shown = dotPath(p[0], p[1], dotRadius(p[2]));
    }
    if (pathCost(d) > available) {
      d = dot ? '' : fitToRoom(available);
      shown = d ? displayPath(outlineOf(points, true)) : '';
      announce(FULL_MESSAGE);
    }

    if (!d) {
      // Nothing fits: let the stroke fade instead of blinking out.
      el.classList.add('is-rejected');
      window.setTimeout(() => el.remove(), prefersReducedMotion() ? 0 : 300);
      sync();
      return;
    }

    el.setAttribute('d', shown);
    const stroke: Committed = { el, ink: liveInk, d, dryTimer: 0 };
    if (el.classList.contains('is-wet')) {
      stroke.dryTimer = window.setTimeout(() => {
        el.classList.remove('is-wet');
        stroke.dryTimer = 0;
      }, DRY_DELAY_MS);
    }
    strokes.push(stroke);
    sync();
  }

  /* ----- controls ----------------------------------------------------- */

  function drop(stroke: Committed): void {
    if (stroke.dryTimer) window.clearTimeout(stroke.dryTimer);
    stroke.dryTimer = 0;
    stroke.el.remove();
  }

  function undo(): void {
    if (pointerId !== null) return;
    if (strokes.length === 0) {
      if (!cleared) return;
      // Undo a Clear: the page comes back, already dry.
      for (const s of cleared) {
        s.el.classList.remove('is-wet');
        layer!.appendChild(s.el);
        strokes.push(s);
      }
      cleared = null;
      announce('Page restored.');
      sync();
      return;
    }
    drop(strokes.pop()!);
    announce('');
    sync();
  }

  function clear(): void {
    if (pointerId !== null || strokes.length === 0) return;
    cleared = strokes.splice(0, strokes.length);
    for (const s of cleared) drop(s);
    announce('Page cleared. Undo brings it back.');
    sync();
  }

  function pickInk(btn: HTMLButtonElement): void {
    const key = btn.dataset.gbInk as InkKey | undefined;
    if (!key || !(key in INKS)) return;
    ink = key;
    for (const b of inkBtns) b.setAttribute('aria-pressed', String(b === btn));
  }

  function onKey(ev: KeyboardEvent): void {
    if ((ev.metaKey || ev.ctrlKey) && !ev.shiftKey && !ev.altKey && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      undo();
    }
  }

  /** A form reset empties the hidden field; the page should follow. */
  function onFormReset(): void {
    for (const s of strokes.splice(0, strokes.length)) drop(s);
    cleared = null;
    announce('');
    // The reset applies after this event; sync once it has.
    window.setTimeout(sync, 0);
  }

  const inkHandlers = inkBtns.map((btn) => {
    const handler = () => pickInk(btn);
    btn.addEventListener('click', handler);
    return [btn, handler] as const;
  });
  const form = field.form;

  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerup', finish);
  svg.addEventListener('pointercancel', finish);
  svg.addEventListener('lostpointercapture', endStroke);
  undoBtn?.addEventListener('click', undo);
  clearBtn?.addEventListener('click', clear);
  root.addEventListener('keydown', onKey);
  form?.addEventListener('reset', onFormReset);

  sync();

  return () => {
    endStroke();
    svg.removeEventListener('pointerdown', onDown);
    svg.removeEventListener('pointermove', onMove);
    svg.removeEventListener('pointerup', finish);
    svg.removeEventListener('pointercancel', finish);
    svg.removeEventListener('lostpointercapture', endStroke);
    undoBtn?.removeEventListener('click', undo);
    clearBtn?.removeEventListener('click', clear);
    root.removeEventListener('keydown', onKey);
    form?.removeEventListener('reset', onFormReset);
    for (const [btn, handler] of inkHandlers) btn.removeEventListener('click', handler);
    window.removeEventListener('scroll', refreshMatrix);
    window.removeEventListener('resize', refreshMatrix);
    for (const s of strokes) if (s.dryTimer) window.clearTimeout(s.dryTimer);
    delete root.dataset.gbMounted;
  };
}
