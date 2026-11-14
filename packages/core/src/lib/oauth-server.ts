/**
 * 内置 MCP OAuth 授权服务器的纯逻辑（不碰数据库，也不依赖运行时）：
 * 令牌与标识生成、回调地址匹配、PKCE、应用归属、元数据与授权参数校验。
 * Workers 与 Node 共用，只用 Web Crypto。
 */
import { sha256Hex } from '../mcp/hash';

export const OAUTH_SERVER_SCOPE = 'mcp';
/** 授权请求（等待用户同意）的有效期。 */
export const OAUTH_AUTHORIZATION_REQUEST_TTL_SECONDS = 600;
/** 授权码有效期（自用户同意起）。 */
export const OAUTH_AUTHORIZATION_CODE_TTL_SECONDS = 600;
export const OAUTH_SERVER_ACCESS_TOKEN_TTL_SECONDS = 3600;
export const OAUTH_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 3600;
export const OAUTH_REFRESH_TOKEN_PREFIX = 'ort_';
export const OAUTH_CLIENT_ID_PREFIX = 'octa_';
/** 注册后从未完成授权的注册实例保留天数。 */
export const OAUTH_UNUSED_CLIENT_RETENTION_DAYS = 7;
export const OAUTH_MAX_REDIRECT_URIS = 10;
export const OAUTH_MAX_CLIENT_NAME_LENGTH = 100;

export function hashOAuthSecret(value: string): Promise<string> {
	return sha256Hex(value);
}

function toBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomOAuthToken(byteLength = 32): string {
	return toBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export function generateOAuthClientId(): string {
	return `${OAUTH_CLIENT_ID_PREFIX}${randomOAuthToken(18)}`;
}

export function generateRefreshToken(): string {
	return `${OAUTH_REFRESH_TOKEN_PREFIX}${randomOAuthToken(32)}`;
}

export function isRefreshTokenValue(value: string): boolean {
	return value.startsWith(OAUTH_REFRESH_TOKEN_PREFIX);
}

// ---------------------------------------------------------------------------
// PKCE
// ---------------------------------------------------------------------------

const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;

export function isValidCodeChallenge(value: string): boolean {
	return CHALLENGE_RE.test(value);
}

export function isValidCodeVerifier(value: string): boolean {
	return VERIFIER_RE.test(value);
}

export async function s256Challenge(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
	return toBase64Url(new Uint8Array(digest));
}

export async function verifyPkceS256(verifier: string, challenge: string): Promise<boolean> {
	if (!isValidCodeVerifier(verifier) || !isValidCodeChallenge(challenge)) return false;
	const expected = await s256Challenge(verifier);
	if (expected.length !== challenge.length) return false;
	let diff = 0;
	for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ challenge.charCodeAt(i);
	return diff === 0;
}

// ---------------------------------------------------------------------------
// 回调地址
// ---------------------------------------------------------------------------

/** 回调地址必须是 https（本机开发允许 http://localhost / 127.0.0.1 / [::1]），且无 fragment 与凭据。 */
export function isAcceptableRedirectUriShape(uri: string): boolean {
	let url: URL;
	try {
		url = new URL(uri);
	} catch {
		return false;
	}
	if (url.hash || url.username || url.password) return false;
	if (url.protocol === 'https:') return true;
	return (
		url.protocol === 'http:' &&
		(url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
	);
}

/**
 * 本机回环回调（`http://127.0.0.1` / `http://[::1]`，RFC 8252 §7.3）的比较键：忽略端口，其余必须一致。
 * `localhost` 不在此列（RFC 8252 §8.3 不推荐）。非回环地址返回 null。
 */
function loopbackKey(uri: string): string | null {
	let url: URL;
	try {
		url = new URL(uri);
	} catch {
		return null;
	}
	if (url.protocol !== 'http:') return null;
	if (url.hostname !== '127.0.0.1' && url.hostname !== '[::1]') return null;
	return `${url.hostname}${url.pathname}${url.search}`;
}

export function isLoopbackRedirectUri(uri: string): boolean {
	return loopbackKey(uri) !== null;
}

/** 两个回调地址是否等价：精确相同，或同为回环地址且仅端口不同。 */
export function redirectUrisMatch(candidate: string, registered: string): boolean {
	if (candidate === registered) return true;
	const a = loopbackKey(candidate);
	return a !== null && a === loopbackKey(registered);
}

export function isRedirectUriAllowed(uri: string, allowlist: readonly string[]): boolean {
	if (!isAcceptableRedirectUriShape(uri)) return false;
	return allowlist.some((entry) => redirectUrisMatch(uri, entry));
}

// ---------------------------------------------------------------------------
// 应用目录
// ---------------------------------------------------------------------------

export type OAuthAppMatchInput = {
	id: string;
	redirect_uris: string[];
	client_name_patterns: string[];
	enabled: boolean;
};

/** 把客户端自报的名称规整成可存储的短文本（只用于展示和归类，不是安全依据）。 */
export function sanitizeClientName(raw: unknown): string {
	const text = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '';
	return (text || 'MCP Client').slice(0, OAUTH_MAX_CLIENT_NAME_LENGTH);
}

/** 启用应用的回调地址并集：动态注册与授权放行的唯一来源。 */
export function enabledAppRedirectUris(apps: readonly OAuthAppMatchInput[]): string[] {
	return [...new Set(apps.filter((app) => app.enabled).flatMap((app) => app.redirect_uris))];
}

/**
 * 按回调地址与客户端名称把注册实例归到应用：
 * - 只有一个启用应用覆盖全部回调：归它；
 * - 多个应用共用回调（如 Codex 与豆包的 `http://127.0.0.1/callback`）：名称命中 `client_name_patterns`（不区分大小写的子串）的优先，
 *   其次是没有配置名称规则的唯一应用；仍无法区分则返回 null（未归属）。
 */
export function matchOAuthApp(
	apps: readonly OAuthAppMatchInput[],
	client: { clientName: string; redirectUris: readonly string[] }
): string | null {
	const candidates = apps.filter(
		(app) =>
			app.enabled &&
			client.redirectUris.length > 0 &&
			client.redirectUris.every((uri) => app.redirect_uris.some((entry) => redirectUrisMatch(uri, entry)))
	);
	if (candidates.length === 0) return null;
	if (candidates.length === 1) return candidates[0].id;
	const name = client.clientName.toLowerCase();
	const byName = candidates.filter((app) =>
		app.client_name_patterns.some((pattern) => pattern.trim() !== '' && name.includes(pattern.trim().toLowerCase()))
	);
	if (byName.length >= 1) return byName[0].id;
	const generic = candidates.filter((app) => app.client_name_patterns.length === 0);
	return generic.length === 1 ? generic[0].id : null;
}

export function normalizeStringList(raw: unknown, options: { max: number; maxLength: number }): string[] | null {
	if (!Array.isArray(raw) || raw.length > options.max) return null;
	const out: string[] = [];
	for (const item of raw) {
		if (typeof item !== 'string') return null;
		const trimmed = item.trim();
		if (!trimmed) continue;
		if (trimmed.length > options.maxLength) return null;
		if (!out.includes(trimmed)) out.push(trimmed);
	}
	return out;
}

export function parseJsonStringList(raw: string | null | undefined): string[] {
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
	} catch {
		return [];
	}
}

// ---------------------------------------------------------------------------
// 元数据（RFC 8414）
// ---------------------------------------------------------------------------

export function oauthServerEndpoints(issuer: string) {
	return {
		authorization: `${issuer}/oauth/authorize`,
		token: `${issuer}/oauth/token`,
		registration: `${issuer}/oauth/register`,
		revocation: `${issuer}/oauth/revoke`,
		consent: `${issuer}/oauth/consent`,
	};
}

export function buildOAuthAuthorizationServerMetadata(issuer: string) {
	const endpoints = oauthServerEndpoints(issuer);
	return {
		issuer,
		authorization_endpoint: endpoints.authorization,
		token_endpoint: endpoints.token,
		registration_endpoint: endpoints.registration,
		revocation_endpoint: endpoints.revocation,
		response_types_supported: ['code'],
		grant_types_supported: ['authorization_code', 'refresh_token'],
		code_challenge_methods_supported: ['S256'],
		token_endpoint_auth_methods_supported: ['none'],
		revocation_endpoint_auth_methods_supported: ['none'],
		scopes_supported: [OAUTH_SERVER_SCOPE],
		authorization_response_iss_parameter_supported: true,
	};
}

// ---------------------------------------------------------------------------
// 授权参数校验（OAuth 2.1：client_id / redirect_uri 不可信时不得重定向）
// ---------------------------------------------------------------------------

export type OAuthClientForAuthorize = {
	client_id: string;
	redirect_uris: string[];
	app_id: string | null;
};

export type AuthorizeParams = {
	clientId: string;
	redirectUri: string;
	codeChallenge: string;
	resource: string | null;
	state: string | null;
	scope: typeof OAUTH_SERVER_SCOPE;
};

export type AuthorizeValidation =
	| { ok: true; params: AuthorizeParams }
	| { ok: false; error: string; description: string; redirectable: boolean };

/**
 * RFC 8707 `resource`：必须是本 Gateway 的 MCP 入口（`/mcp` 或 `/mcp/{slug}`），源必须在允许列表里。
 */
export function isValidMcpResource(resource: string, allowedOrigins: readonly string[]): boolean {
	let url: URL;
	try {
		url = new URL(resource);
	} catch {
		return false;
	}
	if (url.hash || url.search) return false;
	if (!allowedOrigins.includes(url.origin)) return false;
	const path = url.pathname.replace(/\/+$/, '');
	return path === '/mcp' || /^\/mcp\/[a-z0-9-]{1,40}$/.test(path);
}

export function validateAuthorizeParams(
	get: (name: string) => string | null | undefined,
	input: {
		client: OAuthClientForAuthorize | null;
		/** 当前生效的回调白名单：客户端归属应用时只含该应用的回调，否则是全部启用应用的并集；应用被停用时为 null。 */
		allowedRedirectUris: readonly string[] | null;
		allowedResourceOrigins: readonly string[];
	}
): AuthorizeValidation {
	const fail = (error: string, description: string, redirectable = true): AuthorizeValidation => ({
		ok: false,
		error,
		description,
		redirectable,
	});

	const clientId = get('client_id')?.trim();
	if (!clientId || !input.client || input.client.client_id !== clientId) {
		return fail('invalid_request', 'Unknown client_id', false);
	}
	if (input.allowedRedirectUris === null) {
		return fail('unauthorized_client', 'This application has been disabled', false);
	}
	const redirectUri = get('redirect_uri')?.trim();
	if (!redirectUri || !input.client.redirect_uris.some((registered) => redirectUrisMatch(redirectUri, registered))) {
		return fail('invalid_request', 'redirect_uri is not registered for this client', false);
	}
	if (!isRedirectUriAllowed(redirectUri, input.allowedRedirectUris)) {
		return fail('invalid_request', 'redirect_uri is not enabled in the server callback allowlist', false);
	}
	if (get('response_type') !== 'code') {
		return fail('unsupported_response_type', 'response_type must be "code"');
	}
	const codeChallenge = get('code_challenge')?.trim() ?? '';
	if (!codeChallenge || get('code_challenge_method') !== 'S256' || !isValidCodeChallenge(codeChallenge)) {
		return fail('invalid_request', 'PKCE with code_challenge_method=S256 is required');
	}
	const scopeRaw = get('scope')?.trim();
	if (scopeRaw && scopeRaw.split(/\s+/).some((item) => item !== OAUTH_SERVER_SCOPE)) {
		return fail('invalid_scope', `Only the "${OAUTH_SERVER_SCOPE}" scope is supported`);
	}
	const resource = get('resource')?.trim() || null;
	if (resource && !isValidMcpResource(resource, input.allowedResourceOrigins)) {
		return fail('invalid_target', "resource must be this gateway's MCP endpoint");
	}
	return {
		ok: true,
		params: {
			clientId,
			redirectUri,
			codeChallenge,
			resource,
			state: get('state') ?? null,
			scope: OAUTH_SERVER_SCOPE,
		},
	};
}

/** 把 `error` / `state` / RFC 9207 `iss` 附到 redirect_uri 上。 */
export function buildAuthorizeErrorRedirect(
	redirectUri: string,
	error: string,
	description: string,
	state: string | null,
	issuer: string
): string {
	const url = new URL(redirectUri);
	url.searchParams.set('error', error);
	url.searchParams.set('error_description', description);
	if (state) url.searchParams.set('state', state);
	url.searchParams.set('iss', issuer);
	return url.toString();
}

export function buildAuthorizeSuccessRedirect(
	redirectUri: string,
	code: string,
	state: string | null,
	issuer: string
): string {
	const url = new URL(redirectUri);
	url.searchParams.set('code', code);
	if (state) url.searchParams.set('state', state);
	url.searchParams.set('iss', issuer);
	return url.toString();
}
