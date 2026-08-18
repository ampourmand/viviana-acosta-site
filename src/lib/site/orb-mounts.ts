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
    const canvases = document.querySelectorAll<HTMLCanvasElement>('canvas[data-orb]');
    for (const canvas of canvases) {
      const preset = canvas.dataset.orb as OrbPresetName;
      const cfg = presetConfig(preset);
      const sizeAttr = canvas.dataset.orbSize;
      if (sizeAttr) cfg.size = Number(sizeAttr);
      try {
        const orb = new Orb(canvas, cfg);
        if (prefersReducedMotion()) orb.renderStatic();
        else orb.start();
        instances.push(orb);
        // Let hover-driven components reach their orb.
        (canvas as HTMLCanvasElement & { __orb?: Orb }).__orb = orb;
      } catch {
        // canvas unavailable: the orb is decorative, carry on
      }
    }
    return () => {
      for (const orb of instances) orb.destroy();
    };
  },
});
