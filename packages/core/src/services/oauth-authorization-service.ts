/**
 * 内置 OAuth 授权服务器的「授权请求」业务：读取请求详情、用户同意 / 拒绝。
 * Proxy 的内置确认页与 Admin API（外部同意页，如门户）共用这一份逻辑，保证两条路径的校验一致。
 * 谁来证明用户身份由调用方负责：这里只接收已确认的 Gateway 用户 id。
 */
import {
	MCP_OAUTH_AUTHORIZATION_SERVER_KEY,
	MCP_OAUTH_CONSENT_URL_KEY,
	MCP_OAUTH_ISSUER_KEY,
	resolveMcpOAuthMode,
	type McpOAuthMode,
} from '../lib/mcp-oauth-system-config';
import {
	OAUTH_AUTHORIZATION_CODE_TTL_SECONDS,
	buildAuthorizeErrorRedirect,
	buildAuthorizeSuccessRedirect,
	hashOAuthSecret,
	randomOAuthToken,
} from '../lib/oauth-server';
import type { GatewayRepositories } from '../storage/repositories-types';

type Repos = Pick<GatewayRepositories, 'systemConfig' | 'oauthServer' | 'users'>;

/** 读取当前 MCP OAuth 模式（三项 system_config）。 */
export async function readMcpOAuthMode(repos: Pick<GatewayRepositories, 'systemConfig'>): Promise<McpOAuthMode> {
	const [issuer, authorizationServer, consentUrl] = await Promise.all([
		repos.systemConfig.getConfig(MCP_OAUTH_ISSUER_KEY),
		repos.systemConfig.getConfig(MCP_OAUTH_AUTHORIZATION_SERVER_KEY),
		repos.systemConfig.getConfig(MCP_OAUTH_CONSENT_URL_KEY),
	]);
	return resolveMcpOAuthMode({ issuer, authorizationServer, consentUrl });
}

export type AuthorizationRequestStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'used';

export type AuthorizationRequestView = {
	id: string;
	status: AuthorizationRequestStatus;
	client_id: string;
	client_name: string;
	app_id: string | null;
	app_name: string | null;
	redirect_uri: string;
	scope: string;
	resource: string | null;
	expires_at: string;
};

export type AuthorizationServiceError = {
	ok: false;
	status: 400 | 403 | 404 | 409 | 503;
	code:
		| 'oauth_disabled'
		| 'request_not_found'
		| 'request_not_pending'
		| 'user_not_found'
		| 'app_unavailable';
	message: string;
};

const fail = (
	status: AuthorizationServiceError['status'],
	code: AuthorizationServiceError['code'],
	message: string
): AuthorizationServiceError => ({ ok: false, status, code, message });

function requestStatus(
	row: { decided_at: string | null; code_hash: string | null; used_at: string | null; expires_at: string },
	nowIso: string
): AuthorizationRequestStatus {
	if (row.used_at) return 'used';
	if (row.decided_at) return row.code_hash ? 'approved' : 'denied';
	return row.expires_at <= nowIso ? 'expired' : 'pending';
}

/** 请求 id 的哈希：库里只存哈希。 */
export function hashAuthorizationRequestId(id: string): Promise<string> {
	return hashOAuthSecret(id);
}

export async function describeAuthorizationRequest(
	repos: Repos,
	id: string,
	nowIso: string = new Date().toISOString()
): Promise<{ ok: true; request: AuthorizationRequestView } | AuthorizationServiceError> {
	const mode = await readMcpOAuthMode(repos);
	if (mode.mode !== 'builtin') return fail(503, 'oauth_disabled', 'Built-in OAuth authorization server is not enabled');
	const row = await repos.oauthServer.getRequest(await hashAuthorizationRequestId(id));
	if (!row) return fail(404, 'request_not_found', 'Authorization request not found');
	const client = await repos.oauthServer.getClient(row.client_id);
	if (!client) return fail(404, 'request_not_found', 'Authorization request not found');
	const app = client.app_id ? await repos.oauthServer.getAppById(client.app_id) : null;
	return {
		ok: true,
		request: {
			id,
			status: requestStatus(row, nowIso),
			client_id: client.client_id,
			client_name: client.client_name,
			app_id: app?.id ?? null,
			app_name: app?.name ?? null,
			redirect_uri: row.redirect_uri,
			scope: row.scope,
			resource: row.resource,
			expires_at: row.expires_at,
		},
	};
}

async function loadPendingRequest(repos: Repos, id: string, nowIso: string) {
	const mode = await readMcpOAuthMode(repos);
	if (mode.mode !== 'builtin') return fail(503, 'oauth_disabled', 'Built-in OAuth authorization server is not enabled');
	const idHash = await hashAuthorizationRequestId(id);
	const row = await repos.oauthServer.getRequest(idHash);
	if (!row) return fail(404, 'request_not_found', 'Authorization request not found');
	if (requestStatus(row, nowIso) !== 'pending') {
		return fail(409, 'request_not_pending', 'Authorization request has already been decided or has expired');
	}
	return { ok: true as const, mode, idHash, row };
}

/** 用户同意：写入授权码，返回带 `code` / `state` / `iss` 的回调地址。 */
export async function acceptAuthorizationRequest(
	repos: Repos,
	id: string,
	userId: string,
	nowIso: string = new Date().toISOString()
): Promise<{ ok: true; redirect_uri: string } | AuthorizationServiceError> {
	const loaded = await loadPendingRequest(repos, id, nowIso);
	if (!loaded.ok) return loaded;
	const { mode, idHash, row } = loaded;

	const user = await repos.users.getById(userId);
	if (!user || user.status !== 'active') return fail(403, 'user_not_found', 'User not found or not active');

	const client = await repos.oauthServer.getClient(row.client_id);
	const app = client?.app_id ? await repos.oauthServer.getAppById(client.app_id) : null;
	if (!client || !app || !app.enabled) return fail(403, 'app_unavailable', 'This application is not available');

	const code = randomOAuthToken(32);
	const approved = await repos.oauthServer.approveRequest(idHash, {
		userId: user.id,
		codeHash: await hashOAuthSecret(code),
		codeExpiresAt: new Date(Date.parse(nowIso) + OAUTH_AUTHORIZATION_CODE_TTL_SECONDS * 1000).toISOString(),
		nowIso,
	});
	if (!approved) return fail(409, 'request_not_pending', 'Authorization request has already been decided or has expired');
	return { ok: true, redirect_uri: buildAuthorizeSuccessRedirect(row.redirect_uri, code, row.state, mode.issuer) };
}

/** 用户拒绝：返回带 `error=access_denied` 的回调地址。 */
export async function rejectAuthorizationRequest(
	repos: Repos,
	id: string,
	nowIso: string = new Date().toISOString()
): Promise<{ ok: true; redirect_uri: string } | AuthorizationServiceError> {
	const loaded = await loadPendingRequest(repos, id, nowIso);
	if (!loaded.ok) return loaded;
	const { mode, idHash, row } = loaded;
	if (!(await repos.oauthServer.denyRequest(idHash, nowIso))) {
		return fail(409, 'request_not_pending', 'Authorization request has already been decided or has expired');
	}
	return {
		ok: true,
		redirect_uri: buildAuthorizeErrorRedirect(row.redirect_uri, 'access_denied', 'The user denied the request', row.state, mode.issuer),
	};
}
