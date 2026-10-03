import type sharp from 'sharp';

/**
 * The single source of the site's photographic look.
 *
 * 'editorial': personal photography (hiking, the husky, Stationery Fest) gets
 * one consistent printed-photo grade so mixed phone shots sit together on
 * blush paper: slightly softened contrast, a breath of rose warmth.
 *
 * 'natural': content imagery where color accuracy matters (planner spreads,
 * book cover art, diagrams) is normalized but not stylized.
 */
export type GradeProfile = 'editorial' | 'natural';

export function applyGrade(img: sharp.Sharp, profile: GradeProfile): sharp.Sharp {
  const base = img
    .rotate() // honor EXIF orientation, then strip it
    .flatten({ background: '#f8f1ec' });

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
    .modulate({ saturation: 0.97 })
    // Softened contrast, like a matte print.
    .linear(0.97, 5)
    // A breath of rose warmth.
    .recomb([
      [1.02, 0.01, 0.0],
      [0.0, 1.0, 0.0],
      [0.0, 0.01, 0.975],
    ]);
}
