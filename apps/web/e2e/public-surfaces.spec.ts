import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { E2E_PROJECT_INVITE_TOKEN, E2E_PUBLIC_SHARE_TOKEN } from './fixtures/seed';

const PUBLIC_SURFACES = [
  { id: 'landing', path: '/' },
  { id: 'trust', path: '/trust' },
  { id: 'ai-model-cards', path: '/ai-model-cards' },
  { id: 'sign-in', path: '/auth/signin' },
  { id: 'sign-up', path: '/auth/signup' },
  { id: 'password-recovery', path: '/auth/forgot-password' },
  { id: 'auth-error', path: '/auth/error?error=AccessDenied' },
  { id: 'password-reset', path: '/auth/reset-password' },
  { id: 'email-verification', path: '/auth/verify-email?error=expired' },
  { id: 'verification-request', path: '/auth/verify-request' },
  { id: 'public-share', path: `/share/${E2E_PUBLIC_SHARE_TOKEN}` },
  { id: 'offline', path: '/offline' },
] as const;

const VIEW_MATRIX = [
  {
    id: 'desktop-light',
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light' as const,
    locale: 'en' as const,
    direction: 'ltr' as const,
  },
  {
    id: 'desktop-dark',
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark' as const,
    locale: 'en' as const,
    direction: 'ltr' as const,
  },
  {
    id: 'mobile-390-light',
    viewport: { width: 390, height: 844 },
    colorScheme: 'light' as const,
    locale: 'en' as const,
    direction: 'ltr' as const,
  },
  {
    id: 'mobile-390-dark',
    viewport: { width: 390, height: 844 },
    colorScheme: 'dark' as const,
    locale: 'en' as const,
    direction: 'ltr' as const,
  },
  {
    id: 'mobile-320-light',
    viewport: { width: 320, height: 568 },
    colorScheme: 'light' as const,
    locale: 'en' as const,
    direction: 'ltr' as const,
  },
  {
    id: 'mobile-320-dark',
    viewport: { width: 320, height: 568 },
    colorScheme: 'dark' as const,
    locale: 'en' as const,
    direction: 'ltr' as const,
  },
  {
    id: 'mobile-320-rtl',
    viewport: { width: 320, height: 568 },
    colorScheme: 'light' as const,
    locale: 'ar' as const,
    direction: 'rtl' as const,
  },
] as const;

const APP_ORIGIN = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000').origin;

async function expectNoDocumentOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    root: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));

  expect(dimensions.root).toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport + 1);
}

async function expectLandingThemeDirection(
  page: Page,
  colorScheme: (typeof VIEW_MATRIX)[number]['colorScheme']
) {
  const luminance = await page.locator('.landing-dark').evaluate((element) => {
    const channels = getComputedStyle(element)
      .backgroundColor.match(/[\d.]+/g)
      ?.slice(0, 3)
      .map(Number);

    if (!channels || channels.length !== 3) return null;

    const linear = channels.map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    const [red, green, blue] = linear;

    if (red === undefined || green === undefined || blue === undefined) return null;
    return red * 0.2126 + green * 0.7152 + blue * 0.0722;
  });

  expect(luminance, 'landing background should resolve to an opaque color').not.toBeNull();

  if (colorScheme === 'dark') {
    expect(luminance).toBeLessThan(0.15);
  } else {
    expect(luminance).toBeGreaterThan(0.75);
  }
}

test.describe('public surface contract', () => {
  test.describe.configure({ mode: 'serial' });

  for (const surface of PUBLIC_SURFACES) {
    for (const view of VIEW_MATRIX) {
      test(`${surface.id} · ${view.id}`, async ({ page }) => {
        const browserErrors: string[] = [];
        const httpErrors: string[] = [];
        page.on('console', (message) => {
          if (message.type() === 'error') browserErrors.push(message.text());
        });
        page.on('pageerror', (error) => browserErrors.push(error.message));
        page.on('response', (response) => {
          if (response.status() >= 400 && response.url().startsWith(APP_ORIGIN)) {
            httpErrors.push(`${response.status()} ${response.url()}`);
          }
        });

        await page.context().addCookies([
          {
            name: 'validteam-locale',
            value: view.locale,
            url: APP_ORIGIN,
          },
        ]);

        await page.setViewportSize(view.viewport);
        await page.emulateMedia({
          colorScheme: view.colorScheme,
          reducedMotion: 'reduce',
        });
        await page.addInitScript((theme) => {
          window.localStorage.setItem('validteam-color-mode', theme);
          document.documentElement?.classList.toggle('dark', theme === 'dark');
        }, view.colorScheme);

        const response = await page.goto(surface.path, { waitUntil: 'domcontentloaded' });
        expect(response?.status(), `${surface.path} should resolve`).toBeLessThan(400);

        await expect(page.locator('main')).toHaveCount(1);
        const headings = page.getByRole('heading', { level: 1 });
        await expect(headings).toHaveCount(1);
        await expect(headings.first()).toBeVisible();
        await expect(page).toHaveTitle(/\S/);
        await expectNoDocumentOverflow(page);
        await expect(page.locator('html')).toHaveAttribute('dir', view.direction);
        if (surface.id === 'landing') {
          await expectLandingThemeDirection(page, view.colorScheme);
        }

        await page.keyboard.press('Tab');
        const focusLeftDocumentRoot = await page.evaluate(() => {
          const active = document.activeElement;
          return active !== document.body && active !== document.documentElement;
        });
        expect(focusLeftDocumentRoot, `${surface.path} should expose a keyboard target`).toBe(true);

        const accessibility = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        const accessibilityFailures = accessibility.violations.flatMap((violation) =>
          violation.nodes.map((node) => `${violation.id}: ${node.target.map(String).join(' > ')}`)
        );
        expect(accessibilityFailures, `${surface.path} should pass automated WCAG checks`).toEqual(
          []
        );
        expect(httpErrors, `${surface.path} should not return HTTP errors`).toEqual([]);
        expect(browserErrors, `${surface.path} should not log browser errors`).toEqual([]);
      });
    }
  }

  test('project invitation controller preserves the token when redirecting', async ({ page }) => {
    const response = await page.goto(`/join/project/${E2E_PROJECT_INVITE_TOKEN}`, {
      waitUntil: 'domcontentloaded',
    });

    expect(response?.status()).toBeLessThan(400);
    await expect(page).toHaveURL(
      new RegExp(`/auth/signup\\?projectInviteToken=${E2E_PROJECT_INVITE_TOKEN}$`)
    );
  });

  test('public share exposes published content without search indexing', async ({ page }) => {
    await page.goto(`/share/${E2E_PUBLIC_SHARE_TOKEN}`);

    await expect(page.getByRole('heading', { level: 1 })).toContainText('E2E Public Document');
    await expect(
      page.getByText(
        'This published document is intentionally safe for unauthenticated E2E coverage.'
      )
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /attachment-name-without-breaks/i })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/i);
  });

  test('an unknown public share token returns the 404 boundary', async ({ page }) => {
    const response = await page.goto('/share/e2e-share-token-that-does-not-exist');

    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});
