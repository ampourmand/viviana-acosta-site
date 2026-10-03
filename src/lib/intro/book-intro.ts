/**
 * The book intro: storyboard and player.
 *
 *   settle   the closed book arrives on the desk
 *   open     cover swings open, two leaves follow
 *   write    the pen writes the mission line (camera eases toward the page)
 *   launch   the pen lifts, flips nib-up, dips, and launches like a rocket
 *   dive     the camera pushes into the page until the page is the site
 *
 * One master timeline; all times in seconds from the start (no chained
 * delays). Any key, click on Skip, wheel, or touch skips. The rig is laid
 * out at final size and the camera only ever scales DOWN from 1, so the
 * handoff to the real hero is exact.
 */
import { gsap } from 'gsap';
import { registerModule } from '../transitions/vt';
import { introRequested, releaseIntro } from './intro-gate';
import { loadPiece } from '../ink/reveal';
import { InkWriter } from '../ink/writer';

const T = {
  settle: 0.05,
  settleDur: 0.5,
  open: 0.55,
  openDur: 0.98,
  leafGap: 0.14,
  leafDur: 0.68,
  penIn: 1.36,
  penInDur: 0.56,
  write: 1.9,
  /** Multiplier on the piece's natural writing pace. */
  writePace: 0.92,
  lift: 0.16,
  twirl: 0.46,
  dip: 0.14,
  dipHold: 0.05,
  launch: 0.44,
  diveLead: 0.08, // the dive starts this long after the launch begins
  diveDur: 0.95,
  fade: 0.26,
} as const;

/** Fraction of the page width the handwriting spans, and where it sits. */
const INK_W = 0.8;
const INK_LEFT = 0.1;
const INK_TOP = 0.2;
const PAGE_RATIO = 1.36;

/** The pen artwork is 290 units long; its balance point is mid-barrel. */
const PEN_HALF = 144;
const PEN_ANGLE = 36;

interface Vec {
  x: number;
  y: number;
}

