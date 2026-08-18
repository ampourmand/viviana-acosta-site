import type { OrbConfig } from './orb-engine';
import { prefersMoreContrast } from '../motion/prefs';

export type OrbPresetName =
  | 'heroAmbient'
  | 'sectionMarker'
  | 'hoverAccent'
  | 'formPending'
  | 'planet';

const presets: Record<OrbPresetName, Partial<OrbConfig>> = {
  /** The large constellation presence beside the hero. */
  heroAmbient: {
    mode: 'web',
    size: 300,
    count: 340,
    speed: 0.8,
    edges: true,
    seed: 11,
  },
  /** Tiny living node beside section eyebrows. */
  sectionMarker: {
    mode: 'globe',
    size: 22,
    count: 130,
    speed: 1.6,
    seed: 5,
  },
  /** Spins up under a hovered work card. */
  hoverAccent: {
    mode: 'orbits',
    size: 96,
    count: 120,
    speed: 0.9,
    seed: 3,
  },
  /** Form submit-in-flight state. */
  formPending: {
    mode: 'globe',
    size: 28,
    count: 150,
    speed: 2.6,
    seed: 9,
  },
  /** Ascension's slow planetary presence. */
  planet: {
    mode: 'fib',
    size: 340,
    count: 620,
    speed: 0.25,
    seed: 17,
  },
};

export function presetConfig(name: OrbPresetName): Partial<OrbConfig> {
  const base = { ...presets[name] };
  if (prefersMoreContrast()) base.alphaFloor = 0.25;
  return base;
}
