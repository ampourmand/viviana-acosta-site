/**
 * Brand marks, drawn by hand as SVG. One geometry source feeds the site
 * header, favicon, social image, book cover stamp, and the brand sheet.
 *
 * The idea, taken from Viviana's own logo sketches (a rocket with a nib for
 * a window; a winged nib on a cloud): the fountain pen nib IS the rocket.
 * She writes, and it flies.
 *
 * Every mark is drawn on a 64 x 64 grid. Colors are parameters so the same
 * geometry works in wine on paper and in blush on wine.
 */

export interface MarkColors {
  /** Main shape (nib / letterform). */
  ink: string;
  /** Secondary shape (cloud, flame, wings). */
  soft: string;
  /** What shows through the nib's slit and breather hole. */
  paper: string;
}

export const paperColors: MarkColors = { ink: '#6e2a48', soft: '#d9a3b4', paper: '#f8f1ec' };
export const wineColors: MarkColors = { ink: '#f6dfe4', soft: '#b06a86', paper: '#3e1528' };

/** The nib, pointing up, centered on x = 32. Reused by every mark. */
const NIB_BODY =
  'M32 5 C35.6 12.5 42.5 21 42.5 29.5 C42.5 34.6 40.6 39 38.6 43 L25.4 43 C23.4 39 21.5 34.6 21.5 29.5 C21.5 21 28.4 12.5 32 5 Z';

function nibDetails(paper: string): string {
  return (
    `<path d="M32 12 L32 26.5" stroke="${paper}" stroke-width="1.7" stroke-linecap="round" fill="none"/>` +
    `<circle cx="32" cy="29.6" r="3.1" fill="${paper}"/>`
  );
}

/**
 * Concept 1 (recommended): the Nib Rocket.
 * A nib lifting off a cloud. Fins and a small flame make it a rocket; the
 * slit and breather hole keep it a pen.
 */
export function nibRocket(c: MarkColors, opts: { cloud?: boolean } = {}): string {
  const cloud = opts.cloud ?? true;
  const rocket =
    `<g transform="rotate(30 32 34)">` +
    // flame
    `<path d="M27.6 44.5 C27.6 49.5 32 55.5 32 55.5 C32 55.5 36.4 49.5 36.4 44.5 Z" fill="${c.soft}"/>` +
    // fins
    `<path d="M22.6 33.2 C18.6 36.6 15.6 41.4 14.8 47 C18.4 45.2 22.4 44.3 25.8 44.2 Z" fill="${c.ink}"/>` +
    `<path d="M41.4 33.2 C45.4 36.6 48.4 41.4 49.2 47 C45.6 45.2 41.6 44.3 38.2 44.2 Z" fill="${c.ink}"/>` +
    `<path d="${NIB_BODY}" fill="${c.ink}"/>` +
    nibDetails(c.paper) +
    `</g>`;
  const cloudShape = cloud
    ? `<path d="M9.5 58 C5.4 58 2.5 55.2 2.5 51.8 C2.5 48.6 5 46 8.3 45.7 C9 41.9 12.3 39 16.4 39 C19.2 39 21.7 40.4 23.2 42.5 C24.2 42 25.3 41.8 26.5 41.8 C30.6 41.8 33.9 45 34 49 C36.3 49.5 38 51.4 38 53.6 C38 56 36 58 33.4 58 Z" fill="${c.soft}"/>`
    : '';
  return cloudShape + rocket;
}

/**
 * Concept 2: the Winged Nib.
 * Her winged-nib sketches reduced to geometry: two leaf wings, one cloud.
 */
export function wingedNib(c: MarkColors): string {
  return (
    `<path d="M22 27 C17 21.5 10 18.5 3.5 19 C4.5 21.5 6 23.5 8 25 C7.6 25.4 7.4 25.8 7.2 26.2 C9 28 11.2 29.4 13.6 30.3 C13.5 30.8 13.4 31.2 13.4 31.6 C16.2 33 19.4 33.8 22.6 33.8 Z" fill="${c.soft}"/>` +
    `<path d="M42 27 C47 21.5 54 18.5 60.5 19 C59.5 21.5 58 23.5 56 25 C56.4 25.4 56.6 25.8 56.8 26.2 C55 28 52.8 29.4 50.4 30.3 C50.5 30.8 50.6 31.2 50.6 31.6 C47.8 33 44.6 33.8 41.4 33.8 Z" fill="${c.soft}"/>` +
    `<path d="M13 60 C9.4 60 6.5 57.4 6.5 54.2 C6.5 51.2 8.9 48.8 12 48.5 C13 45.3 16.2 43 20 43 C22.3 43 24.4 43.9 25.9 45.3 L38.1 45.3 C39.6 43.9 41.7 43 44 43 C47.8 43 51 45.3 52 48.5 C55.1 48.8 57.5 51.2 57.5 54.2 C57.5 57.4 54.6 60 51 60 Z" fill="${c.soft}"/>` +
    `<path d="${NIB_BODY}" fill="${c.ink}"/>` +
    nibDetails(c.paper) +
    `<path d="M25.4 43 L38.6 43 L37.4 48.5 L26.6 48.5 Z" fill="${c.ink}"/>`
  );
}

/**
 * Concept 3: the VA monogram.
 * V is a nib pointing down (she writes). A is the same nib pointing up
 * with a crossbar of cloud (it flies).
 */
export function monogramVA(c: MarkColors): string {
  const nib = (transform: string, extra = '') =>
    `<g transform="${transform}">` +
    `<path d="${NIB_BODY}" fill="${c.ink}"/>` +
    nibDetails(c.paper) +
    extra +
    `</g>`;
  return (
    // V: nib pointing down, left
    nib('translate(-13.5 4) rotate(180 32 24)') +
    // A: nib pointing up, right, with a small cloud crossbar at its base
    nib('translate(13.5 4)') +
    `<path d="M31 54 C31 51.6 33 49.7 35.4 49.7 C36.2 47.6 38.2 46.2 40.6 46.2 C42.3 46.2 43.8 46.9 44.9 48.1 C45.9 47.2 47.2 46.7 48.6 46.7 C51.3 46.7 53.5 48.6 54 51 C55.7 51.4 57 52.9 57 54.7 C57 56.8 55.3 58.5 53.2 58.5 L35.2 58.5 C32.9 58.5 31 56.5 31 54 Z" fill="${c.soft}"/>`
  );
}

export function svgDoc(inner: string, size = 64, bg?: string, radius = 14): string {
  const rect = bg ? `<rect width="64" height="64" rx="${radius}" fill="${bg}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">${rect}${inner}</svg>`;
}
