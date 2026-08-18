import { addTick } from './ticker';
import type { SpringParams } from './tokens';

/**
 * A scalar spring stepped by the shared ticker.
 *
 * Interruptible by construction: setTarget() re-targets from the *current
 * presentation value and velocity*, so grabbing a moving element mid-flight
 * never jumps and reversals never hit a velocity brick wall.
 */
export class Spring {
  private value: number;
  private velocity = 0;
  private target: number;
  private stiffness: number;
  private damping: number;
  private unsubscribe: (() => void) | null = null;
  private onUpdate: (value: number) => void;
  private onRest: (() => void) | null = null;
  private epsilon = 0.0005;

  constructor(
    initial: number,
    params: SpringParams,
    onUpdate: (value: number) => void,
    opts?: { epsilon?: number; onRest?: () => void },
  ) {
    this.value = initial;
    this.target = initial;
    this.onUpdate = onUpdate;
    if (opts?.epsilon !== undefined) this.epsilon = opts.epsilon;
    if (opts?.onRest) this.onRest = opts.onRest;
    const { stiffness, damping } = toPhysics(params);
    this.stiffness = stiffness;
    this.damping = damping;
  }

  /** Retarget from the live value; optionally hand off gesture velocity (units/s). */
  setTarget(target: number, opts?: { velocity?: number; params?: SpringParams }): void {
    this.target = target;
    if (opts?.velocity !== undefined) this.velocity = opts.velocity;
    if (opts?.params) {
      const { stiffness, damping } = toPhysics(opts.params);
      this.stiffness = stiffness;
      this.damping = damping;
    }
    this.start();
  }

  /** Snap without animation (used by reduced-motion branches). */
  jump(value: number): void {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.stop();
    this.onUpdate(value);
  }

  get current(): number {
    return this.value;
  }

  get restingAt(): number {
    return this.target;
  }

  destroy(): void {
    this.stop();
  }

  private start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = addTick((_, dt) => this.step(dt / 1000));
  }

  private stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private step(dt: number): void {
    // Semi-implicit Euler at small steps: stable for our stiffness range and
    // keeps velocity continuous across retargets.
    const steps = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const displacement = this.value - this.target;
      const accel = -this.stiffness * displacement - this.damping * this.velocity;
      this.velocity += accel * h;
      this.value += this.velocity * h;
    }
    const settled =
      Math.abs(this.value - this.target) < this.epsilon &&
      Math.abs(this.velocity) < this.epsilon * 20;
    if (settled) {
      this.value = this.target;
      this.velocity = 0;
      this.onUpdate(this.value);
      this.stop();
      this.onRest?.();
    } else {
      this.onUpdate(this.value);
    }
  }
}

/** Apple's designer parameters -> physics (unit mass). */
function toPhysics({ response, dampingRatio }: SpringParams): {
  stiffness: number;
  damping: number;
} {
  const omega = (2 * Math.PI) / Math.max(0.05, response);
  return {
    stiffness: omega * omega,
    damping: 2 * dampingRatio * omega,
  };
}
