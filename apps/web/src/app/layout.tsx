import type { Metadata, Viewport } from 'next';
import { cookies, headers } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { DirectionProvider } from '@/lib/i18n/direction-provider';
import './globals.css';
import '@livekit/components-styles';
import { Providers } from '@/components/providers';
import { Toaster } from '@/components/ui/toaster';
import { auth } from '@/auth';
import {
  LEGACY_LOCALE_COOKIE,
  LOCALE_COOKIE,
  defaultLocale,
  getDirection,
  isSupportedLocale,
  type Locale,
} from '@/lib/i18n/config';
import {
  COMPANY_NAME,
  POSITIONING,
  PRODUCT_NAME,
  SUPPORT_EMAIL,
  THEME_COLOR_DARK,
  THEME_COLOR_LIGHT,
  resolveMetadataBase,
} from '@/config/brand';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('metadata.root');

  return {
    metadataBase: resolveMetadataBase(),
    applicationName: PRODUCT_NAME,
    // Only a default, deliberately no `template`: every route's `metaTitle` in
    // the 30 catalogs already carries the brand suffix in that locale's own
    // style ("Trust Center · ValidTeam", "Docs | ValidTeam"). A root template
    // would append the suffix a second time on those routes.
    title: t('title'),
    description: t('description'),
    manifest: '/manifest.json',
    keywords: [
      PRODUCT_NAME,
      COMPANY_NAME,
      'team management',
      'work coordination',
      'project tracking',
      'goals',
      'accountability',
      POSITIONING,
    ],
    // No root-level `alternates.canonical` or `openGraph.url`: those are
    // absolute per-route values, and declaring them here would canonicalize
    // every descendant (app, auth, share) back to the marketing root.
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },
    // Keep the tab, the share card and the installed-app shell on one identity.
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      title: PRODUCT_NAME,
    },
    formatDetection: {
      telephone: false,
    },
    openGraph: {
      type: 'website',
      siteName: `${PRODUCT_NAME} · ${COMPANY_NAME}`,
      title: t('title'),
      description: t('description'),
      // The image file convention supplies the asset, but Next 15 does not carry
      // its `.alt.txt` through into the rendered tags, so state the alt here.
      // Reusing the localized title keeps one sentence for tab, card and image.
      images: [
        {
          url: '/opengraph-image.png',
          width: 1200,
          height: 630,
          alt: t('title'),
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: t('title'),
      description: t('description'),
      images: [{ url: '/opengraph-image.png', alt: t('title') }],
    },
    other: {
      // Surfaced by some intranet shells and by the PWA install prompt.
      'application-name': PRODUCT_NAME,
      'apple-mobile-web-app-title': PRODUCT_NAME,
      author: COMPANY_NAME,
      contact: SUPPORT_EMAIL,
    },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_COLOR_LIGHT },
    { media: '(prefers-color-scheme: dark)', color: THEME_COLOR_DARK },
  ],
};

/**
 * Resolve the active locale for the request. Order of precedence:
 *  1. `x-validteam-locale` header (set by the locale middleware for paths
 *     under a `[locale]` segment).
 *  2. the persisted locale cookie, then its pre-rebrand name.
 *  3. The default locale.
 */
async function resolveLocale(): Promise<Locale> {
  const headerStore = await headers();
  const fromHeader =
    headerStore.get('x-validteam-locale') ?? headerStore.get('x-tasknebula-locale');
  if (isSupportedLocale(fromHeader)) return fromHeader;

  const cookieStore = await cookies();
  const fromCookie =
    cookieStore.get(LOCALE_COOKIE)?.value ?? cookieStore.get(LEGACY_LOCALE_COOKIE)?.value;
  if (isSupportedLocale(fromCookie)) return fromCookie;

  return defaultLocale;
}

