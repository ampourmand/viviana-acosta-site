/**
 * Renders the site's purple cloud fields: deep violet fBm noise glinting
 * into pink and blue, baked to static images at build time. Deterministic
 * (no Math.random), so the clouds are the same on every build.
 *
 * Outputs (public/clouds/):
 *   clouds-base.webp/.jpg  quiet site-wide backdrop, low contrast
 *   clouds-hero.webp/.jpg  richer variant with faint star glints
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'public/clouds');
const W = 1600;
const H = 1000;

/* Deterministic value noise (same recipe as the orb engine). */
const frac = (v: number) => v - Math.floor(v);
const hash2 = (a: number, b: number) =>
  frac(Math.sin(a * 12.9898 + b * 78.233) * 43758.5453);
const smooth = (t: number) => t * t * (3 - 2 * t);

function vnoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(frac(x));
  const fy = smooth(frac(y));
  const v00 = hash2(ix, iy);
  const v10 = hash2(ix + 1, iy);
  const v01 = hash2(ix, iy + 1);
  const v11 = hash2(ix + 1, iy + 1);
  return (
    v00 * (1 - fx) * (1 - fy) +
    v10 * fx * (1 - fy) +
    v01 * (1 - fx) * fy +
    v11 * fx * fy
  );
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

/** Piecewise ramp through color stops. */
function ramp(stops: Array<[number, RGB]>, t: number): RGB {
  if (t <= stops[0]![0]) return stops[0]![1];
  for (let i = 1; i < stops.length; i++) {
    const [pos, color] = stops[i]!;
    if (t <= pos) {
      const [prevPos, prevColor] = stops[i - 1]!;
      return mix(prevColor, color, (t - prevPos) / (pos - prevPos));
    }
  }
  return stops[stops.length - 1]![1];
}

/* Deep purple lifting into pink; and into periwinkle blue. */
const PINK: Array<[number, RGB]> = [
  [0.0, hex('#151021')],
  [0.5, hex('#251a40')],
  [0.72, hex('#4b2f66')],
  [0.88, hex('#7c4c85')],
  [1.0, hex('#b479ab')],
];
const BLUE: Array<[number, RGB]> = [
  [0.0, hex('#151021')],
  [0.5, hex('#1f1b45')],
  [0.72, hex('#333670')],
  [0.88, hex('#4d5698')],
  [1.0, hex('#7d92d9')],
];

interface CloudOpts {
  seed: number;
  contrast: number; // 0..1 how far the ramp is allowed to rise
  stars: number; // count of glint specks, 0 for none
}

function renderClouds({ seed, contrast, stars }: CloudOpts): Buffer {
  const buf = Buffer.alloc(W * H * 3);
  const scale = 3.1; // noise cells across the width
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = (x / W) * scale;
      const ny = (y / H) * scale * (H / W) * 1.6;
      // Domain warp makes billows instead of static */
      const wx = fbm(nx + 4.2, ny + 1.7, 3, seed + 5) * 1.1;
      const wy = fbm(nx - 2.6, ny + 6.3, 3, seed + 9) * 1.1;
      let t = fbm(nx + wx, ny + wy, 5, seed);
      t = Math.min(1, Math.max(0, (t - 0.18) * 1.55));
      t = Math.pow(t, 1.55) * contrast;
      // A slow hue field chooses between the pink and blue ramps.
      const h = smooth(Math.min(1, Math.max(0, fbm(nx * 0.55 + 11.1, ny * 0.55 + 3.7, 3, seed + 17) * 1.6 - 0.25)));
      const c = mix(ramp(PINK, t), ramp(BLUE, t), h);
      const i = (y * W + x) * 3;
      buf[i] = c[0];
      buf[i + 1] = c[1];
      buf[i + 2] = c[2];
    }
  }

  // Faint star glints: soft gaussian specks in lavender, pink, periwinkle.
  const tints: RGB[] = [hex('#efe9f8'), hex('#eebede'), hex('#aebdf2')];
  for (let s = 0; s < stars; s++) {
    const sx = hash2(s * 3.1, seed) * W;
    const sy = hash2(s * 7.7, seed + 1) * H;
    const bright = 0.25 + 0.75 * hash2(s * 5.3, seed + 2) ** 2;
    const radius = 0.8 + 2.4 * hash2(s * 9.1, seed + 3) ** 1.5;
    const tint = tints[Math.floor(hash2(s * 1.7, seed + 4) * 3) % 3]!;
    const r = Math.ceil(radius * 3);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const px = Math.round(sx) + dx;
        const py = Math.round(sy) + dy;
        if (px < 0 || px >= W || py < 0 || py >= H) continue;
        const fall = Math.exp(-(dx * dx + dy * dy) / (2 * radius * radius));
        const a = bright * fall;
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
  const img = sharp(buf, { raw: { width: W, height: H, channels: 3 } }).blur(1.2);
  await img.clone().webp({ quality: 82 }).toFile(join(OUT, `${name}.webp`));
  await img.clone().jpeg({ quality: 84, mozjpeg: true }).toFile(join(OUT, `${name}.jpg`));
  console.log(`${name}.webp / .jpg`);
}

mkdirSync(OUT, { recursive: true });
await write('clouds-base', renderClouds({ seed: 3, contrast: 0.5, stars: 0 }));
await write('clouds-hero', renderClouds({ seed: 8, contrast: 0.85, stars: 110 }));
console.log('clouds rendered');
