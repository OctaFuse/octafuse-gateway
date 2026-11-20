/**
 * 后台登录：`POST` 校验 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 后写入 `admin_session`（httpOnly）。
 * `DELETE` 与 `/api/auth/logout` 类似，用于清除会话（兼容旧客户端可一并保留）。
 */
import { generateSessionToken, hashSessionToken, resolveCookieSecure, timingSafeEqualSecret } from '@/lib/auth';
import { cookies } from 'next/headers';
import { resolveAdminRequestRuntime } from '@/lib/admin-request-runtime';
import { logAdminAuthEvent } from '@/lib/security-log';
import {
  checkLoginLockout, reserveLogin, commitLoginFailure, commitLoginSuccess,
  rollbackLogin, getLoginGuardState, guardNow,
  type GuardDecision, type Reservation,
} from '@/lib/admin-login-guard';

export const dynamic = 'force-dynamic';

interface LoginRequest {
  username: string;
  password: string;
}

const MAX_BODY_BYTES = 4096;

async function readLoginBody(request: Request): Promise<LoginRequest | Response> {
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ success: false, message: 'Invalid JSON body' }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, 10_000);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        return Response.json({ success: false, message: 'Request body too large' }, { status: 413 });
      }
      chunks.push(value);
    }
    if (timedOut) return Response.json({ success: false, message: 'Request timed out' }, { status: 408 });
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
        typeof (parsed as LoginRequest).username !== 'string' ||
        typeof (parsed as LoginRequest).password !== 'string') throw new Error('invalid shape');
    return parsed as LoginRequest;
  } catch {
    if (timedOut) return Response.json({ success: false, message: 'Request timed out' }, { status: 408 });
    return Response.json({ success: false, message: 'Invalid JSON body' }, { status: 400 });
  } finally { clearTimeout(timeout); reader.releaseLock(); }
}

function guardResponse(decision: GuardDecision): Response | null {
  if (decision.kind === 'reserved') return null;
  if (decision.kind === 'busy') return Response.json(
    { success: false, code: 'ADMIN_LOGIN_BUSY', message: 'Login is busy. Try again shortly.' },
    { status: 429, headers: { 'Retry-After': '1' } },
  );
  return Response.json(
    { success: false, code: 'ADMIN_LOGIN_LOCKED', message: 'Too many failed attempts. Try again later.', retryAfterSeconds: decision.retryAfterSeconds },
    { status: 429, headers: { 'Retry-After': String(decision.retryAfterSeconds) } },
  );
}

function guardFailure(request: Request, error: unknown): Response {
  logAdminAuthEvent('admin.auth.guard_degraded', request);
  void error;
  return Response.json({ success: false, message: 'Login temporarily unavailable' }, { status: 503 });
}

async function postLogin(request: Request) {
  let reservation: Reservation | null = null;
  let guardState: ReturnType<typeof getLoginGuardState>;
  try {
    try { guardState = getLoginGuardState(); }
    catch (error) { return guardFailure(request, error); }
    const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-octafuse-peer-ip') || '';
    try {
      const locked = checkLoginLockout(guardState, ip, guardNow());
      if (locked) {
        logAdminAuthEvent('admin.auth.login_locked', request, { guardKey: locked.key });
        return guardResponse(locked)!;
      }
    } catch (error) { return guardFailure(request, error); }
    const parsed = await readLoginBody(request);
    if (parsed instanceof Response) return parsed;
    const body = parsed;
    const { username, password } = body;

    try {
      const decision = reserveLogin(guardState, ip, guardNow());
      const refused = guardResponse(decision);
      if (refused) return refused;
      reservation = decision.kind === 'reserved' ? decision.reservation : null;
    } catch (error) { return guardFailure(request, error); }

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
      throw new Error('Admin credentials not configured');
    }

    const passwordMatches = await timingSafeEqualSecret(String(password ?? ''), adminPassword);
    if (username !== adminUsername || !passwordMatches) {
      logAdminAuthEvent('admin.auth.login_failed', request, { username: String(username ?? '') });
      let locked: GuardDecision | null;
      try {
        locked = commitLoginFailure(guardState, reservation!, guardNow());
        reservation = null;
      } catch (error) { return guardFailure(request, error); }
      if (locked) {
        if (locked.kind === 'locked') logAdminAuthEvent('admin.auth.login_lockout_triggered', request, { guardKey: locked.key });
        return guardResponse(locked)!;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      return Response.json(
        { success: false, message: 'Invalid credentials' },
        { status: 401 }
      );
    }

    if (reservation && guardNow() >= reservation.deadline) {
      throw new Error('Login attempt expired');
    }
    const sessionToken = generateSessionToken();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);
    const { storage } = await resolveAdminRequestRuntime(request);
    const now = new Date().toISOString();
    await storage.repositories.adminAccess.deleteExpiredSessions(now);
    const tokenHash = await hashSessionToken(sessionToken);
    await storage.repositories.adminAccess.insertSession({
      tokenHash,
      username,
      createdAt: now,
      expiresAt: expiresAt.toISOString(),
    });

    const cookieStore = await cookies();
    cookieStore.set('admin_session', sessionToken, {
      httpOnly: true,
      secure: resolveCookieSecure(),
      sameSite: 'strict',
      expires: expiresAt,
      path: '/',
    });

    logAdminAuthEvent('admin.auth.login', request, { username });
    try {
      commitLoginSuccess(guardState, reservation!);
      reservation = null;
    } catch (error) {
      try { await storage.repositories.adminAccess.deleteSession(tokenHash); }
      catch { /* Orphaned session expires under the existing session policy. */ }
      return guardFailure(request, error);
    }

    return Response.json({
      success: true,
      message: 'Login successful',
    });

  } catch (error) {
    console.error('Login API error:', error);
    if (reservation) {
      try { rollbackLogin(guardState!, reservation); }
      catch (guardError) { return guardFailure(request, guardError); }
    }
    return Response.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  const response = await postLogin(request);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function DELETE(request: Request) {
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
