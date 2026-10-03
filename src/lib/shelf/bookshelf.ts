/**
 * The Bookshelf's behavior (markup and styles: components/writing/Bookshelf.astro).
 *
 * One 3D book, five springs:
 *   pos    0 in its slot on the shelf   .. 1 presented on the stage
 *   turn   0 spine toward the reader    .. 1 cover toward the reader
 *   open   0 cover shut                 .. 1 cover open (OPEN_DEG)
 *   shift  0 the closed book centered   .. 1 the open spread centered
 *   carry  the hover lift the book had when it was pulled, easing to 0
 *
 * The book is laid out at reading size and scaled DOWN into its slot, so the
 * open page is always crisp. The eye (perspective-origin) rides in front of
 * the hinge: at pos 0 the 3D spine covers the real spine exactly, and the
 * swap between the two cannot be seen.
 *
 * Every spring retargets from its live value and velocity, so any step can be
 * interrupted: Escape mid-flight, a grab at a swinging cover, a second thought.
 * Nothing here reads layout inside the frame loop.
 */
import { registerModule } from '../transitions/vt';
import { Spring } from '../motion/spring';
import { springs, type SpringParams } from '../motion/tokens';
import { project } from '../motion/projection';
import { prefersReducedMotion } from '../motion/prefs';

/** Where an opened cover comes to rest, and as far as it can physically go. */
const OPEN_DEG = 172;
const FLAT = 180 / OPEN_DEG;
const RAD = Math.PI / 180;

const FLY_OUT: SpringParams = { response: 0.5, dampingRatio: 1 };
const TURN_OUT: SpringParams = { response: 0.6, dampingRatio: 1 };
const FLY_HOME: SpringParams = { response: 0.42, dampingRatio: 1 };
const TURN_HOME: SpringParams = { response: 0.32, dampingRatio: 1 };
const COVER_OPEN: SpringParams = { response: 0.58, dampingRatio: 1 };
const COVER_SHUT: SpringParams = { response: 0.34, dampingRatio: 1 };

/** The beat the closed cover is held for before it opens on its own (ms). */
const COVER_BEAT = 200;
/** A release faster than this (cover-travels per second) is a flick. */
const FLICK = 0.9;

type Phase = 'shelf' | 'out' | 'returning';

interface Pose {
  lift: number;
  lean: number;
  liftSpring: Spring | null;
}

