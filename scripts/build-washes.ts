/**
 * Renders the site's watercolor washes: soft clouds of blush, mauve, and
 * tan pink on paper, plus a deep wine night variant. Deterministic fBm
 * (no Math.random), so the washes are identical on every build.
 *
 * Outputs (public/washes/):
 *   wash-paper   quiet site-wide backdrop; washes gather at the edges so
 *                the reading area stays clean
 *   wash-hero    fuller clouds for heroes and the book's endpapers
 *   wash-wine    deep wine sky with rose clouds and faint stars
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'public/washes');
const W = 1600;
const H = 1000;

const frac = (v: number) => v - Math.floor(v);
const hash2 = (a: number, b: number) =>
  frac(Math.sin(a * 12.9898 + b * 78.233) * 43758.5453);
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smoothstep = (a: number, b: number, v: number) => smooth(clamp01((v - a) / (b - a)));

function vnoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(frac(x));
  const fy = smooth(frac(y));
  const v00 = hash2(ix, iy);
  const v10 = hash2(ix + 1, iy);
  const v01 = hash2(ix, iy + 1);
  const v11 = hash2(ix + 1, iy + 1);
  return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
}

function fbm(x: number, y: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise(x * freq + seed * 13.7, y * freq + seed * 7.3);
    amp *= 0.5;
    freq *= 2.02;
  }
  return sum;
}

type RGB = [number, number, number];
const hex = (s: string): RGB => [
  parseInt(s.slice(1, 3), 16),
  parseInt(s.slice(3, 5), 16),
  parseInt(s.slice(5, 7), 16),
];
const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

interface Pigment {
  color: RGB;
  seed: number;
  /** Noise threshold: higher = rarer blooms. */
  threshold: number;
  /** Max coverage of this pigment. */
  strength: number;
  scale: number;
}

interface WashOpts {
  base: RGB;
  pigments: Pigment[];
  /** 0 = washes everywhere, 1 = washes only hug the edges. */
  edgeBias: number;
  stars: number;
  starTints: RGB[];
  /** Screen (lighten) instead of glaze (darken): for the wine night sky. */
  luminous: boolean;
}

function render(opts: WashOpts): Buffer {
  const buf = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const v = y / H;
      // Where washes are allowed: a soft frame that leaves the center clean.
      const dx = Math.abs(u - 0.5) * 2;
      const dy = Math.abs(v - 0.5) * 2;
      const edge = smoothstep(0.35, 1.05, Math.max(dx, dy * 0.9) + 0.25 * fbm(u * 3, v * 3, 2, 91));
      const allow = 1 - opts.edgeBias + opts.edgeBias * edge;

      let c: RGB = opts.base;
      for (const p of opts.pigments) {
        const nx = u * p.scale;
        const ny = v * p.scale * (H / W) * 1.5;
        // Domain warp gives watercolor blooms instead of static.
        const wx = fbm(nx + 4.2, ny + 1.7, 3, p.seed + 5) * 1.25;
        const wy = fbm(nx - 2.6, ny + 6.3, 3, p.seed + 9) * 1.25;
        const f = fbm(nx + wx, ny + wy, 5, p.seed);
        // Soft-edged pool of pigment...
        const pool = smoothstep(p.threshold, p.threshold + 0.2, f);
        // ...with a darker rim where the wash dried (edge bloom).
        const rim = Math.exp(-Math.pow((f - p.threshold - 0.03) / 0.03, 2)) * 0.28;
        // Granulation: pigment settles unevenly into the paper tooth.
        const grain = 0.88 + 0.24 * vnoise(x * 0.35 + p.seed, y * 0.35);
        const a = clamp01((pool * 0.85 + rim) * grain) * p.strength * allow;
        c = mix(c, p.color, a);
      }
      const i = (y * W + x) * 3;
      buf[i] = c[0];
      buf[i + 1] = c[1];
      buf[i + 2] = c[2];
    }
  }

  for (let s = 0; s < opts.stars; s++) {
    const sx = hash2(s * 3.1, 7) * W;
    const sy = hash2(s * 7.7, 8) * H;
    const bright = 0.2 + 0.8 * hash2(s * 5.3, 9) ** 2.2;
    const radius = 0.7 + 2.1 * hash2(s * 9.1, 10) ** 1.6;
    const tint = opts.starTints[Math.floor(hash2(s * 1.7, 11) * opts.starTints.length) % opts.starTints.length]!;
    const r = Math.ceil(radius * 3);
    for (let oy = -r; oy <= r; oy++) {
      for (let ox = -r; ox <= r; ox++) {
        const px = Math.round(sx) + ox;
        const py = Math.round(sy) + oy;
        if (px < 0 || px >= W || py < 0 || py >= H) continue;
        const a = bright * Math.exp(-(ox * ox + oy * oy) / (2 * radius * radius));
        if (a < 0.01) continue;
        const i = (py * W + px) * 3;
        buf[i] = Math.min(255, buf[i]! + tint[0] * a);
        buf[i + 1] = Math.min(255, buf[i + 1]! + tint[1] * a);
        buf[i + 2] = Math.min(255, buf[i + 2]! + tint[2] * a);
      }
    }
  }
  return buf;
}

