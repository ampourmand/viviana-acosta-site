/**
 * Physical tilt for things you could pick up (prints, book covers).
 * The object leans toward the pointer on two independent springs, lifts a
 * little, and settles back when the pointer leaves. Interruptible by
 * construction: every pointer move just retargets the springs.
 */
import { Spring } from '../motion/spring';
import { springs } from '../motion/tokens';
import { prefersReducedMotion } from '../motion/prefs';
import { registerModule } from '../transitions/vt';

const MAX_DEG = 6;

function mount(el: HTMLElement): () => void {
  const base = el.dataset.tiltBase ?? '';
  let rx = 0;
  let ry = 0;
  let lift = 0;
  const apply = () => {
    el.style.transform = `${base} perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(
      2,
    )}deg) translateZ(${(lift * 14).toFixed(1)}px)`;
    el.style.setProperty('--tilt-lift', lift.toFixed(3));
  };
  const sx = new Spring(0, springs.default, (v) => {
    rx = v;
    apply();
  });
  const sy = new Spring(0, springs.default, (v) => {
    ry = v;
    apply();
  });
  const sl = new Spring(0, springs.snappy, (v) => {
    lift = v;
    apply();
  });

  const move = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    sy.setTarget(px * MAX_DEG * 2);
    sx.setTarget(-py * MAX_DEG * 2);
    sl.setTarget(1);
  };
  const leave = () => {
    sx.setTarget(0);
    sy.setTarget(0);
    sl.setTarget(0);
  };

  el.addEventListener('pointermove', move);
  el.addEventListener('pointerleave', leave);
  return () => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerleave', leave);
    sx.destroy();
    sy.destroy();
    sl.destroy();
    el.style.transform = '';
  };
}

registerModule({
  init() {
    if (prefersReducedMotion()) return;
    const cleanups = Array.from(document.querySelectorAll<HTMLElement>('[data-tilt]')).map(mount);
    return () => cleanups.forEach((fn) => fn());
  },
});
