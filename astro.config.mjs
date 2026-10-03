// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

/**
 * A post's page already has its h1 (the title). If the post's own outline
 * starts at `#`, shift the whole outline down so it starts at h2.
 */
function demoteBodyHeadings() {
  /** @param {any} tree */
  return (tree) => {
    /** @type {any[]} */
    const headings = [];
    /** @param {any} node */
    const walk = (node) => {
      if (node.type === 'element' && /^h[1-6]$/.test(node.tagName)) headings.push(node);
      if (node.children) node.children.forEach(walk);
    };
    walk(tree);
    if (headings.length === 0) return;
    const top = Math.min(...headings.map((h) => Number(h.tagName[1])));
    if (top >= 2) return;
    for (const h of headings) h.tagName = `h${Math.min(6, Number(h.tagName[1]) + 2 - top)}`;
  };
}

export default defineConfig({
  // Her live domain.
  site: 'https://www.escritoraviviana.com',
  devToolbar: { enabled: false },
  output: 'static',
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/thanks'),
    }),
  ],
  image: {
    // Astro's built-in sharp service builds the AVIF/WebP ladders from the
    // pre-graded JPEG masters in src/assets/photos (never from HEIC).
    responsiveStyles: true,
  },
  markdown: {
    rehypePlugins: [demoteBodyHeadings],
  },
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'viewport',
  },
});
