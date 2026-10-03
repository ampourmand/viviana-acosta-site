/**
 * Single-stroke font pipeline: turns text into the pen's true path.
 *
 * The EMS fonts (Evil Mad Scientist "Hershey Text" SVG fonts, SIL OFL) store
 * each glyph as open centerline strokes, exactly what a pen traces. We lay a
 * phrase out, smooth the coarse polylines into curves, order the strokes the
 * way a hand writes (dots and crosses after the word), simulate nib pressure
 * from stroke direction, and time everything so curves slow the pen down.
 */
import { readFileSync } from 'node:fs';
import type { InkPiece, InkStrokeData, InkStyle } from '../../src/lib/ink/freehand';

type Pt = [number, number];

export interface StrokeGlyph {
  adv: number;
  /** Strokes in font units, y-up. */
  strokes: Pt[][];
}

export interface StrokeFont {
  unitsPerEm: number;
  defaultAdv: number;
  glyphs: Map<string, StrokeGlyph>;
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

function decodeUnicode(u: string): string {
  if (u.startsWith('&#x')) return String.fromCodePoint(parseInt(u.slice(3, -1), 16));
  if (u.startsWith('&#')) return String.fromCodePoint(parseInt(u.slice(2, -1), 10));
  return ENTITIES[u] ?? u;
}

function cubicPoint(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ];
}

/** Parse an absolute M/L/C path into polylines (cubics get flattened). */
function parsePath(d: string): Pt[][] {
  const tokens = d.match(/[MLC]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const strokes: Pt[][] = [];
  let cur: Pt[] | null = null;
  let cmd = '';
  let i = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const tok = tokens[i]!;
    if (/^[MLC]$/i.test(tok)) {
      cmd = tok.toUpperCase();
      i++;
      continue;
    }
    if (cmd === 'M') {
      cur = [[num(), num()]];
      strokes.push(cur);
      cmd = 'L'; // implicit lineto after moveto
    } else if (cmd === 'L') {
      cur!.push([num(), num()]);
    } else if (cmd === 'C') {
      const p0 = cur![cur!.length - 1]!;
      const p1: Pt = [num(), num()];
      const p2: Pt = [num(), num()];
      const p3: Pt = [num(), num()];
      for (let s = 1; s <= 6; s++) cur!.push(cubicPoint(p0, p1, p2, p3, s / 6));
    } else {
      i++;
    }
  }
  return strokes.filter((s) => s.length > 0);
}

/**
 * The conversion did not always preserve how a hand moves. A stroke that
 * starts clearly lower than it ends (an "i" drawn from its exit hook up, an
 * "f" from its tail) gets reversed so stems are true downstrokes: that is
 * what makes the pressure model put weight in the right places.
 */
function naturalize(stroke: Pt[], unitsPerEm: number): Pt[] {
  if (stroke.length < 2) return stroke;
  const start = stroke[0]!;
  const end = stroke[stroke.length - 1]!;
  // Font units are y-up: a larger y is higher on the page.
  if (start[1] < end[1] - unitsPerEm * 0.12) return stroke.slice().reverse();
  return stroke;
}

/** Per-glyph craft fixes, keyed by character. */
const GLYPH_PATCHES: Record<string, (strokes: Pt[][]) => Pt[][]> = {
  // The exit hook on "l" is long enough to read as a capital L at small
  // sizes; trim it to a short curl.
  l: (strokes) => strokes.map((st, i) => (i === 0 && st.length > 4 ? st.slice(0, st.length - 2) : st)),
  // Serifed capital I: top serif, stem, bottom serif.
  I: (strokes) => (strokes.length === 3 ? [strokes[2]!, strokes[1]!, strokes[0]!] : strokes),
};

export function loadStrokeFont(path: string): StrokeFont {
  const src = readFileSync(path, 'utf8');
  const unitsPerEm = Number(src.match(/units-per-em="([\d.]+)"/)?.[1] ?? 1000);
  const defaultAdv = Number(src.match(/<font [^>]*horiz-adv-x="([\d.]+)"/)?.[1] ?? 500);
  const glyphs = new Map<string, StrokeGlyph>();
  const re = /<glyph\s+unicode="([^"]+)"[^>]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const tag = m[0];
    const ch = decodeUnicode(m[1]!);
    const adv = Number(tag.match(/horiz-adv-x="([\d.]+)"/)?.[1] ?? defaultAdv);
    const d = tag.match(/\sd="([^"]*)"/)?.[1] ?? '';
    let strokes = d ? parsePath(d).map((st) => naturalize(st, unitsPerEm)) : [];
    const patch = GLYPH_PATCHES[ch];
    if (patch) strokes = patch(strokes);
    glyphs.set(ch, { adv, strokes });
  }
  return { unitsPerEm, defaultAdv, glyphs };
}

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function polyLength(pts: Pt[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1]!, pts[i]!);
  return len;
}

