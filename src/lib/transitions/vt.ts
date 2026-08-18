/**
 * View-transition lifecycle registry. Every interactive module registers
 * { init, destroy }; init runs on astro:page-load, destroy on
 * astro:before-swap. Nothing leaks rAF loops, observers, or ScrollTriggers
 * across client-side navigations.
 */
export interface Lifecycle {
  /** Called on every page load (including the first). Return a destroy fn or register teardown separately. */
  init: () => void | (() => void);
}

const modules: Lifecycle[] = [];
let teardowns: Array<() => void> = [];
let wired = false;

export function registerModule(mod: Lifecycle): void {
  modules.push(mod);
  wire();
}

function runInits() {
  for (const mod of modules) {
    try {
      const cleanup = mod.init();
      if (typeof cleanup === 'function') teardowns.push(cleanup);
    } catch (err) {
      console.error('[vt] module init failed', err);
    }
  }
}

function runTeardowns() {
  for (const fn of teardowns) {
    try {
      fn();
    } catch (err) {
      console.error('[vt] module teardown failed', err);
    }
  }
  teardowns = [];
}

function wire() {
  if (wired) return;
  wired = true;
  document.addEventListener('astro:page-load', runInits);
  document.addEventListener('astro:before-swap', runTeardowns);
}
