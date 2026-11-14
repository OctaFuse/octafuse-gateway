/**
 * 内置 MCP OAuth 授权服务器的公开端点（仅 `MCP_OAUTH_ISSUER` 非空时启用，否则一律 404）：
 *
 * - `GET  /.well-known/oauth-authorization-server`  授权服务器元数据（RFC 8414）
 * - `POST /oauth/register`   动态客户端注册（RFC 7591），回调须命中某个启用应用
 * - `GET  /oauth/authorize`  校验参数、落授权请求，跳到同意页
 * - `POST /oauth/token`      授权码换令牌 / 刷新令牌轮换（刷新令牌重放视为泄露，整个授权被撤销）
 * - `POST /oauth/revoke`     撤销（RFC 7009），接受访问令牌或刷新令牌
 * - `GET|POST /oauth/consent` 内置确认页，见 `oauth-consent.ts`
 *
 * 全部为公开客户端（无 client secret），PKCE S256 必需。Gateway 不信任客户端自报的名称：
 * 它只用于归类展示，归属以回调地址为准。
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import {
	OAUTH_AUTHORIZATION_REQUEST_TTL_SECONDS,
	OAUTH_MAX_REDIRECT_URIS,
	OAUTH_REFRESH_TOKEN_TTL_SECONDS,
	OAUTH_SERVER_ACCESS_TOKEN_TTL_SECONDS,
	OAUTH_SERVER_SCOPE,
	OAUTH_UNUSED_CLIENT_RETENTION_DAYS,
	buildAuthorizeErrorRedirect,
	buildOAuthAuthorizationServerMetadata,
	consumeRateLimitLayers,
	generateOAuthAccessTokenSecret,
	generateOAuthClientId,
	generateRefreshToken,
	hashOAuthAccessToken,
	hashOAuthSecret,
	isAcceptableRedirectUriShape,
	isOAuthAccessTokenValue,
	isRefreshTokenValue,
	isValidCodeVerifier,
	matchOAuthApp,
	normalizeStringList,
	oauthAccessTokenHint,
	oauthAccessTokenStatus,
	randomOAuthToken,
	readMcpOAuthMode,
	sanitizeClientName,
	validateAuthorizeParams,
	verifyPkceS256,
	type GatewayRepositories,
	type McpOAuthMode,
} from '@octafuse/core';
import type { Env } from '../app';
import { publicOrigin } from '../services/mcp/oauth-discovery';

export const oauthServerRoutes = new Hono<Env>();
export const oauthServerMetadataRoutes = new Hono<Env>();

const MAX_BODY_BYTES = 16 * 1024;

type BuiltinMode = Extract<McpOAuthMode, { mode: 'builtin' }>;
type Ctx = Context<Env>;

const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

/** 来源 IP（反向代理头优先）。只用于尽力限流，不作安全判断。 */
export function requestClientIp(c: Ctx): string {
	const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
	return c.req.header('cf-connecting-ip')?.trim() || c.req.header('x-real-ip')?.trim() || forwarded || 'unknown';
}

async function rateLimited(c: Ctx, bucket: string, rpm: number): Promise<Response | null> {
	const { exceeded, retryAfterSeconds } = await consumeRateLimitLayers([
		{ subject: `oauth:${bucket}:${requestClientIp(c)}`, rpm },
	]);
	if (!exceeded) return null;
	return c.json(
		{ error: 'temporarily_unavailable', error_description: 'Too many requests' },
		429,
		{ ...NO_STORE, 'Retry-After': String(retryAfterSeconds) }
	);
}

function oauthError(c: Ctx, status: 400 | 401 | 403 | 404 | 429 | 503, error: string, description: string): Response {
	return c.json({ error, error_description: description }, status, NO_STORE);
}

/** 授权服务器关闭（或没有开启内置模式）时，所有端点表现为不存在。 */
async function requireBuiltin(c: Ctx): Promise<BuiltinMode | Response> {
	const mode = await readMcpOAuthMode(c.get('repositories'));
	if (mode.mode !== 'builtin') return c.json({ error: 'not_found' }, 404);
	return mode;
}

