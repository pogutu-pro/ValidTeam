import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test, type TestInfo } from '@playwright/test';
import { ensureSeed, type SeededIds } from './fixtures/seed';

type Surface = {
  id: string;
  path: (seed: SeededIds) => string;
};

type SurfaceView = {
  id: string;
  viewport: { width: number; height: number };
  colorScheme: 'light' | 'dark';
  locale: 'en' | 'ar';
  direction: 'ltr' | 'rtl';
};

const staticPath = (path: string) => () => path;

const APP_SURFACES: Surface[] = [
  { id: 'admin', path: staticPath('/admin') },
  { id: 'api-docs', path: staticPath('/api-docs') },
  { id: 'dashboard', path: staticPath('/dashboard') },
  { id: 'docs', path: staticPath('/docs') },
  { id: 'drafts', path: staticPath('/drafts') },
  { id: 'inbox', path: staticPath('/inbox') },
  { id: 'initiatives', path: staticPath('/initiatives') },
  { id: 'initiative-detail', path: (seed) => `/initiatives/${seed.initiativeId}` },
  { id: 'issues-redirect', path: staticPath('/issues') },
  { id: 'issue-detail', path: (seed) => `/issues/${seed.issueIds[0]}` },
  { id: 'my-issues', path: staticPath('/my-issues') },
  { id: 'projects', path: staticPath('/projects') },
  { id: 'project-views-default', path: (seed) => `/projects/${seed.projectId}` },
  { id: 'project-analytics', path: (seed) => `/projects/${seed.projectId}/analytics` },
  { id: 'project-backlog', path: (seed) => `/projects/${seed.projectId}/backlog` },
  { id: 'project-board', path: (seed) => `/projects/${seed.projectId}/board` },
  { id: 'project-chat', path: (seed) => `/projects/${seed.projectId}/chat` },
  { id: 'project-docs', path: (seed) => `/projects/${seed.projectId}/docs` },
  { id: 'project-modules', path: (seed) => `/projects/${seed.projectId}/modules` },
  { id: 'project-roadmap', path: (seed) => `/projects/${seed.projectId}/roadmap` },
  {
    id: 'project-settings',
    path: (seed) => `/projects/${seed.projectId}/settings`,
  },
  {
    id: 'project-components',
    path: (seed) => `/projects/${seed.projectId}/settings/components`,
  },
  {
    id: 'project-versions',
    path: (seed) => `/projects/${seed.projectId}/settings/versions`,
  },
  {
    id: 'project-workflows',
    path: (seed) => `/projects/${seed.projectId}/settings/workflows`,
  },
  { id: 'project-sprints', path: (seed) => `/projects/${seed.projectId}/sprints` },
  {
    id: 'project-sprint-detail',
    path: (seed) => `/projects/${seed.projectId}/sprints/${seed.sprintId}`,
  },
  { id: 'project-views', path: (seed) => `/projects/${seed.projectId}/views` },
  { id: 'settings', path: staticPath('/settings') },
  { id: 'ai-transparency', path: staticPath('/settings/ai-transparency') },
  { id: 'billing', path: staticPath('/settings/billing') },
  { id: 'import', path: staticPath('/settings/import') },
  { id: 'intake-forms', path: staticPath('/settings/intake-forms') },
  {
    id: 'intake-form-edit',
    path: (seed) => `/settings/intake-forms/${seed.intakeFormId}/edit`,
  },
  { id: 'integrations', path: staticPath('/settings/integrations') },
  { id: 'labels', path: staticPath('/settings/labels') },
  { id: 'members', path: staticPath('/settings/members') },
  { id: 'organization', path: staticPath('/settings/organization') },
  {
    id: 'audit-log-streaming',
    path: staticPath('/settings/security/audit-log-streaming'),
  },
  { id: 'sso', path: staticPath('/settings/sso') },
  { id: 'team', path: staticPath('/team') },
  { id: 'templates', path: staticPath('/templates') },
  { id: 'public-intake', path: staticPath('/intake/e2e-intake') },
];

const VIEW_MATRIX: readonly SurfaceView[] = [
  {
    id: 'desktop-light',
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'light',
    locale: 'en',
    direction: 'ltr',
  },
  {
    id: 'mobile-dark',
    viewport: { width: 390, height: 844 },
    colorScheme: 'dark',
    locale: 'en',
    direction: 'ltr',
  },
] as const;

