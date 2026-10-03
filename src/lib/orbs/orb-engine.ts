/**
 * Particle dot-sphere orbs, canvas 2D.
 *
 * Geometry recipe ported from `thinking-orbs` by Jakub Antalik
 * (github.com/Jakubantalik/thinking-orbs, MIT license), re-inked for this
 * site as pen stipple: wine dots on paper, blush dots on wine. The register's hard rules, kept on purpose:
 * orthographic projection (no perspective divide), depth carried by dot
 * radius and ink value alone, honest z-sorting, deterministic hash noise,
 * and absolutely no gradients, shadowBlur, glow, or filters per dot.
 */
import { addTick } from '../motion/ticker';
import { Spring } from '../motion/spring';
import { springs } from '../motion/tokens';
import { prefersReducedMotion } from '../motion/prefs';

export interface Dot {
  x: number;
  y: number;
  z: number; // -1 .. 1 after rotation
  r: number;
  /** 0 = nearest/brightest .. 1 = farthest/dimmest (pre-ramp ink value) */
  ink: number;
  a: number;
  /** accent-ink flag, assigned from the stable generation index */
  accent?: boolean;
}

export interface Edge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  a: number;
}

export interface OrbFrame {
  dots: Dot[];
  edges: Edge[];
}

export type OrbMode = 'globe' | 'orbits' | 'web' | 'fib';

export interface OrbConfig {
  mode: OrbMode;
  size: number; // css px (square)
  speed: number;
  count: number; // particle budget hint (mode-dependent meaning)
  accentRatio: number; // fraction of dots in the accent ink
  seed: number;
  edges: boolean; // proximity constellation lines (web mode)
  alphaFloor: number; // raised under prefers-contrast
  /** Extra rotation from the reader's hand (drag to spin), in radians. */
  yawOffset: number;
  tiltOffset: number;
}

export const defaultConfig: OrbConfig = {
  mode: 'globe',
  size: 48,
  speed: 1,
  count: 220,
  accentRatio: 0.07,
  seed: 7,
  edges: false,
  alphaFloor: 0,
  yawOffset: 0,
  tiltOffset: 0,
};

/* ------------------------------------------------------------------ */
/* Deterministic primitives (no Math.random anywhere)                  */
/* ------------------------------------------------------------------ */

const frac = (v: number) => v - Math.floor(v);

function hash2(a: number, b: number): number {
  return frac(Math.sin(a * 12.9898 + b * 78.233) * 43758.5453);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Smoothstep-interpolated value noise on a 2D lattice. */
function vnoise(a: number, b: number): number {
  const ia = Math.floor(a);
  const ib = Math.floor(b);
  const fa = smooth(frac(a));
  const fb = smooth(frac(b));
  const v00 = hash2(ia, ib);
  const v10 = hash2(ia + 1, ib);
  const v01 = hash2(ia, ib + 1);
  const v11 = hash2(ia + 1, ib + 1);
  return (
    v00 * (1 - fa) * (1 - fb) +
    v10 * fa * (1 - fb) +
    v01 * (1 - fa) * fb +
    v11 * fa * fb
  );
}

/** Fibonacci sphere direction i of n. */
function fibDir(i: number, n: number): [number, number, number] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (2 * (i + 0.5)) / n;
  const rad = Math.sqrt(Math.max(0, 1 - y * y));
  const a = i * golden;
  return [rad * Math.cos(a), y, rad * Math.sin(a)];
}

