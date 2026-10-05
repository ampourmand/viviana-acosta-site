import { test, expect, type Page } from '@playwright/test';

/**
 * The Writing page's bookshelf: pull a book, read its title page, handle the
 * cover, put it back. These assert on what a reader can observe (the dialog,
 * focus, the cover's angle), not on internals.
 */

const OPEN = -172;

const stage = (page: Page) => page.locator('[data-sb-stage]');
const spine = (page: Page, id: string) => page.locator(`a[data-book="${id}"]`);

/** The cover's angle in degrees: 0 shut, -172 open. */
const coverAngle = (page: Page) =>
  page
    .locator('[data-sb-cover]')
    .evaluate((el) => parseFloat((el as HTMLElement).style.getPropertyValue('--phi')) || 0);

const readHinge = (page: Page) =>
  page
    .locator('[data-sb-book]')
    .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);

/** Where the book's hinge is on screen, once the book has stopped moving. */
async function hingeX(page: Page) {
  let last = await readHinge(page);
  await expect
    .poll(async () => {
      await page.waitForTimeout(120);
      const now = await readHinge(page);
      const still = Math.abs(now - last) < 0.01;
      last = now;
      return still;
    })
    .toBe(true);
  return last;
}

/**
 * A pointer gesture on the cover with exact timing, dispatched in the page.
 * (Real input through the test driver arrives late when the machine is busy,
 * and a flick is nothing but timing.) Resolves to the cover's angle at the
 * moment of release.
 */
async function gesture(page: Page, points: Array<[number, number]>, stepMs = 16) {
  return page.locator('[data-sb-cover]').evaluate(
    async (cover, { points, stepMs }) => {
      const fire = (type: string, [x, y]: [number, number]) =>
        cover.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 7,
            pointerType: 'mouse',
            isPrimary: true,
            button: type === 'pointermove' ? -1 : 0,
            buttons: type === 'pointerup' ? 0 : 1,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        );
      const first = points[0];
      const last = points[points.length - 1];
      if (!first || !last) return 0;
      fire('pointerdown', first);
      for (const point of points.slice(1)) {
        await new Promise((resolve) => setTimeout(resolve, stepMs));
        fire('pointermove', point);
      }
      // Let the frame's write pass run, then read where the cover is held.
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      const held = parseFloat((cover as HTMLElement).style.getPropertyValue('--phi')) || 0;
      fire('pointerup', last);
      return held;
    },
    { points, stepMs },
  );
}

async function gotoShelf(page: Page) {
  // The opening animation is its own subject; skip it here.
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem('viv:intro:v2', '1');
    } catch {
      /* storage unavailable */
    }
  });
  await page.goto('/writing');
  await expect(page.locator('[data-bookshelf][data-ready]')).toBeVisible();
}

async function pull(page: Page, id: string) {
  await spine(page, id).click();
  await expect(stage(page)).toHaveJSProperty('open', true);
  await expect.poll(() => coverAngle(page), { timeout: 8000 }).toBeLessThan(OPEN + 1);
}

async function expectBackOnShelf(page: Page, id: string) {
  await expect(stage(page)).toHaveJSProperty('open', false);
  await expect(spine(page, id)).not.toHaveAttribute('data-pulled', '');
  await expect(spine(page, id)).toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/shelf-open/);
}

let consoleErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
});

test.afterEach(() => {
  expect(consoleErrors, 'no console errors').toEqual([]);
});

