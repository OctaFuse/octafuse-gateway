/**
 * 管理端：内置 MCP OAuth 授权服务器。
 *
 * - 授权请求（给同意页用）：读取详情、用户同意 / 拒绝。同意页可以是门户，也可以是 Gateway 内置确认页。
 * - 应用目录：运维维护「应用 → 回调白名单」，注册实例（`client_id`）按回调地址与名称归到应用。
 * - 手工客户端：给不支持动态注册的平台签发固定 `client_id` + `client_secret`。
 * - 按应用统计 / 撤销，按用户撤销（封禁联动）。
 */
import {
	OAUTH_MAX_REDIRECT_URIS,
	acceptAuthorizationRequest,
	describeAuthorizationRequest,
	generateOAuthClientId,
	generateOAuthClientSecret,
	hashOAuthSecret,
	isValidRedirectUriRule,
	matchOAuthApp,
	normalizeStringList,
	rejectAuthorizationRequest,
	type AuthorizationServiceError,
	type GatewayRepositories,
	type OAuthAccessTokenAppStat,
	type OAuthAppRow,
	type OAuthClientListRow,
	type OAuthClientRow,
} from '@octafuse/core';
import { badRequest, conflict, notFound } from './errors';
import { resolveAdminUserId } from './users-service';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_NAME = 100;
const MAX_PATTERNS = 20;
const MAX_PATTERN_LENGTH = 100;
const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 20;
const REATTRIBUTE_LIMIT = 500;

/** 授权请求相关错误：同意页需要稳定的错误码，所以不走通用 `AdminServiceError`。 */
export class OAuthAuthorizationRequestError extends Error {
	status: number;
	code: string;
	constructor(error: AuthorizationServiceError) {
		super(error.message);
		this.name = 'OAuthAuthorizationRequestError';
		this.status = error.status;
		this.code = error.code;
	}
}

export function isOAuthAuthorizationRequestError(error: unknown): error is OAuthAuthorizationRequestError {
	return error instanceof OAuthAuthorizationRequestError;
}

export async function getAuthorizationRequest(repos: GatewayRepositories, id: string) {
	const result = await describeAuthorizationRequest(repos, id);
	if (!result.ok) throw new OAuthAuthorizationRequestError(result);
	return result.request;
}

/** 用户同意；`user_id` 沿用 `/admin/users/:id` 的路由 ID（UUID 或 外部系统:外部用户 ID）。 */
export async function acceptOAuthAuthorizationRequest(
	repos: GatewayRepositories,
	id: string,
	input: { user_id?: unknown }
): Promise<{ redirect_uri: string }> {
	if (typeof input.user_id !== 'string' || !input.user_id.trim()) throw badRequest('user_id is required');
	const userId = await resolveAdminUserId(repos, input.user_id.trim());
	const result = await acceptAuthorizationRequest(repos, id, userId);
	if (!result.ok) throw new OAuthAuthorizationRequestError(result);
	return { redirect_uri: result.redirect_uri };
}

export async function rejectOAuthAuthorizationRequest(repos: GatewayRepositories, id: string): Promise<{ redirect_uri: string }> {
	const result = await rejectAuthorizationRequest(repos, id);
	if (!result.ok) throw new OAuthAuthorizationRequestError(result);
	return { redirect_uri: result.redirect_uri };
}

// ---------------------------------------------------------------------------
// 应用目录
// ---------------------------------------------------------------------------

export type OAuthAppWithStats = OAuthAppRow & {
	client_count: number;
	user_count: number;
	active_count: number;
	live_count: number;
	total_count: number;
	last_used_at: string | null;
};

export type OAuthAppsOverview = {
	apps: OAuthAppWithStats[];
	/** 迁移前由外部授权服务器签发、没有归属应用的授权，按客户端名称成组。 */
	unattributed: OAuthAccessTokenAppStat[];
	unattributed_client_count: number;
};