function angleDelta(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Sub-linear dot radius scaling keeps small orbs crisp. */
const radiusScale = (size: number) => Math.pow(size / 300, 0.6);

interface Projector {
  (x: number, y: number, z: number): [number, number, number];
}

function makeProj(
  yaw: number,
  tilt: number,
  cx: number,
  cy: number,
  scale: number,
): Projector {
  const cy1 = Math.cos(yaw);
  const sy1 = Math.sin(yaw);
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  return (x, y, z) => {
    const x1 = x * cy1 + z * sy1;
    const z1 = -x * sy1 + z * cy1;
    const y1 = y * ct - z1 * st;
    const z2 = y * st + z1 * ct;
    // Orthographic on purpose; the flat look is the aesthetic.
    return [cx + x1 * scale, cy - y1 * scale, z2];
  };
}

/* ------------------------------------------------------------------ */
/* Geometry modes: pure functions of (cfg, t) -> frame                 */
/* ------------------------------------------------------------------ */

function globeFrame(cfg: OrbConfig, t: number): OrbFrame {
  const { size, seed } = cfg;
  const rs = radiusScale(size);
  const half = size / 2;
  const scale = half * 0.82;
  const yaw = t * 0.5;
  const tilt = 0.4 + 0.06 * Math.sin(t * 0.35);
  const proj = makeProj(yaw + cfg.yawOffset, tilt + cfg.tiltOffset, half, half, scale);
  const dots: Dot[] = [];

  // Lat/long lattice with density-corrected rows.
  const latRings = Math.max(7, Math.round(Math.sqrt(cfg.count / 2.6)) + 4);
  const lonDensity = Math.max(10, Math.round(cfg.count / latRings) * 1.6);
  const scanAngle = 0; // scan meridian fixed; sphere spins beneath it

  for (let ri = 1; ri < latRings; ri++) {
    const lat = (ri / latRings) * Math.PI - Math.PI / 2;
    const lonCount = Math.max(3, Math.round(Math.abs(Math.cos(lat)) * lonDensity));
    for (let li = 0; li < lonCount; li++) {
      const lon = (li / lonCount) * Math.PI * 2 + seed;
      const x = Math.cos(lat) * Math.cos(lon);
      const y = Math.sin(lat);
      const z = Math.cos(lat) * Math.sin(lon);
      const [sx, sy, sz] = proj(x, y, z);
      const depth = (sz + 1) / 2;
      // Gaussian size ripple along a scanning meridian: a hand, not a shine.
      const d = angleDelta(lon + t * 0.9, scanAngle);
      const boost = Math.exp(-(d * d) / 0.18) * Math.max(0, sz);
      const r = Math.max(0.3, (0.6 + 1.7 * depth + boost * 1.2) * rs);
      const a = Math.max(cfg.alphaFloor, 0.32 + 0.62 * depth + boost * 0.25);
      dots.push({ x: sx, y: sy, z: sz, r, ink: 1 - depth, a });
    }
  }
  return { dots, edges: [] };
}

function orbitsFrame(cfg: OrbConfig, t: number): OrbFrame {
  const { size, seed } = cfg;
  const rs = radiusScale(size);
  const half = size / 2;
  const scale = half * 0.8;
  const proj = makeProj(t * 0.16 + cfg.yawOffset, 0.35 + cfg.tiltOffset, half, half, scale);
  const dots: Dot[] = [];
  const rings = 10;
  const ghostPer = 36;

  for (let k = 0; k < rings; k++) {
    const tiltA = hash2(seed + k, 3.1) * Math.PI;
    const tiltB = hash2(seed + k, 7.7) * Math.PI;
    const ca = Math.cos(tiltA), sa = Math.sin(tiltA);
    const cb = Math.cos(tiltB), sb = Math.sin(tiltB);
    const orient = (x: number, y: number, z: number): [number, number, number] => {
      const y1 = y * ca - z * sa;
      const z1 = y * sa + z * ca;
      const x2 = x * cb + z1 * sb;
      const z2 = -x * sb + z1 * cb;
      return [x2, y1, z2];
    };
    // Ghost orbit path: faint structure, no glow.
    for (let g = 0; g < ghostPer; g++) {
      const ang = (g / ghostPer) * Math.PI * 2;
      const [ox, oy, oz] = orient(Math.cos(ang), 0, Math.sin(ang));
      const [sx, sy, sz] = proj(ox, oy, oz);
      const depth = (sz + 1) / 2;
      dots.push({
        x: sx, y: sy, z: sz,
        r: Math.max(0.3, 0.55 * rs + 0.4 * depth * rs),
        ink: 1 - depth * 0.85,
        a: Math.max(cfg.alphaFloor, 0.1 + 0.28 * depth),
      });
    }
    // Travelers on the orbit.
    for (let p = 0; p < 3; p++) {
      const ang = t * (0.5 + hash2(seed + k, p + 11) * 0.9) + p * ((Math.PI * 2) / 3);
      const [ox, oy, oz] = orient(Math.cos(ang), 0, Math.sin(ang));
      const [sx, sy, sz] = proj(ox, oy, oz);
      const depth = (sz + 1) / 2;
      dots.push({
        x: sx, y: sy, z: sz,
        r: Math.max(0.4, (1.2 + 1.6 * depth) * rs),
        ink: 1 - depth,
        a: Math.max(cfg.alphaFloor, 0.45 + 0.55 * depth),
      });
    }
  }
  return { dots, edges: [] };
}

function webFrame(cfg: OrbConfig, t: number): OrbFrame {
  const { size, seed, count } = cfg;
  const rs = radiusScale(size);
  const half = size / 2;
  const scale = half * 0.78;
  const proj = makeProj(
    t * 0.12 + cfg.yawOffset,
    0.38 + 0.05 * Math.sin(t * 0.3) + cfg.tiltOffset,
    half,
    half,
    scale,
  );
  const dots: Dot[] = [];
  const unit: Array<[number, number, number]> = [];

  for (let i = 0; i < count; i++) {
    let [x, y, z] = fibDir(i, count);
    // Organic drift: value noise per axis, then renormalize back onto the
    // sphere; the renormalization is what keeps scatter on the surface.
    x += 0.3 * (vnoise(i * 0.31 + 9 + seed, t * 0.24) - 0.5) * 2;
    y += 0.3 * (vnoise(i * 0.47 + 31 + seed, t * 0.21) - 0.5) * 2;
    z += 0.3 * (vnoise(i * 0.59 + 57 + seed, t * 0.27) - 0.5) * 2;
    const len = Math.hypot(x, y, z) || 1;
    x /= len; y /= len; z /= len;
    unit.push([x, y, z]);
    const [sx, sy, sz] = proj(x, y, z);
    const depth = (sz + 1) / 2;
    dots.push({
      x: sx, y: sy, z: sz,
      r: Math.max(0.3, (0.6 + 1.7 * depth) * rs),
      ink: 1 - depth,
      a: Math.max(cfg.alphaFloor, 0.34 + 0.6 * depth),
    });
  }

  const edges: Edge[] = [];
  if (cfg.edges) {
    // Proximity constellation lines in unit-sphere space; sparse and honest.
    const thr = 0.4;
    for (let i = 0; i < count; i++) {
      const a = unit[i]!;
      for (let j = i + 1; j < count; j++) {
        const b = unit[j]!;
        const dx = a[0] - b[0];
        if (dx > thr || dx < -thr) continue;
        const dist = Math.hypot(dx, a[1] - b[1], a[2] - b[2]);
        if (dist < thr && hash2(i * 31 + j, seed) > 0.6) {
          const di = dots[i]!;
          const dj = dots[j]!;
          const depth = ((di.z + dj.z) / 2 + 1) / 2;
          edges.push({
            x1: di.x, y1: di.y, x2: dj.x, y2: dj.y,
            a: (1 - dist / thr) * (0.05 + 0.16 * depth),
          });
        }
      }
    }
  }
  return { dots, edges };
}

function fibFrame(cfg: OrbConfig, t: number): OrbFrame {
  const { size, count } = cfg;
  const rs = radiusScale(size);
  const half = size / 2;
  const proj = makeProj(t * 0.4 + cfg.yawOffset, 0.35 + cfg.tiltOffset, half, half, half * 0.82);
  const dots: Dot[] = [];
  for (let i = 0; i < count; i++) {
    const [x, y, z] = fibDir(i, count);
    const [sx, sy, sz] = proj(x, y, z);
    const depth = (sz + 1) / 2;
    dots.push({
      x: sx, y: sy, z: sz,
      r: Math.max(0.3, (0.6 + 1.7 * depth) * rs),
      ink: 1 - depth,
      a: Math.max(cfg.alphaFloor, 0.34 + 0.6 * depth),
    });
  }
  return { dots, edges: [] };
}

const modes: Record<OrbMode, (cfg: OrbConfig, t: number) => OrbFrame> = {
  globe: globeFrame,
  orbits: orbitsFrame,
  web: webFrame,
  fib: fibFrame,
};

/* ------------------------------------------------------------------ */
/* Painter: ink value -> two-stop ramp read from the surface the orb   */
/* sits on (CSS variables), so it is wine stipple on paper and blush   */
/* stipple on wine. Matte fills only.                                  */
/* ------------------------------------------------------------------ */

interface RGB {
  r: number;
  g: number;
  b: number;
}

interface OrbPalette {
  near: RGB;
  far: RGB;
  accent: RGB;
}

const FALLBACK: OrbPalette = {
  near: { r: 74, g: 26, b: 48 },
  far: { r: 205, g: 170, b: 182 },
  accent: { r: 168, g: 110, b: 147 },
};

function readTriplet(style: CSSStyleDeclaration, name: string, fallback: RGB): RGB {
  const parts = style.getPropertyValue(name).trim().split(/[\s,]+/).map(Number);
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return fallback;
  return { r: parts[0]!, g: parts[1]!, b: parts[2]! };
}

function readPalette(el: Element): OrbPalette {
  const style = getComputedStyle(el);
  return {
    near: readTriplet(style, '--orb-near', FALLBACK.near),
    far: readTriplet(style, '--orb-far', FALLBACK.far),
    accent: readTriplet(style, '--orb-accent', FALLBACK.accent),
  };
}

function inkColor(p: OrbPalette, ink: number, accent: boolean): string {
  const t = 1 - ink; // 1 near, 0 far
  let r = p.far.r + (p.near.r - p.far.r) * t;
  let g = p.far.g + (p.near.g - p.far.g) * t;
  let b = p.far.b + (p.near.b - p.far.b) * t;
  if (accent) {
    r = r * 0.35 + p.accent.r * 0.65;
    g = g * 0.35 + p.accent.g * 0.65;
    b = b * 0.35 + p.accent.b * 0.65;
  }
  return `rgb(${r | 0} ${g | 0} ${b | 0})`;
}

/* ------------------------------------------------------------------ */
/* Orb instance                                                        */
/* ------------------------------------------------------------------ */

/** Keep the poles from flipping over while the reader drags. */
const clampTilt = (v: number) => Math.max(-1.1, Math.min(1.1, v));

export class Orb {
  private cfg: OrbConfig;
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private removeTickFn: (() => void) | null = null;
  private io: IntersectionObserver | null = null;
  private visible = true;
  private speedSpring: Spring;
  private scaleSpring: Spring;
  private speedFactor = 1;
  private drawScale = 1;
  private phase: number;
  private palette: OrbPalette;
  // Drag-to-spin: the reader's hand adds rotation; a flick keeps coasting.
  private spinVelocity = 0; // rad/s around the vertical axis
  private tiltVelocity = 0;
  private dragging = false;
  private detachSpin: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement, cfg: Partial<OrbConfig> = {}) {
    this.cfg = { ...defaultConfig, ...cfg };
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    this.ctx = ctx;
    this.phase = this.cfg.seed * 137.1;
    this.palette = readPalette(canvas);
    this.raster();

    this.speedSpring = new Spring(1, springs.gentle, (v) => {
      this.speedFactor = v;
    });
    this.scaleSpring = new Spring(1, springs.default, (v) => {
      this.drawScale = v;
    });

    this.io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        this.visible = entry.isIntersecting;
        if (this.visible) this.start();
        else this.stopLoop();
      }
    });
    this.io.observe(canvas);
  }

  private raster(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const { size } = this.cfg;
    this.canvas.width = Math.round(size * dpr);
    this.canvas.height = Math.round(size * dpr);
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  start(): void {
    if (prefersReducedMotion()) {
      this.renderStatic();
      return;
    }
    if (this.removeTickFn || !this.visible) return;
    this.removeTickFn = addTick((now, dt) => {
      // Integrate our own clock so speed springs modulate smoothly.
      void now;
      const seconds = dt / 1000;
      this.phase += seconds * this.cfg.speed * this.speedFactor;
      if (!this.dragging && (this.spinVelocity !== 0 || this.tiltVelocity !== 0)) {
        // Coast on the flick, bleeding speed like a globe on a good bearing.
        this.cfg.yawOffset += this.spinVelocity * seconds;
        this.cfg.tiltOffset = clampTilt(this.cfg.tiltOffset + this.tiltVelocity * seconds);
        const decay = Math.exp(-seconds / 1.15);
        this.spinVelocity *= decay;
        this.tiltVelocity *= decay;
        if (Math.abs(this.spinVelocity) < 0.01) this.spinVelocity = 0;
        if (Math.abs(this.tiltVelocity) < 0.01) this.tiltVelocity = 0;
      }
      this.draw(this.phase);
    });
  }

  private stopLoop(): void {
    this.removeTickFn?.();
    this.removeTickFn = null;
  }

  pause(): void {
    this.stopLoop();
  }

  resume(): void {
    this.start();
  }

  /**
   * Let the reader grab the sphere: drag turns it 1:1 under the pointer,
   * release hands the pointer's velocity to the spin, which coasts down.
   */
  enableSpin(): void {
    if (this.detachSpin) return;
    const canvas = this.canvas;
    let radius = this.cfg.size * 0.41;
    let lastX = 0;
    let lastY = 0;
    let lastT = 0;
    const samples: Array<{ dx: number; dy: number; dt: number }> = [];

    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      radius = this.cfg.size * 0.41;
      this.dragging = true;
      this.spinVelocity = 0;
      this.tiltVelocity = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      lastT = performance.now();
      samples.length = 0;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // the pointer is already gone; the drag ends on the next move
      }
      canvas.dataset.grabbing = 'true';
    };
    const move = (e: PointerEvent) => {
      if (!this.dragging) return;
      // A release we never heard about (a context menu, a lost capture).
      if (e.buttons === 0) {
        up();
        return;
      }
      const now = performance.now();
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      // A point on the surface follows the finger: arc length / radius.
      this.cfg.yawOffset -= dx / radius;
      this.cfg.tiltOffset = clampTilt(this.cfg.tiltOffset + dy / radius);
      samples.push({ dx, dy, dt: Math.max(1, now - lastT) });
      if (samples.length > 6) samples.shift();
      lastX = e.clientX;
      lastY = e.clientY;
      lastT = now;
      if (prefersReducedMotion()) this.renderStatic();
    };
    const up = () => {
      if (!this.dragging) return;
      this.dragging = false;
      delete canvas.dataset.grabbing;
      if (prefersReducedMotion()) return;
      // Hand the release velocity to the spin (stale samples mean no flick).
      if (performance.now() - lastT < 80 && samples.length > 1) {
        const sum = samples.reduce(
          (acc, s) => ({ dx: acc.dx + s.dx, dy: acc.dy + s.dy, dt: acc.dt + s.dt }),
          { dx: 0, dy: 0, dt: 0 },
        );
        this.spinVelocity = -((sum.dx / sum.dt) * 1000) / radius;
        this.tiltVelocity = ((sum.dy / sum.dt) * 1000) / radius;
      }
      this.start();
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('lostpointercapture', up);
    this.detachSpin = () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('lostpointercapture', up);
    };
  }

  /** Nudge the spin from the keyboard (arrow keys on a focused orb). */
  nudge(yaw: number, tilt: number): void {
    if (prefersReducedMotion()) {
      this.cfg.yawOffset += yaw * 0.35;
      this.cfg.tiltOffset = clampTilt(this.cfg.tiltOffset + tilt * 0.35);
      this.renderStatic();
      return;
    }
    this.spinVelocity += yaw * 2.2;
    this.tiltVelocity += tilt * 2.2;
    this.start();
  }

  destroy(): void {
    this.stopLoop();
    this.detachSpin?.();
    this.detachSpin = null;
    this.io?.disconnect();
    this.io = null;
    this.speedSpring.destroy();
    this.scaleSpring.destroy();
  }

  /** Spring the rotation speed toward a multiplier (hover states). */
  setSpeedTarget(mult: number): void {
    this.speedSpring.setTarget(mult);
    if (!this.removeTickFn && !prefersReducedMotion()) this.start();
  }

  /** Spring the whole orb's drawn scale (breathe). */
  setScaleTarget(mult: number): void {
    this.scaleSpring.setTarget(mult);
  }

  /** Single deterministic frame for reduced motion. */
  renderStatic(): void {
    this.draw(0.6 + this.phase * 0.001);
  }

  /** Change the drawn size (css px). The spin gesture reads it live. */
  resize(size: number): void {
    if (size === this.cfg.size) return;
    this.cfg.size = size;
    // Re-rastering clears the canvas; draw at once rather than leave it blank
    // until the next tick (which, during a window resize, never comes first).
    this.raster();
    if (prefersReducedMotion() || !this.removeTickFn) this.renderStatic();
    else this.draw(this.phase);
  }

  /** Re-read ink colors (the orb moved to a different surface). */
  refreshPalette(): void {
    this.palette = readPalette(this.canvas);
  }

  private draw(t: number): void {
    const { ctx, cfg } = this;
    const frame = modes[cfg.mode](cfg, t);
    // Accent by generation index (stable across frames), BEFORE the z-sort
    // reorders draw indices; keying accents to draw order makes them flicker.
    frame.dots.forEach((d, gi) => {
      d.accent = hash2(gi, cfg.seed) < cfg.accentRatio;
    });
    frame.dots.sort((a, b) => a.z - b.z);
    ctx.clearRect(0, 0, cfg.size, cfg.size);

    const half = cfg.size / 2;
    if (this.drawScale !== 1) {
      ctx.save();
      ctx.translate(half, half);
      ctx.scale(this.drawScale, this.drawScale);
      ctx.translate(-half, -half);
    }

    for (const e of frame.edges) {
      if (e.a < 0.02) continue;
      ctx.globalAlpha = e.a;
      ctx.strokeStyle = inkColor(this.palette, 0.5, true);
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(e.x1, e.y1);
      ctx.lineTo(e.x2, e.y2);
      ctx.stroke();
    }

    for (const d of frame.dots) {
      if (d.a < 0.02) continue;
      ctx.globalAlpha = Math.min(1, d.a);
      ctx.fillStyle = inkColor(this.palette, d.ink, d.accent === true);
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (this.drawScale !== 1) ctx.restore();
  }
}