async function loadMessages(locale: Locale): Promise<Record<string, unknown>> {
  try {
    const mod = await import(`../../messages/${locale}.json`);
    return mod.default as Record<string, unknown>;
  } catch {
    const fallback = await import(`../../messages/${defaultLocale}.json`);
    return fallback.default as Record<string, unknown>;
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await resolveLocale();
  const dir = getDirection(locale);
  const messages = await loadMessages(locale);
  const session = await auth();

  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  // Migrate pre-rebrand preference keys once, before the theme
                  // providers read them, so an upgrade keeps the user's choices.
                  var keyPairs = [
                    ['tasknebula-color-mode', 'validteam-color-mode'],
                    ['tasknebula-theme', 'validteam-theme']
                  ];
                  for (var i = 0; i < keyPairs.length; i++) {
                    var from = keyPairs[i][0];
                    var to = keyPairs[i][1];
                    if (localStorage.getItem(to) === null) {
                      var previous = localStorage.getItem(from);
                      if (previous !== null) {
                        localStorage.setItem(to, previous);
                      }
                    }
                    localStorage.removeItem(from);
                  }

                  var storedColorMode = localStorage.getItem('validteam-color-mode');
                  if (!storedColorMode) {
                    var legacyColorMode = localStorage.getItem('theme');
                    if (
                      legacyColorMode === 'light' ||
                      legacyColorMode === 'dark' ||
                      legacyColorMode === 'system'
                    ) {
                      localStorage.setItem('validteam-color-mode', legacyColorMode);
                    }
                  }
                  var raw = localStorage.getItem('validteam-theme');
                  var state = raw ? (JSON.parse(raw).state || {}) : {};
                  var theme = state.colorTheme || 'default';
                  var visual = state.visualStyle || 'modern';
                  var font = state.interfaceFont === 'brand' ? 'brand' : 'ibm';
                  var anims = state.enableAnimations === false ? 'false' : 'true';
                  var fontStacks = {
                    brand: {
                      sans: "'Plus Jakarta Sans'",
                      mono: "'JetBrains Mono'"
                    },
                    ibm: {
                      sans: "'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif",
                      mono: "'IBM Plex Mono', 'IBM Plex Sans', ui-monospace, monospace"
                    }
                  };
                  var activeFont = fontStacks[font] || fontStacks.ibm;
                  var root = document.documentElement;
                  root.setAttribute('data-theme', theme);
                  root.setAttribute('data-visual', visual);
                  root.setAttribute('data-interface-font', font);
                  root.setAttribute('data-animations', anims);
                  root.style.setProperty('--app-font-sans', activeFont.sans);
                  root.style.setProperty('--app-font-mono', activeFont.mono);
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body className="font-sans antialiased">
        {/*
          DirectionProvider primes Radix primitives with the correct
          reading direction. NextIntlClientProvider exposes the same
          message catalog to client components outside the [locale]
          segment (e.g. /auth/signin) so the language switcher works
          everywhere. The inner [locale]/layout re-installs both with
          its own params to keep static rendering correct under that
          subtree.
        */}
        <DirectionProvider dir={dir}>
          <NextIntlClientProvider locale={locale} messages={messages}>
            <Providers session={session}>{children}</Providers>
            <Toaster />
          </NextIntlClientProvider>
        </DirectionProvider>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (() => {
                if (!('serviceWorker' in navigator)) {
                  return;
                }

                const isLocalHost =
                  ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname) ||
                  window.location.hostname.endsWith('.local');
                const shouldRegister = ${process.env.NODE_ENV === 'production' ? 'true' : 'false'} && !isLocalHost;

                window.addEventListener('load', async () => {
                  try {
                    if (!shouldRegister) {
                      const registrations = await navigator.serviceWorker.getRegistrations();
                      await Promise.all(
                        registrations.map((registration) => registration.unregister().catch(() => false))
                      );

                      if ('caches' in window) {
                        const cacheKeys = await caches.keys();
                        await Promise.all(
                          cacheKeys
                            .filter(
                              (key) =>
                                key.startsWith('validteam-') || key.startsWith('tasknebula-')
                            )
                            .map((key) => caches.delete(key))
                        );
                      }

                      return;
                    }

                    await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
                  } catch {
                    // Keep localhost and production consoles clean. The app works without SW.
                  }
                });
              })();
            `,
          }}
        />
      </body>
    </html>
  );
}
