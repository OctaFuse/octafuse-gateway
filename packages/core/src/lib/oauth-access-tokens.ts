/**
 * 访问令牌（`oauth_access_tokens`）：授权服务器代表用户签发给第三方 MCP 客户端的凭证。
 *
 * 与 `api_keys` 分开：前缀 `oat_`，库里只存 SHA-256 哈希，可过期，只能访问 `/mcp*`。
 * Proxy 通过前缀区分两类凭证，不需要读任何 metadata 做判断。
 */
import { sha256Hex } from '../mcp/hash';

export const OAUTH_ACCESS_TOKEN_PREFIX = 'oat_';

/** 目前只有 `mcp`：令牌只能访问 `/mcp` 与 `/mcp/*`。 */
export const OAUTH_ACCESS_TOKEN_SCOPES = ['mcp'] as const;
export type OAuthAccessTokenScope = (typeof OAUTH_ACCESS_TOKEN_SCOPES)[number];

export const DEFAULT_OAUTH_ACCESS_TOKEN_TTL_SECONDS = 3600;
export const MIN_OAUTH_ACCESS_TOKEN_TTL_SECONDS = 60;
export const MAX_OAUTH_ACCESS_TOKEN_TTL_SECONDS = 30 * 24 * 3600;

export type OAuthAccessTokenStatus = 'active' | 'expired' | 'revoked';

const SCOPES_INVALID = `scopes must be a non-empty array of: ${OAUTH_ACCESS_TOKEN_SCOPES.join(', ')}`;

/** 请求里的凭证是否是访问令牌（按前缀判断）。 */
export function isOAuthAccessTokenValue(value: string): boolean {
	return value.startsWith(OAUTH_ACCESS_TOKEN_PREFIX);
}

/** `oat_` + 32 字节随机数（base64url）。 */
export function generateOAuthAccessTokenSecret(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	return `${OAUTH_ACCESS_TOKEN_PREFIX}${encoded}`;
}

export function hashOAuthAccessToken(secret: string): Promise<string> {
	return sha256Hex(secret);
}

/** 末 4 位，供后台辨认；不足以还原令牌。 */
export function oauthAccessTokenHint(secret: string): string {
	return secret.slice(-4);
}

/** 读库解析；非法或空数组按默认 `["mcp"]` 处理（令牌永远不能是「不限」）。 */
export function parseOAuthAccessTokenScopes(raw: string | null | undefined): string[] {
	if (!raw) return [...OAUTH_ACCESS_TOKEN_SCOPES];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [...OAUTH_ACCESS_TOKEN_SCOPES];
		const out = parsed.filter((v): v is string => typeof v === 'string' && v !== '');
		return out.length > 0 ? out : [...OAUTH_ACCESS_TOKEN_SCOPES];
	} catch {
		return [...OAUTH_ACCESS_TOKEN_SCOPES];
	}
}

/** 写库前校验；省略 / null 取默认 `["mcp"]`。 */
export function coerceOAuthAccessTokenScopesInput(
	raw: unknown
): { ok: true; value: string[] } | { ok: false; message: string } {
	if (raw === undefined || raw === null) return { ok: true, value: [...OAUTH_ACCESS_TOKEN_SCOPES] };
	if (!Array.isArray(raw) || raw.length === 0) return { ok: false, message: SCOPES_INVALID };
	const out: string[] = [];
	for (const item of raw) {
		if (typeof item !== 'string' || !(OAUTH_ACCESS_TOKEN_SCOPES as readonly string[]).includes(item)) {
			return { ok: false, message: SCOPES_INVALID };
		}
		if (!out.includes(item)) out.push(item);
	}
	return { ok: true, value: out };
}

/** 校验 / 规范 `ttl_seconds`；省略取默认值。 */
export function coerceOAuthAccessTokenTtlInput(
	raw: unknown
): { ok: true; value: number } | { ok: false; message: string } {
	if (raw === undefined || raw === null) return { ok: true, value: DEFAULT_OAUTH_ACCESS_TOKEN_TTL_SECONDS };
	if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw)) {
		return { ok: false, message: 'ttl_seconds must be an integer' };
	}
	if (raw < MIN_OAUTH_ACCESS_TOKEN_TTL_SECONDS || raw > MAX_OAUTH_ACCESS_TOKEN_TTL_SECONDS) {
		return {
			ok: false,
			message: `ttl_seconds must be between ${MIN_OAUTH_ACCESS_TOKEN_TTL_SECONDS} and ${MAX_OAUTH_ACCESS_TOKEN_TTL_SECONDS}`,
		};
	}
	return { ok: true, value: raw };
}

export function oauthAccessTokenExpiresAt(ttlSeconds: number, nowMs: number = Date.now()): string {
	return new Date(nowMs + ttlSeconds * 1000).toISOString();
}

/** 令牌的 scopes 是否允许访问 `path`。 */
export function isPathAllowedForOAuthAccessTokenScopes(scopes: readonly string[], path: string): boolean {
	return scopes.includes('mcp') && (path === '/mcp' || path.startsWith('/mcp/'));
}

export function oauthAccessTokenStatus(
	row: { revoked_at: string | null; expires_at: string | null },
	nowMs: number = Date.now()
): OAuthAccessTokenStatus {
	if (row.revoked_at) return 'revoked';
	if (row.expires_at) {
		const expires = Date.parse(row.expires_at);
		if (Number.isFinite(expires) && expires <= nowMs) return 'expired';
	}
	return 'active';
}
