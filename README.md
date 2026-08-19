# Viviana Acosta — vivianaacosta.com

A hand-built portfolio for Viviana Acosta: author and engineer. Astro 5,
TypeScript, GSAP, and a custom canvas orb engine on a deep-violet design
system: clouds of purple glinting into pink and blue, orchid accents,
periwinkle ornament. The homepage opens with a fountain-pen signature intro
(Monsieur La Doulaise baked to SVG outlines, mask-reveal animation, macro
camera pull-back).

Regenerate the cloud backdrops (deterministic fBm renders in public/clouds/)
with `npm run clouds`.

## Daily commands

```bash
npm run dev        # local site at localhost:4321
npm run build      # copy lint + production build to dist/
npm run preview    # serve the production build
npm run check      # TypeScript + Astro diagnostics
```

## Editing content (the common cases)

**New blog post.** Add `src/content/blog/my-post.md`:

```markdown
---
title: "My Post Title"
description: "One sentence for previews and search."
date: 2026-09-01
cover: ../../assets/photos/my-cover.jpg   # optional
tags: ["writing life"]
---
Post body in Markdown.
```

**Update a work** (status, word count, genre): edit its file in
`src/content/works/`. Empty fields render as elegant TBDs, so fill in only
what is real. Status values: `querying`, `on-submission`, `in-progress`,
`drafting`, `complete`, `published`, `tbd`.

**Bio, experience, socials, nav:** `src/data/about.ts` and `src/data/site.ts`.

**Causes:** JSON files in `src/content/causes/`.

**Contact form channels:** the "How did you hear about us?" choices live in
`src/components/contact/ContactForm.astro`.

## Photos

Originals go in `content-src/photos/` (HEIC fine), then:

```bash
npm run ingest
```

This runs ONLY on a Mac (uses `sips` to decode HEIC), auto-orients, applies
the warm editorial grade, and writes committed JPEG masters to
`src/assets/photos/`. Netlify never sees a HEIC. Map new personal photos to
slugs inside `scripts/ingest-photos.ts`.

## The signature

- Artwork + guide strokes: `src/assets/signature/` (`signature-guide.svg` is
  hand-tuned; do not regenerate it casually).
- Rebuild outlines/meta/lab/OG image: `npm run signature`
  (`-- --init-guide` OVERWRITES the hand-tuned guide; avoid).
- Visual iteration: `npm run signature`, copy
  `content-src/signature-lab.html` to `public/`, open
  `localhost:4321/signature-lab.html` and scrub.
- Intro behavior: plays fully on first visit each browser session
  (sessionStorage `viv:intro:v1`), Skip always available, Escape works,
  reduced-motion gets a static crossfade. Replay link sits under the hero
  tagline.

## Copy rules (enforced)

`npm run build` fails if authored copy contains an em dash, placeholder text,
or TODO markers (`scripts/check-copy.ts`). Viviana's blog posts are her voice
and exempt from the punctuation rule.

## Deployment (when she approves)

1. Push to GitHub. In Netlify: Import from Git, build `npm run build`,
   publish `dist/`, Node 22 (already in `netlify.toml`).
2. Netlify site settings: enable **Form detection**, redeploy, then submit
   both forms once on the live URL and confirm the entries appear under
   Forms (contact + newsletter). Free tier: 100 submissions/month.
3. Domain (registered at Squarespace): Squarespace domains dashboard → the
   domain → DNS. FIRST record every existing DNS entry (screenshot), and
   confirm which MX/TXT records exist — email must survive untouched.
   Then use **Add Preset → Netlify** (one click) or manually: delete the
   four Squarespace A records + the `www` CNAME to ext-cust.squarespace.com,
   add `ALIAS @ → apex-loadbalancer.netlify.com` and
   `CNAME www → <site>.netlify.app`. SSL provisions automatically.
4. Cancel only the Squarespace **website** subscription; keep the domain
   subscription with auto-renew ON (~$20/yr, domain-only works fine).
5. Old Squarespace URLs (`/picture-books`, `/young-adul-fiction`, ...)
   301-redirect via `netlify.toml`.

**If Netlify's credit-based free plan ever bites** (300 credits/month, about
20 production deploys): move to Cloudflare Pages (unlimited bandwidth; needs
the domain's nameservers moved to Cloudflare and a form-service swap, e.g.
Formspree — the forms are plain HTML posts, a one-attribute change).

## For Viviana (open items, nothing blocking)

- Bibliography details: statuses, word counts, genres for the notebook works
  (including whether Consuelo Dolores is a novel or flash fiction).
- Preferred headshot if different from the current purple portrait.
- Real "How did you hear about us?" options if these should change.

## Credits

- Orb geometry ported from [`thinking-orbs`](https://github.com/Jakubantalik/thinking-orbs)
  by Jakub Antalik (MIT).
- Fonts: Fraunces (Undercase Type), Source Serif 4 (Adobe), Fragment Mono,
  Monsieur La Doulaise (Sudtipos) — all SIL OFL, self-hosted, licenses in
  `public/fonts/`.
