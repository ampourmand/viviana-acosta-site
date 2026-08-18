/**
 * Momentum projection: where would this gesture coast to if we let it
 * decelerate like a scroll view? Choose snap targets from the projected
 * endpoint, not the release point.
 */
export function project(
  value: number,
  velocity: number,
  decelerationRate = 0.998,
): number {
  return value + ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

export function nearest(candidates: readonly number[], point: number): number {
  let best = candidates[0] ?? 0;
  let bestDist = Math.abs(best - point);
  for (const c of candidates) {
    const d = Math.abs(c - point);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}
