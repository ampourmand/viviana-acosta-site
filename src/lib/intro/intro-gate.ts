/**
 * Session gating for the book intro. The decision itself is made before
 * first paint by the inline script in Base.astro (it adds `intro-on` to
 * <html>); these helpers are for everything after that.
 */
const REPLAY = 'viv:intro:replay';

/** True when the inline head script decided the intro should play. */
export function introRequested(): boolean {
  return document.documentElement.classList.contains('intro-on');
}

/** Ask for the intro to play on the next load of the home page. */
export function requestReplay(): void {
  try {
    sessionStorage.setItem(REPLAY, '1');
  } catch {
    // Storage unavailable: nothing to remember, the reload just shows home.
  }
}

/** The intro is over (finished, skipped, or failed): show the site. */
export function releaseIntro(): void {
  document.documentElement.classList.remove('intro-on');
}
