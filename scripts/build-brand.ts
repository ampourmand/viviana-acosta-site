/**
 * Brand assets from the one geometry source (src/data/brand.ts):
 *   public/favicon.svg           the nib rocket on a wine tile
 *   public/apple-touch-icon.png  the same, 180px, square (iOS rounds it)
 *   public/og-default.png        the social card, 1200 x 630
 *
 * The social card is typeset by a real browser (Playwright's Chromium) from
 * the site's own fonts, wash, handwriting and headshot, so it cannot drift
 * from the site. Everything is inlined; no server is needed.
 *
 * Run: npm run brand
 */
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { chromium } from '@playwright/test';
import { nibRocket, paperColors, wineColors } from '../src/data/brand';
import { site } from '../src/data/site';

/** The mark, a little larger than its grid so it fills a small tile. */
function tile(size: number, radius: number): string {
  const mark = nibRocket(wineColors, { cloud: false });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">` +
    `<rect width="64" height="64" rx="${radius}" fill="${wineColors.paper}"/>` +
    `<g transform="translate(32 32) scale(1.14) translate(-32 -30.5)">${mark}</g>` +
    `</svg>`
  );
}

const dataUri = async (path: string, type: string) =>
  `data:${type};base64,${(await readFile(path)).toString('base64')}`;

async function socialCard(): Promise<Buffer> {
  const [fraunces, mono, serifItalic, wash, portrait, ink] = await Promise.all([
    dataUri('public/fonts/fraunces-latin-full-normal.woff2', 'font/woff2'),
    dataUri('public/fonts/fragment-mono-latin-400-normal.woff2', 'font/woff2'),
    dataUri('public/fonts/source-serif-4-latin-opsz-italic.woff2', 'font/woff2'),
    dataUri('public/washes/wash-hero.jpg', 'image/jpeg'),
    dataUri('src/assets/photos/portrait-headshot.jpg', 'image/jpeg'),
    readFile('public/ink/mission.svg', 'utf8'),
  ]);
  const box = /viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/.exec(ink);
  const ratio = box ? Number(box[3]) / Number(box[4]) : 3.8;
  const inkUri = `data:image/svg+xml;base64,${Buffer.from(ink).toString('base64')}`;
  const mark = nibRocket(paperColors);

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face { font-family: 'Fraunces'; src: url(${fraunces}) format('woff2'); font-weight: 100 900; }
    @font-face { font-family: 'Fragment Mono'; src: url(${mono}) format('woff2'); }
    @font-face { font-family: 'Source Serif'; src: url(${serifItalic}) format('woff2'); font-style: italic; font-weight: 200 900; }
    * { margin: 0; box-sizing: border-box; }
    body { width: 1200px; height: 630px; overflow: hidden; background: #f8f1ec; color: #2f1622; }
    .wash { position: absolute; inset: 0; background: url(${wash}) center / cover; mix-blend-mode: multiply; }
    .card { position: relative; width: 1200px; height: 630px; display: grid; grid-template-columns: 1fr 372px; align-items: center; gap: 56px; padding: 0 84px 0 88px; }
    .mark { width: 76px; height: 76px; display: block; margin-bottom: 26px; }
    .role { font: 400 17px/1.4 'Fragment Mono', monospace; letter-spacing: 0.1em; text-transform: uppercase; color: #8b4a6b; }
    h1 { margin-top: 10px; font: 410 92px/1 'Fraunces', serif; font-variation-settings: 'SOFT' 30, 'WONK' 0; letter-spacing: -0.02em; }
    .ink { margin-top: 30px; width: 560px; aspect-ratio: ${ratio}; background: #4a1a30; -webkit-mask: url(${inkUri}) center / contain no-repeat; mask: url(${inkUri}) center / contain no-repeat; }
    .tag { margin-top: 26px; font: italic 400 25px/1.4 'Source Serif', serif; color: #684856; }
    .print { position: relative; padding: 14px 14px 16px; background: #fffdfb; border-radius: 4px; transform: rotate(2.2deg); box-shadow: 0 1px 2px rgb(62 21 40 / 0.14), 0 10px 26px rgb(62 21 40 / 0.16), 0 28px 60px rgb(62 21 40 / 0.14); }
    .print img { display: block; width: 100%; border-radius: 2px; }
    .tape { position: absolute; top: -17px; left: 50%; width: 124px; height: 34px; transform: translateX(-50%) rotate(-3.5deg); background-color: rgb(201 138 155 / 0.62); background-image: repeating-linear-gradient(90deg, rgb(255 255 255 / 0.16) 0 10px, rgb(255 255 255 / 0) 10px 20px); clip-path: polygon(0% 0%, 3% 14%, 0% 28%, 3% 42%, 0% 57%, 3% 71%, 0% 85%, 3% 100%, 97% 100%, 100% 85%, 97% 71%, 100% 57%, 97% 42%, 100% 28%, 97% 14%, 100% 0%); }
  </style></head><body>
    <div class="wash"></div>
    <div class="card">
      <div>
        <svg class="mark" viewBox="0 0 64 64">${mark}</svg>
        <p class="role">${site.role}</p>
        <h1>${site.name}</h1>
        <div class="ink"></div>
        <p class="tag">${site.taglineA}</p>
      </div>
      <figure class="print"><span class="tape"></span><img src="${portrait}" alt=""></figure>
    </div>
  </body></html>`;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    return await page.screenshot({ type: 'png' });
  } finally {
    await browser.close();
  }
}

await writeFile('public/favicon.svg', tile(64, 14) + '\n');
await sharp(Buffer.from(tile(720, 0))).resize(180, 180).png().toFile('public/apple-touch-icon.png');
// A photographic card: a palette PNG keeps it a few hundred kB without visible loss.
await sharp(await socialCard()).png({ palette: true, quality: 92, effort: 9 }).toFile('public/og-default.png');
console.log('brand: favicon.svg, apple-touch-icon.png, og-default.png');
