/**
 * Gateway Admin 后台会话：随机 token 写入 `admin_session` cookie；`checkAuth` 仅做 cookie 存在性检查（非 JWT 校验）。
 */

/** 生成 32 字节十六进制会话标识。 */
export function generateSessionToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * 是否为 `admin_session` 设置 `Secure`（可选加固，由 `ADMIN_COOKIE_SECURE` 控制）。
 * - 未设置或 `0`/`false`/`no`/`off` → false（默认；明文 HTTP 可登录）
 * - `1`/`true`/`yes`/`on` → true（已部署 HTTPS 时可选用，限制 Cookie 仅经 HTTPS 回传）
 */
export function resolveCookieSecure(): boolean {
  const raw = process.env.ADMIN_COOKIE_SECURE?.trim().toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') {
    return true;
  }
  return false;
}

/** 请求头 Cookie 中是否包含 `admin_session=`（与登录路由写入名一致）。 */
export function checkAuth(request: Request): boolean {
  const cookieHeader = request.headers.get('cookie');
  return cookieHeader?.includes('admin_session=') ?? false;
}
