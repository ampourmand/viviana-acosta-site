/**
 * The signature ink player: a macro nib writes "Viviana Acosta" in wet ink,
 * the camera pulls back, the page follows.
 *
 * States: idle -> writing -> settling -> complete; skipped from any state.
 * Reduced motion gets the finished frame and a quiet crossfade via the same
 * API so callers never branch.
 */
import { gsap } from 'gsap';
import meta from '../../assets/signature/signature-meta.json';
import { prefersReducedMotion } from '../motion/prefs';

export type PlayerState = 'idle' | 'writing' | 'settling' | 'complete' | 'skipped';

interface StrokeRuntime {
  id: number;
  length: number;
  weight: number;
  mask: SVGPathElement;
  wet: SVGPathElement;
  pool: SVGCircleElement | null;
  guide: SVGPathElement;
}

export interface SignaturePlayer {
  play(): void;
  skip(): void;
  dismiss(): void;
  destroy(): void;
  state(): PlayerState;
  onDismissed(cb: () => void): void;
}

const WRITE_SECONDS = 4.4;
const PEN_LIFT = 0.09;
const WET_WINDOW = 130;

export function createSignaturePlayer(overlay: HTMLElement): SignaturePlayer {
  const svg = overlay.querySelector<SVGSVGElement>('svg[data-signature="animated"]')!;
  const camera = overlay.querySelector<HTMLElement>('[data-sig-camera]')!;
  const nib = svg.querySelector<SVGGElement>('[data-sig-nib]')!;
  const subtitle = overlay.querySelector<HTMLElement>('[data-sig-subtitle]');
  const prompt = overlay.querySelector<HTMLElement>('[data-sig-prompt]');

  let state: PlayerState = 'idle';
  let tl: gsap.core.Timeline | null = null;
  let dismissedCb: (() => void) | null = null;
  let cameraTicker: (() => void) | null = null;

  // Build runtime stroke table; guides are detached paths used only for
  // point sampling (lengths come precomputed from build time).
  const ns = 'http://www.w3.org/2000/svg';
  const strokes: StrokeRuntime[] = meta.strokes.map((s) => {
    const guide = document.createElementNS(ns, 'path');
    guide.setAttribute('d', s.d);
    return {
      id: s.id,
      length: s.length,
      weight: s.weight,
      mask: svg.querySelector<SVGPathElement>(`[data-sig-mask="${s.id}"]`)!,
      wet: svg.querySelector<SVGPathElement>(`[data-sig-wet="${s.id}"]`)!,
      pool: svg.querySelector<SVGCircleElement>(`[data-sig-pool="${s.id}"]`),
      guide,
    };
  });

  const nibPos = { x: 0, y: 0, active: 0 };
  const cameraPos = { x: 0, y: 0, scale: 1, cx: 0.5, cy: 0.5 };
  // The svg's UNTRANSFORMED screen rect, measured once per play/resize.
  // Reading the live rect inside the camera loop would feed the camera's own
  // transform back into itself and diverge.
  let baseRect = { left: 0, top: 0, width: 1, height: 1 };

  function measureBase() {
    const prev = camera.style.transform;
    camera.style.transform = 'none';
    const r = svg.getBoundingClientRect();
    baseRect = { left: r.left, top: r.top, width: r.width, height: r.height };
    camera.style.transform = prev;
  }

  function svgPointToOverlay(x: number, y: number): { px: number; py: number } {
    // Map signature viewBox coords to fractions of the svg box.
    const [vx, vy, vw, vh] = meta.viewBox.split(' ').map(Number) as [number, number, number, number];
    return { px: (x - vx) / vw, py: (y - vy) / vh };
  }

  function applyCamera() {
    const scale = cameraPos.scale;
    // Keep the nib's fraction-point near the viewport focus while zoomed.
    // camera transform-origin is 0 0 and transform = translate() scale():
    // a base point B lands at T + B*s, so T = focus - B*s.
    const focusX = window.innerWidth * 0.5;
    const focusY = window.innerHeight * 0.44;
    const nibBaseX = baseRect.left + cameraPos.cx * baseRect.width;
    const nibBaseY = baseRect.top + cameraPos.cy * baseRect.height;
    const originX = baseRect.left;
    const originY = baseRect.top;
    // translate is applied to the element; with origin at the element's
    // top-left, screen position of point P: origin + (P - origin)*s + t.
    const tx = focusX - (originX + (nibBaseX - originX) * scale);
    const ty = focusY - (originY + (nibBaseY - originY) * scale);
    // Blend toward no correction as scale approaches 1 so settle lands at rest.
    const k = Math.min(1, Math.max(0, (scale - 1) / 1.3));
    camera.style.transform = `translate(${tx * k}px, ${ty * k}px) scale(${scale})`;
  }

  function setNib(stroke: StrokeRuntime, localT: number) {
    const at = Math.max(0, Math.min(stroke.length, stroke.length * localT));
    const pt = stroke.guide.getPointAtLength(at);
    const ahead = stroke.guide.getPointAtLength(Math.min(stroke.length, at + 2));
    const angle = (Math.atan2(ahead.y - pt.y, ahead.x - pt.x) * 180) / Math.PI;
    // Damped rotation around a fixed writing angle: real pens barely rotate.
    const damped = -42 + Math.max(-14, Math.min(14, angle * 0.18));
    nib.setAttribute('transform', `translate(${pt.x} ${pt.y}) rotate(${damped})`);
    const frac = svgPointToOverlay(pt.x, pt.y);
    cameraPos.cx += (frac.px - cameraPos.cx) * 0.16;
    cameraPos.cy += (frac.py - cameraPos.cy) * 0.16;
  }

  function buildTimeline(): gsap.core.Timeline {
    const timeline = gsap.timeline({
      paused: true,
      onComplete: () => settle(),
    });

    timeline.set(nib, { opacity: 1 });
    let cursor = 0;

    strokes.forEach((stroke, i) => {
      const dur = Math.max(0.16, stroke.weight * WRITE_SECONDS);
      const isFirst = i === 0;
      const isLast = i === strokes.length - 1;
      const ease = isFirst ? 'power1.in' : isLast ? 'power1.out' : 'none';

      const proxy = { t: 0 };
      timeline.to(
        proxy,
        {
          t: 1,
          duration: dur,
          ease,
          onStart: () => {
            nibPos.active = stroke.id;
          },
          onUpdate: () => {
            const t = proxy.t;
            stroke.mask.setAttribute('stroke-dashoffset', String(stroke.length * (1 - t)));
            // Wet trail: a bright window riding just behind the tip.
            const window_ = Math.min(WET_WINDOW, stroke.length);
            stroke.wet.setAttribute('stroke-dasharray', `${window_} ${stroke.length + 200}`);
            stroke.wet.setAttribute(
              'stroke-dashoffset',
              String(window_ - stroke.length * t),
            );
            setNib(stroke, t);
          },
          onComplete: () => {
            // Ink pool blooms where the pen lifted, then the wet window dries.
            gsap.to(stroke.wet, { opacity: 0, duration: 1.6, ease: 'power1.out' });
            if (stroke.pool) {
              gsap.fromTo(
                stroke.pool,
                { opacity: 0.55, scale: 0.4 },
                { opacity: 0, scale: 1.5, duration: 1.4, ease: 'power2.out' },
              );
            }
          },
        },
        cursor,
      );
      // Pen lift between words (space between glyph 7 and 8) breathes longer.
      const lift = stroke.id === 7 ? PEN_LIFT * 3 : PEN_LIFT;
      cursor += dur + (isLast ? 0 : lift);
    });

    return timeline;
  }

  function startCameraLoop() {
    if (cameraTicker) return;
    const tick = () => applyCamera();
    gsap.ticker.add(tick);
    cameraTicker = () => gsap.ticker.remove(tick);
  }

  function lockPage(lock: boolean) {
    document.documentElement.style.overflow = lock ? 'hidden' : '';
    for (const el of document.querySelectorAll<HTMLElement>('body > header, body > main, body > footer')) {
      if (lock) el.setAttribute('inert', '');
      else el.removeAttribute('inert');
    }
  }

  function play() {
    if (state !== 'idle') return;
    if (prefersReducedMotion()) {
      // Finished frame, quiet reveal, no camera choreography.
      for (const s of strokes) {
        s.mask.setAttribute('stroke-dashoffset', '0');
        s.wet.setAttribute('stroke-dasharray', `0 ${s.length + 200}`);
      }
      state = 'complete';
      lockPage(true);
      overlay.dataset.state = 'complete';
      gsap.fromTo(overlay, { opacity: 0 }, { opacity: 1, duration: 0.3 });
      if (subtitle) gsap.fromTo(subtitle, { opacity: 0 }, { opacity: 1, duration: 0.4, delay: 0.2 });
      if (prompt) gsap.fromTo(prompt, { opacity: 0 }, { opacity: 1, duration: 0.4, delay: 0.3 });
      return;
    }

    state = 'writing';
    overlay.dataset.state = 'writing';
    lockPage(true);
    cameraPos.scale = window.innerWidth < 720 ? 1.7 : 2.3;
    // Seed focus at the first stroke's starting point.
    const first = strokes[0]!.guide.getPointAtLength(0);
    const frac = svgPointToOverlay(first.x, first.y);
    cameraPos.cx = frac.px;
    cameraPos.cy = frac.py;
    measureBase();
    window.addEventListener('resize', measureBase);
    startCameraLoop();
    applyCamera();
    tl = buildTimeline();
    if (import.meta.env.DEV) {
      (window as Window & { __sigDebug?: unknown }).__sigDebug = {
        seek: (p: number) => {
          tl?.progress(p, false);
          applyCamera();
        },
        settle,
      };
    }
    tl.play();
  }

  function settle() {
    if (state !== 'writing') return;
    state = 'settling';
    overlay.dataset.state = 'settling';
    gsap.to(nib, { opacity: 0, duration: 0.5, ease: 'power1.out' });
    gsap.to(cameraPos, {
      scale: 1,
      duration: 1.15,
      ease: 'expo.inOut',
      onUpdate: () => applyCamera(),
      onComplete: () => {
        cameraTicker?.();
        cameraTicker = null;
        camera.style.transform = 'none';
        state = 'complete';
        overlay.dataset.state = 'complete';
      },
    });
    if (subtitle) {
      gsap.fromTo(subtitle, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.7, delay: 0.75, ease: 'power2.out' });
    }
    if (prompt) {
      gsap.fromTo(prompt, { opacity: 0 }, { opacity: 1, duration: 0.6, delay: 1.05 });
    }
  }

  function skip() {
    if (state === 'skipped') return;
    tl?.kill();
    cameraTicker?.();
    cameraTicker = null;
    for (const s of strokes) {
      s.mask.setAttribute('stroke-dashoffset', '0');
      s.wet.setAttribute('opacity', '0');
    }
    gsap.set(nib, { opacity: 0 });
    camera.style.transform = 'none';
    dismiss();
  }

  function dismiss() {
    if (state === 'skipped') return;
    const wasComplete = state === 'complete';
    state = 'skipped';
    overlay.dataset.state = 'leaving';
    tl?.kill();
    cameraTicker?.();
    cameraTicker = null;

    const finish = () => {
      overlay.remove();
      lockPage(false);
      dismissedCb?.();
    };

    const bg = overlay.querySelector<HTMLElement>('[data-sig-bg]');
    const heroSig = document.querySelector<SVGSVGElement>(
      'main [data-signature-home] svg[data-signature="static"]',
    );

    if (!wasComplete || prefersReducedMotion() || !heroSig || !bg) {
      gsap.to(overlay, {
        opacity: 0,
        duration: prefersReducedMotion() ? 0.2 : 0.55,
        ease: 'power1.inOut',
        onComplete: finish,
      });
      return;
    }

    // Shared-element handoff: fly the overlay signature onto the hero
    // masthead while the curtain lifts, so the name never jumps.
    lockPage(false);
    measureBase();
    const hero = heroSig.getBoundingClientRect();
    const scale = hero.width / baseRect.width;
    // transform-origin is 0 0 at the svg's base top-left: translating by the
    // rect delta maps the overlay signature exactly onto the hero masthead.
    const dx = hero.left - baseRect.left;
    const dy = hero.top - baseRect.top;
    const fade = overlay.querySelectorAll('[data-sig-subtitle], [data-sig-prompt], [data-sig-skip]');
    gsap.to(fade, { opacity: 0, duration: 0.25, ease: 'power1.out' });
    gsap.to(bg, { opacity: 0, duration: 0.6, ease: 'power2.inOut' });
    gsap.to(camera, {
      x: dx,
      y: dy,
      scale,
      transformOrigin: '0 0',
      duration: 0.75,
      ease: 'expo.inOut',
      onComplete: () => {
        gsap.to(overlay, { opacity: 0, duration: 0.18, onComplete: finish });
      },
    });
  }

  function destroy() {
    tl?.kill();
    cameraTicker?.();
    cameraTicker = null;
    window.removeEventListener('resize', measureBase);
    lockPage(false);
    overlay.remove();
  }

  return {
    play,
    skip,
    dismiss,
    destroy,
    state: () => state,
    onDismissed: (cb) => {
      dismissedCb = cb;
    },
  };
}
