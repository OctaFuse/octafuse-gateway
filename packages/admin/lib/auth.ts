/**
 * Gateway Admin 后台会话：随机 token 写入 `admin_session` cookie；`checkAuth` 仅做 cookie 存在性检查（非 JWT 校验）。
 */

/** 生成 32 字节十六进制会话标识。 */
export function generateSessionToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** 请求头 Cookie 中是否包含 `admin_session=`（与登录路由写入名一致）。 */
export function checkAuth(request: Request): boolean {
  const cookieHeader = request.headers.get('cookie');
  return cookieHeader?.includes('admin_session=') ?? false;
}
