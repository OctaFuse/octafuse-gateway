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

export function timingSafeEqualString(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

export async function verifyPkceS256(verifier: string, challenge: string): Promise<boolean> {
	if (!isValidCodeVerifier(verifier) || !isValidCodeChallenge(challenge)) return false;
	return timingSafeEqualString(await s256Challenge(verifier), challenge);
}

// ---------------------------------------------------------------------------
// 客户端认证（token 端点）
// ---------------------------------------------------------------------------

export const OAUTH_CLIENT_SECRET_PREFIX = 'ocs_';
export const OAUTH_TOKEN_ENDPOINT_AUTH_METHODS = ['none', 'client_secret_basic', 'client_secret_post'] as const;
export type OAuthTokenEndpointAuthMethod = (typeof OAUTH_TOKEN_ENDPOINT_AUTH_METHODS)[number];

/** 注册实例来源：动态注册、管理员手工签发、客户端元数据文档（`client_id` 是 https URL）。 */
export type OAuthClientRegistrationMethod = 'dcr' | 'manual' | 'cimd';

export function isTokenEndpointAuthMethod(value: unknown): value is OAuthTokenEndpointAuthMethod {
	return typeof value === 'string' && (OAUTH_TOKEN_ENDPOINT_AUTH_METHODS as readonly string[]).includes(value);
}

/** 机密客户端：持有 `client_secret`，换令牌时必须出示。 */
export function isConfidentialAuthMethod(method: string | null | undefined): boolean {
	return method === 'client_secret_basic' || method === 'client_secret_post';
}

export function generateOAuthClientSecret(): string {
	return `${OAUTH_CLIENT_SECRET_PREFIX}${randomOAuthToken(32)}`;
}

/** `client_secret` 只存哈希；比较走定长时间。 */
export async function verifyOAuthClientSecret(secret: string, hash: string | null): Promise<boolean> {
	if (!secret || !hash) return false;
	return timingSafeEqualString(await hashOAuthSecret(secret), hash);
}

/**
 * 解析 `Authorization: Basic …`（RFC 6749 §2.3.1：id 与 secret 先做 form-urlencode 再 base64）。
 * 不是 Basic 或格式非法返回 null；secret 可以为空串（公开客户端也会这样带上 client_id）。
 */
export function parseBasicClientCredentials(header: string | null | undefined): { clientId: string; clientSecret: string } | null {
	const match = /^Basic\s+([A-Za-z0-9+/=_-]+)\s*$/i.exec(header ?? '');
	if (!match) return null;
	let decoded: string;
	try {
		decoded = atob(match[1].replace(/-/g, '+').replace(/_/g, '/'));
	} catch {
		return null;
	}
	const colon = decoded.indexOf(':');
	if (colon <= 0) return null;
	const decode = (value: string) => {
		try {
			return decodeURIComponent(value.replace(/\+/g, ' '));
		} catch {
			return null;
		}
	};
	const clientId = decode(decoded.slice(0, colon));
	const clientSecret = decode(decoded.slice(colon + 1));
	if (!clientId || clientSecret === null) return null;
	return { clientId, clientSecret };
}

// ---------------------------------------------------------------------------
// 回调地址
// ---------------------------------------------------------------------------

/** 不能作为回调的协议：能执行脚本、读本地资源，或不是浏览器跳转能落地的协议。 */
const FORBIDDEN_REDIRECT_SCHEMES = new Set([
	'javascript:',
	'data:',
	'file:',
	'vbscript:',
	'blob:',
	'about:',
	'filesystem:',
	'ftp:',
	'ws:',
	'wss:',
	'mailto:',
	'tel:',
]);
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:$/;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);

