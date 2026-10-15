/** Copy-paste samples for connecting an external agent to the Proxy MCP endpoint. */
export const MCP_KEY_PLACEHOLDER = '<YOUR_API_KEY>';
export const MCP_KEY_ENV_NAME = 'OCTAFUSE_API_KEY';

export type McpConnectClient = 'cursor' | 'vscode' | 'claude-code' | 'codex' | 'curl';
export const MCP_CONNECT_CLIENTS: readonly McpConnectClient[] = ['cursor', 'vscode', 'claude-code', 'codex', 'curl'];

export type McpConnectSnippet = {
	client: McpConnectClient;
	/** Where the sample goes: a config file path or "terminal". */
	target: string;
	language: 'json' | 'toml' | 'bash';
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
