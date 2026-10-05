# Viviana Acosta: escritoraviviana.com

A hand-built site for Viviana Acosta, author and engineer. Astro 5, strict
TypeScript, GSAP for authored timelines, and hand-rolled springs for anything
a reader touches. The look is hers: blush paper, wine ink, watercolor washes.

What makes it hers:

- **The opening.** A clothbound book opens, a fountain pen writes her mission
  in a real pen hand, flips nib-up and launches, and the page becomes the site.
- **The bookshelf** (`/writing`). Her works stand on a shelf as clothbound
  spines. Pull one and a 3D book comes out, turns its cover to you and opens
  to its title page. The cover can be dragged, flicked, or tapped.
- Handwritten ink that writes itself in, taped photo prints that lean toward
  the pointer, dotted orbs you can spin, and page-turn transitions between
  pages.

Everything on the site is her real copy, verbatim. Nothing is invented.

## Daily commands

```bash
npm run dev        # local site (add `-- --port 4322` to match the tests)
npm run build      # copy lint + production build to dist/
npm run preview    # serve the production build
npm run check      # TypeScript + Astro diagnostics
npm test           # Playwright: Chromium, WebKit and Firefox, desktop and phone
```

`npm test` reuses a dev server on port 4322 if one is running, and needs the
browsers once: `npx playwright install chromium webkit firefox`. To test the
production build instead: `npm run build && npx astro preview --port 4323`,
then `PORT=4323 npm test`. To test a live deployment:
`BASE_URL=https://<project>.netlify.app npm test`.

## Editing content (the common cases)

Push to `main` and the live site rebuilds itself (see Deployment).

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
`src/content/works/`. Fill in only what is real; empty fields simply do not
show. Status values: `querying`, `on-submission`, `in-progress`, `drafting`,
`complete`, `published`, `tbd`.

**Add a work to the shelf.** Add a file in `src/content/works/` and it appears
on the bookshelf by itself: its spine's thickness follows `wordCount`, and its
title is sized to fit. Optional, in `src/components/writing/Bookshelf.astro`:
give it a cloth and foil color in `cloths`, and cover art in `covers`.

**Bio, experience, socials, nav:** `src/data/about.ts` and `src/data/site.ts`.

**The bibliography is hidden** until Viviana's list is ready. Its page waits at
`src/pages/writing/_bibliography.astro` (the underscore keeps Astro from
building it) and `netlify.toml` sends its address to the Writing page. To bring
it back: rename the file to `bibliography.astro`, delete that redirect, and put
the links back (the Writing sub-menu in `src/data/site.ts`, the home page, the
line under the shelf, and `pageFor` in `src/components/writing/Bookshelf.astro`
for works that have no page of their own).

**Causes:** JSON files in `src/content/causes/`.

**Contact form choices:** the "How did you hear about us?" options live in
`src/components/contact/ContactForm.astro`.

## Photos

Originals go in `content-src/photos/` (HEIC fine), then:

```bash
npm run ingest
```

This runs only on a Mac (it uses `sips` to decode HEIC), auto-orients, applies
the editorial grade, and writes committed JPEG masters to
`src/assets/photos/`. The host never sees a HEIC. Map new photos to slugs
inside `scripts/ingest-photos.ts`.

## Generated assets

Each of these is deterministic and its output is committed, so the host only
runs `npm run build`.

| Command          | What it makes                                                      |
| ---------------- | ------------------------------------------------------------------ |
| `npm run ink`    | The handwriting (`public/ink/*.svg`, `src/assets/ink/*.json`) from the phrases in `scripts/build-ink.ts` |
| `npm run washes` | The watercolor backdrops in `public/washes/`                       |
| `npm run brand`  | `favicon.svg`, `apple-touch-icon.png` and the social card `og-default.png`, from `src/data/brand.ts` |

## How the pieces work

- **The opening:** `src/components/intro/BookIntro.astro` and
  `src/lib/intro/book-intro.ts`. It plays in full once per browser session
  (sessionStorage `viv:intro:v2`), can always be skipped (button, Escape, a
  scroll), and is replaced by a plain page under reduced motion. "Replay the
  opening" sits under the hero.
