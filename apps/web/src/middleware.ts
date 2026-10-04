import NextAuth from 'next-auth';
import { NextResponse, type NextRequest } from 'next/server';
import { authConfig } from './auth.config';
import {
  LOCALE_COOKIE,
  defaultLocale,
  isSupportedLocale,
  matchLocaleFromAcceptLanguage,
} from './lib/i18n/config';

const { auth } = NextAuth(authConfig);

// Routes that are explicitly served from the top-level (no /[locale]/ prefix).
// These match the directory structure under apps/web/src/app/.
const UN_LOCALIZED_PREFIXES = [
  '/api',
  '/auth',
  '/join',
  '/share',
  '/setup',
  '/offline',
  '/ai-model-cards',
  '/intake',
  '/trust',
  '/legal',
];

const PUBLIC_AUTH_ROUTES = [
  '/auth/signin',
  '/auth/signup',
  '/auth/error',
  '/auth/verify-request',
  '/auth/verify-email',
  '/auth/forgot-password',
  '/auth/reset-password',
] as const;

// Verification pages remain useful after signup has established a session:
// they explain the next step and expose the resend action. Entry and recovery
// forms, on the other hand, should still send an authenticated user home.
const SIGNED_IN_AUTH_REDIRECT_ROUTES = new Set<string>([
  '/auth/signup',
  '/auth/error',
  '/auth/forgot-password',
  '/auth/reset-password',
]);

