/**
 * Write-on-view. Every `.ink[data-ink-write="view"]` that starts below the
 * fold waits unwritten, then the pen writes it the first time it scrolls
 * into view. Lines already on screen at load stay finished (nothing ever
 * un-writes in front of the reader). Reduced motion: everything stays
 * finished.
 */
import { gsap } from 'gsap';
import { registerModule } from '../transitions/vt';
import { prefersReducedMotion } from '../motion/prefs';
import type { InkPiece } from './freehand';
import { InkWriter } from './writer';

const loaders = import.meta.glob<{ default: InkPiece }>('../../assets/ink/*.json');

export async function loadPiece(id: string): Promise<InkPiece> {
  const load = loaders[`../../assets/ink/${id}.json`];
  if (!load) throw new Error(`unknown ink piece: ${id}`);
  return (await load()).default;
}

/** Swap an .ink host from its static mask to live strokes. */
export function goLive(host: HTMLElement, piece: InkPiece): InkWriter {
  const writer = new InkWriter(piece);
  host.querySelector('.ink-live')?.remove();
  host.appendChild(writer.svg);
  host.classList.add('is-live');
  return writer;
}

registerModule({
  init() {
    if (prefersReducedMotion()) return;
    const hosts = Array.from(
      document.querySelectorAll<HTMLElement>('.ink[data-ink-write="view"]'),
    );
    if (hosts.length === 0) return;

    const tweens: gsap.core.Tween[] = [];
    const viewportH = window.innerHeight;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const host = entry.target as HTMLElement;
          io.unobserve(host);
          void write(host);
        }
      },
      { threshold: 0.55 },
    );

    async function write(host: HTMLElement) {
      const id = host.dataset.ink!;
      try {
        const piece = await loadPiece(id);
        const writer = goLive(host, piece);
        writer.setProgress(0);
        host.classList.remove('is-pending');
        const state = { p: 0 };
        tweens.push(
          gsap.to(state, {
            p: 1,
            duration: piece.duration,
            ease: 'none', // the pen's rhythm is baked into the samples
            onUpdate: () => writer.setProgress(state.p),
          }),
        );
      } catch {
        // If the piece fails to load, fall back to the finished mask.
        host.classList.remove('is-pending', 'is-live');
      }
    }

    for (const host of hosts) {
      const rect = host.getBoundingClientRect();
      if (rect.top < viewportH * 0.92) continue; // already visible: leave written
      host.classList.add('is-pending');
      io.observe(host);
    }

    return () => {
      io.disconnect();
      for (const t of tweens) t.kill();
      for (const host of hosts) host.classList.remove('is-pending');
    };
  },
});
