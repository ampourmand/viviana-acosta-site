/**
 * Signature artwork build.
 *
 * Bakes "Viviana Acosta" (Monsieur La Doulaise, OFL) into filled SVG
 * outlines, computes per-glyph metrics, and measures the hand-authored
 * guide strokes in signature-guide.svg so the runtime never calls
 * getTotalLength(). Also regenerates the signature-lab preview page
 * (content-src/signature-lab.html) used to iterate on guide paths.
 *
 * Run with --init-guide to (re)generate a starter guide file from glyph
 * metrics. The starter is a rough left-to-right sweep per glyph; the
 * committed guide file is then hand-tuned and NEVER regenerated unless
 * you pass the flag explicitly.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import opentype from 'opentype.js';
import { svgPathProperties } from 'svg-path-properties';

const ROOT = new URL('..', import.meta.url).pathname;
const FONT = join(ROOT, 'content-src/fonts/MonsieurLaDoulaise-Regular.ttf');
const OUT_DIR = join(ROOT, 'src/assets/signature');
const GUIDE = join(OUT_DIR, 'signature-guide.svg');
const TEXT = 'Viviana Acosta';
const SIZE = 160;
const PAD = 28;

const initGuide = process.argv.includes('--init-guide');

const font = opentype.parse(readFileSync(FONT).buffer as ArrayBuffer);

interface GlyphInfo {
  char: string;
  x: number;
  advance: number;
  bbox: { x1: number; y1: number; x2: number; y2: number } | null;
  pathData: string;
}

const glyphs: GlyphInfo[] = [];
const baseline = 0;

font.forEachGlyph(TEXT, 0, baseline, SIZE, { kerning: true }, (glyph, gx, gy, gsize) => {
  const p = glyph.getPath(gx, gy, gsize);
  const d = p.toPathData(3);
  const bb = p.getBoundingBox();
  const scale = gsize / font.unitsPerEm;
  glyphs.push({
    char: String.fromCodePoint(glyph.unicode ?? 32),
    x: gx,
    advance: (glyph.advanceWidth ?? 0) * scale,
    bbox: d ? { x1: bb.x1, y1: bb.y1, x2: bb.x2, y2: bb.y2 } : null,
    pathData: d,
  });
});

const inked = glyphs.filter((g) => g.pathData);
const minX = Math.min(...inked.map((g) => g.bbox!.x1)) - PAD;
const minY = Math.min(...inked.map((g) => g.bbox!.y1)) - PAD;
const maxX = Math.max(...inked.map((g) => g.bbox!.x2)) + PAD;
const maxY = Math.max(...inked.map((g) => g.bbox!.y2)) + PAD;
const viewBox = `${r2(minX)} ${r2(minY)} ${r2(maxX - minX)} ${r2(maxY - minY)}`;

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* signature-outlines.svg: the filled glyph artwork                    */
/* ------------------------------------------------------------------ */
const outlines = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">
  <g id="glyphs">
${inked.map((g) => `    <path d="${g.pathData}"/>`).join('\n')}
  </g>
</svg>
`;
writeFileSync(join(OUT_DIR, 'signature-outlines.svg'), outlines);

/* ------------------------------------------------------------------ */
/* Starter guide (only with --init-guide, never overwrites otherwise)  */
/* ------------------------------------------------------------------ */
if (initGuide || !existsSync(GUIDE)) {
  const strokes = inked.map((g, i) => {
    const b = g.bbox!;
    const midY = (b.y1 + b.y2) / 2;
    const w = b.x2 - b.x1;
    const lift = Math.min(30, (b.y2 - b.y1) * 0.18);
    const d = `M ${r2(b.x1)} ${r2(midY + lift)} C ${r2(b.x1 + w * 0.33)} ${r2(midY - lift)}, ${r2(
      b.x1 + w * 0.66,
    )} ${r2(midY + lift)}, ${r2(b.x2)} ${r2(midY - lift * 0.4)}`;
    const width = Math.ceil((b.y2 - b.y1) * 1.15);
    return `  <path data-stroke="${i + 1}" data-width="${width}" d="${d}"/>`;
  });
  const guide = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">
${strokes.join('\n')}
</svg>
`;
  writeFileSync(GUIDE, guide);
  console.log(`starter guide written (${inked.length} strokes) - hand-tune before shipping`);
}

/* ------------------------------------------------------------------ */
/* Measure guide strokes -> signature-meta.json                        */
/* ------------------------------------------------------------------ */
const guideSvg = readFileSync(GUIDE, 'utf8');
const strokeRe = /<path[^>]*data-stroke="(\d+)"[^>]*data-width="([\d.]+)"[^>]*d="([^"]+)"/g;
interface StrokeMeta {
  id: number;
  width: number;
  length: number;
  d: string;
}
const strokes: StrokeMeta[] = [];
let m: RegExpExecArray | null;
while ((m = strokeRe.exec(guideSvg))) {
  const d = m[3]!;
  const props = new svgPathProperties(d);
  strokes.push({
    id: Number(m[1]),
    width: Number(m[2]),
    length: r2(props.getTotalLength()),
    d,
  });
}
strokes.sort((a, b) => a.id - b.id);

const totalLength = strokes.reduce((sum, s) => sum + s.length, 0);
const meta = {
  text: TEXT,
  viewBox,
  width: r2(maxX - minX),
  height: r2(maxY - minY),
  totalLength: r2(totalLength),
  strokes: strokes.map((s) => ({
    id: s.id,
    width: s.width,
    length: s.length,
    weight: r2(s.length / totalLength),
    d: s.d,
  })),
};
writeFileSync(join(OUT_DIR, 'signature-meta.json'), JSON.stringify(meta, null, 2));
console.log(
  `outlines: ${inked.length} glyphs, viewBox ${viewBox}\nguide: ${strokes.length} strokes, total length ${r2(totalLength)}`,
);

