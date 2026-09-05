/**
 * 用户 API 鉴权中间件：从多种客户端约定位置提取 sk，校验后写入 `c.set('apiKey', …)`。
 * 预算在「大部分路由」上于此拦截；`/v1/chat/completions` 等在具体路由内结合模型 free 通道再判断。
 */
import { createMiddleware } from 'hono/factory';
import { authenticateApiKey } from '../services/api-key-auth';
import type { Env } from '../app';
import { GatewayErrorCode } from '../services/gateway-error-codes';
import { gatewayErrorJson } from '../services/gateway-error-response';
import type { ApiKeyRateLimit } from '@octafuse/core';
import { parseDashScopeRealtimeAuthProtocol } from '@octafuse/core/realtime-protocol';
import {
	consumeRateLimitLayers,
	currentRateWindowStartedAt,
	hasPositiveTotalBalance,
	keyRateLimitSubject,
	rateLimitRetryAfterSeconds,
	rateLimitRpmOf,
	resolveIngressHost,
	userRateLimitSubject,
} from '@octafuse/core';

/** 与 `authenticateApiKey` 结果一致，供 `/v1/*` 处理器使用。 */
export type ApiKeyContext = {
  /** `api_keys.id` */
  keyId: string;
  userId: string;
  userEmail: string | null;
  budgetMax: number | null;
  budgetSpent: number;
  walletGranted: number;
  walletSpent: number;
  budgetPeriod: string;
  budgetResetAt: string | null;
  metadata: Record<string, unknown> | null;
  chargedCostFactors: string | null;
  /** `api_keys.rate_limit`; null = unlimited */
  rateLimit: ApiKeyRateLimit | null;
  /** `users.rate_limit`; null = user layer unlimited */
  userRateLimit: ApiKeyRateLimit | null;
  /** Request Host (observe only) */
  ingressHost: string | null;
};

/** 日志中脱敏展示密钥前缀。 */
function maskKey(key: string): string {
  if (key.length <= 12) return '***';
  return `${key.slice(0, 8)}...${key.slice(-4)}`;
}

/**
 * 按路径兼容多 SDK：`Authorization: Bearer`、Anthropic `x-api-key`、Gemini 查询参数 `key` 或 `x-goog-api-key`。
 * @returns 明文 sk 或 null
 */
function extractApiKey(c: { req: { header: (name: string) => string | undefined; path: string; url: string } }): string | null {
  const auth = c.req.header('Authorization');
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (bearer) {
    return bearer;
  }

	// 浏览器 WebSocket 无法自定义 Authorization；实时入口从协商子协议读取 Key。
	if (c.req.path.startsWith('/v1/dashscope/realtime')) {
		const realtimeAuth = parseDashScopeRealtimeAuthProtocol(
			c.req.header('Sec-WebSocket-Protocol')
		);
		if (realtimeAuth) return realtimeAuth.apiKey;
	}

  const path = c.req.path;

  // Anthropic SDK commonly sends x-api-key.
  if (path.startsWith('/v1/messages')) {
    const anthropicKey = c.req.header('x-api-key')?.trim() ?? '';
    if (anthropicKey) {
      return anthropicKey;
    }
  }

  // Gemini SDK commonly sends API key in query string or x-goog-api-key.
  if (path.startsWith('/v1beta/')) {
    try {
      const url = new URL(c.req.url);
      const queryKey = url.searchParams.get('key')?.trim() ?? '';
      if (queryKey) {
        return queryKey;
      }
    } catch {
      // ignore URL parse errors and continue header fallback
    }
    const googHeaderKey = c.req.header('x-goog-api-key')?.trim() ?? '';
    if (googHeaderKey) {
      return googHeaderKey;
    }
  }

  return null;
}

/**
 * 校验 API Key 并注入上下文；未授权返回 401，超额预算返回 403（部分路由豁免，见内联注释）。
 */
export const requireApiKey = createMiddleware<Env>(async (c, next) => {
  const key = extractApiKey(c);
  if (!key) {
    console.warn('[Gateway Auth] 401: missing API key in supported auth locations');
    return gatewayErrorJson(c, {
      status: 401,
      code: GatewayErrorCode.authFailed,
      message: 'Missing or invalid API key',
    });
  }

  const repos = c.get('repositories');
  const authResult = await authenticateApiKey(repos, key);
  if (!authResult) {
    console.warn(`[Gateway Auth] 401 API key not found keyPrefix=${maskKey(key)}`);
    return gatewayErrorJson(c, {
      status: 401,
      code: GatewayErrorCode.authFailed,
      message: 'Invalid API key',
    });
  }
  console.log(`[Gateway Auth] key valid keyId=${authResult.keyId} userId=${authResult.userId}`);

  const ingressHost = resolveIngressHost(c.req.header('Host'), c.req.url);

  // Allow GET /v1/me even when budget is 0 or rate-limited, so clients can show key / budget state
  const isKeyInfoRoute = c.req.method === 'GET' && c.req.path.endsWith('/me');
  if (!isKeyInfoRoute) {
    const windowStartedAt = currentRateWindowStartedAt();
    const { exceeded } = await consumeRateLimitLayers(
      [
        { subject: keyRateLimitSubject(authResult.keyId), rpm: rateLimitRpmOf(authResult.rateLimit) },
        { subject: userRateLimitSubject(authResult.userId), rpm: rateLimitRpmOf(authResult.userRateLimit) },
      ],
      windowStartedAt
    );
    if (exceeded) {
      const retryAfter = String(rateLimitRetryAfterSeconds(windowStartedAt));
      return gatewayErrorJson(c, {
        status: 429,
        code: GatewayErrorCode.rateLimited,
        message: 'Rate limit exceeded',
        headers: { 'Retry-After': retryAfter },
      });
    }
  }

  // Allow GET /v1/models even when budget is exceeded (just lists available models, no resource consumption)
  const isModelsRoute = c.req.method === 'GET' && c.req.path.endsWith('/models');
  // Budget check for chat / images / audio is done in route after resolving model (and pre-estimate)
  const isChatRoute = c.req.method === 'POST' && c.req.path.endsWith('/chat/completions');
  const isImagesRoute =
    c.req.method === 'POST' &&
    (c.req.path.endsWith('/images/generations') || c.req.path.endsWith('/images/edits'));
  const isAudioRoute =
    c.req.method === 'POST' && c.req.path.endsWith('/audio/transcriptions');
  if (
    !isKeyInfoRoute &&
    !isModelsRoute &&
    !isChatRoute &&
    !isImagesRoute &&
    !isAudioRoute &&
    !hasPositiveTotalBalance(
      authResult.budgetMax,
      authResult.budgetSpent,
      authResult.walletGranted,
      authResult.walletSpent
    )
  ) {
    return gatewayErrorJson(c, {
      status: 403,
      code: GatewayErrorCode.budgetExceeded,
      message: 'Budget exceeded',
    });
  }

  c.set('apiKey', {
    keyId: authResult.keyId,
    userId: authResult.userId,
    userEmail: authResult.userEmail,
    budgetMax: authResult.budgetMax,
    budgetSpent: authResult.budgetSpent,
    walletGranted: authResult.walletGranted,
    walletSpent: authResult.walletSpent,
    budgetPeriod: authResult.budgetPeriod,
    budgetResetAt: authResult.budgetResetAt,
    metadata: authResult.metadata,
    chargedCostFactors: authResult.chargedCostFactors,
    rateLimit: authResult.rateLimit,
    userRateLimit: authResult.userRateLimit,
    ingressHost,
  });
  await next();
});
