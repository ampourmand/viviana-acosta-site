/**
 * Pointer tracking with a short weighted history so release velocity is
 * available for spring handoff. Tracks 1:1 and respects the grab offset.
 */
export interface GestureState {
  x: number;
  y: number;
  dx: number;
  dy: number;
  vx: number;
  vy: number;
}

interface Sample {
  x: number;
  y: number;
  t: number;
}

export interface GestureHandlers {
  onStart?: (s: GestureState, e: PointerEvent) => void;
  onMove?: (s: GestureState, e: PointerEvent) => void;
  onEnd?: (s: GestureState, e: PointerEvent) => void;
}

const HISTORY_MS = 100;

export function attachGesture(
  el: HTMLElement,
  handlers: GestureHandlers,
): () => void {
  let samples: Sample[] = [];
  let startX = 0;
  let startY = 0;
  let active = false;

  function velocity(): { vx: number; vy: number } {
    const now = performance.now();
    const recent = samples.filter((s) => now - s.t <= HISTORY_MS);
    if (recent.length < 2) return { vx: 0, vy: 0 };
    const first = recent[0]!;
    const lastS = recent[recent.length - 1]!;
    const dt = (lastS.t - first.t) / 1000;
    if (dt <= 0) return { vx: 0, vy: 0 };
    return { vx: (lastS.x - first.x) / dt, vy: (lastS.y - first.y) / dt };
  }

  function state(e: PointerEvent): GestureState {
    const { vx, vy } = velocity();
    return {
      x: e.clientX,
      y: e.clientY,
      dx: e.clientX - startX,
      dy: e.clientY - startY,
      vx,
      vy,
    };
  }

  function down(e: PointerEvent) {
    active = true;
    startX = e.clientX;
    startY = e.clientY;
    samples = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
    el.setPointerCapture(e.pointerId);
    handlers.onStart?.(state(e), e);
  }

  function move(e: PointerEvent) {
    if (!active) return;
    samples.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    if (samples.length > 12) samples.shift();
    handlers.onMove?.(state(e), e);
  }

  function up(e: PointerEvent) {
    if (!active) return;
    active = false;
    handlers.onEnd?.(state(e), e);
    samples = [];
  }

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);

  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
  };
}