function isLoopbackHost(hostname: string): boolean {
	return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

/** 协议与主机的组合是否可作回调：https；回环 http；或自定义协议（如 `cursor://`、`com.example.app:/`）。 */
function isAllowedRedirectScheme(url: URL): boolean {
	if (url.protocol === 'https:') return true;
	if (url.protocol === 'http:') return isLoopbackHost(url.hostname);
	return SCHEME_RE.test(url.protocol) && !FORBIDDEN_REDIRECT_SCHEMES.has(url.protocol);
}

function parseRedirectUrl(raw: string): URL | null {
	if (!raw || raw.includes('#')) return null;
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	if (url.username || url.password) return null;
	return isAllowedRedirectScheme(url) ? url : null;
}

/**
 * 客户端自报的回调地址（动态注册、元数据文档、授权请求里的 `redirect_uri`）：
 * https、回环 http（`localhost` / `127.0.0.1` / `[::1]`）或自定义协议；不含 fragment、凭据与通配符 `*`。
 */
export function isAcceptableRedirectUriShape(uri: string): boolean {
	if (uri.includes('*')) return false;
	return parseRedirectUrl(uri) !== null;
}

/**
 * 回环回调（RFC 8252 §7.3）的比较键：忽略端口，其余必须一致。
 * `localhost` 也算回环：RFC 8252 §8.3 不推荐，但 Claude Code、Gemini CLI 等命令行客户端普遍使用。
 */
function loopbackKey(uri: string): string | null {
	let url: URL;
	try {
		url = new URL(uri);
	} catch {
		return null;
	}
	if (url.protocol !== 'http:' || !isLoopbackHost(url.hostname)) return null;
	return `${url.hostname.toLowerCase()}${url.pathname}${url.search}`;
}

export function isLoopbackRedirectUri(uri: string): boolean {
	return loopbackKey(uri) !== null;
}

/** 两个具体回调地址是否等价：精确相同，或同为回环地址且仅端口不同。 */
export function redirectUrisMatch(candidate: string, registered: string): boolean {
	if (candidate === registered) return true;
	const a = loopbackKey(candidate);
	return a !== null && a === loopbackKey(registered);
}

/**
 * 管理员配置的回调规则（应用白名单、手工客户端）。在具体地址之外支持两种受控通配：
 * - 主机最左侧 `*.`（仅 https）：匹配一层或多层子域名，不匹配裸域；`*.` 后至少两段（`*.com` 无效）。
 *   通配主机不写路径时匹配任意路径（`https://*.example.com` 等同 `https://*.example.com/*`）。
 * - 路径末尾 `*`：按「路径 + 查询串」前缀匹配，如 `https://app.example.com/oauth/*`。
 * 回环 http 规则忽略端口。其它位置出现 `*` 无效。
 */
type RedirectUriRule = {
	scheme: string;
	host: string;
	hostWildcard: boolean;
	port: string;
	loopback: boolean;
	path: string;
	pathPrefix: boolean;
};

function parseRedirectUriRule(entry: string): RedirectUriRule | null {
	const raw = entry.trim();
	const url = parseRedirectUrl(raw);
	if (!url) return null;

	let host = url.hostname;
	const hostWildcard = host.startsWith('*.');
	if (hostWildcard) {
		host = host.slice(2);
		const labels = host.split('.');
		if (url.protocol !== 'https:' || labels.length < 2 || labels.some((label) => label === '')) return null;
	}
	if (host.includes('*')) return null;

	let path = `${url.pathname}${url.search}`;
	let pathPrefix = false;
	if (path.endsWith('*')) {
		path = path.slice(0, -1);
		pathPrefix = true;
	}
	if (path.includes('*')) return null;
	if (hostWildcard && !pathPrefix && !/^[a-z][a-z0-9+.-]*:\/\/[^/?]+[/?]/i.test(raw)) {
		pathPrefix = true;
		path = '/';
	}

	return {
		scheme: url.protocol,
		host,
		hostWildcard,
		port: url.port,
		loopback: url.protocol === 'http:' && isLoopbackHost(host),
		path,
		pathPrefix,
	};
}

/** 管理员填写的回调规则是否合法（具体地址或受控通配）。 */
export function isValidRedirectUriRule(entry: string): boolean {
	return parseRedirectUriRule(entry) !== null;
}

function ruleMatches(rule: RedirectUriRule, url: URL): boolean {
	if (url.protocol !== rule.scheme) return false;
	const host = rule.loopback ? url.hostname.toLowerCase() : url.hostname;
	if (rule.hostWildcard) {
		if (!host.endsWith(`.${rule.host}`)) return false;
	} else if (host !== rule.host) {
		return false;
	}
	if (!rule.loopback && url.port !== rule.port) return false;
	const target = `${url.pathname}${url.search}`;
	return rule.pathPrefix ? target.startsWith(rule.path) : target === rule.path;
}

/**
 * 具体回调地址命中规则列表的精确度：0 未命中，1 只命中通配规则，2 命中具体地址。
 * 应用归属按精确度排序，所以「通用本机客户端」这类通配应用可以安全地兜底。
 */
export function redirectUriMatchSpecificity(uri: string, rules: readonly string[]): number {
	if (!isAcceptableRedirectUriShape(uri)) return 0;
	const url = new URL(uri);
	let best = 0;
	for (const entry of rules) {
		const rule = parseRedirectUriRule(entry);
		if (!rule || !ruleMatches(rule, url)) continue;
		best = Math.max(best, rule.hostWildcard || rule.pathPrefix ? 1 : 2);
		if (best === 2) break;
	}
	return best;
}

export function isRedirectUriAllowed(uri: string, rules: readonly string[]): boolean {
	return redirectUriMatchSpecificity(uri, rules) > 0;
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

/** 启用应用的回调规则并集。 */
export function enabledAppRedirectUris(apps: readonly OAuthAppMatchInput[]): string[] {
	return [...new Set(apps.filter((app) => app.enabled).flatMap((app) => app.redirect_uris))];
}

/** 应用覆盖客户端全部回调时的精确度（取各回调中最低的一档）；有任一回调未覆盖返回 0。 */
function appCoverage(app: OAuthAppMatchInput, redirectUris: readonly string[]): number {
	let coverage = 2;
	for (const uri of redirectUris) {
		coverage = Math.min(coverage, redirectUriMatchSpecificity(uri, app.redirect_uris));
		if (coverage === 0) return 0;
	}
	return coverage;
}

/**
 * 按回调地址与客户端名称把注册实例归到应用：
 * - 只有一个启用应用覆盖全部回调：归它；
 * - 多个应用都覆盖（如 Codex 与豆包共用 `http://127.0.0.1/callback`）：名称命中 `client_name_patterns`（不区分大小写的子串）的优先；
 *   其次在没有名称规则的应用里取精确度最高且唯一的一个（具体地址优先于通配规则）；仍无法区分返回 null。
 */
export function matchOAuthApp(
	apps: readonly OAuthAppMatchInput[],
	client: { clientName: string; redirectUris: readonly string[] }
): string | null {
	if (client.redirectUris.length === 0) return null;
	const candidates = apps
		.filter((app) => app.enabled)
		.map((app) => ({ app, coverage: appCoverage(app, client.redirectUris) }))
		.filter((item) => item.coverage > 0);
	if (candidates.length === 0) return null;
	if (candidates.length === 1) return candidates[0].app.id;

	const mostSpecific = (items: typeof candidates) => {
		const top = Math.max(...items.map((item) => item.coverage));
		return items.filter((item) => item.coverage === top);
	};
	const name = client.clientName.toLowerCase();
	const byName = candidates.filter((item) =>
		item.app.client_name_patterns.some((pattern) => pattern.trim() !== '' && name.includes(pattern.trim().toLowerCase()))
	);
	if (byName.length > 0) return mostSpecific(byName)[0].app.id;
	const generic = candidates.filter((item) => item.app.client_name_patterns.length === 0);
	if (generic.length === 0) return null;
	const best = mostSpecific(generic);
	return best.length === 1 ? best[0].app.id : null;
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

export function buildOAuthAuthorizationServerMetadata(issuer: string, options: { clientIdMetadataDocuments?: boolean } = {}) {
	const endpoints = oauthServerEndpoints(issuer);
	return {
		issuer,
		authorization_endpoint: endpoints.authorization,
		token_endpoint: endpoints.token,
		registration_endpoint: endpoints.registration,
		revocation_endpoint: endpoints.revocation,
		response_types_supported: ['code'],
		response_modes_supported: ['query'],
		grant_types_supported: ['authorization_code', 'refresh_token'],
		code_challenge_methods_supported: ['S256'],
		token_endpoint_auth_methods_supported: [...OAUTH_TOKEN_ENDPOINT_AUTH_METHODS],
		revocation_endpoint_auth_methods_supported: [...OAUTH_TOKEN_ENDPOINT_AUTH_METHODS],
		scopes_supported: [OAUTH_SERVER_SCOPE],
		authorization_response_iss_parameter_supported: true,
		client_id_metadata_document_supported: options.clientIdMetadataDocuments === true,
	};
}

// ---------------------------------------------------------------------------
// 授权参数校验（OAuth 2.1：client_id / redirect_uri 不可信时不得重定向）
// ---------------------------------------------------------------------------

export type OAuthClientForAuthorize = {
	client_id: string;
	/** 动态注册 / 元数据文档：具体地址；手工客户端：回调规则（可含通配），为空表示沿用所属应用的白名单。 */
	redirect_uris: string[];
	app_id: string | null;
	registration_method?: string;
	token_endpoint_auth_method?: string;
};

export type AuthorizeParams = {
	clientId: string;
	redirectUri: string;
	/** 机密客户端可以不带 PKCE，此时为空串，换令牌时改由 client_secret 保证。 */
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
	const client = input.client;
	const registered =
		client.registration_method === 'manual'
			? client.redirect_uris.length === 0 || isRedirectUriAllowed(redirectUri ?? '', client.redirect_uris)
			: client.redirect_uris.some((uri) => redirectUrisMatch(redirectUri ?? '', uri));
	if (!redirectUri || !registered) {
		return fail('invalid_request', 'redirect_uri is not registered for this client', false);
	}
	if (!isRedirectUriAllowed(redirectUri, input.allowedRedirectUris)) {
		return fail('invalid_request', 'redirect_uri is not enabled in the server callback allowlist', false);
	}
	if (get('response_type') !== 'code') {
		return fail('unsupported_response_type', 'response_type must be "code"');
	}
	const codeChallenge = get('code_challenge')?.trim() ?? '';
	const pkceOptional = isConfidentialAuthMethod(client.token_endpoint_auth_method);
	if (codeChallenge || !pkceOptional) {
		if (!codeChallenge || get('code_challenge_method') !== 'S256' || !isValidCodeChallenge(codeChallenge)) {
			return fail('invalid_request', 'PKCE with code_challenge_method=S256 is required');
		}
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
