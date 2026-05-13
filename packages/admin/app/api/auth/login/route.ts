/**
 * 后台登录：`POST` 校验 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 后写入 `admin_session`（httpOnly）。
 * `DELETE` 与 `/api/auth/logout` 类似，用于清除会话（兼容旧客户端可一并保留）。
 */
import { generateSessionToken } from '@/lib/auth';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

interface LoginRequest {
  username: string;
  password: string;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as LoginRequest;
    const { username, password } = body;

    // 凭据来自 OpenNext env；本地 dev 回退 process.env
    let adminUsername: string | undefined;
    let adminPassword: string | undefined;

    try {
      const { env } = await import('@opennextjs/cloudflare').then(m => m.getCloudflareContext());
      adminUsername = env.ADMIN_USERNAME;
      adminPassword = env.ADMIN_PASSWORD;
    } catch {
      adminUsername = process.env.ADMIN_USERNAME;
      adminPassword = process.env.ADMIN_PASSWORD;
    }

    if (!adminUsername || !adminPassword) {
      console.error('Admin credentials not configured');
      return Response.json(
        { success: false, message: 'Server configuration error' },
        { status: 500 }
      );
    }

    if (username !== adminUsername || password !== adminPassword) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      return Response.json(
        { success: false, message: 'Invalid credentials' },
        { status: 401 }
      );
    }

    const sessionToken = generateSessionToken();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    const cookieStore = await cookies();
    cookieStore.set('admin_session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      expires: expiresAt,
      path: '/',
    });

    return Response.json({
      success: true,
      message: 'Login successful',
    });

  } catch (error) {
    console.error('Login API error:', error);
    return Response.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const cookieStore = await cookies();
    cookieStore.delete('admin_session');

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
