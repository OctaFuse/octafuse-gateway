import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ADMIN_NAV_GROUPS, formatAdminDocumentTitle, matchAdminNavRoute } from './admin-nav';

describe('matchAdminNavRoute', () => {
	it('matches exact sidebar paths', () => {
		assert.equal(matchAdminNavRoute('/gateway/simulator')?.nameKey, 'simulator');
		assert.equal(matchAdminNavRoute('/dashboard')?.nameKey, 'dashboard');
	});

	it('prefers the longest href so nested tools pages win', () => {
		assert.equal(matchAdminNavRoute('/gateway/tools')?.nameKey, 'toolsConfig');
		assert.equal(matchAdminNavRoute('/gateway/tools/invocations')?.nameKey, 'toolInvocations');
		assert.equal(matchAdminNavRoute('/gateway/mcp')?.nameKey, 'mcpServers');
	});

	it('lists REST services, then MCP servers, then invocations', () => {
		const tools = ADMIN_NAV_GROUPS.find((group) => group.groupKey === 'tools');
		assert.deepEqual(
			tools?.items.map((item) => item.nameKey),
			['toolsConfig', 'mcpServers', 'toolInvocations'],
		);
	});

	it('groups integration keys with Config and nests maintenance under Config', () => {
		const system = ADMIN_NAV_GROUPS.find((group) => group.groupKey === 'system');
		assert.deepEqual(
			system?.items.map((item) => item.nameKey),
			['config', 'adminApiKeys'],
		);
		assert.equal(matchAdminNavRoute('/gateway/maintenance')?.nameKey, 'config');
		assert.equal(matchAdminNavRoute('/gateway/config')?.nameKey, 'config');
		assert.equal(matchAdminNavRoute('/gateway/config#config-panel-maintenance')?.nameKey, 'config');
		assert.equal(ADMIN_NAV_GROUPS.some((group) => group.items.some((item) => item.nameKey === 'maintenance')), false);
		assert.equal(matchAdminNavRoute('/gateway/admin-api-keys')?.nameKey, 'adminApiKeys');
	});

	it('treats user detail as Users', () => {
		assert.equal(matchAdminNavRoute('/gateway/users/abc-123')?.nameKey, 'users');
	});

	it('does not confuse analytics users with the Users page', () => {
		assert.equal(matchAdminNavRoute('/gateway/analytics/users')?.nameKey, 'userUsage');
	});

	it('returns null for unknown paths', () => {
		assert.equal(matchAdminNavRoute('/'), null);
		assert.equal(matchAdminNavRoute('/unknown'), null);
	});
});

describe('formatAdminDocumentTitle', () => {
	it('puts the page function before the product title', () => {
		assert.equal(
			formatAdminDocumentTitle('Simulator', 'Octafuse Gateway · Admin'),
			'Simulator · Octafuse Gateway · Admin',
		);
	});

	it('falls back to the product title when the page is unknown', () => {
		assert.equal(formatAdminDocumentTitle(null, 'Octafuse Gateway · Admin'), 'Octafuse Gateway · Admin');
		assert.equal(formatAdminDocumentTitle('  ', 'Octafuse Gateway · Admin'), 'Octafuse Gateway · Admin');
	});
});
