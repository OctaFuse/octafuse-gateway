import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import {
	MAINTENANCE_DEFAULT_RETRY_AFTER_SECONDS,
	MAINTENANCE_MAX_RETRY_AFTER_SECONDS,
	buildMaintenanceConfigFromInput,
	getMaintenanceConfig,
	maintenanceRemainingMinutes,
	maintenanceRetryAfterSeconds,
	parseAcceptLanguage,
	parseMaintenanceConfig,
	resetMaintenanceModeCacheForTests,
	resolveMaintenanceMessage,
	serializeMaintenanceConfig,
	type MaintenanceConfig,
} from './maintenance-mode';

const NOW = new Date('2026-10-25T05:00:00.000Z');

function enabled(overrides: Partial<MaintenanceConfig> = {}): MaintenanceConfig {
	return {
		enabled: true,
		message: '',
		messages: {},
		expected_end_at: null,
		block_admin_writes: true,
		...overrides,
	};
}

beforeEach(() => resetMaintenanceModeCacheForTests());

test('missing, empty and malformed values are treated as disabled', () => {
	assert.equal(parseMaintenanceConfig(null).enabled, false);
	assert.equal(parseMaintenanceConfig('').enabled, false);
	assert.equal(parseMaintenanceConfig('not json').enabled, false);
	assert.equal(parseMaintenanceConfig('[]').enabled, false);
	assert.equal(parseMaintenanceConfig('{"enabled":"true"}').enabled, false);
	assert.equal(parseMaintenanceConfig('{"enabled":false,"message":"x"}').enabled, false);
});

test('parse keeps enabled config and normalises fields', () => {
	const config = parseMaintenanceConfig(
		JSON.stringify({
			enabled: true,
			message: ' down ',
			messages: { ZH_cn: ' 维护中 ', en: '', bad: 1 },
			expected_end_at: '2026-10-25T06:00:00+01:00',
		})
	);
	assert.equal(config.enabled, true);
	assert.equal(config.message, 'down');
	assert.deepEqual(config.messages, { 'zh-cn': '维护中' });
	assert.equal(config.expected_end_at, '2026-10-25T05:00:00.000Z');
	assert.equal(config.block_admin_writes, true);
	assert.equal(parseMaintenanceConfig('{"enabled":true,"block_admin_writes":false}').block_admin_writes, false);
});

test('serialize round trips and disabled drops stale fields', () => {
	const config = enabled({ message: 'm', expected_end_at: '2026-10-25T06:00:00.000Z' });
	assert.deepEqual(parseMaintenanceConfig(serializeMaintenanceConfig(config)), config);
	assert.equal(serializeMaintenanceConfig(buildMaintenanceConfigFromInput({ enabled: false, message: 'old' })), '{"enabled":false}');
});

test('input validation rejects bad shapes', () => {
	assert.throws(() => buildMaintenanceConfigFromInput({}), /enabled must be a boolean/);
	assert.throws(() => buildMaintenanceConfigFromInput({ enabled: true, message: 1 }), /message must be a string/);
	assert.throws(() => buildMaintenanceConfigFromInput({ enabled: true, messages: [] }), /messages must be an object/);
	assert.throws(() => buildMaintenanceConfigFromInput({ enabled: true, messages: { zh: 3 } }), /messages\.zh/);
	assert.throws(() => buildMaintenanceConfigFromInput({ enabled: true, message: 'x'.repeat(501) }), /at most/);
	assert.throws(() => buildMaintenanceConfigFromInput({ enabled: true, duration_minutes: 0 }), /duration_minutes/);
	assert.throws(() => buildMaintenanceConfigFromInput({ enabled: true, duration_minutes: 10 ** 6 }), /duration_minutes/);
	assert.throws(() => buildMaintenanceConfigFromInput({ enabled: true, expected_end_at: 'tomorrow-ish' }), /valid ISO/);
	assert.throws(
		() => buildMaintenanceConfigFromInput({ enabled: true, expected_end_at: '2026-10-25T06:00:00Z', duration_minutes: 5 }),
		/either/
	);
	assert.throws(() => buildMaintenanceConfigFromInput({ enabled: true, block_admin_writes: 'no' }), /block_admin_writes/);
});

