/**
 * 供前端判断是否存在 `admin_session` cookie（不验证 token 内容，与 `checkAuth` 策略一致）。
 */
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get('admin_session');

    if (sessionToken && sessionToken.value) {
      return Response.json({
        authenticated: true,
      });
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