const RTL_SMOKE_VIEW: SurfaceView = {
  id: 'mobile-320-rtl',
  viewport: { width: 320, height: 568 },
  colorScheme: 'light',
  locale: 'ar',
  direction: 'rtl',
};

const RTL_SMOKE_SURFACE_IDS = new Set(['dashboard', 'issue-detail', 'project-board', 'settings']);
const RTL_SMOKE_SURFACES = APP_SURFACES.filter((surface) => RTL_SMOKE_SURFACE_IDS.has(surface.id));

const SETTLED_SETTINGS_TABS: Readonly<Partial<Record<string, string>>> = {
  settings: 'organization',
  billing: 'organization',
  members: 'members',
  organization: 'organization',
};

const APP_ORIGIN = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000').origin;

async function dismissAiDisclosure(page: Page) {
  const acknowledgement = page.getByTestId('ai-disclosure-ack');
  if (await acknowledgement.isVisible().catch(() => false)) {
    await acknowledgement.click();
    await expect(page.getByTestId('ai-disclosure-modal')).toBeHidden();
  }
}

async function waitForSurfaceReady(page: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.waitForLoadState('load');
    await expect(page.locator('main')).toBeVisible();

    try {
      await page.evaluate(async () => {
        await document.fonts?.ready;
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
      });
      return;
    } catch (error) {
      const navigationReplacedContext = errorMessage(error).includes(
        'Execution context was destroyed'
      );
      if (!navigationReplacedContext || attempt === 2) throw error;
    }
  }
}

async function getHorizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const viewport = window.innerWidth;
    return Math.max(
      0,
      document.documentElement.scrollWidth - viewport,
      document.body.scrollWidth - viewport
    );
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.stack || error.message : String(error);
}

async function attachFailureArtifacts({
  page,
  testInfo,
  artifactName,
  diagnostics,
}: {
  page: Page;
  testInfo: TestInfo;
  artifactName: string;
  diagnostics: Record<string, unknown>;
}) {
  try {
    await testInfo.attach(`${artifactName}-diagnostics`, {
      body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
      contentType: 'application/json',
    });
  } catch {
    // Best-effort evidence must not mask the original surface failure.
  }

  if (page.isClosed()) return;
  try {
    const screenshot = await page.screenshot({ fullPage: true });
    await testInfo.attach(`${artifactName}-page`, {
      body: screenshot,
      contentType: 'image/png',
    });
  } catch {
    // Trace/video from the Playwright config remain available if capture fails.
  }
}

