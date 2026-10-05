import NextAuth from 'next-auth';
import type { NextAuthConfig, Session } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import GitHub from 'next-auth/providers/github';
import Google from 'next-auth/providers/google';
import { db, users } from '@validteam/db';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { authConfig } from './auth.config';
import { consumeSamlExchangeToken } from '@/lib/sso/session';
import { getLoginOAuthCredentials, isLoginOAuthProvider } from '@/lib/auth/login-oauth-providers';
import { applyOAuthDatabaseUser, resolveOAuthDatabaseUser } from '@/lib/auth/oauth-users';
import { consumeMobileOAuthExchangeToken } from '@/lib/auth/mobile-oauth';
import { isDurableSessionValid } from '@/lib/auth/session-revocation';

/**
 * Full auth configuration with database operations
 * This file extends auth.config.ts with Node.js-only features
 */
function buildCredentialProviders(): NextAuthConfig['providers'] {
  return [
    // Override Credentials provider with actual authorize logic
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const user = await db.query.users.findFirst({
          where: eq(users.email, credentials.email as string),
        });

        if (!user || !user.password || user.status !== 'active') {
          return null;
        }

        const isPasswordValid = await bcrypt.compare(credentials.password as string, user.password);

        if (!isPasswordValid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
    // SAML bridge: redeems a one-shot exchange token minted by the ACS
    // callback (see apps/web/src/lib/sso/session.ts) and signs the user in.
    Credentials({
      id: 'saml-bridge',
      name: 'saml-bridge',
      credentials: {
        token: { label: 'SAML exchange token', type: 'text' },
      },
      async authorize(credentials) {
        const token = credentials?.token;
        if (typeof token !== 'string' || !token) return null;
        const payload = await consumeSamlExchangeToken(token);
        if (!payload) return null;
        const user = await db.query.users.findFirst({
          where: eq(users.id, payload.userId),
        });
        if (!user || user.status !== 'active') return null;
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
    Credentials({
      id: 'mobile-oauth',
      name: 'mobile-oauth',
      credentials: {
        token: { label: 'Mobile OAuth exchange token', type: 'text' },
      },
      async authorize(credentials) {
        const token = credentials?.token;
        if (typeof token !== 'string' || !token) return null;
        const payload = await consumeMobileOAuthExchangeToken(token);
        if (!payload) return null;
        const user = await db.query.users.findFirst({
          where: eq(users.id, payload.userId),
        });
        if (!user || user.status !== 'active') return null;
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
  ];
}

async function buildNodeProviders(): Promise<NextAuthConfig['providers']> {
  const providers = buildCredentialProviders();
  const credentials = await getLoginOAuthCredentials();

  if (credentials.github) {
    providers.push(
      GitHub({
        clientId: credentials.github.clientId,
        clientSecret: credentials.github.clientSecret,
      })
    );
  }

  if (credentials.google) {
    providers.push(
      Google({
        clientId: credentials.google.clientId,
        clientSecret: credentials.google.clientSecret,
      })
    );
  }

  return providers;
}

async function buildNodeAuthConfig(): Promise<NextAuthConfig> {
  const baseCallbacks = authConfig.callbacks ?? {};

  return {
    ...authConfig,
    callbacks: {
      ...(authConfig.callbacks ?? {}),
      async signIn({ user, account }) {
        if (!isLoginOAuthProvider(account?.provider)) {
          return true;
        }

        const databaseUser = await resolveOAuthDatabaseUser({ user, account });
        if (!databaseUser) return false;
        applyOAuthDatabaseUser(user, databaseUser);
        return true;
      },
      async jwt(params) {
        if (params.user && isLoginOAuthProvider(params.account?.provider)) {
          const databaseUser = await resolveOAuthDatabaseUser({
            user: params.user,
            account: params.account,
          });
          if (databaseUser) {
            applyOAuthDatabaseUser(params.user, databaseUser);
          }
        }

        return baseCallbacks.jwt ? baseCallbacks.jwt(params) : params.token;
      },
    },
    providers: await buildNodeProviders(),
  };
}

const handlerAuth = NextAuth(async () => buildNodeAuthConfig());
const sessionAuth = NextAuth(authConfig);

export const handlers = handlerAuth.handlers;
export const signIn: typeof handlerAuth.signIn = handlerAuth.signIn;
export const signOut = handlerAuth.signOut;

/**
 * Resolve a session and re-check the durable user status on every server
 * boundary. Credentials are rejected at sign-in time as well, but JWT sessions
 * can outlive an administrator deactivating an account. Keeping this check in
 * the canonical `auth()` export makes that admin control take effect for pages
 * and route handlers without waiting for the token to expire.
 */
export async function auth(): Promise<Session | null> {
  const session = await sessionAuth.auth();
  const userId = session?.user?.id;
  if (!userId) return session;

  const [actor] = await db
    .select({ status: users.status, sessionVersion: users.sessionVersion })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return isDurableSessionValid(actor, session.user.sessionVersion) ? session : null;
}
