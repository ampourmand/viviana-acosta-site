/**
 * One source of truth for user preference media queries.
 * CSS consumes the same queries via tokens.css overrides; JS engines
 * (orbs, springs, signature player, scroll choreography) consult this.
 */
type PrefListener = () => void;

const queries = {
  reducedMotion: '(prefers-reduced-motion: reduce)',
  reducedTransparency: '(prefers-reduced-transparency: reduce)',
  moreContrast: '(prefers-contrast: more)',
} as const;

const mqls: Partial<Record<keyof typeof queries, MediaQueryList>> = {};
const listeners = new Set<PrefListener>();

function mql(key: keyof typeof queries): MediaQueryList {
  if (!mqls[key]) {
    mqls[key] = window.matchMedia(queries[key]);
    mqls[key]!.addEventListener('change', notify);
  }
  return mqls[key]!;
}

function notify() {
  reflectClasses();
  for (const fn of listeners) fn();
}

/** Mirror preferences onto <html> so CSS and JS observe one truth. */
export function reflectClasses(): void {
  const root = document.documentElement;
  root.classList.toggle('no-motion', prefersReducedMotion());
  root.classList.toggle('no-transparency', mql('reducedTransparency').matches);
  root.classList.toggle('more-contrast', mql('moreContrast').matches);
}

export function prefersReducedMotion(): boolean {
  return mql('reducedMotion').matches;
}

export function prefersReducedTransparency(): boolean {
  return mql('reducedTransparency').matches;
}

export function prefersMoreContrast(): boolean {
  return mql('moreContrast').matches;
}

export function onPrefChange(fn: PrefListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
