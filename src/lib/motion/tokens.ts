/**
 * Spring vocabulary, Apple-parameterized: response (seconds to target) and
 * dampingRatio (1 = critically damped, < 1 overshoots). Bounce must be
 * earned by real gesture momentum; default UI never overshoots.
 */
export interface SpringParams {
  response: number;
  dampingRatio: number;
}

export const springs = {
  default: { response: 0.38, dampingRatio: 1.0 },
  gentle: { response: 0.6, dampingRatio: 1.0 },
  snappy: { response: 0.26, dampingRatio: 0.95 },
  momentum: { response: 0.5, dampingRatio: 0.78 },
} as const satisfies Record<string, SpringParams>;

export type SpringName = keyof typeof springs;