test.describe('the shelf', () => {
  test('holds every work as a link with a spoken name', async ({ page }) => {
    await gotoShelf(page);
    const spines = page.locator('a[data-book]');
    await expect(spines).toHaveCount(10);
    for (const el of await spines.all()) {
      await expect(el).toHaveAttribute('href', /^\/writing\//);
      await expect(el).toHaveAttribute('aria-label', /Pull it off the shelf\.$/);
    }
    await expect(spine(page, 'ascension')).toHaveAccessibleName(/^Ascension\. Young Adult Novel/);
  });

  test('pulling a book opens it to its title page', async ({ page }) => {
    await gotoShelf(page);
    await pull(page, 'i-cant-see');

    const dialog = page.getByRole('dialog', { name: "I Can't See!" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('How the Hubble Space Telescope Got Glasses').first()).toBeVisible();
    await expect(dialog.getByText(/this 600-word picture book portrays Hubble/)).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Open Picture Books' })).toBeVisible();

    // The real spine is out of the shelf while the book is in the hand.
    await expect(spine(page, 'i-cant-see')).toHaveAttribute('data-pulled', '');
    await expect(page.locator('html')).toHaveClass(/shelf-open/);
    await expect(page.locator('[data-sb-close]')).toBeFocused();
  });

  test('a work still in the notebook shows only what is known', async ({ page }) => {
    await gotoShelf(page);
    await pull(page, 'consuelo-dolores');
    const dialog = page.getByRole('dialog', { name: 'Consuelo Dolores' });
    await expect(dialog.getByText('In the notebook')).toBeVisible();
    // No page of its own yet, so no link: nothing to follow into a dead end.
    await expect(dialog.locator('.sbp-link')).toHaveCount(0);
    await expect(dialog.locator('.sbp-body')).toHaveCount(0);
  });

  test('Escape puts the book back and returns focus to its spine', async ({ page }) => {
    await gotoShelf(page);
    await pull(page, 'besitos-de-coco');
    await page.keyboard.press('Escape');
    await expectBackOnShelf(page, 'besitos-de-coco');
    await expect(spine(page, 'besitos-de-coco')).toBeFocused();
  });

  test('the button and a click on the dimmed room both put it back', async ({ page }) => {
    await gotoShelf(page);
    await pull(page, 'powerful');
    await page.getByRole('button', { name: 'Put it back' }).click();
    await expectBackOnShelf(page, 'powerful');

    await pull(page, 'powerful');
    await page.locator('[data-sb-scene]').click({ position: { x: 12, y: 12 } });
    await expectBackOnShelf(page, 'powerful');
  });

  test('can be interrupted mid-flight', async ({ page }) => {
    await gotoShelf(page);
    await spine(page, 'its-not-fair').click();
    await expect(stage(page)).toHaveJSProperty('open', true);
    await page.waitForTimeout(120);
    // Still on its way out: the cover has not begun to open.
    expect(await coverAngle(page)).toBeGreaterThan(-1);
    await page.keyboard.press('Escape');
    await expectBackOnShelf(page, 'its-not-fair');

    // And it still works afterwards.
    await pull(page, 'its-not-fair');
    await page.keyboard.press('Escape');
    await expectBackOnShelf(page, 'its-not-fair');
  });

  test('a double-click pulls the book once and leaves it out', async ({ page, isMobile }) => {
    test.skip(isMobile, 'mouse input');
    await gotoShelf(page);
    const box = await spine(page, 'ascension').boundingBox();
    if (!box) throw new Error('no spine');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    // The second click of a double-click comes ~150ms later, when the book has
    // already left its slot and the click lands on whatever it uncovered.
    await page.mouse.click(x, y);
    await page.waitForTimeout(150);
    await page.mouse.down({ clickCount: 2 });
    await page.mouse.up({ clickCount: 2 });
    await expect.poll(() => coverAngle(page), { timeout: 8000 }).toBeLessThan(OPEN + 1);
    await expect(stage(page)).toHaveJSProperty('open', true);
  });

  test('a held Enter pulls the book once', async ({ page, isMobile }) => {
    test.skip(isMobile, 'hardware keyboard flow');
    await gotoShelf(page);
    await spine(page, 'powerful').focus();
    await page.keyboard.down('Enter');
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(40);
      await page.keyboard.down('Enter'); // auto-repeat
    }
    await page.keyboard.up('Enter');
    await expect.poll(() => coverAngle(page), { timeout: 8000 }).toBeLessThan(OPEN + 1);
    await expect(stage(page)).toHaveJSProperty('open', true);
  });

  test('pressing on the room and letting go on the book does not close it', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'mouse input');
    await gotoShelf(page);
    await pull(page, 'besitos-de-coco');
    // Release over the open cover's inside (the left leaf), not over text.
    const hx = await hingeX(page);
    await page.mouse.move(12, 12);
    await page.mouse.down();
    await page.mouse.move(hx - 200, 450, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    await expect(stage(page)).toHaveJSProperty('open', true);
    expect(await coverAngle(page)).toBeLessThan(OPEN + 1); // and the cover was not tapped shut
  });

  test('keyboard: Enter opens, Tab reaches the page, Escape closes', async ({
    page,
    isMobile,
    browserName,
  }) => {
    test.skip(isMobile, 'hardware keyboard flow');
    await gotoShelf(page);
    await spine(page, 'besitos-de-coco').focus();
    await page.keyboard.press('Enter');
    await expect(stage(page)).toHaveJSProperty('open', true);
    await expect(page.locator('[data-sb-close]')).toBeFocused();
    // Safari keeps plain Tab for form controls; Option+Tab walks links.
    await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
    await expect(page.getByRole('link', { name: 'Open Short Fiction' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expectBackOnShelf(page, 'besitos-de-coco');
    await expect(spine(page, 'besitos-de-coco')).toBeFocused();
  });

  test('a modified click is left to the browser', async ({ page, context, isMobile }) => {
    test.skip(isMobile, 'no modifier keys');
    await gotoShelf(page);
    const [tab] = await Promise.all([
      context.waitForEvent('page'),
      spine(page, 'ascension').click({ modifiers: ['ControlOrMeta'] }),
    ]);
    await expect(tab).toHaveURL(/\/writing\/ascension\/?$/);
    await expect(stage(page)).toHaveJSProperty('open', false);
    await tab.close();
  });

  test('the title page link leaves the shelf clean behind it', async ({ page }) => {
    await gotoShelf(page);
    await pull(page, 'ascension');
    // After the swap everything is new, so look at the moment of leaving:
    // the book must already be away when the next page has been fetched.
    await page.evaluate(() => {
      document.addEventListener(
        'astro:after-preparation',
        () => {
          const dialog = document.querySelector<HTMLDialogElement>('[data-sb-stage]');
          (window as unknown as { __atLeave?: unknown }).__atLeave = {
            open: dialog?.open,
            locked: document.documentElement.classList.contains('shelf-open'),
            pulled: document.querySelectorAll('[data-pulled]').length,
          };
        },
        { once: true },
      );
    });
    await page.getByRole('link', { name: 'Open the Ascension page' }).click();
    await expect(page).toHaveURL(/\/writing\/ascension\/?$/);
    const atLeave = await page.evaluate(() => (window as unknown as { __atLeave?: unknown }).__atLeave);
    expect(atLeave).toEqual({ open: false, locked: false, pulled: 0 });
    await expect(page.locator('html')).not.toHaveClass(/shelf-open/);

    // Back on the shelf after a client-side return, everything still works.
    await page.goBack();
    await expect(page.locator('[data-bookshelf][data-ready]')).toBeVisible();
    await pull(page, 'ascension');
    await page.keyboard.press('Escape');
    await expectBackOnShelf(page, 'ascension');
  });
});

test.describe('the cover in the hand', () => {
  test.skip(({ isMobile }) => isMobile, 'mouse gestures');

  test('follows the pointer, and a slow release falls to the nearer side', async ({ page }) => {
    await gotoShelf(page);
    await pull(page, 'panela-plantation');

    // Take the open cover by its inside and carry it shut.
    let hx = await hingeX(page);
    await page.mouse.move(hx - 300, 450);
    await page.mouse.down();
    await page.mouse.move(hx - 120, 450, { steps: 6 });
    const partway = await coverAngle(page);
    expect(partway).toBeGreaterThan(OPEN + 20);
    expect(partway).toBeLessThan(-90);
    await page.mouse.move(hx + 330, 450, { steps: 12 });
    expect(await coverAngle(page)).toBeGreaterThan(-12);
    await page.waitForTimeout(140);
    await page.mouse.up();
    await expect.poll(() => coverAngle(page)).toBeGreaterThan(-0.5);
    await expect(stage(page)).toHaveJSProperty('open', true);

    // Lift it a little, hold, let go: it falls shut again.
    hx = await hingeX(page);
    await page.mouse.move(hx + 380, 450);
    await page.mouse.down();
    await page.mouse.move(hx + 300, 450, { steps: 8 });
    await page.waitForTimeout(200);
    expect(await coverAngle(page)).toBeLessThan(-5);
    await page.mouse.up();
    await expect.poll(() => coverAngle(page)).toBeGreaterThan(-0.5);
  });

  test('a flick throws it open from well short of half way', async ({ page }) => {
    await gotoShelf(page);
    await pull(page, 'panela-plantation');
    // Shut it first with a tap on the inside of the cover.
    let hx = await hingeX(page);
    await page.mouse.click(hx - 200, 450);
    await expect.poll(() => coverAngle(page)).toBeGreaterThan(-0.5);

    // A short, fast throw: 180px in about 60ms, let go while still moving.
    hx = await hingeX(page);
    const atRelease = await gesture(page, [
      [hx + 380, 450],
      [hx + 335, 450],
      [hx + 290, 450],
      [hx + 245, 450],
      [hx + 200, 450],
    ]);
    expect(atRelease).toBeLessThan(-20);
    expect(atRelease).toBeGreaterThan(-86); // let go before half way
    await expect.poll(() => coverAngle(page), { timeout: 8000 }).toBeLessThan(OPEN + 1);
  });

  test('the same distance, carried slowly and held, falls shut', async ({ page }) => {
    await gotoShelf(page);
    await pull(page, 'panela-plantation');
    let hx = await hingeX(page);
    await page.mouse.click(hx - 200, 450);
    await expect.poll(() => coverAngle(page)).toBeGreaterThan(-0.5);

    hx = await hingeX(page);
    await gesture(
      page,
      [
        [hx + 380, 450],
        [hx + 290, 450],
        [hx + 200, 450],
        [hx + 200, 450],
        [hx + 200, 450],
      ],
      70,
    );
    await expect.poll(() => coverAngle(page), { timeout: 8000 }).toBeGreaterThan(-0.5);
    await expect(stage(page)).toHaveJSProperty('open', true);
  });

  test('a tap turns the cover over', async ({ page }) => {
    await gotoShelf(page);
    await pull(page, 'i-cant-hear');
    let hx = await hingeX(page);
    await page.mouse.click(hx - 200, 450);
    await expect.poll(() => coverAngle(page)).toBeGreaterThan(-0.5);
    hx = await hingeX(page);
    await page.mouse.click(hx + 200, 450);
    await expect.poll(() => coverAngle(page), { timeout: 8000 }).toBeLessThan(OPEN + 1);
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the book is simply open, and simply gone', async ({ page }) => {
    await gotoShelf(page);
    await spine(page, 'frequency-and-the-time-twins').click();
    await expect(stage(page)).toHaveJSProperty('open', true);
    await expect(stage(page)).toHaveClass(/is-plain/);
    // No flight: the cover is already open on the first frame.
    expect(await coverAngle(page)).toBeLessThan(OPEN + 1);
    await expect(page.getByRole('dialog', { name: 'Frequency and the Time Twins' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expectBackOnShelf(page, 'frequency-and-the-time-twins');
  });
});

test.describe('small screens', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone layout');

  test('two shelves, with the globe at the end of the first', async ({ page }) => {
    await gotoShelf(page);
    const top = (sel: string) => page.locator(sel).evaluate((el) => el.getBoundingClientRect().top);
    const novel = await top('a[data-book="ascension"]');
    const globe = await top('.shelf-globe');
    const shortFiction = await top('a[data-book="panela-plantation"]');
    expect(Math.abs(globe - novel)).toBeLessThan(260); // same row
    expect(shortFiction - novel).toBeGreaterThan(200); // next row
  });

  test('a tapped book opens to a page that fits the screen', async ({ page }) => {
    await gotoShelf(page);
    await spine(page, 'besitos-de-coco').tap();
    await expect(stage(page)).toHaveJSProperty('open', true);
    await expect.poll(() => coverAngle(page), { timeout: 8000 }).toBeLessThan(OPEN + 1);
    const box = await page.locator('[data-sb-page]').boundingBox();
    const viewport = page.viewportSize();
    expect(box && viewport).toBeTruthy();
    if (box && viewport) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    }
    await page.getByRole('button', { name: 'Put it back' }).tap();
    await expectBackOnShelf(page, 'besitos-de-coco');
  });
});

test.describe('small screens, the cover', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone layout');

  test('carried as far as the screen allows, it stays open', async ({ page }) => {
    await gotoShelf(page);
    await spine(page, 'besitos-de-coco').tap();
    await expect(stage(page)).toHaveJSProperty('open', true);
    await expect.poll(() => coverAngle(page), { timeout: 8000 }).toBeLessThan(OPEN + 1);

    const viewport = page.viewportSize();
    if (!viewport) throw new Error('no viewport');
    const y = Math.round(viewport.height / 2);

    // A tap shuts it. (The open cover is mostly off screen to the left.)
    const hx = await hingeX(page);
    await gesture(page, [
      [hx - 4, y],
      [hx - 4, y],
    ]);
    await expect.poll(() => coverAngle(page)).toBeGreaterThan(-0.5);
    await hingeX(page);

    // On a phone the hinge is at the screen's edge: a finger can only carry
    // the cover to about upright. Carried there slowly and held, it opens.
    const right = viewport.width - 70;
    const path: Array<[number, number]> = [];
    for (let i = 0; i <= 8; i++) path.push([right - ((right - 30) * i) / 8, y]);
    path.push([30, y], [30, y], [30, y]);
    const held = await gesture(page, path, 40);
    expect(held).toBeLessThan(-60);
    expect(held).toBeGreaterThan(-100);
    await expect.poll(() => coverAngle(page), { timeout: 8000 }).toBeLessThan(OPEN + 1);
  });
});

test.describe('small screens, a real finger', () => {
  test.skip(({ isMobile, browserName }) => !isMobile || browserName !== 'chromium', 'CDP touch');

  test('drags the cover open and scrolls nothing behind it', async ({ page, context }) => {
    await gotoShelf(page);
    await spine(page, 'besitos-de-coco').tap();
    await expect.poll(() => coverAngle(page), { timeout: 8000 }).toBeLessThan(OPEN + 1);
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('no viewport');
    const y = Math.round(viewport.height / 2);
    const hx = await hingeX(page);
    await gesture(page, [
      [hx - 4, y],
      [hx - 4, y],
    ]);
    await expect.poll(() => coverAngle(page)).toBeGreaterThan(-0.5);
    await hingeX(page);

    const cdp = await context.newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: Array<[number, number]>) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: points.map(([px, py]) => ({ x: px, y: py })),
      });
    const scrolledBefore = await page.evaluate(() => window.scrollY);
    await touch('touchStart', [[viewport.width - 70, y]]);
    for (let px = viewport.width - 70; px >= 40; px -= 30) {
      await touch('touchMove', [[px, y]]);
      await page.waitForTimeout(16);
    }
    expect(await coverAngle(page)).toBeLessThan(-45); // it followed the finger
    await page.waitForTimeout(150);
    await touch('touchEnd', []);
    await expect.poll(() => coverAngle(page), { timeout: 8000 }).toBeLessThan(OPEN + 1);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolledBefore);
  });
});

test.describe('without script', () => {
  test.use({ javaScriptEnabled: false });

  test('a spine is just a link to the work', async ({ page }) => {
    await page.goto('/writing');
    // Nothing promises a dialog that will not come.
    await expect(spine(page, 'ascension')).toHaveAttribute(
      'aria-label',
      'Ascension. Young Adult Novel, in progress.',
    );
    await expect(spine(page, 'ascension')).not.toHaveAttribute('aria-haspopup', 'dialog');
    // Let the book finish being set on the shelf. (With scripts off, the test
    // driver cannot wait out a moving element by itself.)
    await expect(spine(page, 'ascension')).toHaveCSS('opacity', '1');
    await page.waitForTimeout(100);
    await spine(page, 'ascension').click();
    await expect(page).toHaveURL(/\/writing\/ascension\/?$/);
  });
});
