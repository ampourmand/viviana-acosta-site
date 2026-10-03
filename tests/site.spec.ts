import { test, expect, type Page } from '@playwright/test';

/**
 * Whole-site checks: links point straight at pages, and every address the old
 * Squarespace site published still lands somewhere real. One browser is
 * enough for these, so they run in the desktop project only.
 */

/** Every page address in the old Squarespace sitemap (October 2026). */
const OLD_URLS = [
  '/home',
  '/about',
  '/causes',
  '/contact',
  '/picture-books',
  '/short-fiction',
  '/young-adul-fiction',
  '/blog',
  '/blog/2025-a-new-plan',
  '/blog/goals-vs-realities',
  '/blog/life-choices',
  '/blog/nowrimo-2023',
  '/blog/planning-for-2023',
  '/blog/scifimigrantes',
  '/blog/what-domain-name-should-i-use',
  '/blog/tag/%23amplanning',
  '/blog/tag/%23amwriting',
  '/blog/tag/%23hobonichi',
  '/blog/tag/%23hobonichi2023',
  '/blog/tag/Common+Planner',
  '/blog/tag/Hobonichi',
  '/blog/tag/Hobonichi+Cousin',
  '/blog/tag/Hobonichi+Techo',
  '/blog/tag/HobonichiWeeks',
  '/blog/tag/Journal',
  '/blog/tag/Journaling',
  '/blog/tag/Planning',
  '/blog/tag/Productivity',
  '/blog/tag/washi',
  '/blog/tag/Wonderland+222',
];

/** Old addresses that moved, and the page each must reach in a single hop. */
const MOVED: Array<[string, string]> = [
  ['/home', '/'],
  ['/picture-books', '/writing/picture-books/'],
  ['/short-fiction', '/writing/short-fiction/'],
  ['/young-adul-fiction', '/writing/ascension/'],
  ['/young-adult-fiction', '/writing/ascension/'],
  ['/bibliography', '/writing/bibliography/'],
  ['/blog/tag/Hobonichi', '/blog/'],
];

const skipIntro = (page: Page) =>
  page.addInitScript(() => {
    try {
      sessionStorage.setItem('viv:intro:v2', '1');
    } catch {
      /* storage unavailable */
    }
  });

test('internal links point straight at their pages', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'one pass is enough');
  test.setTimeout(120_000);
  await skipIntro(page);

  // Walk the whole site from the home page.
  const queue = ['/'];
  const seen = new Set(queue);
  const problems: string[] = [];
  while (queue.length > 0) {
    const path = queue.shift() as string;
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    const targets = await page.evaluate(() => [
      ...[...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') ?? ''),
      ...[...document.querySelectorAll('form[action]')].map((f) => f.getAttribute('action') ?? ''),
    ]);
    for (const raw of targets) {
      if (!raw.startsWith('/') || raw.startsWith('//')) continue;
      const { pathname } = new URL(raw, 'https://site.invalid');
      if (/\.[a-z0-9]+$/i.test(pathname)) continue; // a file, not a page
      // Pages live at /about/; a link to /about costs a redirect on Netlify.
      if (!pathname.endsWith('/')) problems.push(`${path} links to ${raw}`);
      if (!seen.has(pathname) && seen.size < 80) {
        seen.add(pathname);
        queue.push(pathname);
      }
    }
  }
  expect(seen.size, 'pages reached from the home page').toBeGreaterThan(15);
  expect(problems).toEqual([]);
});

test('every address from the old Squarespace site lands on a page', async ({ request }) => {
  test.skip(test.info().project.name !== 'desktop', 'one pass is enough');
  test.skip(!process.env.BASE_URL, 'the old-address redirects live in netlify.toml: run against a deployment');

  for (const path of OLD_URLS) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
  }
  for (const [from, to] of MOVED) {
    const response = await request.get(from, { maxRedirects: 0 });
    expect(response.status(), from).toBe(301);
    const location = new URL(response.headers()['location'] ?? '', 'https://site.invalid');
    expect(location.pathname, from).toBe(to);
  }
  // And an address that never existed gets the real 404 page.
  const missing = await request.get('/not-a-page-that-exists');
  expect(missing.status()).toBe(404);
  expect(await missing.text()).toContain('This page drifted off course.');
});
