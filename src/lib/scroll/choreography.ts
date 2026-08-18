/**
 * Scroll choreography: quiet, one-shot entrance reveals. Scrubbed triggers
 * and springs stay interruptible; these fire once and get out of the way.
 * Reduced motion is handled by gsap.matchMedia (no motion, content simply
 * present).
 */
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { registerModule } from '../transitions/vt';

gsap.registerPlugin(ScrollTrigger);

const REVEAL_TARGETS = [
  '.section-heading',
  '.work-row',
  '.post-card',
  '.cause',
  '.book',
  '.piece',
  '.photo-strip li',
  '.mission-line',
].join(', ');

registerModule({
  init() {
    const mm = gsap.matchMedia();

    mm.add('(prefers-reduced-motion: no-preference)', () => {
      for (const el of document.querySelectorAll(REVEAL_TARGETS)) {
        gsap.fromTo(
          el,
          { opacity: 0, y: 14 },
          {
            opacity: 1,
            y: 0,
            duration: 0.65,
            ease: 'power2.out',
            scrollTrigger: { trigger: el, start: 'top 90%', once: true },
          },
        );
      }
      // Hairline rules under sticky chrome draw themselves in.
      for (const rule of document.querySelectorAll('.ink-rule')) {
        gsap.fromTo(
          rule,
          { scaleX: 0 },
          {
            scaleX: 1,
            duration: 0.9,
            ease: 'power3.out',
            scrollTrigger: { trigger: rule, start: 'top 92%', once: true },
          },
        );
      }
    });

    return () => mm.revert();
  },
});
