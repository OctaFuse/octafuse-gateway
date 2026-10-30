/** Copy-paste samples for connecting an external agent to the Proxy MCP endpoint. */
import { MCP_CATALOG_PROXY_STORAGE, SIMULATOR_PROXY_STORAGE, mcpProxyBaseUrl } from './mcp-catalog-test-utils';

export function readSavedMcpProxyUrl(): string {
	// The Admin and Proxy can use different origins; never infer the Proxy from the Admin in production.
	if (typeof window === 'undefined') return '';
	try {
		const saved = localStorage.getItem(MCP_CATALOG_PROXY_STORAGE) || localStorage.getItem(SIMULATOR_PROXY_STORAGE);
		if (saved && mcpProxyBaseUrl(saved)) return saved;
	} catch {
		/* Storage can be unavailable in private contexts. */
	}
	if (['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) {
		const local = new URL(window.location.origin);
		local.port = '8787';
		return local.origin;
	}
	return '';
}

export const MCP_KEY_PLACEHOLDER = '<YOUR_API_KEY>';
export const MCP_KEY_ENV_NAME = 'OCTAFUSE_API_KEY';

export type McpConnectClient = 'chatgpt' | 'cursor' | 'vscode' | 'claude-code' | 'codex' | 'curl';
/** API Key samples: clients that let you set a request header or env var. */
export const MCP_CONNECT_CLIENTS: readonly McpConnectClient[] = ['cursor', 'vscode', 'claude-code', 'codex', 'curl'];
/** OAuth samples: no key anywhere; ChatGPT connectors only work this way. */
export const MCP_OAUTH_CONNECT_CLIENTS: readonly McpConnectClient[] = [
	'chatgpt',
	'cursor',
	'vscode',
	'claude-code',
	'codex',
	'curl',
];

/** `terminal` = shell command, `ui` = type it into the client's own UI, otherwise a config file path. */
export type McpConnectSnippet = {
	client: McpConnectClient;
	target: string;
	language: 'json' | 'toml' | 'bash' | 'text';
	code: string;
};

/** `/mcp` or `/mcp/{slug}` on top of the Proxy base URL (base URL has no trailing slash). */
export function mcpConnectEndpoint(baseUrl: string, slug: string): string {
	return `${baseUrl}/mcp${slug ? `/${encodeURIComponent(slug)}` : ''}`;
}

/** Key name used in the client config; keeps scoped services distinguishable. */
export function mcpConnectServerName(slug: string): string {
	return slug ? `octafuse-${slug}` : 'octafuse';
}

const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
const json = (value: unknown) => JSON.stringify(value, null, 2);

export function buildMcpConnectSnippets(input: { baseUrl: string; slug: string }): McpConnectSnippet[] {
	const url = mcpConnectEndpoint(input.baseUrl, input.slug);
	const name = mcpConnectServerName(input.slug);
	const bearer = `Bearer ${MCP_KEY_PLACEHOLDER}`;
	const probe = {
		jsonrpc: '2.0',
		id: 1,
		method: 'tools/list',
		params: {},
	};
	return [
		{
			client: 'cursor',
			target: '~/.cursor/mcp.json',
			language: 'json',
			code: json({ mcpServers: { [name]: { url, headers: { Authorization: bearer } } } }),
		},
		{
			client: 'vscode',
			target: '.vscode/mcp.json',
			language: 'json',
			code: json({ servers: { [name]: { type: 'http', url, headers: { Authorization: bearer } } } }),
		},
		{
			client: 'claude-code',
			target: 'terminal',
			language: 'bash',
			code: `claude mcp add --transport http ${name} ${quote(url)} \\\n  --header ${quote(`Authorization: ${bearer}`)}`,
		},
		{
			client: 'codex',
			target: '~/.codex/config.toml',
			language: 'toml',
			code: [
				// Slugs are [a-z0-9-], valid as TOML bare keys.
				`[mcp_servers.${name}]`,
				`url = ${JSON.stringify(url)}`,
				`bearer_token_env_var = ${JSON.stringify(MCP_KEY_ENV_NAME)}`,
				'',
				`# export ${MCP_KEY_ENV_NAME}=${MCP_KEY_PLACEHOLDER}`,
			].join('\n'),
		},
		{
			client: 'curl',
			target: 'terminal',
			language: 'bash',
			code: [
				`curl -X POST ${quote(url)}`,
				`  -H 'Content-Type: application/json'`,
				`  -H 'Accept: application/json, text/event-stream'`,
				`  -H ${quote(`Authorization: ${bearer}`)}`,
				`  --data-raw ${quote(JSON.stringify(probe))}`,
			].join(' \\\n'),
		},
	];
}

/**
 * Samples for the OAuth path: the client only needs the MCP URL and discovers the authorization
 * server from the 401 response, so none of them carries a key or header.
 */
export function buildMcpOAuthSnippets(input: { baseUrl: string; slug: string }): McpConnectSnippet[] {
	const url = mcpConnectEndpoint(input.baseUrl, input.slug);
	const name = mcpConnectServerName(input.slug);
	const probe = {
		jsonrpc: '2.0',
		id: 1,
		method: 'tools/list',
		params: {},
	};
	return [
		{ client: 'chatgpt', target: 'ui', language: 'text', code: url },
		{
			client: 'cursor',
			target: '~/.cursor/mcp.json',
			language: 'json',
			code: json({ mcpServers: { [name]: { url } } }),
		},
		{
			client: 'vscode',
			target: '.vscode/mcp.json',
			language: 'json',
			code: json({ servers: { [name]: { type: 'http', url } } }),
		},
		{
			client: 'claude-code',
			target: 'terminal',
			language: 'bash',
			code: [`claude mcp add --transport http ${name} ${quote(url)}`, '', '# then run /mcp inside Claude Code to sign in'].join(
				'\n'
			),
		},
		{
			client: 'codex',
			target: '~/.codex/config.toml',
			language: 'toml',
			code: [`[mcp_servers.${name}]`, `url = ${JSON.stringify(url)}`, '', `# codex mcp login ${name}`].join('\n'),
		},
		{
			client: 'curl',
			target: 'terminal',
			language: 'bash',
			code: [
				`curl -i -X POST ${quote(url)}`,
				`  -H 'Content-Type: application/json'`,
				`  -H 'Accept: application/json, text/event-stream'`,
				`  --data-raw ${quote(JSON.stringify(probe))}`,
			].join(' \\\n'),
		},
	];
}
