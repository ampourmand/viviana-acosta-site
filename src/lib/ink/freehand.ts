/**
 * Ink rendering shared by build-time (static handwriting baked into HTML)
 * and runtime (the pen writing live). A stroke is a list of [x, y, pressure]
 * samples along the pen's true path; perfect-freehand turns it into a
 * variable-width outline, so the ink swells on downstrokes and tapers to a
 * fine tip exactly like a nib.
 */
import { getStroke } from 'perfect-freehand';

export interface InkStyle {
  /** Base stroke diameter in the piece's own units. */
  size: number;
  /** How strongly pressure changes width (0 = monoline, 1 = dramatic). */
  thinning: number;
  /** Taper length at the start of each stroke, in units. */
  taperStart: number;
  /** Taper length at the live/finished end of each stroke, in units. */
  taperEnd: number;
}

export interface InkStrokeData {
  /** Flat [x, y, pressure, x, y, pressure, ...] samples, evenly spaced. */
  pts: number[];
  /** Normalized time window within the piece when the pen is down. */
  t0: number;
  t1: number;
}

export interface InkPiece {
  id: string;
  text: string;
  viewBox: [number, number, number, number];
  style: InkStyle;
  /** Suggested writing duration in seconds at natural speed. */
  duration: number;
  strokes: InkStrokeData[];
}

export type InkPoint = [number, number, number];

export function unpack(pts: number[]): InkPoint[] {
  const out: InkPoint[] = [];
  for (let i = 0; i < pts.length; i += 3) {
    out.push([pts[i]!, pts[i + 1]!, pts[i + 2]!]);
  }
  return out;
}

const r2 = (v: number) => Math.round(v * 10) / 10;

/** Outline polygon -> smooth closed SVG path (quadratic midpoints). */
function pathFromOutline(outline: number[][]): string {
  const n = outline.length;
  if (n < 3) return '';
  let d = `M${r2(outline[0]![0]!)},${r2(outline[0]![1]!)} Q`;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = outline[i]!;
    const [x1, y1] = outline[(i + 1) % n]!;
    d += `${r2(x0!)},${r2(y0!)} ${r2((x0! + x1!) / 2)},${r2((y0! + y1!) / 2)} `;
  }
  return d + 'Z';
}

/** Ramer-Douglas-Peucker on a closed outline: drops points that add nothing. */
function simplify(outline: number[][], tolerance: number): number[][] {
  if (outline.length < 8) return outline;
  const keep = new Uint8Array(outline.length);
  keep[0] = 1;
  keep[outline.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, outline.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = outline[a]!;
    const [bx, by] = outline[b]!;
    const dx = bx! - ax!;
    const dy = by! - ay!;
    const len = Math.hypot(dx, dy) || 1;
    let worst = -1;
    let worstDist = tolerance;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = outline[i]!;
      const d = Math.abs((px! - ax!) * dy - (py! - ay!) * dx) / len;
      if (d > worstDist) {
        worstDist = d;
        worst = i;
      }
    }
    if (worst !== -1) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return outline.filter((_, i) => keep[i]);
}

/**
 * Ink outline for a (possibly partial) stroke.
 * `complete` finalizes the stroke end; while writing, the live end still
 * tapers so the tip stays fine like a nib in motion.
 */
export function inkPath(
  points: InkPoint[],
  style: InkStyle,
  complete = true,
  /** Outline simplification tolerance in units (0 = keep every point). */
  tolerance = 0,
): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    // A dot: a tiny round blot.
    const [x, y, p] = points[0]!;
    const r = style.size * (0.36 + 0.3 * p);
    return `M${r2(x - r)},${r2(y)} a${r2(r)},${r2(r)} 0 1,0 ${r2(r * 2)},0 a${r2(r)},${r2(r)} 0 1,0 ${r2(-r * 2)},0 Z`;
  }
  const outline = getStroke(points, {
    size: style.size,
    thinning: style.thinning,
    smoothing: 0.5,
    streamline: 0.12,
    simulatePressure: false,
    start: { taper: style.taperStart, cap: true },
    end: { taper: style.taperEnd, cap: true },
    last: complete,
  });
  return pathFromOutline(tolerance > 0 ? simplify(outline, tolerance) : outline);
}

/** Every stroke of a piece, finished: used for static rendering. */
export function inkPaths(piece: InkPiece, tolerance = 0.12): string[] {
  return piece.strokes.map((s) => inkPath(unpack(s.pts), piece.style, true, tolerance));
}