async function readBody(c: Ctx): Promise<Record<string, unknown> | Response> {
	const declared = Number(c.req.header('content-length') ?? 0);
	if (declared > MAX_BODY_BYTES) return oauthError(c, 400, 'invalid_request', 'Request body is too large');
	const contentType = (c.req.header('content-type') ?? '').toLowerCase();
	try {
		if (contentType.includes('application/json')) {
			const text = await c.req.text();
			if (text.length > MAX_BODY_BYTES) return oauthError(c, 400, 'invalid_request', 'Request body is too large');
			const parsed: unknown = JSON.parse(text);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
			return oauthError(c, 400, 'invalid_request', 'Body must be a JSON object');
		}
		const form = await c.req.parseBody();
		const out: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(form)) out[key] = typeof value === 'string' ? value : undefined;
		return out;
	} catch {
		return oauthError(c, 400, 'invalid_request', 'Malformed request body');
	}
}

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** 注册、授权请求时顺手清理：注册后从未使用的实例与过期授权请求。尽力而为，不影响请求。 */
async function maybeCleanup(repos: GatewayRepositories): Promise<void> {
	if (Math.random() >= 0.05) return;
	try {
		const now = Date.now();
		await repos.oauthServer.deleteUnusedClients(
			new Date(now - OAUTH_UNUSED_CLIENT_RETENTION_DAYS * 24 * 3600 * 1000).toISOString()
		);
		await repos.oauthServer.deleteExpiredRequests(new Date(now - 24 * 3600 * 1000).toISOString());
	} catch (error) {
		console.warn('[Gateway OAuth] cleanup failed', error);
	}
}

// ---------------------------------------------------------------------------
// 元数据
// ---------------------------------------------------------------------------

oauthServerMetadataRoutes.get('/', async (c) => {
	const mode = await requireBuiltin(c);
	if (mode instanceof Response) return mode;
	return c.json(buildOAuthAuthorizationServerMetadata(mode.issuer), 200, { 'Cache-Control': 'public, max-age=300' });
});

// ---------------------------------------------------------------------------
// 动态注册
// ---------------------------------------------------------------------------

oauthServerRoutes.post('/register', async (c) => {
	const mode = await requireBuiltin(c);
	if (mode instanceof Response) return mode;
	const limited = await rateLimited(c, 'register', 30);
	if (limited) return limited;
	const body = await readBody(c);
	if (body instanceof Response) return body;

	const redirectUris = normalizeStringList(body.redirect_uris, { max: OAUTH_MAX_REDIRECT_URIS, maxLength: 2000 });
	const invalidMeta = (description: string) => oauthError(c, 400, 'invalid_client_metadata', description);
	if (!redirectUris || redirectUris.length === 0) return invalidMeta('redirect_uris must be a non-empty array of strings');
	if (!redirectUris.every(isAcceptableRedirectUriShape)) {
		return oauthError(c, 400, 'invalid_redirect_uri', 'redirect_uris must be https URLs, loopback http URLs or custom schemes');
	}
	const method = str(body.token_endpoint_auth_method);
	if (method && method !== 'none') return invalidMeta('Only token_endpoint_auth_method "none" is supported');
	if (Array.isArray(body.grant_types)) {
		const allowed = ['authorization_code', 'refresh_token'];
		if (!body.grant_types.every((g) => typeof g === 'string' && allowed.includes(g))) {
			return invalidMeta('grant_types must be a subset of authorization_code, refresh_token');
		}
	}
	if (Array.isArray(body.response_types) && !body.response_types.every((t) => t === 'code')) {
		return invalidMeta('response_types must be ["code"]');
	}

	const repos = c.get('repositories');
	const clientName = sanitizeClientName(body.client_name);
	const apps = await repos.oauthServer.listApps();
	const appId = matchOAuthApp(apps, { clientName, redirectUris });
	if (!appId) {
		return oauthError(c, 400, 'invalid_redirect_uri', 'redirect_uris are not allowed by any enabled application');
	}
	const clientId = generateOAuthClientId();
	const nowIso = new Date().toISOString();
	await repos.oauthServer.insertClient({ clientId, appId, clientName, redirectUris, nowIso });
	void maybeCleanup(repos);
	return c.json(
		{
			client_id: clientId,
			client_id_issued_at: Math.floor(Date.parse(nowIso) / 1000),
			client_name: clientName,
			redirect_uris: redirectUris,
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			token_endpoint_auth_method: 'none',
			scope: OAUTH_SERVER_SCOPE,
		},
		201,
		NO_STORE
	);
});

