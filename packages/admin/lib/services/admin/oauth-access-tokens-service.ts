/**
 * 管理端：OAuth 访问令牌（`oat_`）。令牌由授权服务器（门户）代用户签发 / 轮换，
 * 明文只在签发与轮换的响应里出现一次，库里只有哈希。
 */
import {
	oauthAccessTokenExpiresAt,
	oauthAccessTokenHint,
	oauthAccessTokenStatus,
	coerceOAuthAccessTokenScopesInput,
	coerceOAuthAccessTokenTtlInput,
	generateOAuthAccessTokenSecret,
	hashOAuthAccessToken,
	type OAuthAccessTokenClientStat,
	type OAuthAccessTokenListRow,
	type OAuthAccessTokenRow,
	type OAuthAccessTokenStatus,
	type GatewayRepositories,
} from '@octafuse/core';
import { badRequest, notFound } from './errors';
import { resolveAdminUserId } from './users-service';

const MAX_TEXT = 200;
const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_CLEANUP_DAYS = 30;

export type OAuthAccessTokenPublic = OAuthAccessTokenRow & { status: OAuthAccessTokenStatus };
export type OAuthAccessTokenListItem = OAuthAccessTokenListRow & { status: OAuthAccessTokenStatus };

export type IssueOAuthAccessTokenInput = {
	client_id?: unknown;
	client_name?: unknown;
	scopes?: unknown;
	ttl_seconds?: unknown;
};

function withStatus<T extends OAuthAccessTokenRow>(row: T): T & { status: OAuthAccessTokenStatus } {
	return { ...row, status: oauthAccessTokenStatus(row) };
}

function requiredText(value: unknown, field: string): string {
	if (typeof value !== 'string' || !value.trim()) throw badRequest(`${field} is required`);
	const trimmed = value.trim();
	if (trimmed.length > MAX_TEXT) throw badRequest(`${field} is too long`);
	return trimmed;
}

function parseTtl(value: unknown): number {
	const parsed = coerceOAuthAccessTokenTtlInput(value);
	if (!parsed.ok) throw badRequest(parsed.message);
	return parsed.value;
}

/** 创建或轮换（同一用户 x 应用只保留一条有效授权）；返回一次性明文。 */
export async function issueOAuthAccessToken(
	repos: GatewayRepositories,
	rawUserId: string,
	input: IssueOAuthAccessTokenInput
): Promise<{ token: OAuthAccessTokenPublic; access_token: string; expires_in: number; rotated: boolean }> {
	const userId = await resolveAdminUserId(repos, rawUserId);
	const clientId = requiredText(input.client_id, 'client_id');
	const clientName = requiredText(input.client_name, 'client_name');
	const scopes = coerceOAuthAccessTokenScopesInput(input.scopes);
	if (!scopes.ok) throw badRequest(scopes.message);
	const ttlSeconds = parseTtl(input.ttl_seconds);

	const secret = generateOAuthAccessTokenSecret();
	const now = new Date();
	const { row, rotated } = await repos.oauthAccessTokens.issue({
		id: crypto.randomUUID(),
		userId,
		clientId,
		clientName,
		tokenHash: await hashOAuthAccessToken(secret),
		tokenHint: oauthAccessTokenHint(secret),
		scopes: scopes.value,
		expiresAt: oauthAccessTokenExpiresAt(ttlSeconds, now.getTime()),
		nowIso: now.toISOString(),
	});
	return { token: withStatus(row), access_token: secret, expires_in: ttlSeconds, rotated };
}

/** 轮换既有授权的令牌（刷新令牌换新访问令牌时用）；授权已撤销返回 404。 */
export async function rotateOAuthAccessToken(
	repos: GatewayRepositories,
	id: string,
	input: { ttl_seconds?: unknown }
): Promise<{ token: OAuthAccessTokenPublic; access_token: string; expires_in: number }> {
	const ttlSeconds = parseTtl(input.ttl_seconds);
	const secret = generateOAuthAccessTokenSecret();
	const now = new Date();
	const row = await repos.oauthAccessTokens.rotate(id, {
		tokenHash: await hashOAuthAccessToken(secret),
		tokenHint: oauthAccessTokenHint(secret),
		expiresAt: oauthAccessTokenExpiresAt(ttlSeconds, now.getTime()),
		nowIso: now.toISOString(),
	});
	if (!row) throw notFound('Access token not found');
	return { token: withStatus(row), access_token: secret, expires_in: ttlSeconds };
}

