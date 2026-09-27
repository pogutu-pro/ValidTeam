import { auth, handlers } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';

const SESSION_COOKIE_NAMES = [
  'authjs.session-token',
  '__Secure-authjs.session-token',
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
] as const;

/**
 * Auth.js' generic session handler trusts the signed JWT. Run the application
 * durability check first so deactivated or version-revoked users are also
 * reported as signed out to client-side `useSession()` consumers.
 */
export async function GET(request: NextRequest) {
  if (request.nextUrl.pathname === '/api/auth/session') {
    const session = await auth();
    if (!session) {
      const response = NextResponse.json(null);
      const secure = request.nextUrl.protocol === 'https:';
      for (const name of SESSION_COOKIE_NAMES) {
        response.cookies.set(name, '', {
          expires: new Date(0),
          httpOnly: true,
          path: '/',
          sameSite: 'lax',
          secure,
        });
      }
      return response;
    }
  }

  return handlers.GET(request);
}

export const POST = handlers.POST;