// ---------------------------------------------------------------------------
// 授权
// ---------------------------------------------------------------------------

/** 注册实例当前生效的回调白名单：归属应用启用才有；应用被删后尝试按回调重新归类。 */
async function resolveClientApp(
	repos: GatewayRepositories,
	client: { client_id: string; client_name: string; app_id: string | null; redirect_uris: string[] }
) {
	if (client.app_id) {
		const app = await repos.oauthServer.getAppById(client.app_id);
		return app && app.enabled ? app : null;
	}
	const apps = await repos.oauthServer.listApps();
	const matched = matchOAuthApp(apps, { clientName: client.client_name, redirectUris: client.redirect_uris });
	if (!matched) return null;
	await repos.oauthServer.setClientApp(client.client_id, matched);
	await repos.oauthAccessTokens.assignApp(client.client_id, matched);
	return apps.find((a) => a.id === matched) ?? null;
}

oauthServerRoutes.get('/authorize', async (c) => {
	const mode = await requireBuiltin(c);
	if (mode instanceof Response) return mode;
	const limited = await rateLimited(c, 'authorize', 60);
	if (limited) return limited;

	const repos = c.get('repositories');
	const query = (name: string) => c.req.query(name);
	const clientId = str(query('client_id'));
	const client = clientId ? await repos.oauthServer.getClient(clientId) : null;
	const app = client ? await resolveClientApp(repos, client) : null;

	const validation = validateAuthorizeParams(query, {
		client: client ? { client_id: client.client_id, app_id: client.app_id, redirect_uris: client.redirect_uris } : null,
		allowedRedirectUris: client ? (app ? app.redirect_uris : null) : [],
		allowedResourceOrigins: [mode.issuer, publicOrigin(c)],
	});
	if (!validation.ok) {
		if (!validation.redirectable) {
			return c.json({ error: validation.error, error_description: validation.description }, 400, NO_STORE);
		}
		const redirectUri = str(query('redirect_uri'));
		return c.redirect(
			buildAuthorizeErrorRedirect(redirectUri, validation.error, validation.description, query('state') ?? null, mode.issuer),
			302
		);
	}

	const { params } = validation;
	const requestId = randomOAuthToken(32);
	const nowMs = Date.now();
	await repos.oauthServer.insertRequest({
		idHash: await hashOAuthSecret(requestId),
		clientId: params.clientId,
		redirectUri: params.redirectUri,
		codeChallenge: params.codeChallenge,
		resource: params.resource,
		state: params.state,
		scope: params.scope,
		expiresAt: new Date(nowMs + OAUTH_AUTHORIZATION_REQUEST_TTL_SECONDS * 1000).toISOString(),
		nowIso: new Date(nowMs).toISOString(),
	});
	void maybeCleanup(repos);

	const consent = new URL(mode.consentUrl ?? `${mode.issuer}/oauth/consent`);
	consent.searchParams.set('request_id', requestId);
	return c.redirect(consent.toString(), 302);
});

// ---------------------------------------------------------------------------
// 换令牌与刷新
// ---------------------------------------------------------------------------

