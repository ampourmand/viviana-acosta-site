/**
 * Copy gate: fails the build if authored copy contains an em dash, leftover
 * placeholder prose, or TODO markers. Viviana's own blog posts are exempt
 * from the punctuation rule (her voice is hers) but never from placeholders.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

const AUTHORED_DIRS = [
  'src/pages',
  'src/components',
  'src/layouts',
  'src/data',
  'src/content/works',
  'src/content/causes',
];
const VOICE_DIRS = ['src/content/blog'];

const PLACEHOLDERS = [
  'It all begins with an idea',
  'Lorem ipsum',
  'TODO:',
  'FIXME',
  'Option 1',
];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(astro|ts|md|mdx|json)$/.test(entry)) yield full;
  }
}

let failures = 0;

function fail(file: string, line: number, message: string) {
  console.error(`  ${relative(ROOT, file)}:${line}  ${message}`);
  failures++;
}

function scan(file: string, banEmDash: boolean) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((text, i) => {
    if (banEmDash && text.includes('—')) {
      fail(file, i + 1, 'em dash in authored copy');
    }
    for (const p of PLACEHOLDERS) {
      if (text.includes(p)) fail(file, i + 1, `placeholder text: "${p}"`);
    }
  });
}

for (const dir of AUTHORED_DIRS) {
  for (const file of walk(join(ROOT, dir))) scan(file, true);
}
for (const dir of VOICE_DIRS) {
  for (const file of walk(join(ROOT, dir))) scan(file, false);
}

if (failures > 0) {
  console.error(`\ncheck-copy: ${failures} problem(s). Build blocked.`);
  process.exit(1);
}
console.log('check-copy: clean.');