test('duration_minutes is resolved against the server clock', () => {
	const config = buildMaintenanceConfigFromInput({ enabled: true, duration_minutes: 30 }, NOW);
	assert.equal(config.expected_end_at, '2026-10-25T05:30:00.000Z');
	assert.equal(config.block_admin_writes, true);
});

test('remaining minutes round up and never report zero', () => {
	assert.equal(maintenanceRemainingMinutes(enabled(), NOW), null);
	assert.equal(maintenanceRemainingMinutes(enabled({ expected_end_at: '2026-10-25T05:00:01.000Z' }), NOW), 1);
	assert.equal(maintenanceRemainingMinutes(enabled({ expected_end_at: '2026-10-25T05:10:00.000Z' }), NOW), 10);
	assert.equal(maintenanceRemainingMinutes(enabled({ expected_end_at: '2026-10-25T04:59:00.000Z' }), NOW), null);
});

test('retry-after is bounded', () => {
	assert.equal(maintenanceRetryAfterSeconds(enabled(), NOW), MAINTENANCE_DEFAULT_RETRY_AFTER_SECONDS);
	assert.equal(
		maintenanceRetryAfterSeconds(enabled({ expected_end_at: '2026-10-25T04:00:00.000Z' }), NOW),
		MAINTENANCE_DEFAULT_RETRY_AFTER_SECONDS
	);
	assert.equal(maintenanceRetryAfterSeconds(enabled({ expected_end_at: '2026-10-25T05:00:20.000Z' }), NOW), 20);
	assert.equal(
		maintenanceRetryAfterSeconds(enabled({ expected_end_at: '2026-10-25T09:00:00.000Z' }), NOW),
		MAINTENANCE_MAX_RETRY_AFTER_SECONDS
	);
});

test('Accept-Language is ordered by q and ignores wildcards', () => {
	assert.deepEqual(parseAcceptLanguage('en;q=0.5, zh-CN, ja;q=0'), ['zh-cn', 'en']);
	assert.deepEqual(parseAcceptLanguage('*'), []);
	assert.deepEqual(parseAcceptLanguage(null), []);
});

test('message falls back to built-in text with or without an ETA', () => {
	const withEta = enabled({ expected_end_at: '2026-10-25T05:10:00.000Z' });
	assert.equal(resolveMaintenanceMessage(withEta, null, NOW), '网关维护中，预计 10 分钟后恢复，请稍后再试');
	assert.match(resolveMaintenanceMessage(withEta, 'en-US,en;q=0.9', NOW), /about 10 minutes/);
	assert.equal(resolveMaintenanceMessage(enabled(), 'zh-CN', NOW), '网关维护中，请稍后再试');
	assert.equal(resolveMaintenanceMessage(enabled(), 'en', NOW), 'The gateway is under maintenance. Please try again later.');
});

test('custom messages pick exact tag, then primary language, then default', () => {
	const config = enabled({
		message: '默认 {minutes}',
		messages: { en: 'English {minutes}', 'zh-tw': '繁體 {minutes}' },
		expected_end_at: '2026-10-25T05:05:00.000Z',
	});
	assert.equal(resolveMaintenanceMessage(config, 'en-GB', NOW), 'English 5');
	assert.equal(resolveMaintenanceMessage(config, 'zh-TW', NOW), '繁體 5');
	assert.equal(resolveMaintenanceMessage(config, 'fr', NOW), '默认 5');
	assert.equal(resolveMaintenanceMessage(config, undefined, NOW), '默认 5');
});

test('custom template that needs {minutes} falls back when no ETA is set', () => {
	assert.equal(resolveMaintenanceMessage(enabled({ message: '预计 {minutes} 分钟' }), 'zh', NOW), '网关维护中，请稍后再试');
	assert.equal(resolveMaintenanceMessage(enabled({ message: '升级中，请稍候' }), 'zh', NOW), '升级中，请稍候');
});

test('getMaintenanceConfig caches within the TTL and parses the stored value', async () => {
	let reads = 0;
	const repos = {
		systemConfig: {
			getConfig: async () => {
				reads += 1;
				return '{"enabled":true,"message":"m"}';
			},
		},
	} as unknown as Parameters<typeof getMaintenanceConfig>[0];
	const first = await getMaintenanceConfig(repos);
	const second = await getMaintenanceConfig(repos);
	assert.equal(first.enabled, true);
	assert.equal(second.message, 'm');
	assert.equal(reads, 1);
});
