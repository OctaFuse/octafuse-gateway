/**
 * `/mcp*` 鉴权：同时接受 `sk-` 用户 Key 与 `oat_` OAuth 访问令牌，统一成 `McpCaller`。
 * 用户 Key 沿用原有 RPM 与预算规则；访问令牌只受用户级限流，且只能走到这里。
 */
import { createMiddleware } from 'hono/factory';
import {
	consumeRateLimitLayers,
	isOAuthAccessTokenValue,
	isPathAllowedForOAuthAccessTokenScopes,
	keyRateLimitSubject,
	rateLimitRpmOf,
	resolveIngressHost,
	userRateLimitSubject,
} from '@octafuse/core';
import type { Env } from '../app';
import { authenticateOAuthAccessToken } from '../services/oauth-access-token-auth';
import { authenticateApiKey } from '../services/api-key-auth';
import { GatewayErrorCode } from '../services/gateway-error-codes';
import { gatewayErrorJson } from '../services/gateway-error-response';
import { mcpUnauthorizedHeaders } from '../services/mcp/oauth-discovery';
import { extractApiKey, maskKey, readJsonRpcMethod } from './auth';

/** MCP 调用方：计费与限流所需的最小集合；两类凭证二选一非空。 */
export type McpCaller = {
	userId: string;
	userEmail: string | null;
	budgetMax: number | null;
	budgetSpent: number;
	walletGranted: number;
	walletSpent: number;
	/** `sk-` 调用时的 `api_keys.id`；`oat_` 为 null */
	apiKeyId: string | null;
	/** `oat_` 调用时的 `oauth_access_tokens.id`；`sk-` 为 null */
	oauthAccessTokenId: string | null;
	ingressHost: string | null;
};

export type McpEnv = Env & { Variables: { mcpCaller: McpCaller } };

export const requireMcpCaller = createMiddleware<McpEnv>(async (c, next) => {
	const repos = c.get('repositories');
	const credential = extractApiKey(c);
	if (!credential) {
		console.warn('[Gateway MCP Auth] 401: missing credential');
		return gatewayErrorJson(c, {
			status: 401,
			code: GatewayErrorCode.authFailed,
			message: 'Missing or invalid credential',
			headers: await mcpUnauthorizedHeaders(c, repos),
		});
	}

	const ingressHost = resolveIngressHost(c.req.header('Host'), c.req.url);
	// 清单类请求（initialize / tools/list 等）不占 RPM，只有 tools/call 计数。
	// 必须在凭证校验通过之后再调用：它会读完整请求体，未认证请求不得触发。
	// JSON-RPC 批量数组一律拒绝：SDK 会逐条执行，单次限流计数拦不住（MCP 2025-06-18 已移除批量）。
	const inspectRpc = async (): Promise<{ counts: boolean; rejected: Response | null }> => {
		const { method, batch } = await readJsonRpcMethod(c);
		if (batch) {
			return {
				counts: false,
				rejected: gatewayErrorJson(c, {
					status: 400,
					code: GatewayErrorCode.invalidRequest,
					message: 'JSON-RPC batch requests are not supported',
				}),
			};
		}
		return { counts: method === 'tools/call', rejected: null };
	};

	if (isOAuthAccessTokenValue(credential)) {
		const result = await authenticateOAuthAccessToken(repos, credential);
		if (!result.ok) {
			console.warn(`[Gateway MCP Auth] 401 access token ${result.reason} prefix=${maskKey(credential)}`);
			return gatewayErrorJson(c, {
				status: 401,
				code: GatewayErrorCode.authFailed,
				message: result.reason === 'expired' ? 'Access token expired or revoked' : 'Invalid access token',
				headers: await mcpUnauthorizedHeaders(c, repos, { invalidToken: true }),
			});
		}
		const token = result.token;
		if (!isPathAllowedForOAuthAccessTokenScopes(token.scopes, c.req.path)) {
			return gatewayErrorJson(c, {
				status: 403,
				code: GatewayErrorCode.scopeDenied,
				message: 'This access token is not permitted to access this endpoint',
			});
		}
		const rpc = await inspectRpc();
		if (rpc.rejected) return rpc.rejected;
		if (rpc.counts) {
			const { exceeded, retryAfterSeconds } = await consumeRateLimitLayers([
				{ subject: userRateLimitSubject(token.userId), rpm: rateLimitRpmOf(token.userRateLimit) },
			]);
			if (exceeded) {
				return gatewayErrorJson(c, {
					status: 429,
					code: GatewayErrorCode.rateLimited,
					message: 'Rate limit exceeded',
					headers: { 'Retry-After': String(retryAfterSeconds) },
				});
			}
		}
		c.set('mcpCaller', {
			userId: token.userId,
			userEmail: token.userEmail,
			budgetMax: token.budgetMax,
			budgetSpent: token.budgetSpent,
			walletGranted: token.walletGranted,
			walletSpent: token.walletSpent,
			apiKeyId: null,
			oauthAccessTokenId: token.oauthAccessTokenId,
			ingressHost,
		});
		return next();
	}

	const authResult = await authenticateApiKey(repos, credential);
	if (!authResult) {
		console.warn(`[Gateway MCP Auth] 401 API key not found keyPrefix=${maskKey(credential)}`);
		return gatewayErrorJson(c, {
			status: 401,
			code: GatewayErrorCode.authFailed,
			message: 'Invalid API key',
			headers: await mcpUnauthorizedHeaders(c, repos),
		});
	}
	const rpc = await inspectRpc();
	if (rpc.rejected) return rpc.rejected;
	if (rpc.counts) {
		const { exceeded, retryAfterSeconds } = await consumeRateLimitLayers([
			{ subject: keyRateLimitSubject(authResult.keyId), rpm: rateLimitRpmOf(authResult.rateLimit) },
			{ subject: userRateLimitSubject(authResult.userId), rpm: rateLimitRpmOf(authResult.userRateLimit) },
		]);
		if (exceeded) {
			return gatewayErrorJson(c, {
				status: 429,
				code: GatewayErrorCode.rateLimited,
				message: 'Rate limit exceeded',
				headers: { 'Retry-After': String(retryAfterSeconds) },
			});
		}
	}
	c.set('mcpCaller', {
		userId: authResult.userId,
		userEmail: authResult.userEmail,
		budgetMax: authResult.budgetMax,
		budgetSpent: authResult.budgetSpent,
		walletGranted: authResult.walletGranted,
		walletSpent: authResult.walletSpent,
		apiKeyId: authResult.keyId,
		oauthAccessTokenId: null,
		ingressHost,
	});
	return next();
});
