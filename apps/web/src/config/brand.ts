/**
 * ValidTeam brand contract — the single source of truth for product identity.
 *
 * Every user-facing surface (metadata, manifest, emails, public pages, the app
 * shell, empty states, error pages) must read its name, company, domain and
 * positioning from here. Do not inline "ValidTeam" or "StratNovo" in components:
 * that is what let the previous identity leak back into production through
 * stale literals and environment defaults.
 *
 * Environment overrides exist so a deployment can re-point the canonical
 * origin without a rebuild. They default to the ValidTeam/StratNovo identity,
 * never to the upstream product.
 *
 * Copy that must be translated lives in the locale catalogs under the
 * `metadata`, `publicPages` and `pagesHome` namespaces — this module holds
 * identity constants and SEO fallbacks only.
 */

/** Canonical product name. */
export const PRODUCT_NAME = 'ValidTeam';

/** Organisation that builds and operates the product. */
export const COMPANY_NAME = 'StratNovo';

/** Lowercase handle used for ids, cache keys and asset filenames. */
export const PRODUCT_HANDLE = 'validteam';

/** Initials shown in avatar and workspace fallbacks. */
export const PRODUCT_INITIALS = 'VT';

/** Canonical apex domain. */
export const DOMAIN = 'rumiamanage.com';

/** Absolute URL used when no environment override is configured. */
export const DEFAULT_APP_URL = `https://${DOMAIN}`;

/**
 * Positioning. Short, declarative, and safe to reuse in metadata, the app
 * switcher and the PWA manifest.
 */
export const POSITIONING = 'A serious operating system for modern teams.';

/**
 * One-paragraph product summary for metadata, the manifest and share cards.
 * Deliberately describes an internal operating system rather than a generic
 * task manager.
 */
export const PRODUCT_SUMMARY =
  'ValidTeam is the internal operating system StratNovo runs its team on: people, teams, projects and work in one accountable place, with AI that assists rather than takes over.';

/** Compact description for surfaces with tight character budgets. */
export const PRODUCT_SHORT_SUMMARY =
  'Team management and work coordination for the StratNovo team — people, projects, goals and AI-assisted execution in one place.';

/** Browser theme colours, aligned with the porcelain / ruby token palette. */
export const THEME_COLOR_LIGHT = '#FAF7F2';
export const THEME_COLOR_DARK = '#141110';

/** Browser-chrome colour for the address bar on mobile. */
export const THEME_COLOR_META = '#9B1B30';

/** Contact addresses surfaced on the trust centre and error pages. */
export const SUPPORT_EMAIL = `support@${DOMAIN}`;
export const SECURITY_EMAIL = `security@${DOMAIN}`;

/** Status page for the trust centre. */
export const STATUS_URL = `https://status.${DOMAIN}`;

/** Internal destinations referenced from public surfaces. */
export const PATHS = {
  signIn: '/auth/signin',
  signUp: '/auth/signup',
  forgotPassword: '/auth/forgot-password',
  trust: '/trust',
  aiTransparency: '/ai-model-cards',
  dashboard: '/dashboard',
  teams: '/team',
  projects: '/projects',
  myWork: '/my-issues',
  activity: '/inbox',
} as const;

function readEnv(name: string): string | undefined {
  // `process.env` is statically replaced by Next.js for `NEXT_PUBLIC_*`, so the
  // property access must stay literal for the client bundle.
  //
  // `NEXT_PUBLIC_APP_NAME` is the name declared in `lib/env.ts` and the one the
  // app shell already reads, so it wins. The `NEXT_PUBLIC_PRODUCT_*` aliases let
  // a deployment rename the brand without also renaming the app name.
  switch (name) {
    case 'PRODUCT_NAME':
      return process.env.NEXT_PUBLIC_APP_NAME || process.env.NEXT_PUBLIC_PRODUCT_NAME;
    case 'COMPANY_NAME':
      return process.env.NEXT_PUBLIC_COMPANY_NAME;
    case 'DOMAIN':
      return process.env.NEXT_PUBLIC_BRAND_DOMAIN;
    default:
      return undefined;
  }
}

/** Product name, overridable per deployment. */
export const productName = readEnv('PRODUCT_NAME')?.trim() || PRODUCT_NAME;

/** Company name, overridable per deployment. */
export const companyName = readEnv('COMPANY_NAME')?.trim() || COMPANY_NAME;

/** Apex domain, overridable per deployment. */
export const brandDomain = readEnv('DOMAIN')?.trim() || DOMAIN;

/** `ValidTeam by StratNovo` — the default suffix for page titles. */
export const titleSuffix = `${productName} · ${companyName}`;

/** `Made by StratNovo` — used on public surfaces and in the footer. */
export const madeBy = `Made by ${companyName}`;

/**
 * Resolve the canonical origin for metadata, canonical links and share cards.
 * Falls back to the ValidTeam apex domain instead of a localhost default so a
 * misconfigured production deploy can never publish `localhost` or an upstream
 * origin.
 */
export function resolveAppUrl(): URL {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim() || undefined;

  const candidates = [configured, DEFAULT_APP_URL];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return new URL(candidate);
    } catch {
      // Try the next candidate rather than throwing during render.
    }
  }

  return new URL(DEFAULT_APP_URL);
}

/** `metadataBase` for the Next.js metadata API. */
export function resolveMetadataBase(): URL {
  return resolveAppUrl();
}

/** Absolute URL for a root-relative path. */
export function absoluteUrl(path: string): URL {
  return new URL(path, resolveAppUrl());
}

/**
 * Brand palette exposed to non-CSS consumers (OpenGraph image generation,
 * email headers, native manifests). The runtime UI reads the CSS custom
 * properties in `globals.css`; these literals exist so the two cannot drift
 * silently — keep them in sync with the `:root` block.
 */
export const PALETTE = {
  ruby: '#9B1B30',
  rubyDeep: '#7A1325',
  rubyBright: '#C0243F',
  sand: '#E7D9BE',
  sandDeep: '#CDB894',
  sandPale: '#F5EEE1',
  porcelain: '#FAF7F2',
  ink: '#1C1815',
  graphite: '#4A423B',
} as const;

/**
 * Marketing/SEO entry points. Paths, not copy — the wording lives in the
 * locale catalogs so it can be translated.
 *
 * Every path here must resolve to a real route: public surfaces link straight
 * into these entries, so a typo becomes a 404 in production.
 */
export const ROUTES = {
  home: '/',
  trust: '/trust',
  aiTransparency: '/ai-model-cards',
  /** Policies and sub-processor disclosures live on the trust centre. */
  documents: '/trust#documents',
  compliance: '/trust#compliance',
  status: '/trust#status',
  contact: '/trust#contact',
  signIn: '/auth/signin',
} as const;
