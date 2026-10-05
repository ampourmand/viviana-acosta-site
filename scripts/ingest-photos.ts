/**
 * Photo ingest: content-src/{photos,remote} -> src/assets/photos.
 *
 * Runs on the maintainer's Mac ONLY (sharp's prebuilt binaries cannot decode
 * HEIC, so HEIC is decoded via macOS `sips` first). Graded JPEG masters are
 * committed; the Netlify build image never sees a HEIC.
 */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import sharp from 'sharp';
import { applyGrade, type GradeProfile } from './grade';

const ROOT = new URL('..', import.meta.url).pathname;
const PERSONAL = join(ROOT, 'content-src/photos');
const REMOTE = join(ROOT, 'content-src/remote');
const OUT = join(ROOT, 'src/assets/photos');

/** Personal photos: source file -> output slug (all get the editorial grade). */
const personal: Record<string, string> = {
  'FullSizeRender 3.HEIC': 'photo-smokies-1',
  'FullSizeRender 4.HEIC': 'photo-smokies-2',
  'image000000.JPG': 'photo-husky-court',
  'IMG_6855.JPG': 'photo-husky-hallway',
  'IMG_7158.HEIC': 'photo-flag-selfie',
  'IMG_7163.HEIC': 'photo-husky-treadmill',
  'IMG_7166.HEIC': 'photo-husky-howl',
  'IMG_7350.HEIC': 'photo-desert-hike-1',
  'IMG_7351.HEIC': 'photo-desert-hike-2',
  'IMG_7358.HEIC': 'photo-desert-cactus',
  'IMG_7484.HEIC': 'photo-stationery-liberty',
};

/** Edges trimmed off (fractions of the upright image) so only Viviana is in frame. */
const trims: Record<string, { bottom: number }> = {
  'photo-smokies-1': { bottom: 0.14 },
};

/** Remote (rescued from Squarespace): which grade each gets. */
const remoteProfiles: Record<string, GradeProfile> = {
  // Her studio headshot is already color-managed: leave it alone.
  'portrait-headshot.png': 'natural',
};

/** Archived from the old site but no longer used anywhere. */
const retired = new Set(['portrait-about.png', 'portrait-home-collage.png']);

interface ManifestEntry {
  width: number;
  height: number;
  profile: GradeProfile;
}

const manifest: Record<string, ManifestEntry> = {};

/** Count GIF Graphic Control Extensions; more than one means animation. */
function isAnimatedGif(path: string): boolean {
  const buf = readFileSync(path);
  let count = 0;
  for (let i = 0; i < buf.length - 2; i++) {
    if (buf[i] === 0x21 && buf[i + 1] === 0xf9 && buf[i + 2] === 0x04) {
      count++;
      if (count > 1) return true;
    }
  }
  return false;
}

function decodeHeic(path: string, tmp: string): string {
  const out = join(tmp, `${basename(path, extname(path))}.jpg`);
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '95', path, '--out', out], {
    stdio: 'pipe',
  });
  return out;
}

async function processImage(
  srcPath: string,
  slug: string,
  profile: GradeProfile,
  tmp: string,
): Promise<void> {
  const ext = extname(srcPath).toLowerCase();
  const input = ext === '.heic' ? decodeHeic(srcPath, tmp) : srcPath;
  const outPath = join(OUT, `${slug}.jpg`);
  let image = sharp(input);
  const trim = trims[slug];
  if (trim) {
    const upright = await sharp(input).rotate().toBuffer({ resolveWithObject: true });
    const height = Math.round(upright.info.height * (1 - trim.bottom));
    image = sharp(upright.data).extract({ left: 0, top: 0, width: upright.info.width, height });
  }
  const info = await applyGrade(image, profile)
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(outPath);
  manifest[`${slug}.jpg`] = { width: info.width, height: info.height, profile };
  console.log(`  ${slug}.jpg  ${info.width}x${info.height}  [${profile}]`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), 'viv-ingest-'));

  console.log('Personal photos (editorial grade):');
  for (const [file, slug] of Object.entries(personal)) {
    await processImage(join(PERSONAL, file), slug, 'editorial', tmp);
  }

  console.log('Rescued site images:');
  for (const file of readdirSync(REMOTE).sort()) {
    const ext = extname(file).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.gif'].includes(ext)) continue;
    if (retired.has(file)) continue;
    const slug = basename(file, ext);
    if (ext === '.gif' && isAnimatedGif(join(REMOTE, file))) {
      // Animated planner flip-throughs stay animated; copy untouched.
      copyFileSync(join(REMOTE, file), join(OUT, `${slug}.gif`));
      console.log(`  ${slug}.gif  [animated, copied as-is]`);
      continue;
    }
    const profile = remoteProfiles[file] ?? 'natural';
    await processImage(join(REMOTE, file), slug, profile, tmp);
  }

  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${Object.keys(manifest).length} masters written to src/assets/photos`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