export async function listOAuthApps(repos: GatewayRepositories): Promise<OAuthAppsOverview> {
	const [apps, stats, clientCounts] = await Promise.all([
		repos.oauthServer.listApps(),
		repos.oauthAccessTokens.statsByApp(new Date().toISOString()),
		repos.oauthServer.countClientsByApp(),
	]);
	const statByApp = new Map(stats.filter((s) => s.app_id).map((s) => [s.app_id as string, s]));
	const clientsByApp = new Map(clientCounts.map((c) => [c.app_id, c.client_count]));
	return {
		apps: apps.map((app) => {
			const stat = statByApp.get(app.id);
			return {
				...app,
				client_count: clientsByApp.get(app.id) ?? 0,
				user_count: stat?.user_count ?? 0,
				active_count: stat?.active_count ?? 0,
				live_count: stat?.live_count ?? 0,
				total_count: stat?.total_count ?? 0,
				last_used_at: stat?.last_used_at ?? null,
			};
		}),
		unattributed: stats.filter((s) => !s.app_id),
		unattributed_client_count: clientsByApp.get(null) ?? 0,
	};
}

function parseName(value: unknown): string {
	if (typeof value !== 'string' || !value.trim()) throw badRequest('name is required');
	const name = value.trim();
	if (name.length > MAX_NAME) throw badRequest('name is too long');
	return name;
}

/** 回调白名单规则：具体地址，或 `https://*.example.com`、`.../*` 这类受控通配（见 core `isValidRedirectUriRule`）。 */
function parseRedirectUris(value: unknown): string[] {
	const list = normalizeStringList(value, { max: OAUTH_MAX_REDIRECT_URIS * 3, maxLength: 2000 });
	if (!list) throw badRequest('redirect_uris must be an array of strings');
	const invalid = list.find((entry) => !isValidRedirectUriRule(entry));
	if (invalid) {
		throw badRequest(
			`Invalid redirect URI rule "${invalid}": use https URLs, loopback http URLs, custom schemes, ` +
				'https://*.domain wildcards or a trailing * for prefix matching'
		);
	}
	return list;
}

function parsePatterns(value: unknown): string[] {
	const list = normalizeStringList(value, { max: MAX_PATTERNS, maxLength: MAX_PATTERN_LENGTH });
	if (!list) throw badRequest('client_name_patterns must be an array of strings');
	return list;
}

/** 目录变化后，把还没有归属的注册实例重新归类（尽力而为）。 */
async function reattributeClients(repos: GatewayRepositories): Promise<void> {
	const apps = await repos.oauthServer.listApps();
	const clients = await repos.oauthServer.listUnattributedClients(REATTRIBUTE_LIMIT);
	for (const client of clients) {
		const appId = matchOAuthApp(apps, { clientName: client.client_name, redirectUris: client.redirect_uris });
		if (!appId) continue;
		await repos.oauthServer.setClientApp(client.client_id, appId);
		await repos.oauthAccessTokens.assignApp(client.client_id, appId);
	}
}

export async function createOAuthApp(
	repos: GatewayRepositories,
	input: { slug?: unknown; name?: unknown; redirect_uris?: unknown; client_name_patterns?: unknown; enabled?: unknown }
): Promise<OAuthAppRow> {
	const slug = typeof input.slug === 'string' ? input.slug.trim() : '';
	if (!SLUG_RE.test(slug)) throw badRequest('slug must be 1-40 chars of lowercase letters, digits and hyphens');
	const name = parseName(input.name);
	const redirectUris = parseRedirectUris(input.redirect_uris ?? []);
	const clientNamePatterns = parsePatterns(input.client_name_patterns ?? []);
	if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw badRequest('enabled must be a boolean');
	if (await repos.oauthServer.getAppBySlug(slug)) throw conflict('An application with this slug already exists');
	const row = await repos.oauthServer.insertApp({
		id: crypto.randomUUID(),
		slug,
		name,
		redirectUris,
		clientNamePatterns,
		enabled: input.enabled !== false,
		nowIso: new Date().toISOString(),
	});
	await reattributeClients(repos);
	return row;
}

