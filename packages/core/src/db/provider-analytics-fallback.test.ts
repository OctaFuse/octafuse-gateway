/**
 * 供应商统计名称回退：目录名优先，否则用请求日志快照；空 provider_id 不计入。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createD1AdminAnalyticsRepository } from './d1/admin-analytics.impl';
import type { D1DatabaseClient } from '../storage/database-client';

const START = '2026-09-01 00:00:00';
const END = '2026-09-02 00:00:00';
const AT = '2026-09-01 12:00:00';

function createAnalyticsDb() {
	const sqlite = new DatabaseSync(':memory:');
	sqlite.exec(`
		CREATE TABLE providers (id TEXT PRIMARY KEY, name TEXT);
		CREATE TABLE api_key_request_logs (
			id TEXT PRIMARY KEY,
			provider_id TEXT,
			provider_name TEXT,
			model_id TEXT,
			created_at TEXT,
			charged_cost REAL DEFAULT 0,
			metered_cost REAL DEFAULT 0,
			standard_cost REAL DEFAULT 0,
			input_tokens INTEGER DEFAULT 0,
			output_tokens INTEGER DEFAULT 0,
			cache_read_tokens INTEGER DEFAULT 0,
			cache_write_tokens INTEGER DEFAULT 0,
			status TEXT,
			latency_ms INTEGER,
			upstream_response_ms INTEGER,
			stream_duration_ms INTEGER,
			upstream_failover_count INTEGER,
			upstream_attempt_count INTEGER,
			first_reasoning_token_ms INTEGER,
			first_token_ms INTEGER
		);
	`);
	sqlite.prepare('INSERT INTO providers (id, name) VALUES (?, ?)').run('live', 'Live Name');
	const insert = sqlite.prepare(
		`INSERT INTO api_key_request_logs (id, provider_id, provider_name, model_id, created_at, status, charged_cost)
		 VALUES (?, ?, ?, ?, ?, 'success', 1)`
	);
	insert.run('live-log', 'live', 'Stale Snapshot', 'model-a', AT);
	insert.run('deleted-log', 'gone', 'Deleted Snapshot', 'model-a', AT);
	insert.run('blank-name-log', 'gone-noname', '', 'model-a', AT);
	insert.run('tools-log', 'octafuse-tools', 'OctaFuse Tools', 'tool:web-search', AT);
	insert.run('empty-provider-log', '', '', 'model-a', AT);
	const raw = {
		prepare(sql: string) {
			return {
				bind(...values: unknown[]) {
					return {
						async all() {
							const rows = sqlite.prepare(sql).all(...(values as Array<string | number | null>));
							return { results: rows };
						},
					};
				},
			};
		},
	};
	return createD1AdminAnalyticsRepository({ raw } as unknown as D1DatabaseClient);
}

describe('provider analytics name fallback', () => {
	it('uses the catalog name, then the log snapshot, and drops empty provider ids', async () => {
		const analytics = createAnalyticsDb();
		const rows = await analytics.queryProviderAnalytics({ start: START, end: END });
		const byId = new Map(rows.map((row) => [row.provider_id, row.provider_name]));

		assert.equal(byId.get('live'), 'Live Name');
		assert.equal(byId.get('gone'), 'Deleted Snapshot');
		assert.equal(byId.get('gone-noname') ?? '', '');
		assert.equal(byId.get('octafuse-tools'), 'OctaFuse Tools');
		assert.equal(byId.has(''), false);
		assert.equal(rows.length, 4);
	});

	it('applies the same name fallback on reliability aggregates', async () => {
		const analytics = createAnalyticsDb();
		const providers = await analytics.queryProviderReliability({ start: START, end: END });
		const models = await analytics.queryModelProviderReliability({ start: START, end: END });

		assert.equal(providers.find((row) => row.provider_id === 'gone')?.provider_name, 'Deleted Snapshot');
		assert.equal(providers.find((row) => row.provider_id === 'live')?.provider_name, 'Live Name');
		assert.equal(providers.some((row) => row.provider_id === ''), false);
		assert.equal(models.find((row) => row.provider_id === 'gone')?.provider_name, 'Deleted Snapshot');
		assert.equal(models.some((row) => row.provider_id === ''), false);
	});
});
