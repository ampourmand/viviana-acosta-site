/**
 * The live pen. Given a piece (stroke samples that are already uniform in
 * time), renders the ink as it would exist at any moment of the writing and
 * reports where the nib is. Pure function of progress: scrub it, reverse
 * it, or jump to the end; nothing drifts.
 */
import { inkPath, unpack, type InkPiece, type InkPoint } from './freehand';

const NS = 'http://www.w3.org/2000/svg';

export interface PenTip {
  /** Nib position in the piece's coordinate space. */
  x: number;
  y: number;
  /** True while the nib is touching paper. */
  down: boolean;
  /** 0..1 how far through a pen-up hop we are (0 when down). */
  hop: number;
  /** Index of the stroke being written or about to be written. */
  stroke: number;
}

interface StrokeRuntime {
  pts: InkPoint[];
  t0: number;
  t1: number;
  path: SVGPathElement;
  /** -1 = empty, 2 = finished; otherwise last rendered fractional count. */
  rendered: number;
}

export class InkWriter {
  readonly svg: SVGSVGElement;
  readonly piece: InkPiece;
  private strokes: StrokeRuntime[];
  private progress = -1;

  constructor(piece: InkPiece, opts: { className?: string } = {}) {
    this.piece = piece;
    const [x, y, w, h] = piece.viewBox;
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
    this.svg.setAttribute('aria-hidden', 'true');
    this.svg.setAttribute('class', opts.className ?? 'ink-live');
    this.strokes = piece.strokes.map((s) => {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('class', 'ink-stroke');
      this.svg.appendChild(path);
      return { pts: unpack(s.pts), t0: s.t0, t1: s.t1, path, rendered: -1 };
    });
  }

  /** Render the ink as of `p` (0..1 across the whole piece). */
  setProgress(p: number): void {
    const clamped = Math.min(1, Math.max(0, p));
    if (clamped === this.progress) return;
    this.progress = clamped;
    for (const s of this.strokes) {
      if (clamped >= s.t1) {
        if (s.rendered !== 2) {
          s.path.setAttribute('d', inkPath(s.pts, this.piece.style, true));
          s.path.classList.remove('is-wet');
          s.path.classList.add('is-dry');
          s.rendered = 2;
        }
      } else if (clamped <= s.t0) {
        if (s.rendered !== -1) {
          s.path.setAttribute('d', '');
          s.path.classList.remove('is-wet', 'is-dry');
          s.rendered = -1;
        }
      } else {
        const local = (clamped - s.t0) / (s.t1 - s.t0);
        s.path.setAttribute('d', inkPath(this.partial(s.pts, local), this.piece.style, false));
        if (s.rendered === -1 || s.rendered === 2) {
          s.path.classList.remove('is-dry');
          s.path.classList.add('is-wet');
        }
        s.rendered = local;
      }
    }
  }

  /** Points up to a fractional index, with the live tip interpolated. */
  private partial(pts: InkPoint[], local: number): InkPoint[] {
    const exact = local * (pts.length - 1);
    const whole = Math.floor(exact);
    const out = pts.slice(0, whole + 1);
    const next = pts[whole + 1];
    if (next) {
      const prev = pts[whole]!;
      const f = exact - whole;
      out.push([
        prev[0] + (next[0] - prev[0]) * f,
        prev[1] + (next[1] - prev[1]) * f,
        prev[2] + (next[2] - prev[2]) * f,
      ]);
    }
    return out;
  }

  /** Where the nib is at progress `p`, including the hops between strokes. */
  tipAt(p: number): PenTip {
    const strokes = this.strokes;
    const clamped = Math.min(1, Math.max(0, p));
    for (let i = 0; i < strokes.length; i++) {
      const s = strokes[i]!;
      if (clamped < s.t0) {
        // In the air, travelling from the previous stroke's end to this start.
        const prev = strokes[i - 1];
        const to = s.pts[0]!;
        if (!prev) return { x: to[0], y: to[1], down: false, hop: 0, stroke: i };
        const from = prev.pts[prev.pts.length - 1]!;
        const span = s.t0 - prev.t1 || 1;
        const f = (clamped - prev.t1) / span;
        // Ease the hop so the hand leaves and arrives gently.
        const e = f * f * (3 - 2 * f);
        return {
          x: from[0] + (to[0] - from[0]) * e,
          y: from[1] + (to[1] - from[1]) * e,
          down: false,
          hop: f,
          stroke: i,
        };
      }
      if (clamped <= s.t1) {
        const local = (clamped - s.t0) / (s.t1 - s.t0 || 1);
        const exact = local * (s.pts.length - 1);
        const whole = Math.min(s.pts.length - 1, Math.floor(exact));
        const a = s.pts[whole]!;
        const b = s.pts[Math.min(s.pts.length - 1, whole + 1)]!;
        const f = exact - whole;
        return {
          x: a[0] + (b[0] - a[0]) * f,
          y: a[1] + (b[1] - a[1]) * f,
          down: true,
          hop: 0,
          stroke: i,
        };
      }
    }
    const last = strokes[strokes.length - 1];
    const end = last ? last.pts[last.pts.length - 1]! : ([0, 0, 0] as InkPoint);
    return { x: end[0], y: end[1], down: false, hop: 1, stroke: strokes.length };
  }

  finish(): void {
    this.setProgress(1);
  }
}
