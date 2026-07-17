/**
 * 用户 API 鉴权中间件：从多种客户端约定位置提取 sk，校验后写入 `c.set('apiKey', …)`。
 * 预算在「大部分路由」上于此拦截；`/v1/chat/completions` 等在具体路由内结合模型 free 通道再判断。
 */
import { createMiddleware } from 'hono/factory';
import { authenticateApiKey } from '../services/api-key-auth';
import type { Env } from '../app';

/** 与 `authenticateApiKey` 结果一致，供 `/v1/*` 处理器使用。 */
export type ApiKeyContext = {
  /** `api_keys.id` */
  keyId: string;
  userId: string;
  userEmail: string | null;
  budgetMax: number | null;
  budgetSpent: number;
  budgetPeriod: string;
  budgetResetAt: string | null;
  metadata: Record<string, unknown> | null;
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
    return c.json({ error: 'Missing or invalid API key' }, 401);
  }

  const repos = c.get('repositories');
  const authResult = await authenticateApiKey(repos, key);
  if (!authResult) {
    console.warn(`[Gateway Auth] 401 API key not found keyPrefix=${maskKey(key)}`);
    return c.json({ error: 'Invalid API key' }, 401);
  }
  console.log(`[Gateway Auth] key valid keyId=${authResult.keyId} userId=${authResult.userId}`);

  // Allow GET /v1/me (key info) even when budget is 0 or exceeded, so clients can show budget state
  const isKeyInfoRoute = c.req.method === 'GET' && c.req.path.endsWith('/me');
  // Allow GET /v1/models even when budget is exceeded (just lists available models, no resource consumption)
  const isModelsRoute = c.req.method === 'GET' && c.req.path.endsWith('/models');
  // Budget check for chat / images is done in route after resolving model (and image pre-estimate)
  const isChatRoute = c.req.method === 'POST' && c.req.path.endsWith('/chat/completions');
  const isImagesRoute =
    c.req.method === 'POST' &&
    (c.req.path.endsWith('/images/generations') || c.req.path.endsWith('/images/edits'));
  if (
    !isKeyInfoRoute &&
    !isModelsRoute &&
    !isChatRoute &&
    !isImagesRoute &&
    authResult.budgetMax != null &&
    authResult.budgetSpent >= authResult.budgetMax
  ) {
    return c.json({ error: 'Budget exceeded' }, 403);
  }

  c.set('apiKey', {
    keyId: authResult.keyId,
    userId: authResult.userId,
    userEmail: authResult.userEmail,
    budgetMax: authResult.budgetMax,
    budgetSpent: authResult.budgetSpent,
    budgetPeriod: authResult.budgetPeriod,
    budgetResetAt: authResult.budgetResetAt,
    metadata: authResult.metadata,
  });
  await next();
});