export async function updateOAuthApp(
	repos: GatewayRepositories,
	id: string,
	input: { name?: unknown; redirect_uris?: unknown; client_name_patterns?: unknown; enabled?: unknown }
): Promise<OAuthAppRow> {
	const patch: { name?: string; redirectUris?: string[]; clientNamePatterns?: string[]; enabled?: boolean } = {};
	if (input.name !== undefined) patch.name = parseName(input.name);
	if (input.redirect_uris !== undefined) patch.redirectUris = parseRedirectUris(input.redirect_uris);
	if (input.client_name_patterns !== undefined) patch.clientNamePatterns = parsePatterns(input.client_name_patterns);
	if (input.enabled !== undefined) {
		if (typeof input.enabled !== 'boolean') throw badRequest('enabled must be a boolean');
		patch.enabled = input.enabled;
	}
	if (!(await repos.oauthServer.getAppById(id))) throw notFound('Application not found');
	const row = await repos.oauthServer.updateApp(id, patch, new Date().toISOString());
	if (!row) throw notFound('Application not found');
	if (patch.redirectUris || patch.clientNamePatterns || patch.enabled) await reattributeClients(repos);
	return row;
}

/**
 * 删除应用：先撤销它名下全部授权；手工签发的客户端随应用删除，其余注册实例解除归属，之后会因无法归类而被拒绝。
 */
export async function deleteOAuthApp(repos: GatewayRepositories, id: string): Promise<{ revoked: number }> {
	if (!(await repos.oauthServer.getAppById(id))) throw notFound('Application not found');
	const revoked = await repos.oauthAccessTokens.revokeWhere({ appId: id }, new Date().toISOString());
	await repos.oauthAccessTokens.clearApp(id);
	await repos.oauthServer.deleteApp(id);
	return { revoked };
}

/**
 * 撤销一个应用的全部授权。`id` 为 `none` 表示「未归属」，此时必须用 `client_name` 指定具体一组。
 */
export async function revokeOAuthAppGrants(
	repos: GatewayRepositories,
	id: string,
	input: { client_name?: unknown }
): Promise<{ revoked: number }> {
	const nowIso = new Date().toISOString();
	if (id === 'none') {
		if (typeof input.client_name !== 'string' || !input.client_name.trim()) {
			throw badRequest('client_name is required for unattributed grants');
		}
		return { revoked: await repos.oauthAccessTokens.revokeWhere({ appId: 'none', clientName: input.client_name }, nowIso) };
	}
	if (!(await repos.oauthServer.getAppById(id))) throw notFound('Application not found');
	return { revoked: await repos.oauthAccessTokens.revokeWhere({ appId: id }, nowIso) };
}

/** 撤销某用户全部授权（封禁联动、用户主动「退出所有应用」）。 */
export async function revokeUserOAuthGrants(repos: GatewayRepositories, rawUserId: string): Promise<{ revoked: number }> {
	const userId = await resolveAdminUserId(repos, rawUserId);
	return { revoked: await repos.oauthAccessTokens.revokeWhere({ userId }, new Date().toISOString()) };
}

// ---------------------------------------------------------------------------
// 注册实例（含运维签发的手工客户端）
// ---------------------------------------------------------------------------

/** 对外的注册实例：不返回 secret 哈希，只告诉调用方有没有设置 secret。 */
export type OAuthClientView<T extends OAuthClientRow = OAuthClientRow> = Omit<T, 'client_secret_hash'> & {
	has_client_secret: boolean;
};

function toClientView<T extends OAuthClientRow>(row: T): OAuthClientView<T> {
	const { client_secret_hash, ...rest } = row;
	return { ...rest, has_client_secret: Boolean(client_secret_hash) };
}

const REGISTRATION_METHODS = new Set(['dcr', 'manual', 'cimd']);