function turnAngle(a: Pt, b: Pt, c: Pt): number {
  const v1x = b[0] - a[0];
  const v1y = b[1] - a[1];
  const v2x = c[0] - b[0];
  const v2y = c[1] - b[1];
  const l1 = Math.hypot(v1x, v1y) || 1;
  const l2 = Math.hypot(v2x, v2y) || 1;
  const dot = (v1x * v2x + v1y * v2y) / (l1 * l2);
  return (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
}

/** Catmull-Rom through a run of points (endpoints clamped). */
function catmullRom(run: Pt[], perSegment = 8): Pt[] {
  if (run.length < 3) return run.slice();
  const out: Pt[] = [];
  for (let i = 0; i < run.length - 1; i++) {
    const p0 = run[Math.max(0, i - 1)]!;
    const p1 = run[i]!;
    const p2 = run[i + 1]!;
    const p3 = run[Math.min(run.length - 1, i + 2)]!;
    for (let s = 0; s < perSegment; s++) {
      const t = s / perSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(run[run.length - 1]!);
  return out;
}

/**
 * The fonts tessellate curves coarsely. Rebuild them as splines, but keep
 * true cusps (where the pen reverses) sharp by splitting runs at big turns.
 */
function smoothStroke(pts: Pt[], cornerDeg: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const runs: Pt[][] = [];
  let cur: Pt[] = [pts[0]!];
  for (let i = 1; i < pts.length - 1; i++) {
    cur.push(pts[i]!);
    if (turnAngle(pts[i - 1]!, pts[i]!, pts[i + 1]!) > cornerDeg) {
      runs.push(cur);
      cur = [pts[i]!];
    }
  }
  cur.push(pts[pts.length - 1]!);
  runs.push(cur);
  const out: Pt[] = [];
  for (const run of runs) {
    const curve = catmullRom(run);
    if (out.length) curve.shift();
    out.push(...curve);
  }
  return out;
}

/** Resample to even arc-length spacing. */
function resample(pts: Pt[], step: number): Pt[] {
  const total = polyLength(pts);
  if (total === 0 || pts.length < 2) return [pts[0]!];
  const n = Math.max(1, Math.round(total / step));
  const out: Pt[] = [pts[0]!];
  let seg = 0;
  let segStart = 0;
  let segLen = dist(pts[0]!, pts[1]!);
  for (let k = 1; k < n; k++) {
    const target = (k / n) * total;
    while (segStart + segLen < target && seg < pts.length - 2) {
      segStart += segLen;
      seg++;
      segLen = dist(pts[seg]!, pts[seg + 1]!);
    }
    const t = segLen ? (target - segStart) / segLen : 0;
    const a = pts[seg]!;
    const b = pts[seg + 1]!;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

/**
 * Handwriting kinematics. Real pens obey the two-thirds power law: speed
 * falls with curvature (v ~ curvature^(-1/3)), and a stroke starts and
 * ends from rest. We compute that speed profile, then resample the stroke
 * so its points are evenly spaced in TIME. Revealing points at a constant
 * rate then reproduces the natural slow-in-the-curves rhythm for free.
 */
function retime(pts: Pt[], em: number): { pts: Pt[]; cost: number } {
  const n = pts.length;
  if (n < 4) return { pts, cost: Math.max(polyLength(pts), em * 0.1) };
  const speed: number[] = [];
  for (let k = 0; k < n; k++) {
    const a = pts[Math.max(0, k - 2)]!;
    const b = pts[k]!;
    const c = pts[Math.min(n - 1, k + 2)]!;
    const ds = (dist(a, b) + dist(b, c)) / 2 || 1;
    const turn = k < 2 || k > n - 3 ? 0 : (turnAngle(a, b, c) * Math.PI) / 180;
    const kappa = (turn / ds) * em; // curvature per em, dimensionless
    const v = Math.min(1, Math.pow(kappa + 0.55, -1 / 3));
    // Strokes accelerate from rest and decelerate into the lift.
    const edge = Math.min(k, n - 1 - k) / Math.max(1, n * 0.14);
    const ramp = 0.5 + 0.5 * Math.min(1, edge) ** 0.7;
    speed.push(Math.max(0.32, v) * ramp);
  }
  const T: number[] = [0];
  for (let k = 1; k < n; k++) {
    const seg = dist(pts[k - 1]!, pts[k]!);
    T.push(T[k - 1]! + seg / ((speed[k - 1]! + speed[k]!) / 2));
  }
  const total = T[n - 1]!;
  const out: Pt[] = [pts[0]!];
  let j = 0;
  for (let k = 1; k < n - 1; k++) {
    const target = (k / (n - 1)) * total;
    while (j < n - 2 && T[j + 1]! < target) j++;
    const span = T[j + 1]! - T[j]! || 1;
    const t = (target - T[j]!) / span;
    const a = pts[j]!;
    const b = pts[j + 1]!;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  out.push(pts[n - 1]!);
  return { pts: out, cost: total };
}

/* ------------------------------------------------------------------ */
/* Layout + handwriting model                                          */
/* ------------------------------------------------------------------ */

export interface WriteOptions {
  id: string;
  lines: string[];
  /** Pixels per em in output units. */
  fontSize: number;
  /** Line advance in em. */
  lineHeight?: number;
  align?: 'left' | 'center';
  /** Extra tracking in em. */
  tracking?: number;
  /** Dots and crosses wait until the word is finished, like real cursive. */
  deferMarks?: boolean;
  style?: Partial<InkStyle>;
  /** Target seconds for the whole piece at natural speed. */
  duration?: number;
  /** Padding around the ink in output units. */
  pad?: number;
  /** Extra hand-authored strokes (output units, y-down), written last. */
  flourishes?: Pt[][];
}

interface PlacedStroke {
  pts: Pt[];
  word: number;
  isMark: boolean;
}

const MARK_GLYPHS = new Set(['i', 'j', 't', 'f', 'x', 'é', 'í', 'ñ']);

export function writePiece(font: StrokeFont, opts: WriteOptions): InkPiece {
  const {
    lines,
    fontSize,
    lineHeight = 1.25,
    align = 'left',
    tracking = 0,
    deferMarks = true,
    duration = 3,
    pad = fontSize * 0.35,
  } = opts;
  const scale = fontSize / font.unitsPerEm;
  const style: InkStyle = {
    size: fontSize * 0.058,
    thinning: 0.58,
    taperStart: fontSize * 0.16,
    taperEnd: fontSize * 0.2,
    ...opts.style,
  };
  const step = Math.max(0.6, fontSize * 0.03);

  // 1. Place glyph strokes (flip to y-down), tagging word membership.
  const placed: PlacedStroke[] = [];
  const lineWidths: number[] = [];
  const lineStarts: number[] = [];
  let word = 0;
  lines.forEach((line, li) => {
    let x = 0;
    lineStarts.push(placed.length);
    for (const ch of line) {
      const g = font.glyphs.get(ch);
      if (ch === ' ' || !g) {
        x += (g?.adv ?? font.defaultAdv) + tracking * font.unitsPerEm;
        word++;
        continue;
      }
      g.strokes.forEach((stroke, si) => {
        const pts = stroke.map(([px, py]) => [(x + px) * scale, -py * scale] as Pt);
        placed.push({
          pts: pts.map(([px, py]) => [px, py + li * lineHeight * fontSize] as Pt),
          word,
          isMark: deferMarks && MARK_GLYPHS.has(ch) && si > 0,
        });
      });
      x += g.adv + tracking * font.unitsPerEm;
    }
    word++;
    lineWidths.push(x * scale);
  });

  if (align === 'center') {
    const maxW = Math.max(...lineWidths);
    lineStarts.forEach((start, li) => {
      const end = lineStarts[li + 1] ?? placed.length;
      const dx = (maxW - lineWidths[li]!) / 2;
      for (let i = start; i < end; i++) {
        placed[i]!.pts = placed[i]!.pts.map(([px, py]) => [px + dx, py] as Pt);
      }
    });
  }

  // 2. Writing order: within each word, main strokes first, then marks.
  const ordered: PlacedStroke[] = [];
  let i = 0;
  while (i < placed.length) {
    const w = placed[i]!.word;
    const group: PlacedStroke[] = [];
    while (i < placed.length && placed[i]!.word === w) group.push(placed[i++]!);
    ordered.push(...group.filter((s) => !s.isMark), ...group.filter((s) => s.isMark));
  }

  // 3. Flourishes (already in output units).
  for (const f of opts.flourishes ?? []) {
    ordered.push({ pts: f, word: word++, isMark: false });
  }

  // 4. Smooth + resample each stroke; merge strokes that truly connect;
  //    then retime so samples are uniform in time (pen kinematics).
  const merged: Pt[][] = [];
  for (const s of ordered) {
    const curve = resample(smoothStroke(s.pts, 62), step);
    const prev = merged[merged.length - 1];
    if (prev && dist(prev[prev.length - 1]!, curve[0]!) < step * 0.9) {
      prev.push(...curve.slice(1));
    } else {
      merged.push(curve);
    }
  }
  const retimed = merged.map((pts) => retime(pts, fontSize));
  const smooth: Pt[][] = retimed.map((r) => r.pts);

  // 5. Pressure: downstrokes press, upstrokes float; cusps pool a little.
  const strokesPts: number[][][] = smooth.map((pts) => {
    const n = pts.length;
    const raw = pts.map((p, k) => {
      const a = pts[Math.max(0, k - 1)]!;
      const b = pts[Math.min(n - 1, k + 1)]!;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      const down = Math.max(0, dy / len); // y-down: positive dy is a downstroke
      const up = Math.max(0, -dy / len);
      let pressure = 0.5 + 0.34 * down - 0.2 * up;
      if (k > 0 && k < n - 1) {
        const turn = turnAngle(a, p, b);
        pressure += Math.min(0.12, turn / 600);
      }
      return Math.max(0.12, Math.min(0.95, pressure));
    });
    // Low-pass so width changes breathe instead of stepping.
    const sm = raw.map((_, k) => {
      let sum = 0;
      let wsum = 0;
      for (let j = -3; j <= 3; j++) {
        const idx = Math.max(0, Math.min(n - 1, k + j));
        const w = 4 - Math.abs(j);
        sum += raw[idx]! * w;
        wsum += w;
      }
      return sum / wsum;
    });
    return pts.map((p, k) => [p[0], p[1], sm[k]!]);
  });

  // 6. Timing: pen-down time by length; air time by hop distance.
  const costs = retimed.map((r) => Math.max(step, r.cost));
  const hops = smooth.map((pts, k) =>
    k === 0 ? 0 : dist(smooth[k - 1]![smooth[k - 1]!.length - 1]!, pts[0]!),
  );
  // Pen-up time: a fixed lift plus travel (the hand moves faster in the air).
  const hopCost = (d: number) => fontSize * 0.16 + d * 0.5;
  let clock = 0;
  const windows: Array<[number, number]> = [];
  smooth.forEach((_, k) => {
    if (k > 0) clock += hopCost(hops[k]!);
    const t0 = clock;
    // Dots take a deliberate beat even though they have almost no length.
    clock += Math.max(costs[k]!, fontSize * 0.14);
    windows.push([t0, clock]);
  });
  const total = clock || 1;

  // 7. Bounds + pack.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pts of smooth) {
    for (const [px, py] of pts) {
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
  }
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const r5 = (v: number) => Math.round(v * 100000) / 100000;
  const strokes: InkStrokeData[] = strokesPts.map((pts, k) => ({
    pts: pts.flatMap(([px, py, pr]) => [r1(px!), r1(py!), r3(pr!)]),
    t0: r5(windows[k]![0] / total),
    t1: r5(windows[k]![1] / total),
  }));

  return {
    id: opts.id,
    text: lines.join(' '),
    viewBox: [r1(minX - pad), r1(minY - pad), r1(maxX - minX + pad * 2), r1(maxY - minY + pad * 2)],
    style: {
      size: r3(style.size),
      thinning: style.thinning,
      taperStart: r3(style.taperStart),
      taperEnd: r3(style.taperEnd),
    },
    duration,
    strokes,
  };
}
