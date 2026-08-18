// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Site URL: swap to the real custom domain at DNS cutover time.
export default defineConfig({
  site: 'https://vivianaacosta.com',
  output: 'static',
  integrations: [sitemap()],
  image: {
    // Astro's built-in sharp service builds the AVIF/WebP ladders from the
    // pre-graded JPEG masters in src/assets/photos (never from HEIC).
    responsiveStyles: true,
  },
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'viewport',
  },
});
