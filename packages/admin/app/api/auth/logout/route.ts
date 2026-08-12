/**
 * 登出：删除 `admin_session` cookie。
 */
import { cookies } from 'next/headers';
import { hashSessionToken } from '@/lib/auth';
import { resolveAdminRequestRuntime } from '@/lib/admin-request-runtime';
import { logAdminAuthEvent } from '@/lib/security-log';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('admin_session')?.value;
    if (token) {
      const { storage } = await resolveAdminRequestRuntime();
      await storage.repositories.adminAccess.deleteSession(await hashSessionToken(token));
    }
    cookieStore.delete('admin_session');

    logAdminAuthEvent('admin.auth.logout', request);

    return Response.json({
      success: true,
      message: 'Logout successful',
    });
  } catch (error) {
    console.error('Logout API error:', error);
    return Response.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}