async function issueTokenResponse(
	c: Ctx,
	body: { accessToken: string; refreshToken: string }
): Promise<Response> {
	return c.json(
		{
			access_token: body.accessToken,
			token_type: 'Bearer',
			expires_in: OAUTH_SERVER_ACCESS_TOKEN_TTL_SECONDS,
			refresh_token: body.refreshToken,
			scope: OAUTH_SERVER_SCOPE,
		},
		200,
		NO_STORE
	);
}

async function handleAuthorizationCodeGrant(
	c: Ctx,
	repos: GatewayRepositories,
	body: Record<string, unknown>
): Promise<Response> {
	const code = str(body.code);
	const verifier = str(body.code_verifier);
	const clientId = str(body.client_id);
	const redirectUri = str(body.redirect_uri);
	if (!code || !verifier || !clientId || !redirectUri) {
		return oauthError(c, 400, 'invalid_request', 'code, code_verifier, client_id and redirect_uri are required');
	}
	if (!isValidCodeVerifier(verifier)) return oauthError(c, 400, 'invalid_grant', 'Invalid code_verifier');

	const nowIso = new Date().toISOString();
	// 一次性：不论后续校验是否通过，授权码一经取出就作废。
	const request = await repos.oauthServer.consumeCode(await hashOAuthSecret(code), nowIso, `${nowIso}|${randomOAuthToken(12)}`);
	if (!request || !request.user_id) return oauthError(c, 400, 'invalid_grant', 'Invalid or expired authorization code');
	if (request.client_id !== clientId || !redirectUrisMatchExact(request.redirect_uri, redirectUri)) {
		return oauthError(c, 400, 'invalid_grant', 'Authorization code was issued to a different client or redirect_uri');
	}
	if (!(await verifyPkceS256(verifier, request.code_challenge))) {
		return oauthError(c, 400, 'invalid_grant', 'PKCE verification failed');
	}
	const resource = str(body.resource);
	if (request.resource && resource && request.resource !== resource) {
		return oauthError(c, 400, 'invalid_target', 'resource does not match the authorization request');
	}

	const client = await repos.oauthServer.getClient(clientId);
	const app = client ? await resolveClientApp(repos, client) : null;
	if (!client || !app) return oauthError(c, 400, 'invalid_grant', 'This application is not available');
	const user = await repos.users.getById(request.user_id);
	if (!user || user.status !== 'active') return oauthError(c, 400, 'invalid_grant', 'User is not available');

	const accessToken = generateOAuthAccessTokenSecret();
	const refreshToken = generateRefreshToken();
	const nowMs = Date.parse(nowIso);
	await repos.oauthAccessTokens.issue({
		id: crypto.randomUUID(),
		userId: user.id,
		clientId: client.client_id,
		clientName: client.client_name,
		tokenHash: await hashOAuthAccessToken(accessToken),
		tokenHint: oauthAccessTokenHint(accessToken),
		scopes: [OAUTH_SERVER_SCOPE],
		expiresAt: new Date(nowMs + OAUTH_SERVER_ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
		nowIso,
		appId: app.id,
		refresh: {
			hash: await hashOAuthSecret(refreshToken),
			expiresAt: new Date(nowMs + OAUTH_REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString(),
		},
	});
	await repos.oauthServer.touchClientAuthorized(client.client_id, nowIso);
	return issueTokenResponse(c, { accessToken, refreshToken });
}

/** 授权码绑定的回调地址要求逐字相同（RFC 6749 §4.1.3），不做回环端口放宽。 */
function redirectUrisMatchExact(a: string, b: string): boolean {
	return a === b;
}

async function handleRefreshGrant(c: Ctx, repos: GatewayRepositories, body: Record<string, unknown>): Promise<Response> {
	const refreshToken = str(body.refresh_token);
	const clientId = str(body.client_id);
	if (!refreshToken || !clientId) return oauthError(c, 400, 'invalid_request', 'refresh_token and client_id are required');
	if (!isRefreshTokenValue(refreshToken)) return oauthError(c, 400, 'invalid_grant', 'Invalid refresh token');

	const refreshHash = await hashOAuthSecret(refreshToken);
	const current = await repos.oauthAccessTokens.getByRefreshHash(refreshHash);
	const nowIso = new Date().toISOString();
	if (!current) {
		// 上一代刷新令牌再次出现 = 重放（令牌可能已泄露）：撤销整个授权。
		const replayed = await repos.oauthAccessTokens.getByPrevRefreshHash(refreshHash);
		if (replayed) await repos.oauthAccessTokens.revokeById(replayed.id, nowIso);
		return oauthError(c, 400, 'invalid_grant', 'Invalid refresh token');
	}
	if (current.client_id !== clientId) return oauthError(c, 400, 'invalid_grant', 'Refresh token belongs to a different client');
	const client = await repos.oauthServer.getClient(clientId);
	const app = client ? await resolveClientApp(repos, client) : null;
	if (!client || !app) return oauthError(c, 400, 'invalid_grant', 'This application is not available');
	const user = await repos.users.getById(current.user_id);
	if (!user || user.status !== 'active') return oauthError(c, 400, 'invalid_grant', 'User is not available');

	const accessToken = generateOAuthAccessTokenSecret();
	const newRefreshToken = generateRefreshToken();
	const nowMs = Date.parse(nowIso);
	const rotated = await repos.oauthAccessTokens.rotateByRefresh(refreshHash, {
		tokenHash: await hashOAuthAccessToken(accessToken),
		tokenHint: oauthAccessTokenHint(accessToken),
		expiresAt: new Date(nowMs + OAUTH_SERVER_ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
		newRefreshHash: await hashOAuthSecret(newRefreshToken),
		newRefreshExpiresAt: new Date(nowMs + OAUTH_REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString(),
		nowIso,
	});
	if (!rotated) return oauthError(c, 400, 'invalid_grant', 'Invalid or expired refresh token');
	return issueTokenResponse(c, { accessToken, refreshToken: newRefreshToken });
}

oauthServerRoutes.post('/token', async (c) => {
	const mode = await requireBuiltin(c);
	if (mode instanceof Response) return mode;
	const limited = await rateLimited(c, 'token', 120);
	if (limited) return limited;
	const body = await readBody(c);
	if (body instanceof Response) return body;
	const repos = c.get('repositories');
	const grantType = str(body.grant_type);
	if (grantType === 'authorization_code') return handleAuthorizationCodeGrant(c, repos, body);
	if (grantType === 'refresh_token') return handleRefreshGrant(c, repos, body);
	return oauthError(c, 400, 'unsupported_grant_type', 'grant_type must be authorization_code or refresh_token');
});

// ---------------------------------------------------------------------------
// 撤销
// ---------------------------------------------------------------------------

oauthServerRoutes.post('/revoke', async (c) => {
	const mode = await requireBuiltin(c);
	if (mode instanceof Response) return mode;
	const limited = await rateLimited(c, 'revoke', 60);
	if (limited) return limited;
	const body = await readBody(c);
	if (body instanceof Response) return body;
	const token = str(body.token);
	const clientId = str(body.client_id);
	if (!token) return oauthError(c, 400, 'invalid_request', 'token is required');

	const repos = c.get('repositories');
	const nowIso = new Date().toISOString();
	let row = null;
	if (isOAuthAccessTokenValue(token)) {
		row = await repos.oauthAccessTokens.getByHash(await hashOAuthAccessToken(token));
	} else if (isRefreshTokenValue(token)) {
		row = await repos.oauthAccessTokens.getByRefreshHash(await hashOAuthSecret(token));
	}
	// RFC 7009：令牌无效也返回 200，不泄露其是否存在；给了 client_id 则必须一致。
	if (row && (!clientId || row.client_id === clientId) && oauthAccessTokenStatus(row) !== 'revoked') {
		await repos.oauthAccessTokens.revokeById(row.id, nowIso);
	}
	return c.body(null, 200, NO_STORE);
});
