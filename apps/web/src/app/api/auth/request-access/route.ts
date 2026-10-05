import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/auth/rate-limit';
import { sendEmail } from '@/lib/email/sender';
import { renderAccessRequestMessage } from '@/lib/email/templates';

export const dynamic = 'force-dynamic';

/**
 * Recipient for access-request notifications. Configured via
 * `ACCESS_REQUEST_ADMIN_EMAIL` so the address is not baked into the bundle;
 * falls back to the superadmin address used during setup.
 */
const ADMIN_EMAIL = process.env.ACCESS_REQUEST_ADMIN_EMAIL || 'pogutu010@gmail.com';

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const limit = checkRateLimit(`access-request:${ip}`, 5, 60_000);
  if (!limit.allowed) {
    return NextResponse.redirect(new URL('/auth/request-access?error=1', request.url));
  }

  const form = await request.formData().catch(() => null);
  const name = String(form?.get('name') ?? '').trim();
  const email = String(form?.get('email') ?? '')
    .trim()
    .toLowerCase();
  const reason = String(form?.get('reason') ?? '').trim();

  if (!name || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.redirect(new URL('/auth/request-access?error=1', request.url));
  }

  const { subject, html, text } = renderAccessRequestMessage({
    name,
    requesterEmail: email,
    reason,
  });

  const { sent, error, skipped } = await sendEmail({
    to: ADMIN_EMAIL,
    subject,
    html,
    text,
  });

  // Treat every non-delivery outcome as a failure: a hard error, or an SMTP
  // layer that was never configured (`skipped`). Silently reporting success
  // would lose the request entirely.
  if (!sent) {
    console.error('[auth/request-access] delivery failed:', error ?? 'smtp not configured');
    return NextResponse.redirect(new URL('/auth/request-access?error=1', request.url));
  }

  if (skipped) {
    console.warn('[auth/request-access] smtp not configured; request not delivered');
    return NextResponse.redirect(new URL('/auth/request-access?error=1', request.url));
  }

  return NextResponse.redirect(new URL('/auth/request-access?sent=1', request.url));
}