function createBookIntro(root: HTMLElement) {
  const camera = root.querySelector<HTMLElement>('[data-bi-camera]')!;
  const inkHost = root.querySelector<HTMLElement>('[data-bi-ink]')!;
  const curtain = root.querySelector<HTMLElement>('[data-bi-curtain]')!;
  const cast = root.querySelector<HTMLElement>('[data-bi-cast]')!;
  const groundLeft = root.querySelector<HTMLElement>('[data-bi-ground-left]')!;
  const penEl = root.querySelector<HTMLElement>('[data-bi-pen]')!;
  const penShadow = root.querySelector<HTMLElement>('[data-bi-pen-shadow]')!;
  const puff = root.querySelector<HTMLElement>('[data-bi-puff]')!;
  const skipBtn = root.querySelector<HTMLButtonElement>('[data-bi-skip]')!;
  // DOM order is bottom-up; the cover is last and turns first.
  const leaves = Array.from(root.querySelectorAll<HTMLElement>('[data-bi-leaf]')).reverse();

  let tl: gsap.core.Timeline | null = null;
  let done = false;
  const cleanups: Array<() => void> = [];

  const cam = { s: 1, fx: 0, fy: 0 };
  const pen = { cx: 0, cy: 0, a: PEN_ANGLE, k: 1, lift: 0, o: 0, stretch: 1 };

  let vw = window.innerWidth;
  let vh = window.innerHeight;

  function applyCamera() {
    const tx = vw / 2 - cam.fx * cam.s;
    const ty = vh / 2 - cam.fy * cam.s;
    camera.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${cam.s.toFixed(4)})`;
  }

  function applyPen() {
    const base = `rotate(${pen.a.toFixed(2)}deg) scale(${pen.k.toFixed(4)}, ${(pen.k * pen.stretch).toFixed(4)})`;
    penEl.style.transform = `translate(${pen.cx.toFixed(2)}px, ${pen.cy.toFixed(2)}px) ${base} translate(0px, ${PEN_HALF}px)`;
    penEl.style.opacity = String(pen.o);
    // The shadow slides away and softens as the pen leaves the paper.
    const ox = (10 + 46 * pen.lift) * pen.k;
    const oy = (14 + 60 * pen.lift) * pen.k;
    penShadow.style.transform = `translate(${(pen.cx + ox).toFixed(2)}px, ${(pen.cy + oy).toFixed(2)}px) ${base} translate(-10px, ${PEN_HALF - 286}px)`;
    penShadow.style.opacity = String(pen.o * (0.36 - 0.22 * Math.min(1, pen.lift)));
  }

  /** Place the pen so its nib rests on `tip` at the current angle. */
  function penToTip(tip: Vec) {
    const rad = (pen.a * Math.PI) / 180;
    pen.cx = tip.x + Math.sin(rad) * PEN_HALF * pen.k;
    pen.cy = tip.y - Math.cos(rad) * PEN_HALF * pen.k;
  }

  function setLeaf(leaf: HTMLElement, p: number) {
    leaf.style.setProperty('--angle', `${(-180 * p).toFixed(3)}deg`);
    leaf.style.setProperty('--shade', Math.sin(p * Math.PI).toFixed(3));
    leaf.toggleAttribute('data-flipped', p >= 0.5);
  }

  function lockPage(lock: boolean) {
    for (const el of document.querySelectorAll<HTMLElement>(
      'body > header, body > main, body > footer, body > nav',
    )) {
      if (lock) el.setAttribute('inert', '');
      else el.removeAttribute('inert');
    }
  }

  /** Hand the page back: hero pieces make their entrance. */
  function reveal(stagger: boolean) {
    const pieces = Array.from(document.querySelectorAll<HTMLElement>('[data-hero-reveal]'));
    gsap.set(pieces, { autoAlpha: 0, y: stagger ? 14 : 0 });
    releaseIntro();
    lockPage(false);
    gsap.to(pieces, {
      autoAlpha: 1,
      y: 0,
      duration: stagger ? 0.7 : 0.3,
      ease: 'power3.out',
      stagger: stagger ? 0.06 : 0,
      clearProps: 'opacity,visibility,transform',
    });
  }

  function finish(stagger: boolean) {
    if (done) return;
    done = true;
    tl?.kill();
    gsap.killTweensOf([cam, pen, root, curtain]);
    for (const fn of cleanups.splice(0)) fn();
    reveal(stagger);
    gsap.to(root, {
      autoAlpha: 0,
      duration: T.fade,
      ease: 'power1.out',
      onComplete: () => root.remove(),
    });
  }

  async function play() {
    (window as Window & { __vivIntroStarted?: boolean }).__vivIntroStarted = true;
    window.scrollTo({ top: 0, behavior: 'instant' });
    lockPage(true);
    skipBtn.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        finish(false);
      }
    };
    const onSkip = () => finish(false);
    const onResize = () => finish(false);
    document.addEventListener('keydown', onKey);
    skipBtn.addEventListener('click', onSkip);
    window.addEventListener('wheel', onSkip, { passive: true });
    window.addEventListener('touchmove', onSkip, { passive: true });
    window.addEventListener('resize', onResize);
    cleanups.push(() => {
      document.removeEventListener('keydown', onKey);
      skipBtn.removeEventListener('click', onSkip);
      window.removeEventListener('wheel', onSkip);
      window.removeEventListener('touchmove', onSkip);
      window.removeEventListener('resize', onResize);
    });

    // Measure only once type is in: the hero's layout decides everything.
    const fonts = Promise.race([
      document.fonts.ready,
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
    let piece;
    try {
      [piece] = await Promise.all([loadPiece('mission'), fonts]);
    } catch {
      finish(false);
      return;
    }
    if (done) return;

    const heroInk = document.querySelector<HTMLElement>('main [data-ink="mission"]');
    if (!heroInk) {
      finish(false);
      return;
    }

    /* ---------------- geometry (all in layout pixels) ---------------- */
    vw = window.innerWidth;
    vh = window.innerHeight;
    const ink = heroInk.getBoundingClientRect();
    const pageW = ink.width / INK_W;
    const pageH = pageW * PAGE_RATIO;
    const pageX = ink.left - pageW * INK_LEFT;
    const pageY = ink.top - pageH * INK_TOP;
    root.style.setProperty('--page-w', `${pageW.toFixed(2)}px`);
    root.style.setProperty('--page-h', `${pageH.toFixed(2)}px`);
    root.style.setProperty('--page-x', `${pageX.toFixed(2)}px`);
    root.style.setProperty('--page-y', `${pageY.toFixed(2)}px`);
    Object.assign(inkHost.style, {
      left: `${ink.left}px`,
      top: `${ink.top}px`,
      width: `${ink.width}px`,
      height: `${ink.height}px`,
    });

    const writer = new InkWriter(piece);
    inkHost.appendChild(writer.svg);
    writer.setProgress(0);
    const [vbX, vbY, vbW, vbH] = piece.viewBox;
    const toLayout = (x: number, y: number): Vec => ({
      x: ink.left + ((x - vbX) / vbW) * ink.width,
      y: ink.top + ((y - vbY) / vbH) * ink.height,
    });

    /* ---------------- camera stations ---------------- */
    const wide = vw >= 760;
    const pageCenter: Vec = { x: pageX + pageW / 2, y: pageY + pageH / 2 };
    const spine: Vec = { x: pageX, y: pageY + pageH / 2 };
    const fit = wide
      ? Math.min((vw * 0.84) / (pageW * 2.1), (vh * 0.74) / pageH)
      : Math.min((vw * 0.8) / pageW, (vh * 0.66) / pageH);
    const sFit = Math.min(0.94, fit);
    const closed = pageCenter;
    const opened = wide ? spine : pageCenter;
    // While writing, ease toward the page but keep the open book in view,
    // so the dive that follows has real distance to travel.
    const sWrite = Math.min(0.9, sFit * (wide ? 1.14 : 1.1));
    const writeFocus: Vec = {
      x: wide ? pageX + pageW * 0.3 : pageX + pageW / 2,
      y: pageY + pageH * (wide ? 0.47 : 0.44),
    };

    cam.s = sFit * 0.965;
    cam.fx = closed.x;
    cam.fy = closed.y;
    applyCamera();

    /* ---------------- pen stations ---------------- */
    pen.k = (pageW * 0.6) / 290;
    const first = writer.tipAt(0);
    const startTip = toLayout(first.x, first.y);
    pen.a = PEN_ANGLE;
    pen.lift = 1;
    // Wait off the upper right of the page.
    penToTip({ x: startTip.x + pageW * 0.75, y: startTip.y - pageH * 0.3 });
    const penHome = { cx: pen.cx, cy: pen.cy };
    penToTip(startTip);
    const penAtStart = { cx: pen.cx, cy: pen.cy };
    pen.cx = penHome.cx;
    pen.cy = penHome.cy;
    applyPen();

    /* ---------------- master timeline ---------------- */
    const writeDur = piece.duration * T.writePace;
    const tEndWrite = T.write + writeDur;
    const tTwirl = tEndWrite + T.lift;
    const tDip = tTwirl + T.twirl;
    const tLaunch = tDip + T.dip + T.dipHold;
    const tDive = tLaunch + T.diveLead;

    tl = gsap.timeline({
      paused: true,
      defaults: { ease: 'power3.out' },
      onUpdate: () => {
        applyCamera();
        applyPen();
      },
      onComplete: () => finish(true),
    });

    // settle: the book arrives.
    tl.set(camera, { visibility: 'visible' }, 0);
    tl.fromTo(root.querySelector('.bi-scene'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4, ease: 'power1.out' }, T.settle);
    tl.fromTo(root.querySelectorAll('.bi-ground-right'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5, ease: 'power1.out' }, T.settle);
    tl.to(cam, { s: sFit, duration: T.settleDur }, T.settle);

    // open: the cover, then two leaves; the camera pans to the spread.
    const flips = leaves.map(() => ({ p: 0 }));
    const updateFlips = () => {
      let shadow = 0;
      leaves.forEach((leaf, i) => {
        const p = flips[i]!.p;
        setLeaf(leaf, p);
        shadow = Math.max(shadow, Math.sin(p * Math.PI));
      });
      cast.style.opacity = shadow.toFixed(3);
      // The left-hand shadow grows with the cover's footprint as it lands.
      const cover = flips[0]!.p;
      const footprint = cover > 0.5 ? -Math.cos(cover * Math.PI) : 0;
      groundLeft.style.opacity = footprint.toFixed(3);
      groundLeft.style.transform = `scaleX(${Math.max(0.001, footprint).toFixed(3)})`;
    };
    leaves.forEach((_, i) => {
      const isCover = i === 0;
      const isLast = i === leaves.length - 1;
      const start = isCover ? T.open : T.open + T.openDur * 0.42 + (i - 1) * T.leafGap;
      tl!.to(
        flips[i]!,
        {
          p: 1,
          duration: isCover ? T.openDur : isLast ? T.leafDur + 0.12 : T.leafDur,
          ease: isCover ? 'power2.inOut' : 'sine.inOut',
          onUpdate: updateFlips,
        },
        start,
      );
    });
    tl.to(cam, { fx: opened.x, fy: opened.y, duration: T.openDur, ease: 'power2.inOut' }, T.open);

    // pen in: an arc from the upper right, touching down at the first stroke.
    tl.to(pen, { o: 1, duration: 0.25, ease: 'power1.out' }, T.penIn);
    tl.to(pen, { cx: penAtStart.cx, duration: T.penInDur, ease: 'power2.out' }, T.penIn);
    tl.to(pen, { cy: penAtStart.cy, duration: T.penInDur, ease: 'power2.inOut' }, T.penIn);
    tl.to(pen, { lift: 0, duration: 0.22, ease: 'power2.in' }, T.write - 0.22);
    tl.to(cam, { s: sWrite, fx: writeFocus.x, fy: writeFocus.y, duration: 1.3, ease: 'power2.inOut' }, T.penIn - 0.1);

    // write: the pen's rhythm is baked into the samples, so progress is linear.
    const writing = { p: 0 };
    let lean = 0;
    let lastX = startTip.x;
    tl.to(
      writing,
      {
        p: 1,
        duration: writeDur,
        ease: 'none',
        onUpdate: () => {
          writer.setProgress(writing.p);
          const tip = writer.tipAt(writing.p);
          const at = toLayout(tip.x, tip.y);
          // Between strokes the nib hops: up, across, down.
          const hop = tip.down ? 0 : Math.sin(Math.min(1, tip.hop) * Math.PI);
          pen.lift = hop * 0.5;
          // A real pen barely rotates: lean a few degrees into the motion.
          const dx = at.x - lastX;
          lastX = at.x;
          lean += (Math.max(-5, Math.min(5, dx * 1.2)) - lean) * 0.14;
          pen.a = PEN_ANGLE + lean;
          penToTip({ x: at.x, y: at.y - hop * 9 * pen.k });
        },
      },
      T.write,
    );

    // launch: lift, flip nib-up, dip (anticipation), go.
    const launchAngle = 180 + 30 + 360; // nib leads, tilted like the mark
    const dir = () => {
      // Nib direction once flipped: local "down" rotated by the angle.
      const rad = ((180 + 30) * Math.PI) / 180;
      return { x: -Math.sin(rad), y: Math.cos(rad) };
    };
    tl.to(pen, { lift: 1, duration: T.lift, ease: 'power2.out' }, tEndWrite);
    // Carry the pen down to the middle of the page while it flips, so the
    // launch has a runway and reads clearly across the paper.
    const pad = { cx: pageX + pageW * 0.4, cy: pageY + pageH * 0.56 };
    tl.to(pen, { cx: pad.cx, duration: T.lift + T.twirl, ease: 'power2.inOut' }, tEndWrite);
    tl.to(pen, { cy: pad.cy, duration: T.lift + T.twirl, ease: 'power1.inOut' }, tEndWrite);
    tl.to(pen, { a: launchAngle, duration: T.twirl, ease: 'power2.inOut' }, tTwirl);
    tl.to(
      pen,
      {
        cx: () => `-=${dir().x * 16 * pen.k}`,
        cy: () => `-=${dir().y * 16 * pen.k}`,
        stretch: 0.95,
        duration: T.dip,
        ease: 'power2.out',
      },
      tDip,
    );
    const flight = (Math.max(vw, vh) / sWrite) * 1.25;
    tl.to(
      pen,
      {
        cx: () => `+=${dir().x * flight}`,
        cy: () => `+=${dir().y * flight}`,
        stretch: 1.07,
        duration: T.launch,
        ease: 'power2.in',
      },
      tLaunch,
    );
    tl.set(pen, { o: 0 }, tLaunch + T.launch);

    // A puff of cloud where it left: caused by the launch, so it starts on
    // the launch frame.
    const puffs = Array.from(puff.children) as HTMLElement[];
    tl.call(
      () => {
        const rad = (pen.a * Math.PI) / 180;
        // Tail of the pen (opposite the nib).
        const tailX = pen.cx - Math.sin(rad) * -PEN_HALF * pen.k;
        const tailY = pen.cy + Math.cos(rad) * -PEN_HALF * pen.k;
        puffs.forEach((el, i) => {
          const ang = (i / puffs.length) * Math.PI * 2 + i * 0.7;
          const spread = pageW * (0.03 + (i % 3) * 0.02);
          const back = pageW * (0.05 + (i % 4) * 0.022);
          gsap.fromTo(
            el,
            { x: tailX, y: tailY, scale: 0.4, opacity: 0.96 },
            {
              // Billow outward and trail away from the direction of flight.
              x: tailX + Math.cos(ang) * spread - dir().x * back,
              y: tailY + Math.sin(ang) * spread * 0.7 - dir().y * back,
              scale: 1.1 + (i % 3) * 0.35,
              opacity: 0,
              duration: 0.7 + (i % 2) * 0.12,
              ease: 'power2.out',
            },
          );
        });
      },
      [],
      tLaunch,
    );

    // dive: into the page. Paper swallows the desk; the camera lands on
    // identity, where the page's handwriting IS the hero's handwriting.
    tl.to(cam, { s: 1, fx: vw / 2, fy: vh / 2, duration: T.diveDur, ease: 'power3.inOut' }, tDive);
    tl.to(curtain, { opacity: 1, duration: T.diveDur * 0.62, ease: 'power1.in' }, tDive + T.diveDur * 0.3);
    tl.to(skipBtn, { autoAlpha: 0, duration: 0.2 }, tDive);

    if (import.meta.env.DEV) {
      (window as Window & { __bookIntro?: unknown }).__bookIntro = {
        tl,
        seek: (seconds: number) => {
          tl?.pause();
          tl?.time(seconds, false);
          applyCamera();
          applyPen();
        },
        duration: () => tl?.duration(),
      };
    }

    tl.play();
  }

  return {
    play,
    skip: () => finish(false),
    destroy: () => {
      done = true;
      tl?.kill();
      for (const fn of cleanups.splice(0)) fn();
      lockPage(false);
      releaseIntro();
      root.remove();
    },
  };
}

registerModule({
  init() {
    const root = document.querySelector<HTMLElement>('[data-book-intro]');
    if (!root) return;
    if (!introRequested()) return;
    const intro = createBookIntro(root);
    void intro.play();
    return () => intro.destroy();
  },
});
