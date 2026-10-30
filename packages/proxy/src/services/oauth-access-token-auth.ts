/**
 * 访问令牌鉴权：`oat_` 按 SHA-256 哈希查 `oauth_access_tokens`，校验未撤销、未过期、用户存在，
 * 并与用户 Key 鉴权一致地触发预算周期懒重置。只用于 `/mcp*`。
 */
import {
	oauthAccessTokenStatus,
	hashOAuthAccessToken,
	persistLazyBudgetResetIfNeeded,
	roundGatewayMoney,
} from '@octafuse/core';
import type { ApiKeyRateLimit, GatewayRepositories } from '@octafuse/core';

export type AuthenticatedOAuthAccessToken = {
	/** `oauth_access_tokens.id` */
	oauthAccessTokenId: string;
	clientId: string;
	scopes: string[];
	userId: string;
	userEmail: string | null;
	budgetMax: number | null;
	budgetSpent: number;
	walletGranted: number;
	walletSpent: number;
	/** `users.rate_limit`；null = user layer unlimited */
	userRateLimit: ApiKeyRateLimit | null;
};

export type OAuthAccessTokenAuthResult =
	| { ok: true; token: AuthenticatedOAuthAccessToken }
	| { ok: false; reason: 'invalid' | 'expired' };

export async function authenticateOAuthAccessToken(
	repos: GatewayRepositories,
	secret: string,
	nowMs: number = Date.now()
): Promise<OAuthAccessTokenAuthResult> {
	const row = await repos.oauthAccessTokens.getByHash(await hashOAuthAccessToken(secret));
	if (!row) return { ok: false, reason: 'invalid' };
	if (oauthAccessTokenStatus(row, nowMs) !== 'active') return { ok: false, reason: 'expired' };

	const user = await repos.users.getById(row.user_id);
	if (!user) return { ok: false, reason: 'invalid' };

	let budgetSpent = user.budget_spent;
	let budgetMax = user.budget_max != null ? roundGatewayMoney(Number(user.budget_max)) : null;
	const lazy = await persistLazyBudgetResetIfNeeded(repos, {
		budgetRow: user,
		userId: user.id,
		expectedBudgetResetAt: user.budget_reset_at,
		apiKeyId: null,
		snapshotUserRow: user,
		kind: 'oauth_access_token_auth',
	});
	if (lazy.didPersist) {
		budgetSpent = lazy.budget_spent;
		budgetMax = lazy.budget_max;
	}

	// 最近使用时间只用于后台展示，失败不影响请求。
	await repos.oauthAccessTokens.touchLastUsed(row.id, nowMs).catch((err: unknown) => {
		console.warn('[Gateway Auth] access token touchLastUsed failed', err);
	});

	return {
		ok: true,
		token: {
			oauthAccessTokenId: row.id,
			clientId: row.client_id,
			scopes: row.scopes,
			userId: user.id,
			userEmail: user.email,
			budgetMax,
			budgetSpent: roundGatewayMoney(budgetSpent),
			walletGranted: roundGatewayMoney(Number(user.wallet_granted ?? 0)),
			walletSpent: roundGatewayMoney(Number(user.wallet_spent ?? 0)),
			userRateLimit: user.rate_limit ?? null,
		},
	};
}