- **The handwriting:** single-stroke pen paths, retimed to how a hand moves,
  then drawn with pressure (`scripts/ink/`, `src/lib/ink/`).
- **The bookshelf:** `src/components/writing/Bookshelf.astro` (markup, styles)
  and `src/lib/shelf/bookshelf.ts` (behavior). Without JavaScript every spine
  is a plain link to its work.
- **Motion:** springs, momentum projection and the shared frame loop are in
  `src/lib/motion/`. Every interactive module registers with
  `src/lib/transitions/vt.ts` so nothing leaks across page turns.

Three more interactions are built but not yet on the site (a ribbon bookmark
that scrubs the page, a stack of photo prints, a guestbook pad for the contact
form). Their test pages are parked in `src/pages/_lab/`, which Astro does not
build; rename it to `lab` to open them locally.

## Copy rules (enforced)

`npm run build` fails if authored copy contains an em dash, placeholder text,
or TODO markers (`scripts/check-copy.ts`). Viviana's blog posts are her voice
and exempt from the punctuation rule.

## Deployment

The site is static. GitHub holds the code, Netlify builds and serves it, and
the domain stays registered at Squarespace with its DNS pointed at Netlify.

1. **GitHub.** Push this repo (private is fine).
2. **Netlify.** Add new project, import the repo. Build settings come from
   `netlify.toml` (`npm run build`, publish `dist`, Node 22). Every push to
   `main` deploys; pull requests get preview URLs.
3. **Forms.** In the project's Forms settings enable form detection, then
   redeploy. Submit the contact form and the newsletter form once on the
   `*.netlify.app` URL and check both appear under Forms. Add an email
   notification for form submissions to escritoraviviana@gmail.com.
4. **Her review.** Send her the `*.netlify.app` URL. Nothing about the real
   domain changes until she says yes.
5. **Domain.** In Netlify, Domain management: add `www.escritoraviviana.com`
   (primary) and `escritoraviviana.com`. Then at Squarespace: Domains, the
   domain, DNS, DNS Settings. Delete the **Squarespace Defaults** records and
   add two custom records:

   | Host  | Type  | Value                        |
   | ----- | ----- | ---------------------------- |
   | `@`   | A     | `75.2.60.5`                  |
   | `www` | CNAME | `<project-name>.netlify.app` |

   As of October 2026 the domain has no MX or TXT records, so there is no
   email to protect. Netlify issues the HTTPS certificate by itself once the
   records resolve (minutes, sometimes an hour or two).
6. **Squarespace, afterwards.** Before cancelling anything, export her
   newsletter subscribers and copy the password-protected bibliography page.
   Once the new site has run on the domain for a week, cancel the **website**
   subscription only. The domain stays registered there (paid through
   December 2030) and its DNS keeps working without a website plan.

Old Squarespace URLs (`/picture-books`, `/young-adul-fiction`, and so on)
redirect to their new homes via `netlify.toml`.

**Netlify's free plan** gives 300 credits a month: 15 per production deploy,
20 per GB served, 2 per 10,000 requests; form submissions are free. If the
credits run out the site is paused until the next month, so if it ever gets
close, move to the Personal plan. (Netlify accounts created before
September 2025 are on the older plan and are not affected.) The escape hatch
is Cloudflare Pages plus a form service; the forms are plain HTML posts.

## Open items for Viviana

- Bibliography details for the works still "in the notebook": status, word
  count, genre (and whether Consuelo Dolores is a novel or flash fiction).
- "Time to Tell" carries the subtitle "Coconut Kisses", the same as Besitos
  de Coco. Is that right?
- The "How did you hear about us?" options.

## Credits

- Orb geometry ported from [`thinking-orbs`](https://github.com/Jakubantalik/thinking-orbs)
  by Jakub Antalik (MIT).
- Fonts, all SIL OFL and self-hosted: Fraunces (Undercase Type), Source
  Serif 4 (Adobe), Fragment Mono. The handwriting is drawn from EMS Neato
  (Sheldon B. Michaels), a single-stroke derivative of Bad Script; licenses
  are in `public/fonts/` and `content-src/fonts/ems/`.
- Variable-width strokes by [`perfect-freehand`](https://github.com/steveruizok/perfect-freehand)
  (MIT).