export async function listOAuthClients(
	repos: GatewayRepositories,
	query: { app_id?: string | null; registration_method?: string | null; page?: string | null; page_size?: string | null }
): Promise<{ items: OAuthClientView<OAuthClientListRow>[]; total: number; page: number; page_size: number }> {
	const page = Math.max(Number.parseInt(query.page ?? '', 10) || 1, 1);
	const pageSize = Math.min(Math.max(Number.parseInt(query.page_size ?? '', 10) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
	const registrationMethod = query.registration_method?.trim() || undefined;
	if (registrationMethod && !REGISTRATION_METHODS.has(registrationMethod)) {
		throw badRequest('registration_method must be dcr, manual or cimd');
	}
	const { rows, total } = await repos.oauthServer.listClients({
		appId: query.app_id?.trim() || undefined,
		registrationMethod,
		page,
		pageSize,
		nowIso: new Date().toISOString(),
	});
	return { items: rows.map(toClientView), total, page, page_size: pageSize };
}

/** 签发结果：`client_secret` 只在这一次返回，库里只存哈希。 */
export type IssuedOAuthClient = { client: OAuthClientView; client_secret: string };

function parseClientName(value: unknown, fallback: string): string {
	if (value === undefined || value === null || value === '') return fallback;
	return parseName(value);
}

async function requireManualClient(repos: GatewayRepositories, clientId: string): Promise<OAuthClientRow> {
	const client = await repos.oauthServer.getClient(clientId);
	if (!client) throw notFound('Client not found');
	if (client.registration_method !== 'manual') throw badRequest('Only manually issued clients can be changed here');
	return client;
}

/**
 * 为不支持动态注册的平台（如服务端托管的连接器）签发固定的 `client_id` + `client_secret`。
 * `redirect_uris` 为空表示沿用所属应用的回调白名单。
 */
export async function createManualOAuthClient(
	repos: GatewayRepositories,
	appId: string,
	input: { client_name?: unknown; redirect_uris?: unknown }
): Promise<IssuedOAuthClient> {
	const app = await repos.oauthServer.getAppById(appId);
	if (!app) throw notFound('Application not found');
	const clientName = parseClientName(input.client_name, app.name);
	const redirectUris = parseRedirectUris(input.redirect_uris ?? []);
	const secret = generateOAuthClientSecret();
	const row = await repos.oauthServer.insertClient({
		clientId: generateOAuthClientId(),
		appId: app.id,
		clientName,
		redirectUris,
		nowIso: new Date().toISOString(),
		registrationMethod: 'manual',
		tokenEndpointAuthMethod: 'client_secret_basic',
		clientSecretHash: await hashOAuthSecret(secret),
	});
	return { client: toClientView(row), client_secret: secret };
}

export async function updateManualOAuthClient(
	repos: GatewayRepositories,
	clientId: string,
	input: { client_name?: unknown; redirect_uris?: unknown }
): Promise<OAuthClientView> {
	await requireManualClient(repos, clientId);
	const patch: { clientName?: string; redirectUris?: string[] } = {};
	if (input.client_name !== undefined) patch.clientName = parseName(input.client_name);
	if (input.redirect_uris !== undefined) patch.redirectUris = parseRedirectUris(input.redirect_uris);
	const row = await repos.oauthServer.updateClient(clientId, patch);
	if (!row) throw notFound('Client not found');
	return toClientView(row);
}

/** 重置 secret：旧 secret 立即失效，已签发的授权不受影响（需要时另行撤销）。 */
export async function rotateManualOAuthClientSecret(repos: GatewayRepositories, clientId: string): Promise<IssuedOAuthClient> {
	await requireManualClient(repos, clientId);
	const secret = generateOAuthClientSecret();
	await repos.oauthServer.setClientSecret(clientId, { hash: await hashOAuthSecret(secret), authMethod: 'client_secret_basic' });
	const row = await repos.oauthServer.getClient(clientId);
	if (!row) throw notFound('Client not found');
	return { client: toClientView(row), client_secret: secret };
}

/** 删除手工客户端：先撤销它签发的全部授权。 */
export async function deleteManualOAuthClient(repos: GatewayRepositories, clientId: string): Promise<{ revoked: number }> {
	await requireManualClient(repos, clientId);
	const revoked = await repos.oauthAccessTokens.revokeByClient(clientId, new Date().toISOString());
	await repos.oauthServer.deleteClient(clientId);
	return { revoked };
}
