export type McpWorkspaceView = 'catalog' | 'connection';
export type McpConnectAuth = 'key' | 'oauth';

const CLIENT_ANCHORS = ['#mcp-panel-clients', '#mcp-client-guide', '#mcp-oauth', '#oauth-access-tokens'];

export function readMcpWorkspaceLocation(search: string, hash: string) {
	const params = new URLSearchParams(search);
	const server = params.get('server')?.trim() || null;
	const legacyAccess = params.get('view') === 'access';
	return {
		server,
		view: (params.get('view') === 'connection' ? 'connection' : 'catalog') as McpWorkspaceView,
		section: (legacyAccess || CLIENT_ANCHORS.includes(hash) ? 'clients' : 'services') as 'services' | 'clients',
		scope: params.has('scope') ? params.get('scope')?.trim() ?? '' : legacyAccess ? server ?? '' : '',
		auth: (params.get('auth') === 'oauth' ? 'oauth' : 'key') as McpConnectAuth,
	};
}

export function mcpWorkspaceSearch(
	search: string,
	server: string | null,
	view: McpWorkspaceView,
	scope = '',
	auth: McpConnectAuth = 'key'
) {
	const params = new URLSearchParams(search);
	if (server) params.set('server', server);
	else params.delete('server');
	if (view === 'catalog') params.delete('view');
	else params.set('view', view);
	if (scope) params.set('scope', scope);
	else params.delete('scope');
	if (auth === 'oauth') params.set('auth', auth);
	else params.delete('auth');
	const query = params.toString();
	return query ? `?${query}` : '';
}