async function auditSurface({
  hostPage,
  seed,
  surface,
  view,
  testInfo,
}: {
  hostPage: Page;
  seed: SeededIds;
  surface: Surface;
  view: SurfaceView;
  testInfo: TestInfo;
}) {
  const surfacePage = await hostPage.context().newPage();
  await surfacePage.setViewportSize(view.viewport);
  await surfacePage.emulateMedia({
    colorScheme: view.colorScheme,
    reducedMotion: 'reduce',
  });
  await surfacePage.addInitScript((theme) => {
    window.localStorage.setItem('validteam-color-mode', theme);
    document.documentElement?.classList.toggle('dark', theme === 'dark');
  }, view.colorScheme);

  const path = surface.path(seed);
  const browserErrors: string[] = [];
  const httpErrors: string[] = [];
  const initialErrorCount = testInfo.errors.length;
  let thrownError: unknown;
  const onConsole = (message: { type: () => string; text: () => string }) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  };
  const onPageError = (error: Error) => browserErrors.push(error.message);
  const onResponse = (response: { status: () => number; url: () => string }) => {
    if (response.status() >= 400 && response.url().startsWith(APP_ORIGIN)) {
      httpErrors.push(`${response.status()} ${response.url()}`);
    }
  };

  surfacePage.on('console', onConsole);
  surfacePage.on('pageerror', onPageError);
  surfacePage.on('response', onResponse);

  try {
    const response = await surfacePage.goto(path, { waitUntil: 'domcontentloaded' });
    expect.soft(response?.status(), `${path} should resolve`).toBeLessThan(400);

    await waitForSurfaceReady(surfacePage);

    const settledSettingsTab = SETTLED_SETTINGS_TABS[surface.id];
    if (settledSettingsTab) {
      await expect(surfacePage.locator(`[data-settings-tab="${settledSettingsTab}"]`)).toBeVisible({
        timeout: 20_000,
      });
    }

    // Organization-scoped disclosure state resolves after the settings tab.
    // Dismiss only once the surface has settled so the modal cannot open after
    // the accessibility assertions and hide the application root from the tree.
    await dismissAiDisclosure(surfacePage);

    if (surface.id === 'issues-redirect') {
      await expect(surfacePage).toHaveURL(/\/my-issues(?:[?#]|$)/);
    }

    const headings = surfacePage.getByRole('heading', { level: 1 });
    await expect.soft(headings, `${path} needs one h1`).toHaveCount(1);
    if ((await headings.count()) > 0) {
      await expect.soft(headings.first()).toBeVisible();
    }
    await expect.soft(surfacePage, `${path} needs a document title`).toHaveTitle(/\S/);

    if (view.direction === 'rtl') {
      await expect
        .soft(surfacePage.locator('html'), `${path} should set the document direction`)
        .toHaveAttribute('dir', 'rtl');
      await expect
        .soft(
          surfacePage.locator('[data-locale="ar"][data-direction="rtl"]'),
          `${path} should mount the RTL direction provider`
        )
        .toHaveCount(1);
    }

    expect
      .soft(await getHorizontalOverflow(surfacePage), `${path} should not overflow horizontally`)
      .toBeLessThanOrEqual(1);

    const accessibility = await new AxeBuilder({ page: surfacePage })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const accessibilityFailures = accessibility.violations.flatMap((violation) =>
      violation.nodes.map((node) => `${violation.id}: ${node.target.map(String).join(' > ')}`)
    );
    expect.soft(accessibilityFailures, `${path} should pass automated WCAG checks`).toEqual([]);

    expect.soft(httpErrors, `${path} should not return HTTP errors`).toEqual([]);
    expect.soft(browserErrors, `${path} should not log browser errors`).toEqual([]);
  } catch (error) {
    thrownError = error;
    throw error;
  } finally {
    const surfaceErrors = testInfo.errors.slice(initialErrorCount);
    if (thrownError !== undefined || surfaceErrors.length > 0) {
      await attachFailureArtifacts({
        page: surfacePage,
        testInfo,
        artifactName: `${view.id}-${surface.id}`,
        diagnostics: {
          surface: surface.id,
          path,
          finalUrl: surfacePage.url(),
          viewport: view.viewport,
          colorScheme: view.colorScheme,
          locale: view.locale,
          direction: view.direction,
          browserErrors,
          httpErrors,
          thrownError: thrownError === undefined ? null : errorMessage(thrownError),
          assertionErrors: surfaceErrors.map((error) => error.message),
        },
      });
    }

    surfacePage.off('console', onConsole);
    surfacePage.off('pageerror', onPageError);
    surfacePage.off('response', onResponse);
    await surfacePage.close();
  }
}

async function setTestLocale(page: Page, locale: SurfaceView['locale']) {
  await page.context().addCookies([
    {
      name: 'validteam-locale',
      value: locale,
      url: APP_ORIGIN,
    },
  ]);
}

test.describe('authenticated app surface contract', () => {
  // Each matrix intentionally visits the entire authenticated application.
  // Running two matrices against one cold Next dev server at once can exhaust
  // route compilation capacity and produce misleading Auth.js fetch failures.
  test.describe.configure({ mode: 'serial' });

  let seed: SeededIds;

  test.beforeAll(async () => {
    seed = await ensureSeed();
  });

  for (const view of VIEW_MATRIX) {
    test(`${view.id} covers every product page`, async ({ browserName, page }, testInfo) => {
      test.skip(browserName !== 'chromium', 'The exhaustive surface matrix runs once in Chromium');
      test.setTimeout(600_000);
      await setTestLocale(page, view.locale);

      for (const surface of APP_SURFACES) {
        await test.step(surface.id, async () => {
          await auditSurface({ hostPage: page, seed, surface, view, testInfo });
        });
      }
    });
  }

  test('mobile-320-rtl covers direction-sensitive product pages', async ({
    browserName,
    page,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'The RTL smoke runs once in Chromium');
    test.setTimeout(240_000);
    await setTestLocale(page, RTL_SMOKE_VIEW.locale);

    for (const surface of RTL_SMOKE_SURFACES) {
      await test.step(surface.id, async () => {
        await auditSurface({
          hostPage: page,
          seed,
          surface,
          view: RTL_SMOKE_VIEW,
          testInfo,
        });
      });
    }
  });
});