/* ------------------------------------------------------------------ */
/* Signature lab: standalone preview with scrubber                     */
/* ------------------------------------------------------------------ */
const lab = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Signature Lab</title>
<style>
  body { margin: 0; background: #121110; color: #ece7dd; font: 14px/1.5 system-ui; padding: 2rem; }
  .stage { max-width: 1100px; margin-inline: auto; }
  svg { width: 100%; height: auto; display: block; }
  .glyphs path { fill: #e8e0cf; }
  .guides path { fill: none; stroke: rgb(198 161 91 / 0.55); stroke-linecap: round; }
  .guides.hidden { display: none; }
  .controls { display: flex; gap: 1rem; align-items: center; margin-block: 1.5rem; }
  input[type=range] { flex: 1; }
  button { background: none; border: 1px solid #c6a15b; color: #c6a15b; border-radius: 4px; padding: .4rem .9rem; cursor: pointer; }
  .nib-dot { fill: #b0703c; }
</style>
</head>
<body>
<div class="stage">
  <div class="controls">
    <button id="play">Play</button>
    <label><input type="checkbox" id="showGuides" checked> guides</label>
    <input type="range" id="scrub" min="0" max="1000" value="1000">
    <span id="readout">100%</span>
  </div>
  <svg viewBox="${viewBox}">
    <defs>
      <mask id="ink">
        <rect x="${r2(minX)}" y="${r2(minY)}" width="${r2(maxX - minX)}" height="${r2(maxY - minY)}" fill="black"/>
        ${strokes
          .map(
            (s) =>
              `<path class="mask-stroke" data-len="${s.length}" d="${s.d}" fill="none" stroke="white" stroke-width="${s.width}" stroke-linecap="round" stroke-dasharray="${s.length}" stroke-dashoffset="0"/>`,
          )
          .join('\n        ')}
      </mask>
    </defs>
    <g class="glyphs" mask="url(#ink)">
${inked.map((g) => `      <path d="${g.pathData}"/>`).join('\n')}
    </g>
    <g class="guides" id="guides">
${strokes.map((s) => `      <path d="${s.d}" stroke-width="2"/>`).join('\n')}
    </g>
    <circle class="nib-dot" id="nib" r="5" cx="${r2(minX)}" cy="0"/>
  </svg>
</div>
<script>
const strokes = ${JSON.stringify(strokes.map((s) => ({ len: s.length, d: s.d })))};
const total = ${r2(totalLength)};
const maskEls = [...document.querySelectorAll('.mask-stroke')];
const guidePaths = strokes.map(s => { const p = document.createElementNS('http://www.w3.org/2000/svg','path'); p.setAttribute('d', s.d); return p; });
const nib = document.getElementById('nib');
const scrub = document.getElementById('scrub');
const readout = document.getElementById('readout');

function setProgress(t) {
  let acc = 0;
  for (let i = 0; i < strokes.length; i++) {
    const s = strokes[i];
    const start = acc / total, end = (acc + s.len) / total;
    let local = (t - start) / (end - start);
    local = Math.max(0, Math.min(1, local));
    maskEls[i].setAttribute('stroke-dashoffset', String(s.len * (1 - local)));
    if (t >= start && t <= end + 1e-6) {
      const pt = guidePaths[i].getPointAtLength(s.len * local);
      nib.setAttribute('cx', pt.x); nib.setAttribute('cy', pt.y);
    }
    acc += s.len;
  }
  readout.textContent = Math.round(t * 100) + '%';
}
scrub.addEventListener('input', () => setProgress(scrub.value / 1000));
document.getElementById('showGuides').addEventListener('change', (e) =>
  document.getElementById('guides').classList.toggle('hidden', !e.target.checked));
document.getElementById('play').addEventListener('click', () => {
  const start = performance.now(), dur = 4200;
  function frame(now) {
    const t = Math.min(1, (now - start) / dur);
    setProgress(t); scrub.value = String(t * 1000);
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
});
setProgress(1);
</script>
</body>
</html>
`;
writeFileSync(join(ROOT, 'content-src/signature-lab.html'), lab);
console.log('signature lab: content-src/signature-lab.html');

/* ------------------------------------------------------------------ */
/* Default OG image: signature on charcoal, 1200x630                   */
/* ------------------------------------------------------------------ */
const OG_W = 1200;
const OG_H = 630;
const sigW = maxX - minX;
const sigH = maxY - minY;
const ogScale = Math.min((OG_W - 260) / sigW, 300 / sigH);
const ogX = (OG_W - sigW * ogScale) / 2;
const ogY = (OG_H - sigH * ogScale) / 2 - 20;
const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}">
  <rect width="${OG_W}" height="${OG_H}" fill="#121110"/>
  <g transform="translate(${r2(ogX)}, ${r2(ogY)}) scale(${r2(ogScale)}) translate(${r2(-minX)}, ${r2(-minY)})">
${inked.map((g) => `    <path d="${g.pathData}" fill="#e8e0cf"/>`).join('\n')}
  </g>
  <rect x="${OG_W / 2 - 60}" y="${OG_H - 118}" width="120" height="2" fill="#c6a15b"/>
</svg>`;

const { default: sharp } = await import('sharp');
await sharp(Buffer.from(ogSvg)).png().toFile(join(ROOT, 'public/og-default.png'));
console.log('og image: public/og-default.png');
