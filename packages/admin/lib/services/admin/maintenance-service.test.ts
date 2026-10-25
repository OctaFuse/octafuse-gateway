import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import type { GatewayRepositories } from '@octafuse/core';
import { resetMaintenanceModeCacheForTests } from '@octafuse/core/lib/maintenance-mode';
import {
	getAdminWriteFreeze,
	getMaintenanceStatusService,
	isAdminWriteFreezeExempt,
	setMaintenanceService,
} from './maintenance-service';
import { AdminServiceError } from './errors';
import { updateAdminSystemConfigService } from './dashboard-service';

function fakeRepos(initial: string | null = null) {
	const store = new Map<string, string>();
	if (initial !== null) store.set('MAINTENANCE_MODE', initial);
	const repos = {
		systemConfig: {
			getConfig: async (key: string) => store.get(key) ?? null,
			upsertSystemConfigValue: async (key: string, value: string) => {
				store.set(key, value);
			},
		},
	} as unknown as GatewayRepositories;
	return { repos, store };
}

beforeEach(() => resetMaintenanceModeCacheForTests());

test('enabling stores normalised JSON and reports an ETA derived from the server clock', async () => {
	const { repos, store } = fakeRepos();
	const status = await setMaintenanceService(repos, { enabled: true, duration_minutes: 15, messages: { en: 'Back in {minutes}m' } });
	assert.equal(status.config.enabled, true);
	assert.equal(status.remaining_minutes, 15);
	assert.ok(status.retry_after_seconds! > 0);
	assert.match(status.effective_message ?? '', /15/);
	const stored = JSON.parse(store.get('MAINTENANCE_MODE')!);
	assert.equal(stored.enabled, true);
	assert.equal(stored.block_admin_writes, true);
	assert.equal(stored.messages.en, 'Back in {minutes}m');
});

test('disabling collapses to a minimal disabled record', async () => {
	const { repos, store } = fakeRepos();
	await setMaintenanceService(repos, { enabled: true, duration_minutes: 5 });
	const status = await setMaintenanceService(repos, { enabled: false });
	assert.equal(status.config.enabled, false);
	assert.equal(status.effective_message, null);
	assert.equal(store.get('MAINTENANCE_MODE'), '{"enabled":false}');
});

test('invalid input is a 400 and nothing is written', async () => {
	const { repos, store } = fakeRepos();
	await assert.rejects(
		() => setMaintenanceService(repos, { enabled: 'yes' } as never),
		(error: unknown) => error instanceof AdminServiceError && error.status === 400
	);
	await assert.rejects(() => setMaintenanceService(repos, null as never), AdminServiceError);
	assert.equal(store.has('MAINTENANCE_MODE'), false);
});

test('status reads the database directly, not the process cache', async () => {
	const { repos, store } = fakeRepos();
	assert.equal((await getMaintenanceStatusService(repos)).config.enabled, false);
	store.set('MAINTENANCE_MODE', '{"enabled":true}');
	assert.equal((await getMaintenanceStatusService(repos)).config.enabled, true);
});

test('the generic config endpoint refuses to write MAINTENANCE_MODE', async () => {
	const { repos, store } = fakeRepos();
	await assert.rejects(
		() => updateAdminSystemConfigService(repos, { key: 'MAINTENANCE_MODE', value: '{"enabled":true}' }),
		(error: unknown) => error instanceof AdminServiceError && error.status === 400
	);
	assert.equal(store.has('MAINTENANCE_MODE'), false);
});

test('write freeze only applies to mutating, non-exempt admin requests', async () => {
	const { repos } = fakeRepos('{"enabled":true,"block_admin_writes":true}');
	assert.equal(await getAdminWriteFreeze(repos, 'GET', '/admin/users'), null);
	assert.equal(await getAdminWriteFreeze(repos, 'OPTIONS', '/admin/users'), null);
	assert.ok(await getAdminWriteFreeze(repos, 'POST', '/admin/users'));
	assert.ok(await getAdminWriteFreeze(repos, 'PUT', '/admin/config'));
	assert.ok(await getAdminWriteFreeze(repos, 'DELETE', '/admin/keys/k1'));
	assert.equal(await getAdminWriteFreeze(repos, 'PUT', '/admin/maintenance'), null);
	assert.equal(await getAdminWriteFreeze(repos, 'POST', '/admin/access-keys'), null);
	assert.equal(await getAdminWriteFreeze(repos, 'POST', '/admin/playground/chat'), null);
	assert.equal(isAdminWriteFreezeExempt('/admin/users'), false);
});

test('write freeze respects block_admin_writes=false, disabled mode and read failures', async () => {
	assert.equal(await getAdminWriteFreeze(fakeRepos('{"enabled":true,"block_admin_writes":false}').repos, 'POST', '/admin/users'), null);
	resetMaintenanceModeCacheForTests();
	assert.equal(await getAdminWriteFreeze(fakeRepos(null).repos, 'POST', '/admin/users'), null);
	resetMaintenanceModeCacheForTests();
	const broken = {
		systemConfig: {
			getConfig: async () => {
				throw new Error('db down');
			},
		},
	} as unknown as GatewayRepositories;
	assert.equal(await getAdminWriteFreeze(broken, 'POST', '/admin/users'), null);
});

test('freeze message is friendly and carries a retry hint', async () => {
	const { repos } = fakeRepos(
		JSON.stringify({ enabled: true, expected_end_at: new Date(Date.now() + 5 * 60_000).toISOString() })
	);
	const freeze = await getAdminWriteFreeze(repos, 'POST', '/admin/users');
	assert.ok(freeze);
	assert.match(freeze.message, /网关维护中，预计 (4|5) 分钟后恢复/);
	assert.ok(freeze.retryAfterSeconds > 0 && freeze.retryAfterSeconds <= 300);
});
