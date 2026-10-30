/**
 * MCP OAuth 发现：`system_config.MCP_OAUTH_AUTHORIZATION_SERVER`。
 * 填授权服务器（如门户）的 origin；非空即开启：`/mcp*` 在缺 Key / Key 无效时返回
 * `401 + WWW-Authenticate: Bearer resource_metadata=…`，并公开 `/.well-known/oauth-protected-resource`。
 * Gateway 不提供 OAuth 授权流程；向客户端公布授权服务器，由受信任的授权服务器经 Admin API 签发和轮换访问令牌。
 */

export const MCP_OAUTH_AUTHORIZATION_SERVER_KEY = 'MCP_OAUTH_AUTHORIZATION_SERVER';

/** 受保护资源元数据里声明的作用域。 */
export const MCP_OAUTH_SCOPE = 'mcp';

/**
 * 规范化授权服务器地址：只保留 origin。须 https；开发环境放行 http 的 localhost / 127.0.0.1 / [::1]。
 * 空串返回 `''`（表示关闭），非法返回 `null`。
 */
export function normalizeMcpOAuthAuthorizationServer(raw: string | null | undefined): string | null {
	const trimmed = (raw ?? '').trim();
	if (trimmed === '') return '';
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		return null;
	}
	if (url.username || url.password) return null;
	const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return null;
	return url.origin;
}

/** RFC 9728 受保护资源元数据的 well-known 路径（含 `/mcp[/slug]` 后缀形式）。 */
export const MCP_OAUTH_PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource';

/** 把 MCP 资源路径（`/mcp` 或 `/mcp/{slug}`）映射为对应元数据 URL。 */
export function protectedResourceMetadataUrl(origin: string, mcpPath: string): string {
	const suffix = mcpPath === '/mcp' || mcpPath === '/mcp/' ? '/mcp' : mcpPath.replace(/\/+$/, '');
	return `${origin}${MCP_OAUTH_PROTECTED_RESOURCE_PATH}${suffix}`;
}

export type McpProtectedResourceMetadata = {
	resource: string;
	authorization_servers: string[];
	scopes_supported: string[];
	bearer_methods_supported: string[];
	resource_name: string;
};

export function buildProtectedResourceMetadata(params: {
	origin: string;
	/** `/mcp` 或 `/mcp/{slug}`；根路径形式传 `/mcp` */
	mcpPath: string;
	authorizationServer: string;
}): McpProtectedResourceMetadata {
	const path = params.mcpPath.replace(/\/+$/, '') || '/mcp';
	return {
		resource: `${params.origin}${path}`,
		authorization_servers: [params.authorizationServer],
		scopes_supported: [MCP_OAUTH_SCOPE],
		bearer_methods_supported: ['header'],
		resource_name: 'OctaFuse MCP',
	};
}
