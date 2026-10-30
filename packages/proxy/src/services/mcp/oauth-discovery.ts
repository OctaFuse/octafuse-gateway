/**
 * MCP OAuth 发现（RFC 9728）：Gateway 作为资源服务器，只声明授权服务器在哪里。
 * 开关：`system_config.MCP_OAUTH_AUTHORIZATION_SERVER` 非空（见 core `mcp-oauth-system-config`）。
 */
import type { GatewayRepositories } from '@octafuse/core';
import {
	MCP_OAUTH_AUTHORIZATION_SERVER_KEY,
	buildProtectedResourceMetadata,
	normalizeMcpOAuthAuthorizationServer,
	protectedResourceMetadataUrl,
} from '@octafuse/core';

type RequestLike = { req: { header: (name: string) => string | undefined; url: string } };

/** 对外 origin：优先反向代理头，其次请求 URL。 */
export function publicOrigin(c: RequestLike): string {
	const url = new URL(c.req.url);
	const proto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() || url.protocol.replace(':', '');
	const host = c.req.header('x-forwarded-host')?.split(',')[0]?.trim() || c.req.header('host') || url.host;
	return `${proto}://${host}`;
}

/** 已配置且合法的授权服务器 origin；未配置返回 null。 */
export async function readMcpOAuthAuthorizationServer(repos: GatewayRepositories): Promise<string | null> {
	const raw = await repos.systemConfig.getConfig(MCP_OAUTH_AUTHORIZATION_SERVER_KEY);
	const normalized = normalizeMcpOAuthAuthorizationServer(raw);
	return normalized ? normalized : null;
}

/**
 * `/mcp*` 401 时附带的 `WWW-Authenticate`。
 * `invalidToken`：凭证已过期 / 被撤销时带 `error="invalid_token"`，客户端据此刷新令牌（RFC 6750 §3.1）。
 * 未开启 OAuth 发现且没有 `invalidToken` 时返回空对象。
 */
export async function mcpUnauthorizedHeaders(
	c: RequestLike & { req: { path: string } },
	repos: GatewayRepositories,
	options: { invalidToken?: boolean } = {}
): Promise<Record<string, string>> {
	const path = c.req.path;
	if (path !== '/mcp' && !path.startsWith('/mcp/')) return {};
	let server: string | null = null;
	try {
		server = await readMcpOAuthAuthorizationServer(repos);
	} catch (err) {
		console.warn('[Gateway MCP] failed to read MCP_OAUTH_AUTHORIZATION_SERVER', err);
	}
	const params: string[] = [];
	if (options.invalidToken) params.push('error="invalid_token"');
	if (server) params.push(`resource_metadata="${protectedResourceMetadataUrl(publicOrigin(c), path)}"`);
	if (params.length === 0) return {};
	return { 'WWW-Authenticate': `Bearer ${params.join(', ')}` };
}

export { buildProtectedResourceMetadata };
