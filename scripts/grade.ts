import type sharp from 'sharp';

/**
 * The single source of the site's photographic look.
 *
 * 'editorial': personal photography (portraits, hiking, the husky, Stationery
 * Fest) gets a consistent warm dark grade so mixed phone photos sit coherently
 * on the charcoal canvas: gentle black lift toward #121110, eased saturation,
 * a warm cast pulling away from blue.
 *
 * 'natural': content imagery where color accuracy matters (planner spreads,
 * book cover art, diagrams) is normalized but not stylized.
 */
export type GradeProfile = 'editorial' | 'natural';

export function applyGrade(img: sharp.Sharp, profile: GradeProfile): sharp.Sharp {
  const base = img
    .rotate() // honor EXIF orientation, then strip it
    .flatten({ background: '#121110' });

  if (profile === 'natural') {
    return base.resize({
      width: 2000,
      height: 2000,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  return base
    .resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true })
    .modulate({ saturation: 0.86, brightness: 0.99 })
    // Gentle black lift + soft rolloff toward the charcoal ground.
    .linear(0.94, 8)
    // Warm cast: nudge red up, pull blue down.
    .recomb([
      [1.03, 0.02, 0.0],
      [0.01, 1.0, 0.0],
      [0.0, 0.01, 0.93],
    ]);
}
