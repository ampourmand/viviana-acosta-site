/**
 * Hydrates every <canvas data-orb="preset"> on the page. Registered with the
 * view-transition registry so instances are destroyed before each swap.
 */
import { Orb } from '../orbs/orb-engine';
import { presetConfig, type OrbPresetName } from '../orbs/orb-presets';
import { registerModule } from '../transitions/vt';
import { prefersReducedMotion } from '../motion/prefs';

registerModule({
  init() {
    const instances: Orb[] = [];
    const cleanups: Array<() => void> = [];
    const canvases = document.querySelectorAll<HTMLCanvasElement>('canvas[data-orb]');
    for (const canvas of canvases) {
      const preset = canvas.dataset.orb as OrbPresetName;
      const cfg = presetConfig(preset);
      const sizeAttr = canvas.dataset.orbSize;
      if (sizeAttr) cfg.size = Number(sizeAttr);
      // data-orb-fit: the parent's width is the size, and stays the size.
      const frame = canvas.hasAttribute('data-orb-fit') ? canvas.parentElement : null;
      if (frame && frame.clientWidth > 0) cfg.size = Math.round(frame.clientWidth);
      try {
        const orb = new Orb(canvas, cfg);
        if (frame) {
          // Resizing the canvas changes the frame's height, so apply it on the
          // next frame; doing it inside the observer callback is a resize loop.
          let pending = 0;
          const ro = new ResizeObserver(() => {
            cancelAnimationFrame(pending);
            pending = requestAnimationFrame(() => {
              if (frame.clientWidth > 0) orb.resize(Math.round(frame.clientWidth));
            });
          });
          ro.observe(frame);
          cleanups.push(() => {
            cancelAnimationFrame(pending);
            ro.disconnect();
          });
        }
        if (prefersReducedMotion()) orb.renderStatic();
        else orb.start();
        instances.push(orb);
        // Let hover-driven components reach their orb.
        (canvas as HTMLCanvasElement & { __orb?: Orb }).__orb = orb;

        if (canvas.hasAttribute('data-orb-spin')) {
          orb.enableSpin();
          const onKey = (e: KeyboardEvent) => {
            const step: Record<string, [number, number]> = {
              ArrowLeft: [1, 0],
              ArrowRight: [-1, 0],
              ArrowUp: [0, -1],
              ArrowDown: [0, 1],
            };
            const move = step[e.key];
            if (!move) return;
            e.preventDefault();
            orb.nudge(move[0], move[1]);
          };
          canvas.addEventListener('keydown', onKey);
          cleanups.push(() => canvas.removeEventListener('keydown', onKey));
        }
      } catch {
        // canvas unavailable: the orb is decorative, carry on
      }
    }
    return () => {
      for (const fn of cleanups) fn();
      for (const orb of instances) orb.destroy();
    };
  },
});