export type ListOAuthAccessTokensQuery = {
	page?: string | null;
	page_size?: string | null;
	client_id?: string | null;
	user_id?: string | null;
	email?: string | null;
	status?: string | null;
};

function positiveInt(value: string | null | undefined, fallback: number, max: number): number {
	const parsed = Number.parseInt(value ?? '', 10);
	if (!Number.isFinite(parsed) || parsed < 1) return fallback;
	return Math.min(parsed, max);
}

export async function listOAuthAccessTokens(
	repos: GatewayRepositories,
	query: ListOAuthAccessTokensQuery
): Promise<{ items: OAuthAccessTokenListItem[]; total: number; page: number; page_size: number }> {
	const status = query.status?.trim();
	if (status && status !== 'active' && status !== 'expired' && status !== 'revoked') {
		throw badRequest('status must be one of: active, expired, revoked');
	}
	const page = positiveInt(query.page, 1, Number.MAX_SAFE_INTEGER);
	const pageSize = positiveInt(query.page_size, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
	const { rows, total } = await repos.oauthAccessTokens.list({
		page,
		pageSize,
		clientId: query.client_id?.trim() || undefined,
		userId: query.user_id?.trim() || undefined,
		userEmail: query.email?.trim() || undefined,
		status: (status as OAuthAccessTokenStatus | undefined) || undefined,
		nowIso: new Date().toISOString(),
	});
	return { items: rows.map(withStatus), total, page, page_size: pageSize };
}

export async function listUserOAuthAccessTokens(
	repos: GatewayRepositories,
	rawUserId: string
): Promise<OAuthAccessTokenPublic[]> {
	const userId = await resolveAdminUserId(repos, rawUserId);
	return (await repos.oauthAccessTokens.listForUser(userId)).map(withStatus);
}

export async function getOAuthAccessTokenStats(repos: GatewayRepositories): Promise<OAuthAccessTokenClientStat[]> {
	return repos.oauthAccessTokens.statsByClient(new Date().toISOString());
}

export async function revokeOAuthAccessTokenById(repos: GatewayRepositories, id: string): Promise<void> {
	const revoked = await repos.oauthAccessTokens.revokeById(id, new Date().toISOString());
	if (!revoked) throw notFound('Access token not found');
}

/** 批量撤销：按 `client_id`（应用下全部授权）或 `token`（明文，RFC 7009）。 */
export async function revokeOAuthAccessTokensBy(
	repos: GatewayRepositories,
	input: { client_id?: unknown; token?: unknown }
): Promise<{ revoked: number; token_id?: string }> {
	const nowIso = new Date().toISOString();
	const hasClient = typeof input.client_id === 'string' && input.client_id.trim() !== '';
	const hasToken = typeof input.token === 'string' && input.token.trim() !== '';
	if (hasClient === hasToken) throw badRequest('Provide exactly one of client_id or token');
	if (hasClient) {
		const revoked = await repos.oauthAccessTokens.revokeByClient((input.client_id as string).trim(), nowIso);
		return { revoked };
	}
	const id = await repos.oauthAccessTokens.revokeByHash(await hashOAuthAccessToken((input.token as string).trim()), nowIso);
	return id ? { revoked: 1, token_id: id } : { revoked: 0 };
}

/** 清理撤销 / 过期超过 N 天（默认 30）的记录；刚过期的仍可能通过刷新续期，不会被删。 */
export async function cleanupOAuthAccessTokens(
	repos: GatewayRepositories,
	input: { older_than_days?: unknown }
): Promise<{ deleted: number }> {
	let days = DEFAULT_CLEANUP_DAYS;
	if (input.older_than_days !== undefined && input.older_than_days !== null) {
		if (
			typeof input.older_than_days !== 'number' ||
			!Number.isInteger(input.older_than_days) ||
			input.older_than_days < 1 ||
			input.older_than_days > 3650
		) {
			throw badRequest('older_than_days must be an integer between 1 and 3650');
		}
		days = input.older_than_days;
	}
	const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
	return { deleted: await repos.oauthAccessTokens.deleteStale(cutoff) };
}
