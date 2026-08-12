/**
 * 管理端认证安全事件的结构化日志。
 *
 * Access Audit 表已移除，这些事件改为写入日志流（Cloudflare Logs / Docker stdout），
 * 由外部日志平台按 `event` 前缀建告警规则（如同一 IP 的 `admin.auth.login_failed` 频次）。
 *
 * 约束：绝不输出密码或完整密钥；Bearer 场景只记与 `admin_api_keys.key_prefix` 同口径的前 12 位。
 */

export type AdminAuthEvent =
	| 'admin.auth.login'
	| 'admin.auth.login_failed'
	| 'admin.auth.logout'
	| 'admin.auth.unauthorized';

function firstForwardedFor(value: string): string | null {
	const first = value.split(',')[0]?.trim();
	return first || null;
}

export function getClientIp(request: Request | undefined): string | null {
	if (!request) return null;
	const cfIp = request.headers.get('cf-connecting-ip');
	if (cfIp) return cfIp;
	const forwarded = request.headers.get('x-forwarded-for');
	return forwarded ? firstForwardedFor(forwarded) : null;
}

export function getUserAgent(request: Request | undefined): string | null {
	return request?.headers.get('user-agent') ?? null;
}

/** 与 `access-keys` 创建密钥时的 `secretKey.slice(0, 12)` 保持一致。 */
export function getBearerKeyPrefix(request: Request | undefined): string | null {
	const authorization = request?.headers.get('authorization');
	if (!authorization?.startsWith('Bearer ')) return null;
	const secret = authorization.slice(7).trim();
	return secret ? secret.slice(0, 12) : null;
}

export function logAdminAuthEvent(
	event: AdminAuthEvent,
	request: Request | undefined,
	details: {
		username?: string | null;
		keyPrefix?: string | null;
		method?: string | null;
		path?: string | null;
	} = {}
): void {
	const payload: Record<string, unknown> = {
		event,
		at: new Date().toISOString(),
		client_ip: getClientIp(request),
		user_agent: getUserAgent(request),
	};
	if (details.username != null) payload.username = details.username;
	if (details.keyPrefix != null) payload.key_prefix = details.keyPrefix;
	if (details.method != null) payload.method = details.method;
	if (details.path != null) payload.path = details.path;

	const line = JSON.stringify(payload);
	if (event === 'admin.auth.login_failed' || event === 'admin.auth.unauthorized') {
		console.warn(line);
		return;
	}
	console.log(line);
}