interface Drag {
  pointerId: number;
  /** Distance from the hinge to the grabbed point, in the flat model (px). */
  radius: number;
  /** Keeps the cover exactly where it was at the moment it was grabbed. */
  offset: number;
  x: number;
  startX: number;
  moved: boolean;
  samples: Array<{ t: number; v: number }>;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ramp = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function mount(root: HTMLElement): (() => void) | void {
  // A missing part throws; the lifecycle registry logs it and the spines
  // simply stay links.
  const part = <T extends HTMLElement>(name: string): T => {
    const el = root.querySelector<T>(`[data-sb-${name}]`);
    if (!el) throw new Error(`bookshelf: missing [data-sb-${name}]`);
    return el;
  };
  const stage = part<HTMLDialogElement>('stage');
  if (typeof stage.showModal !== 'function') return;
  const scrim = part('scrim');
  const closeBtn = part<HTMLButtonElement>('close');
  const scene = part('scene');
  const book = part('book');
  const spineFace = part('spine');
  const page = part('page');
  const cover = part('cover');
  const front = part('front');
  const inside = part('inner');
  const shadowRight = part('ground-right');
  const shadowLeft = part('ground-left');

  const spines = [...root.querySelectorAll<HTMLAnchorElement>('a[data-book]')];
  const html = document.documentElement;
  const ac = new AbortController();
  const signal = ac.signal;

  let phase: Phase = 'shelf';
  let active: HTMLAnchorElement | null = null;
  /** The slot on the shelf: hinge x, vertical center, scale. Viewport px. */
  const slot = { x: 0, y: 0, s: 1 };
  /** The stage: book size, where its hinge rests shut and open, eye distance. */
  const geo = { W: 420, H: 600, T: 80, shutX: 0, openX: 0, y: 0, P: 1900 };
  let coverWanted = false;
  let coverTaken = false;
  let beatStarted = false;
  let beatTimer = 0;
  let flyingHome = false;
  let drag: Drag | null = null;
  let quiet = false;
  let queued = false;
  /** When the book was pulled: the second click of a double-click lands just
      after, on whatever the book has uncovered, and must not act on it. */
  let pulledAt = -Infinity;
  const justPulled = () => performance.now() - pulledAt < 400;

  /* ---------------------------------------------------------------- */
  /* Rendering: springs only mark the frame dirty; one write pass.     */
  /* ---------------------------------------------------------------- */

  function invalidate() {
    if (quiet || queued) return;
    queued = true;
    queueMicrotask(render);
  }

  const pos = new Spring(0, FLY_OUT, invalidate, { epsilon: 0.0002 });
  const turn = new Spring(0, TURN_OUT, invalidate, { epsilon: 0.0002 });
  const open = new Spring(0, COVER_OPEN, invalidate, { epsilon: 0.0003 });
  const shift = new Spring(0, COVER_OPEN, invalidate, { epsilon: 0.0003 });
  const carry = new Spring(0, springs.default, invalidate, { epsilon: 0.02 });

  /** Where the hinge is right now, from the springs alone (no layout read). */
  function hinge() {
    const p = clamp(pos.current, 0, 1);
    const outX = lerp(geo.shutX, geo.openX, clamp(shift.current, 0, 1));
    return {
      p,
      x: lerp(slot.x, outX, p),
      y: lerp(slot.y + carry.current, geo.y, p),
      s: lerp(slot.s, 1, p),
    };
  }

  function render() {
    queued = false;
    if (phase === 'shelf') return;
    if (drag) solveDrag();

    const { p, x, y, s } = hinge();
    const { W, H, T, P } = geo;
    const turned = clamp(turn.current, 0, 1);
    const opened = clamp(open.current, 0, FLAT);
    const theta = 90 * (1 - turned);
    const phi = -OPEN_DEG * opened;
    const alpha = theta + phi; // the cover's angle to the screen

    scene.style.perspectiveOrigin = `${x.toFixed(2)}px ${y.toFixed(2)}px`;
    book.style.transform =
      `translate3d(${x.toFixed(2)}px, ${(y - H / 2).toFixed(2)}px, 0) ` +
      `rotateY(${theta.toFixed(3)}deg) scale3d(${s.toFixed(5)}, ${s.toFixed(5)}, ${s.toFixed(5)})`;

    cover.style.setProperty('--phi', `${phi.toFixed(3)}deg`);
    // The eye sits in front of the hinge, so the cover is edge-on at exactly -90.
    cover.toggleAttribute('data-flipped', alpha < -90);
    cover.style.setProperty('--shade', (0.9 * Math.abs(Math.sin(alpha * RAD)) ** 1.5).toFixed(3));
    book.style.setProperty('--spine-shade', (0.5 * Math.cos(theta * RAD)).toFixed(3));
    const over = Math.cos(phi * RAD);
    book.style.setProperty('--cast', (over > 0 ? 0.85 * over ** 1.4 : 0).toFixed(3));

    scrim.style.opacity = ramp(0, 0.7, p).toFixed(3);
    closeBtn.style.opacity = ramp(0.45, 1, p).toFixed(3);

    // Ground shadows follow the book's footprint on screen.
    const cosT = Math.cos(theta * RAD);
    const sinT = Math.sin(theta * RAD);
    const screenX = (lx: number, lz: number) => {
      const X = s * (lx * cosT + lz * sinT);
      const Z = s * (-lx * sinT + lz * cosT);
      return x + (X * P) / (P - Z);
    };
    const top = y - (s * H) / 2;
    const lifted = ramp(0.05, 0.75, p);
    const xl = screenX(0, -T);
    const xr = screenX(W, 0);
    shadowRight.style.transform = `translate(${xl.toFixed(1)}px, ${top.toFixed(1)}px) scale(${(
      Math.max(1, xr - xl) / W
    ).toFixed(4)}, ${s.toFixed(4)})`;
    shadowRight.style.opacity = lifted.toFixed(3);

    const free = screenX(W * Math.cos(phi * RAD), -W * Math.sin(phi * RAD));
    const spread = Math.max(0, x - free);
    shadowLeft.style.transform = `translate(${(x - W).toFixed(1)}px, ${top.toFixed(1)}px) scale(${(
      Math.max(1, spread) / W
    ).toFixed(4)}, ${s.toFixed(4)})`;
    shadowLeft.style.opacity = (lifted * clamp(-Math.cos(alpha * RAD), 0, 1)).toFixed(3);

    if (phase === 'out' && !beatStarted && !coverTaken && turned > 0.9) {
      beatStarted = true;
      beatTimer = window.setTimeout(() => {
        if (phase === 'out' && !coverTaken) setCover(true);
      }, COVER_BEAT);
    }
    if (phase === 'returning') {
      if (!flyingHome && open.current < 0.45) flyHome();
      // Close enough that the swap back to the real spine is invisible.
      if (flyingHome && pos.current < 0.0025 && turn.current < 0.003 && open.current < 0.02) {
        settle(true);
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* The shelf: hover lift, and the neighbor that leans into a gap.    */
  /* ---------------------------------------------------------------- */

  const poses = new Map<HTMLElement, Pose>();
  const poseOf = (el: HTMLElement): Pose => {
    let pose = poses.get(el);
    if (!pose) {
      pose = { lift: 0, lean: 0, liftSpring: null };
      poses.set(el, pose);
    }
    return pose;
  };
  const applyPose = (el: HTMLElement, pose: Pose) => {
    el.style.transform =
      pose.lift === 0 && pose.lean === 0
        ? ''
        : `translateY(${pose.lift.toFixed(2)}px) rotate(${pose.lean.toFixed(3)}deg)`;
  };

  function setLift(el: HTMLElement, raised: boolean) {
    if (prefersReducedMotion()) return;
    const pose = poseOf(el);
    pose.liftSpring ??= new Spring(
      0,
      springs.snappy,
      (v) => {
        pose.lift = v;
        applyPose(el, pose);
      },
      { epsilon: 0.02 },
    );
    const em = parseFloat(getComputedStyle(el).fontSize) || 16;
    pose.liftSpring.setTarget(raised ? -0.55 * em : 0);
  }

  let leaner: HTMLElement | null = null;
  const lean = new Spring(
    0,
    springs.gentle,
    (v) => {
      if (!leaner) return;
      const pose = poseOf(leaner);
      pose.lean = v;
      applyPose(leaner, pose);
    },
    {
      epsilon: 0.005,
      onRest: () => {
        if (leaner && lean.restingAt === 0) {
          leaner.style.transformOrigin = '';
          leaner = null;
        }
      },
    },
  );

  /** With a book gone, its left neighbor tips over until the next book catches it. */
  function leanInto(spine: HTMLElement) {
    const prev = spine.previousElementSibling;
    const next = spine.nextElementSibling;
    const able =
      !prefersReducedMotion() && prev instanceof HTMLElement && next instanceof HTMLElement;
    if (leaner && (!able || leaner !== prev)) {
      // A different book was leaning a moment ago: stand it up.
      const pose = poseOf(leaner);
      pose.lean = 0;
      applyPose(leaner, pose);
      leaner.style.transformOrigin = '';
      leaner = null;
      lean.jump(0);
    }
    if (!able) return;
    const gap = next.offsetLeft - (prev.offsetLeft + prev.offsetWidth);
    const h = prev.offsetHeight;
    const flush = Math.asin(clamp(gap / h, 0, 0.2));
    // A shorter catcher is met by the leaning book's side, not its corner.
    const angle = next.offsetHeight >= h * Math.cos(flush) ? flush : Math.atan(gap / next.offsetHeight);
    leaner = prev;
    prev.style.transformOrigin = '100% 100%';
    lean.setTarget(Math.min(angle / RAD, 12) * 0.96, { params: springs.gentle });
  }

  /* ---------------------------------------------------------------- */
  /* Geometry                                                          */
  /* ---------------------------------------------------------------- */

  function layoutStage() {
    const vh = stage.clientHeight;
    let vw = stage.clientWidth;
    let H = Math.min(vh * 0.76, 680);
    let W = H * 0.7;
    let y = vh / 2 + 6;
    if (W > vw - 32) {
      // Narrow screens: the page takes the width, and the book grows taller.
      W = vw - 32;
      H = Math.min(vh * 0.8, W / 0.62);
    } else if (vh < 560 && vw > vh * 1.4) {
      // A phone on its side: a landscape book as tall as the screen allows,
      // set to the left of the button rather than under it.
      vw -= 150;
      H = vh * 0.9;
      W = Math.min(H * 1.1, (vw - 32) / 2);
      y = vh / 2;
    }
    geo.W = Math.round(W);
    geo.H = Math.round(H / 2) * 2;
    geo.shutX = Math.round((vw - geo.W) / 2);
    // Open, the spread is centered when it fits; otherwise the page is.
    geo.openX = Math.max(geo.shutX, Math.round(Math.min(vw / 2, vw - 16 - geo.W)));
    geo.y = Math.round(y);
    geo.P = Math.max(1700, geo.W * 5.5);
    stage.style.setProperty('--W', `${geo.W}px`);
    stage.style.setProperty('--H', `${geo.H}px`);
    scene.style.perspective = `${geo.P}px`;
    markOverflow();
  }

  /** A longer title page scrolls; say so with a fade at its foot. */
  function markOverflow() {
    book.toggleAttribute('data-more', page.scrollHeight - page.clientHeight - page.scrollTop > 6);
  }

  /** Read the pulled book's slot. Its own pose must be at rest (no transform). */
  function measureSlot() {
    if (!active) return;
    const r = active.getBoundingClientRect();
    slot.s = r.height / geo.H;
    slot.x = r.right;
    slot.y = r.top + r.height / 2;
    geo.T = r.width / slot.s;
    stage.style.setProperty('--T', `${geo.T.toFixed(2)}px`);
    // The 3D spine is the real spine's markup at the inverse of the slot scale.
    const font = parseFloat(getComputedStyle(active).fontSize) || 16;
    spineFace.style.fontSize = `${(font / slot.s).toFixed(3)}px`;
  }

  /**
   * A book pulled from under the sticky header would come home tucked back
   * under it. Ease the page down until its slot is in the clear; the slot is
   * re-measured as the page moves (see the scroll listener).
   */
  function clearHeader(spine: HTMLElement) {
    const header = document.querySelector('[data-header]');
    if (!header) return;
    const covered = header.getBoundingClientRect().bottom + 12 - spine.getBoundingClientRect().top;
    if (covered > 0) {
      window.scrollBy({ top: -covered, behavior: prefersReducedMotion() ? 'instant' : 'smooth' });
    }
  }

  /** Dress the stage book as this work. False if its wardrobe is missing. */
  function dress(spine: HTMLAnchorElement): boolean {
    const id = spine.dataset.book ?? '';
    const wardrobe = [...root.querySelectorAll<HTMLElement>('[data-book-wardrobe]')].find(
      (el) => el.dataset.bookWardrobe === id,
    );
    const frontSrc = wardrobe?.querySelector('[data-book-front]');
    const plateSrc = wardrobe?.querySelector('[data-book-plate]');
    const pageSrc = wardrobe?.querySelector('[data-book-page]');
    const inner = spine.querySelector('[data-spine-inner]');
    if (!frontSrc || !pageSrc || !inner) return false;
    const copy = (source: Element) => [...source.childNodes].map((node) => node.cloneNode(true));
    front.replaceChildren(...copy(frontSrc));
    inside.replaceChildren(...(plateSrc ? copy(plateSrc) : []));
    page.replaceChildren(...copy(pageSrc));
    // The art is already loaded (it waits, hidden, in the wardrobe); decode it
    // with the first frame rather than a frame or two late.
    for (const img of stage.querySelectorAll('img')) img.decoding = 'sync';
    // The dialog is named by whichever title page it is showing.
    page.querySelector('[data-page-title]')?.setAttribute('id', 'sb-page-title');
    page.scrollTop = 0;
    spineFace.replaceChildren(inner.cloneNode(true));
    for (const name of ['--cloth', '--foil']) {
      stage.style.setProperty(name, spine.style.getPropertyValue(name));
    }
    spineFace.style.setProperty('--fs', spine.style.getPropertyValue('--fs'));
    return true;
  }

  /* ---------------------------------------------------------------- */
  /* Pull, open, shut, put back                                        */
  /* ---------------------------------------------------------------- */

  function setCover(wantOpen: boolean, velocity = 0) {
    coverWanted = wantOpen;
    if (prefersReducedMotion()) {
      open.jump(wantOpen ? 1 : 0);
      shift.jump(wantOpen ? 1 : 0);
      return;
    }
    const flicked = Math.abs(velocity) > FLICK;
    const params = flicked ? springs.momentum : wantOpen ? COVER_OPEN : COVER_SHUT;
    open.setTarget(wantOpen ? 1 : 0, { velocity, params });
    shift.setTarget(wantOpen ? 1 : 0, { params: wantOpen ? COVER_OPEN : COVER_SHUT });
  }

  function pull(spine: HTMLAnchorElement): boolean {
    // The browser can close the dialog by itself (a second Escape); catch up.
    if (phase !== 'shelf' && !stage.open) settle(false);
    if (phase !== 'shelf' || !dress(spine)) return false;
    pulledAt = performance.now();
    active = spine;
    coverWanted = false;
    coverTaken = false;
    beatStarted = false;
    flyingHome = false;

    // If the shelf is still being set out, this book has arrived.
    for (const animation of spine.getAnimations()) animation.finish();

    // The hover lift rides along and eases out in flight.
    const pose = poseOf(spine);
    const lifted = pose.lift;
    pose.liftSpring?.jump(0);
    pose.lift = 0;
    pose.lean = 0;
    applyPose(spine, pose);

    html.classList.add('shelf-open');
    stage.classList.toggle('is-plain', prefersReducedMotion());
    stage.showModal();
    layoutStage();
    measureSlot();
    clearHeader(spine);
    spine.setAttribute('data-pulled', '');
    phase = 'out';

    quiet = true;
    if (prefersReducedMotion()) {
      pos.jump(1);
      turn.jump(1);
      carry.jump(0);
      setCover(true);
    } else {
      pos.jump(0);
      turn.jump(0);
      open.jump(0);
      shift.jump(0);
      carry.jump(lifted);
      pos.setTarget(1, { params: FLY_OUT });
      turn.setTarget(1, { params: TURN_OUT });
      carry.setTarget(0);
    }
    quiet = false;
    leanInto(spine);
    // First frame now, in the same task as the swap: the 3D spine is already
    // standing where the real one was.
    render();
    return true;
  }

  function putBack() {
    if (phase !== 'out') return;
    if (prefersReducedMotion()) {
      settle(true);
      return;
    }
    phase = 'returning';
    window.clearTimeout(beatTimer);
    endDrag();
    coverWanted = false;
    open.setTarget(0, { params: COVER_SHUT });
    shift.setTarget(0, { params: COVER_SHUT });
    lean.setTarget(0, { params: springs.default });
    invalidate();
  }

  /** The cover is nearly shut: turn the spine out and slide home. */
  function flyHome() {
    flyingHome = true;
    pos.setTarget(0, { params: FLY_HOME });
    turn.setTarget(0, { params: TURN_HOME });
  }

  /** Changed their mind on the way back: bring it out again. */
  function bringBack() {
    if (phase !== 'returning') return;
    phase = 'out';
    flyingHome = false;
    coverTaken = false;
    beatStarted = true;
    pos.setTarget(1, { params: FLY_OUT });
    turn.setTarget(1, { params: TURN_OUT });
    setCover(true);
    if (active) leanInto(active);
  }

  /** Back on the shelf: hand over to the real spine and clear the stage. */
  function settle(refocus: boolean) {
    if (phase === 'shelf') return;
    phase = 'shelf';
    flyingHome = false;
    window.clearTimeout(beatTimer);
    endDrag();
    quiet = true;
    for (const spring of [pos, turn, open, shift, carry]) spring.jump(0);
    quiet = false;
    const spine = active;
    active = null;
    spine?.removeAttribute('data-pulled');
    if (stage.open) stage.close();
    html.classList.remove('shelf-open');
    if (prefersReducedMotion()) lean.jump(0);
    else lean.setTarget(0, { params: springs.default });
    if (refocus) spine?.focus({ preventScroll: true });
    front.replaceChildren();
    inside.replaceChildren();
    page.replaceChildren();
    spineFace.replaceChildren();
  }

  /* ---------------------------------------------------------------- */
  /* The cover in the hand                                             */
  /* ---------------------------------------------------------------- */

  /**
   * The cover follows the finger along a flat arc: the grabbed point sits at
   * `radius` from the hinge, so its x is radius * cos(angle). (The true
   * perspective mapping is not monotonic near shut, where an opening cover
   * first appears to widen; the flat arc is direct and never ambiguous.)
   */
  function solveDrag() {
    if (!drag) return;
    const u = drag.x - drag.offset - hinge().x;
    const angle = Math.acos(clamp(u / drag.radius, -1, 1));
    quiet = true;
    open.jump(angle / (OPEN_DEG * RAD));
    quiet = false;
  }

  /**
   * How far open this grip can carry the cover before the finger runs out of
   * screen. On a phone the hinge sits at the left edge, so a cover can only be
   * carried about half way; "past the middle" has to mean the middle of that.
   */
  function reach(grip: Drag): number {
    const u = -grip.offset - hinge().x;
    return Math.min(1, Math.acos(clamp(u / grip.radius, -1, 1)) / (OPEN_DEG * RAD));
  }

  function endDrag() {
    if (!drag) return;
    if (cover.hasPointerCapture(drag.pointerId)) cover.releasePointerCapture(drag.pointerId);
    drag = null;
    cover.removeAttribute('data-grabbing');
  }

  cover.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0 || phase !== 'out' || drag || justPulled()) return;
      e.preventDefault();
      coverTaken = true;
      window.clearTimeout(beatTimer);
      const { x, s } = hinge();
      const reach = geo.W * s;
      const angle = OPEN_DEG * clamp(open.current, 0, FLAT) * RAD;
      const cos = Math.cos(angle);
      const u = e.clientX - x;
      const radius = clamp(Math.abs(cos) > 0.3 ? u / cos : reach * 0.7, reach * 0.4, reach);
      try {
        cover.setPointerCapture(e.pointerId);
      } catch {
        // The pointer is already gone (a very quick tap): carry on without capture.
      }
      cover.setAttribute('data-grabbing', '');
      open.jump(open.current);
      drag = {
        pointerId: e.pointerId,
        radius,
        offset: u - radius * cos,
        x: e.clientX,
        startX: e.clientX,
        moved: false,
        samples: [{ t: e.timeStamp, v: open.current }],
      };
    },
    { signal },
  );

  cover.addEventListener(
    'pointermove',
    (e) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      drag.x = e.clientX;
      if (Math.abs(e.clientX - drag.startX) > 5) drag.moved = true;
      solveDrag();
      drag.samples.push({ t: e.timeStamp, v: open.current });
      if (drag.samples.length > 8) drag.samples.shift();
      invalidate();
    },
    { signal },
  );

