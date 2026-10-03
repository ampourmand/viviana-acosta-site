/**
 * Handwriting build. Writes every handwritten line on the site with the
 * pen model in scripts/ink/stroke-font.ts and emits, per piece:
 *
 *   src/assets/ink/<id>.json   stroke samples for the live pen (lazy-loaded)
 *   public/ink/<id>.svg        the finished ink, used as a CSS mask so the
 *                              static state costs no HTML and themes via
 *                              background-color
 *   src/assets/ink/index.json  id -> { text, viewBox, duration }
 *
 * The hand is EMS Neato (single-stroke derivative of Bad Script, SIL OFL).
 * Only words Viviana already uses on her site are written in her hand.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inkPaths, type InkPiece } from '../src/lib/ink/freehand';
import { loadStrokeFont, writePiece, type WriteOptions } from './ink/stroke-font';

const ROOT = new URL('..', import.meta.url).pathname;
const DATA = join(ROOT, 'src/assets/ink');
const PUBLIC = join(ROOT, 'public/ink');
mkdirSync(DATA, { recursive: true });
mkdirSync(PUBLIC, { recursive: true });

const font = loadStrokeFont(join(ROOT, 'content-src/fonts/ems/EMSNeato.svg'));

const SIZE = 84;
const base = {
  fontSize: SIZE,
  lineHeight: 1.14,
  pad: SIZE * 0.2,
  style: { size: SIZE * 0.042, thinning: 0.66 },
};

/** A loose, slightly bowed underline: one confident stroke. */
function swash(width: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    pts.push([t * width, Math.sin(t * Math.PI) * -7 + Math.sin(t * Math.PI * 3) * 1.6 + t * 4]);
  }
  return pts;
}

const pieces: WriteOptions[] = [
  {
    ...base,
    id: 'mission',
    lines: ['Inspiring children of all ages', 'to feel seen and safe'],
    duration: 2.7,
  },
  {
    ...base,
    id: 'mission-footer',
    lines: ['Inspiring children of all ages', 'to feel safe and seen'],
    duration: 2.5,
  },
  { ...base, id: 'signoff', lines: ['-Viviana Acosta'], duration: 1.3 },
  { ...base, id: 'thanks', lines: ['Thank you!'], duration: 0.9 },
  { ...base, id: 'american-immigrant', lines: ['American. Immigrant'], duration: 1.4 },
  { ...base, id: 'swash', lines: [], flourishes: [swash(520)], duration: 0.5, pad: 18 },
];

const index: Record<string, { text: string; viewBox: number[]; duration: number }> = {};

for (const opts of pieces) {
  const piece: InkPiece = writePiece(font, opts);
  writeFileSync(join(DATA, `${piece.id}.json`), JSON.stringify(piece));
  const [x, y, w, h] = piece.viewBox;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}">${inkPaths(piece)
    .map((d) => `<path d="${d}"/>`)
    .join('')}</svg>\n`;
  writeFileSync(join(PUBLIC, `${piece.id}.svg`), svg);
  index[piece.id] = { text: piece.text, viewBox: piece.viewBox, duration: piece.duration };
  const pts = piece.strokes.reduce((n, s) => n + s.pts.length / 3, 0);
  console.log(
    `${piece.id.padEnd(20)} ${String(piece.strokes.length).padStart(3)} strokes ${String(pts).padStart(5)} pts  svg ${(svg.length / 1024).toFixed(1)}KB`,
  );
}

writeFileSync(join(DATA, 'index.json'), JSON.stringify(index, null, 2));
console.log('ink written');
