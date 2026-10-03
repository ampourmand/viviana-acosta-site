/**
 * The one rAF loop for the whole site. Orbs and springs subscribe;
 * the loop stops itself at zero subscribers and pauses on hidden tabs.
 */
type TickFn = (now: number, dt: number) => void;

const subscribers = new Set<TickFn>();
let rafId = 0;
let last = 0;
let running = false;

function frame(now: number) {
  if (!running) return;
  // Cap delta so a background-tab return doesn't explode simulations. The cap
  // is 20fps: slower than that, motion slows down instead of skipping.
  const dt = Math.min(50, now - last || 16.7);
  last = now;
  for (const fn of subscribers) fn(now, dt);
  if (subscribers.size > 0) {
    rafId = requestAnimationFrame(frame);
  } else {
    running = false;
  }
}

function start() {
  if (running || subscribers.size === 0) return;
  running = true;
  last = performance.now();
  rafId = requestAnimationFrame(frame);
}

export function addTick(fn: TickFn): () => void {
  subscribers.add(fn);
  start();
  return () => removeTick(fn);
}

export function removeTick(fn: TickFn): void {
  subscribers.delete(fn);
  if (subscribers.size === 0 && running) {
    cancelAnimationFrame(rafId);
    running = false;
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(rafId);
      running = false;
    } else {
      start();
    }
  });
}