async function write(name: string, buf: Buffer): Promise<void> {
  const img = sharp(buf, { raw: { width: W, height: H, channels: 3 } }).blur(0.9);
  await img.clone().webp({ quality: 84 }).toFile(join(OUT, `${name}.webp`));
  await img.clone().jpeg({ quality: 86, mozjpeg: true }).toFile(join(OUT, `${name}.jpg`));
  console.log(`${name}.webp / .jpg`);
}

mkdirSync(OUT, { recursive: true });

// Washes are multiplied onto the page, so their own base is white: only
// pigment darkens the paper.
const PAPER = hex('#ffffff');
const BLUSH = hex('#e6c2cc');
const MAUVE = hex('#c79bb6');
const TAN = hex('#e3bfae');
const ROSE = hex('#d596a6');

await write(
  'wash-paper',
  render({
    base: PAPER,
    edgeBias: 0.92,
    stars: 0,
    starTints: [],
    luminous: false,
    pigments: [
      { color: BLUSH, seed: 3, threshold: 0.44, strength: 0.6, scale: 2.4 },
      { color: TAN, seed: 12, threshold: 0.5, strength: 0.5, scale: 2.9 },
      { color: MAUVE, seed: 21, threshold: 0.56, strength: 0.34, scale: 3.3 },
    ],
  }),
);

await write(
  'wash-hero',
  render({
    base: PAPER,
    edgeBias: 0.25,
    stars: 0,
    starTints: [],
    luminous: false,
    pigments: [
      { color: BLUSH, seed: 8, threshold: 0.4, strength: 0.7, scale: 2.2 },
      { color: TAN, seed: 17, threshold: 0.47, strength: 0.55, scale: 2.7 },
      { color: MAUVE, seed: 26, threshold: 0.5, strength: 0.5, scale: 3.0 },
      { color: ROSE, seed: 33, threshold: 0.6, strength: 0.4, scale: 3.6 },
    ],
  }),
);

await write(
  'wash-wine',
  render({
    base: hex('#3a1326'),
    edgeBias: 0,
    stars: 120,
    starTints: [hex('#f8eaec'), hex('#f2c3cd'), hex('#e3bfae')],
    luminous: true,
    pigments: [
      { color: hex('#55203a'), seed: 5, threshold: 0.36, strength: 0.85, scale: 2.2 },
      { color: hex('#7a3454'), seed: 14, threshold: 0.48, strength: 0.6, scale: 2.8 },
      { color: hex('#a85f7c'), seed: 23, threshold: 0.58, strength: 0.42, scale: 3.3 },
      { color: hex('#c98a9b'), seed: 31, threshold: 0.66, strength: 0.3, scale: 3.8 },
    ],
  }),
);
console.log('washes rendered');
