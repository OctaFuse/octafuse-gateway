import assert from 'node:assert/strict';
import test from 'node:test';
import {
	hasAdminPermission,
	normalizeAdminPermissions,
	parseAdminPermissions,
	type AdminPrincipal,
} from '../../admin-principal';
import { getAdminAuthorizationDecision } from '../../admin-permissions';
import { prepareAdminConfigRows } from '../../admin-config-secrets';
import { authenticateAdminRequest, generateAdminApiKey, hashSessionToken, timingSafeEqualSecret } from '../../auth';

const routeWriter: AdminPrincipal = {
	type: 'api_key',
	id: 'admin_key:routes-bot',
	keyId: 'routes-bot',
	permissions: ['routes.write'],
};

test('write permission includes matching read but no unrelated permission', () => {
	assert.equal(hasAdminPermission(routeWriter, 'routes.read'), true);
	assert.equal(hasAdminPermission(routeWriter, 'routes.write'), true);
	assert.equal(hasAdminPermission(routeWriter, 'analytics.read'), false);
});

test('star normalizes to the only stored permission and grants delegable permissions', () => {
	assert.deepEqual(normalizeAdminPermissions(['routes.read', '*', 'logs.read']), ['*']);
	const principal: AdminPrincipal = {
		type: 'api_key', id: 'admin_key:full', keyId: 'full', permissions: ['*'],
	};
	assert.equal(hasAdminPermission(principal, 'providers.secrets.read'), true);
	assert.deepEqual(parseAdminPermissions('["*","unknown.permission"]'), ['*']);
});

test('permission matrix protects console-only surfaces and defaults to deny', () => {
	assert.deepEqual(getAdminAuthorizationDecision('GET', '/admin/access-keys'), { kind: 'console_only' });
	// Access Audit 已移除：该路径必须落入兜底 deny，不得被重新注册为可访问面
	assert.deepEqual(getAdminAuthorizationDecision('GET', '/admin/admin-audit-logs'), { kind: 'deny' });
	assert.deepEqual(getAdminAuthorizationDecision('GET', '/admin/providers/p1/api-key'), {
		kind: 'permission', permission: 'providers.secrets.read',
	});
	assert.deepEqual(getAdminAuthorizationDecision('GET', '/admin/playground/realtime'), {
		kind: 'permission', permission: 'playground.execute',
	});
	assert.deepEqual(getAdminAuthorizationDecision('GET', '/admin/users/u1/audit-logs'), {
		kind: 'permission', permission: 'logs.read',
	});
	assert.deepEqual(getAdminAuthorizationDecision('GET', '/admin/keys/k1/logs'), {
		kind: 'permission', permission: 'logs.read',
	});
	assert.deepEqual(getAdminAuthorizationDecision('GET', '/admin/analytics/keys'), {
		kind: 'permission', permission: 'analytics.read',
	});
	assert.deepEqual(getAdminAuthorizationDecision('GET', '/admin/not-registered'), { kind: 'deny' });
});

test('config masking removes legacy MASTER_KEY and recursively masks catalog credentials', () => {
	const rows = prepareAdminConfigRows([
		{ key: 'MASTER_KEY', value: 'legacy', description: null },
		{ key: 'ALERT_WEBHOOK_WECOM_URL', value: 'https://example.test/hook/secret', description: null },
		{ key: 'WEB_SEARCH_CATALOG', value: JSON.stringify({ tavily: { apiKey: 'tvly-secret', metered: 1 } }), description: null },
	], false);
	assert.equal(rows.some((row) => row.key === 'MASTER_KEY'), false);
	assert.equal(rows[0]?.value, '••••••••');
	assert.equal(JSON.parse(rows[1]?.value ?? '{}').tavily.apiKey, '••••••••');
});

test('admin secrets and session hashes use expected formats', async () => {
	const key = generateAdminApiKey();
	assert.match(key, /^sk-admin-[0-9a-f]{64}$/);
	assert.match(await hashSessionToken('session-token'), /^[0-9a-f]{64}$/);
	assert.notEqual(await hashSessionToken('session-token'), await hashSessionToken('other-token'));
	assert.equal(await timingSafeEqualSecret('admin-password', 'admin-password'), true);
	assert.equal(await timingSafeEqualSecret('admin-password', 'wrong-password'), false);
});

test('authentication resolves active named keys and persistent sessions', async () => {
	const sessionToken = 'valid-session';
	const expectedSessionHash = await hashSessionToken(sessionToken);
	let touchedKeyId: string | null = null;
	const repositories = {
		adminAccess: {
			getActiveApiKeyBySecret: async (secret: string) => secret === 'active-secret' ? {
				id: 'routes-bot', name: 'routes-bot', description: null, secretKey: secret,
				keyPrefix: 'active-secret', permissionsJson: '["routes.write"]', status: 'active' as const,
				lastUsedAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revokedAt: null,
			} : null,
			touchApiKey: async (id: string) => { touchedKeyId = id; },
			getValidSession: async (tokenHash: string) => tokenHash === expectedSessionHash ? {
				tokenHash, username: 'admin', createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2027-01-01T00:00:00.000Z',
			} : null,
		},
	};

	assert.deepEqual(
		await authenticateAdminRequest(new Request('https://admin.test/api/admin/routes', {
			headers: { authorization: 'Bearer active-secret' },
		}), repositories),
		{ type: 'api_key', id: 'admin_key:routes-bot', keyId: 'routes-bot', permissions: ['routes.write'] }
	);
	assert.equal(touchedKeyId, 'routes-bot');
	assert.deepEqual(
		await authenticateAdminRequest(new Request('https://admin.test/api/admin/routes', {
			headers: { cookie: `admin_session=${sessionToken}` },
		}), repositories),
		{ type: 'console', id: 'console:admin', username: 'admin' }
	);
	assert.equal(await authenticateAdminRequest(new Request('https://admin.test/api/admin/routes', {
		headers: { authorization: 'Bearer revoked-or-unknown' },
	}), repositories), null);
});
