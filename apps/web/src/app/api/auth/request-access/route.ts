import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/auth/rate-limit';
import { sendEmail } from '@/lib/email/sender';

export const dynamic = 'force-dynamic';

const ADMIN_EMAIL = 'pogutu010@gmail.com';

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

  const { sent, error } = await sendEmail({
    to: ADMIN_EMAIL,
    subject: `ValidTeam access request from ${email}`,
    html: `<p><strong>${name}</strong> &lt;${email}&gt; requested access to ValidTeam.</p><p>Reason:</p><p>${reason || '(none)'}</p>`,
    text: `${name} <${email}> requested access.\n\n${reason}`,
  });

  if (!sent && !error) {
    return NextResponse.redirect(new URL('/auth/request-access?error=1', request.url));
  }

  return NextResponse.redirect(new URL('/auth/request-access?sent=1', request.url));
}
