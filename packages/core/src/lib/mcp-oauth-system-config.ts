/**
 * MCP OAuth 三种模式，由 `system_config` 决定（切换与回滚都只改配置）：
 * - 内置（builtin）：`MCP_OAUTH_ISSUER` 非空。Gateway 自己是授权服务器（`/oauth/*`），
 *   登录与同意由 `MCP_OAUTH_CONSENT_URL` 指向的外部页面完成，留空则用内置的 API Key 确认页。
 * - 外部授权服务器（external）：`MCP_OAUTH_AUTHORIZATION_SERVER` 非空且 `MCP_OAUTH_ISSUER` 为空。
 *   Gateway 只做资源服务器，向客户端公布外部授权服务器，由它经 Admin API 签发和轮换访问令牌。
 * - 关闭（off）：两者都为空。
 * 开启任一模式后，`/mcp*` 在缺 Key / Key 无效时返回
 * `401 + WWW-Authenticate: Bearer resource_metadata=…`，并公开 `/.well-known/oauth-protected-resource`。
 */

export const MCP_OAUTH_AUTHORIZATION_SERVER_KEY = 'MCP_OAUTH_AUTHORIZATION_SERVER';
/** 内置授权服务器的 issuer：Gateway 的公开 origin，必须显式配置，不从请求头推导。 */
export const MCP_OAUTH_ISSUER_KEY = 'MCP_OAUTH_ISSUER';
/** 外部同意页地址；留空使用内置 API Key 确认页。 */
export const MCP_OAUTH_CONSENT_URL_KEY = 'MCP_OAUTH_CONSENT_URL';

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

/** issuer 与授权服务器同样只保留 origin，规则一致。 */
export const normalizeMcpOAuthIssuer = normalizeMcpOAuthAuthorizationServer;

/**
 * 规范化外部同意页地址：须 https（开发环境放行 loopback 的 http），不含凭据与片段，保留路径。
 * 空串返回 `''`（使用内置页），非法返回 `null`。
 */
export function normalizeMcpOAuthConsentUrl(raw: string | null | undefined): string | null {
	const trimmed = (raw ?? '').trim();
	if (trimmed === '') return '';
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		return null;
	}
	if (url.username || url.password || url.hash) return null;
	const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return null;
	return url.toString();
}

export type McpOAuthMode =
	| { mode: 'off' }
	| { mode: 'external'; authorizationServer: string }
	| { mode: 'builtin'; issuer: string; consentUrl: string | null };

/** 由三项原始配置解析当前模式；内置优先于外部；非法值视为未配置。 */
export function resolveMcpOAuthMode(raw: {
	issuer?: string | null;
	authorizationServer?: string | null;
	consentUrl?: string | null;
}): McpOAuthMode {
	const issuer = normalizeMcpOAuthIssuer(raw.issuer);
	if (issuer) {
		const consentUrl = normalizeMcpOAuthConsentUrl(raw.consentUrl);
		return { mode: 'builtin', issuer, consentUrl: consentUrl ? consentUrl : null };
	}
	const authorizationServer = normalizeMcpOAuthAuthorizationServer(raw.authorizationServer);
	if (authorizationServer) return { mode: 'external', authorizationServer };
	return { mode: 'off' };
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
