import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

function run(script: string, overrides: NodeJS.ProcessEnv = {}) {
	return spawnSync(process.execPath, ['--import', 'tsx', `scripts/smoke/${script}.ts`], {
		encoding: 'utf8',
		timeout: 10_000,
		env: {
			...process.env,
			NODE_ENV: 'production',
			DATABASE_URL: '',
			DATABASE_DRIVER: 'postgres',
			GATEWAY_BASE_URL: 'http://127.0.0.1:1',
			GATEWAY_SMOKE_STRICT: '',
			GATEWAY_SMOKE_SKIP_ADMIN: '0',
			GATEWAY_SMOKE_SKIP_WRITES: '0',
			GATEWAY_MASTER_KEY: '',
			MASTER_KEY: '',
			...overrides,
		},
	});
}

test('storage smoke can skip an unset database outside strict mode', () => {
	const result = run('test-storage-concurrent-charge');
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /skip: DATABASE_URL unset/);
});

test('strict storage smoke fails when the database is unset', () => {
	const result = run('test-storage-concurrent-charge', { GATEWAY_SMOKE_STRICT: '1' });
	assert.equal(result.status, 1, result.stderr);
	assert.doesNotMatch(result.stdout, /skip/);
	assert.match(result.stderr, /DATABASE_URL/);
});

test('an invalid database URL fails even outside strict mode', () => {
	const result = run('test-storage-concurrent-charge', { DATABASE_URL: 'invalid-url' });
	assert.equal(result.status, 1, result.stderr);
	assert.doesNotMatch(result.stdout, /skip/);
});

for (const flag of ['GATEWAY_SMOKE_SKIP_ADMIN', 'GATEWAY_SMOKE_SKIP_WRITES']) {
	test(`strict route smoke rejects ${flag} before making requests`, () => {
		const result = run('test-node-core-routes', {
			GATEWAY_SMOKE_STRICT: '1', GATEWAY_MASTER_KEY: 'smoke-key', [flag]: '1',
		});
		assert.equal(result.status, 1, result.stderr);
		assert.match(result.stderr, /Strict smoke requires/);
		assert.doesNotMatch(result.stderr, /fetch failed/);
	});
}

test('strict route smoke requires explicit production admin credentials', () => {
	const result = run('test-node-core-routes', { GATEWAY_SMOKE_STRICT: '1' });
	assert.equal(result.status, 1, result.stderr);
	assert.match(result.stderr, /Strict smoke requires/);
});
