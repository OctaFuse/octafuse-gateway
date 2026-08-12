/**
 * 供前端校验数据库中的真实 Session（含过期时间）。
 */
import { cookies } from 'next/headers';
import { hashSessionToken } from '@/lib/auth';
import { resolveAdminRequestRuntime } from '@/lib/admin-request-runtime';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get('admin_session');

    if (sessionToken && sessionToken.value) {
      const { storage } = await resolveAdminRequestRuntime();
      const session = await storage.repositories.adminAccess.getValidSession(
        await hashSessionToken(sessionToken.value),
        new Date().toISOString()
      );
      if (session) return Response.json({ authenticated: true, username: session.username });
    }

    return Response.json({
      authenticated: false,
    });
  } catch (error) {
    console.error('Auth check error:', error);
    return Response.json(
      { authenticated: false },
      { status: 500 }
    );
  }
}