function isUnLocalizedPath(pathname: string): boolean {
  return UN_LOCALIZED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function applyHtmlAttrs(response: NextResponse, locale: string): NextResponse {
  // Surface the resolved locale to client/server components via a request
  // header — useful for components that need locale without re-running the
  // next-intl resolver (e.g. the root layout sets <html lang>).
  response.headers.set('x-validteam-locale', locale);
  return response;
}

function resolveRequestLocale(request: NextRequest): string {
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
  return isSupportedLocale(cookieLocale)
    ? cookieLocale
    : (matchLocaleFromAcceptLanguage(request.headers.get('accept-language')) ?? defaultLocale);
}

function continueWithLocale(request: NextRequest, locale: string): NextResponse {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-validteam-locale', locale);
  return applyHtmlAttrs(NextResponse.next({ request: { headers: requestHeaders } }), locale);
}

export default auth((req) => {
  const request = req as unknown as NextRequest;
  const { pathname } = request.nextUrl;
  const isLoggedIn = !!(req as unknown as { auth?: unknown }).auth;

  // TaskNebula uses authenticated REST route handlers and currently ships no
  // Server Actions. Reject forged Next-Action probes at the edge so Next.js
  // does not attempt to resolve attacker-supplied action ids and flood runtime
  // logs with "Failed to find Server Action" errors.
  if (request.headers.has('next-action')) {
    return new NextResponse(null, { status: 400 });
  }

  // Static files and Next.js internals - skip middleware entirely.
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/icons') ||
    pathname.includes('.') ||
    pathname === '/favicon.ico' ||
    pathname === '/manifest.json' ||
    pathname === '/sw.js' ||
    pathname === '/offline'
  ) {
    return NextResponse.next();
  }

  // Setup page and setup API are always accessible.
  if (pathname === '/setup' || pathname === '/api/setup') {
    return pathname === '/setup'
      ? continueWithLocale(request, resolveRequestLocale(request))
      : NextResponse.next();
  }

  // Un-localized public routes (landing page lives at the root and is also
  // not under a [locale] segment for now).
  if (pathname === '/' || pathname.startsWith('/share/')) {
    return continueWithLocale(request, resolveRequestLocale(request));
  }

  // API routes never get locale handling. Boundary check matters: a naive
  // `startsWith('/api')` would also swallow `/api-docs`, `/api-keys`, etc.,
  // sending them straight to the Next router without next-intl's rewrite —
  // which then fails to match because those pages live under
  // `[locale]/(app)/...`. Match only the actual `/api` segment.
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Public auth routes remain outside the locale-prefixed app route group.
  const isPublicAuthRoute = PUBLIC_AUTH_ROUTES.includes(
    pathname as (typeof PUBLIC_AUTH_ROUTES)[number]
  );

  // Redirect to signin if not logged in and trying to access protected route.
  // We strip any leading /[locale] segment before checking auth status so the
  // redirect target is locale-agnostic.
  const firstSegment = pathname.split('/')[1];
  const hasLocalePrefix = isSupportedLocale(firstSegment);
  const pathWithoutLocale = hasLocalePrefix
    ? pathname.slice(`/${firstSegment}`.length) || '/'
    : pathname;

  if (!isLoggedIn && !isPublicAuthRoute && !isUnLocalizedPath(pathWithoutLocale)) {
    const signInUrl = new URL('/auth/signin', request.url);
    signInUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(signInUrl);
  }

  // The edge middleware can only see the signed JWT, not the durable user
  // status. Keep `/auth/signin` reachable here and let its Node.js Server
  // Component re-check the database before redirecting an active user home.
  // Otherwise an administrator-deactivated account with a stale JWT loops
  // forever between `/dashboard` and `/auth/signin`.
  if (isLoggedIn && SIGNED_IN_AUTH_REDIRECT_ROUTES.has(pathname)) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // `/issues` is a compatibility alias for the canonical personal issue
  // list. Redirect at the request boundary instead of from the rewritten
  // Server Component route: a component-level redirect can stream two
  // different React trees during development and shift useId/Radix ids at
  // hydration time. Issue detail routes remain under `/issues/[issueId]`.
  if (isLoggedIn && pathWithoutLocale === '/issues') {
    const issuesUrl = request.nextUrl.clone();
    issuesUrl.pathname = hasLocalePrefix ? `/${firstSegment}/my-issues` : '/my-issues';
    return NextResponse.redirect(issuesUrl);
  }

  // Un-localized pages still need the resolved locale forwarded to the root
  // layout. Without this request header, a statically cached public response
  // can leak the first visitor's `lang`/`dir` into subsequent requests.
  if (isUnLocalizedPath(pathname)) {
    return continueWithLocale(request, resolveRequestLocale(request));
  }

  // Everything else (dashboard, projects, settings, …) lives under
  // app/[locale]. Preserve unprefixed URLs such as /dashboard by rewriting
  // them internally to the active locale route. Explicit localized URLs
  // (/tr/dashboard, /de/projects, …) are already concrete app routes.
  // Locale resolution order: an explicit URL prefix or a previously chosen
  // cookie always wins; otherwise negotiate from the device/browser
  // `Accept-Language` header, then fall back to the default.
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
  const hasCookieLocale = isSupportedLocale(cookieLocale);
  const resolvedLocale: string = hasLocalePrefix
    ? firstSegment
    : isSupportedLocale(cookieLocale)
      ? cookieLocale
      : (matchLocaleFromAcceptLanguage(request.headers.get('accept-language')) ?? defaultLocale);

  // Forward the resolved locale to server components as a REQUEST header.
  // This app uses a custom middleware (not next-intl's createMiddleware), so
  // next-intl's `requestLocale` isn't populated — `request.ts` reads this
  // header to load the correct catalog for getMessages()/getTranslations().
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-validteam-locale', resolvedLocale);

  if (hasLocalePrefix) {
    return applyHtmlAttrs(
      NextResponse.next({ request: { headers: requestHeaders } }),
      resolvedLocale
    );
  }

  const rewriteUrl = request.nextUrl.clone();
  rewriteUrl.pathname = `/${resolvedLocale}${pathWithoutLocale}`;
  const response = applyHtmlAttrs(
    NextResponse.rewrite(rewriteUrl, { request: { headers: requestHeaders } }),
    resolvedLocale
  );
  // Persist a device-detected locale so subsequent navigation is stable and
  // the language switcher reflects it. Only set it when the visitor hasn't
  // explicitly chosen one — an explicit pick (cookie) must always win.
  if (!hasCookieLocale) {
    response.cookies.set(LOCALE_COOKIE, resolvedLocale, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
    });
  }
  return response;
});

export const config = {
  matcher: [
    '/((?!api/health(?:/|$)|_next/static|_next/image|favicon.ico|icons|manifest.json|sw.js|.*\\.png$|.*\\.jpg$|.*\\.svg$).*)',
  ],
};