  const release = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { moved, samples } = drag;
    const middle = reach(drag) / 2;
    endDrag();
    if (phase !== 'out') return;
    if (!moved && e.type === 'pointerup') {
      // A tap turns the cover over.
      setCover(!coverWanted);
      return;
    }
    // Velocity from the last ~100ms of the gesture; a pause before letting go is no flick.
    const last = samples[samples.length - 1];
    const first = samples.find((sample) => last && last.t - sample.t <= 100) ?? last;
    let velocity = 0;
    if (last && first && last.t > first.t && e.timeStamp - last.t < 80) {
      velocity = ((last.v - first.v) / (last.t - first.t)) * 1000;
    }
    // Where would it coast to? That decides open or shut, not where it was let go.
    setCover(project(open.current, velocity) > middle, velocity);
  };
  cover.addEventListener('pointerup', release, { signal });
  cover.addEventListener('pointercancel', release, { signal });
  cover.addEventListener('lostpointercapture', release, { signal });

  // Catching the book on its way back to the shelf brings it out again.
  book.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button === 0 && phase === 'returning') bringBack();
    },
    { signal },
  );

  /* ---------------------------------------------------------------- */
  /* Wiring                                                            */
  /* ---------------------------------------------------------------- */

  for (const spine of spines) {
    spine.addEventListener(
      'click',
      (e) => {
        // Modified clicks keep their meaning (new tab, download, and so on).
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
          return;
        }
        if (pull(spine)) e.preventDefault();
      },
      { signal },
    );
    spine.addEventListener(
      'pointerenter',
      (e) => {
        if (e.pointerType === 'mouse') setLift(spine, true);
      },
      { signal },
    );
    spine.addEventListener('pointerleave', () => setLift(spine, false), { signal });
    spine.addEventListener(
      'focus',
      () => {
        if (spine.matches(':focus-visible')) setLift(spine, true);
      },
      { signal },
    );
    spine.addEventListener('blur', () => setLift(spine, false), { signal });
  }

  closeBtn.addEventListener('click', putBack, { signal });

  // Escape (and the platform's other "close" gestures) puts the book back.
  stage.addEventListener(
    'cancel',
    (e) => {
      e.preventDefault();
      putBack();
    },
    { signal },
  );
  // If the platform closes the dialog on its own, follow it. (Our own close()
  // also lands here, a task later; by then a new book may already be out.)
  stage.addEventListener(
    'close',
    () => {
      if (!stage.open) settle(true);
    },
    { signal },
  );

  // A click on the dimmed room puts the book back: pressed AND released on
  // the room (a drag that ends on the book is not a click on the room), and
  // not the tail of the double-click that pulled it.
  let downOnRoom = false;
  let upOnRoom = false;
  scene.addEventListener(
    'pointerdown',
    (e) => {
      downOnRoom = e.target === scene;
      upOnRoom = false;
    },
    { signal },
  );
  scene.addEventListener(
    'pointerup',
    (e) => {
      upOnRoom = e.target === scene;
    },
    { signal },
  );
  scene.addEventListener(
    'click',
    (e) => {
      if (e.target !== scene || !downOnRoom || !upOnRoom) return;
      if (e.detail > 1 || justPulled()) return;
      putBack();
    },
    { signal },
  );

  // A held Enter repeats. Left alone, the repeat presses "Put it back" the
  // moment focus lands on it, then the spine again, and round it goes.
  const noRepeat = (e: KeyboardEvent) => {
    if (e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault();
  };
  stage.addEventListener('keydown', noRepeat, { signal });
  for (const spine of spines) spine.addEventListener('keydown', noRepeat, { signal });

  page.addEventListener('scroll', markOverflow, { signal, passive: true });

  // Tabbing to the page while the cover is shut opens the cover.
  page.addEventListener(
    'focusin',
    () => {
      if (phase === 'out' && !coverWanted) setCover(true);
    },
    { signal },
  );

  window.addEventListener(
    'resize',
    () => {
      if (phase === 'shelf') return;
      layoutStage();
      measureSlot();
      invalidate();
    },
    { signal },
  );

  // The page can still be moving under the open book (a smooth scroll that
  // was already under way, or clearHeader). Keep the slot on the real spine.
  window.addEventListener(
    'scroll',
    () => {
      if (phase === 'shelf') return;
      measureSlot();
      invalidate();
    },
    { signal, passive: true },
  );

  // Leaving the page from inside the book: put it away before the page turns
  // (a 3D scene in the top layer does not survive a view-transition snapshot).
  document.addEventListener('astro:before-preparation', () => settle(false), { signal });

  // Dev only: pose the book at exact spring values to inspect a frame.
  if (import.meta.env.DEV) {
    type Dials = Partial<Record<'pos' | 'turn' | 'open' | 'shift', number>>;
    (window as unknown as { __shelf?: unknown }).__shelf = {
      pull: (id: string) => {
        const spine = spines.find((el) => el.dataset.book === id);
        return spine ? pull(spine) : false;
      },
      pose: (dials: Dials) => {
        window.clearTimeout(beatTimer);
        beatStarted = true;
        coverTaken = true;
        quiet = true;
        if (dials.pos !== undefined) pos.jump(dials.pos);
        if (dials.turn !== undefined) turn.jump(dials.turn);
        if (dials.open !== undefined) open.jump(dials.open);
        if (dials.shift !== undefined) shift.jump(dials.shift);
        carry.jump(0);
        quiet = false;
        render();
      },
      putBack,
      state: () => ({
        phase,
        pos: pos.current,
        turn: turn.current,
        open: open.current,
        shift: shift.current,
        coverWanted,
      }),
    };
  }

  // The shelf is live: a spine now opens a book instead of following its
  // link, so say that (and only now; without script it is an ordinary link).
  const plainLabels = new Map<HTMLElement, string>();
  for (const spine of spines) {
    const label = spine.getAttribute('aria-label');
    if (label) {
      plainLabels.set(spine, label);
      spine.setAttribute('aria-label', `${label} Pull it off the shelf.`);
    }
    spine.setAttribute('aria-haspopup', 'dialog');
  }
  root.setAttribute('data-ready', '');

  return () => {
    root.removeAttribute('data-ready');
    for (const [spine, label] of plainLabels) spine.setAttribute('aria-label', label);
    for (const spine of spines) spine.removeAttribute('aria-haspopup');
    if (import.meta.env.DEV) delete (window as unknown as { __shelf?: unknown }).__shelf;
    settle(false);
    ac.abort();
    for (const spring of [pos, turn, open, shift, carry, lean]) spring.destroy();
    for (const [el, pose] of poses) {
      pose.liftSpring?.destroy();
      el.style.transform = '';
      el.style.transformOrigin = '';
    }
    poses.clear();
  };
}

registerModule({
  init() {
    const root = document.querySelector<HTMLElement>('[data-bookshelf]');
    if (!root) return;
    return mount(root);
  },
});
