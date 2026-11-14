import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mcpWorkspaceSearch, readMcpWorkspaceLocation } from './mcp-workspace-location';

describe('MCP workspace location', () => {
	it('restores a scoped service and its connection guide', () => {
		assert.deepEqual(readMcpWorkspaceLocation('?server=team-insight&view=access', ''), {
			server: 'team-insight',
			view: 'catalog',
			section: 'clients',
			scope: 'team-insight',
			auth: 'key',
		});
	});
	it('keeps legacy OAuth and token anchors in the client section', () => {
		for (const hash of ['#mcp-panel-clients', '#mcp-client-guide', '#mcp-oauth', '#oauth-access-tokens']) {
			assert.equal(readMcpWorkspaceLocation('?server=team&view=connection', hash).section, 'clients');
		}
	});
	it('falls back to the catalog for unknown views and empty service IDs', () => {
		assert.deepEqual(readMcpWorkspaceLocation('?server=%20%20&view=unknown', '#unrelated'), {
			server: null,
			view: 'catalog',
			section: 'services',
			scope: '',
			auth: 'key',
		});
	});
	it('updates service scope without dropping unrelated parameters', () => {
		assert.equal(
			mcpWorkspaceSearch('?keep=1&server=old&view=access', 'new-team', 'connection'),
			'?keep=1&server=new-team&view=connection'
		);
	});
	it('removes stale service and view parameters when the last service is removed', () => {
		assert.equal(mcpWorkspaceSearch('?server=old&view=access', null, 'catalog'), '');
		assert.equal(mcpWorkspaceSearch('?keep=1&server=old', null, 'catalog'), '?keep=1');
	});
	it('encodes service scope once and restores the same value', () => {
		const search = mcpWorkspaceSearch('', 'team-a', 'catalog', 'team-a', 'oauth');
		assert.deepEqual(readMcpWorkspaceLocation(search, '#mcp-client-guide'), { server: 'team-a', view: 'catalog', section: 'clients', scope: 'team-a', auth: 'oauth' });
		assert.equal(mcpWorkspaceSearch(search, 'team-a', 'catalog', 'team-a', 'oauth'), search);
	});
	it('keeps guide scope separate from the selected service and preserves it on roundtrip', () => {
		const search = mcpWorkspaceSearch('?keep=1', 'selected', 'connection', 'other', 'oauth');
		const restored = readMcpWorkspaceLocation(search, '#mcp-panel-clients');
		assert.equal(restored.server, 'selected');
		assert.equal(restored.scope, 'other');
		assert.equal(restored.auth, 'oauth');
		assert.equal(new URLSearchParams(search).get('keep'), '1');
	});
	it('clears guide query parameters when using the aggregate API Key guide', () => {
		assert.equal(mcpWorkspaceSearch('?scope=other&auth=oauth&keep=1', 'selected', 'catalog'), '?keep=1&server=selected');
	});
});
