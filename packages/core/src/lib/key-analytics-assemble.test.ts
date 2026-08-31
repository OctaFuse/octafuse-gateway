import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assembleKeyAnalytics } from './key-analytics-assemble';
import type { KeyAnalyticsRow } from '../storage/repository-dtos';

function logRow(partial: Partial<KeyAnalyticsRow> & Pick<KeyAnalyticsRow, 'api_key_id'>): KeyAnalyticsRow {
	return {
		key_name: null,
		request_count: 0,
		input_tokens: 0,
		output_tokens: 0,
		charged_cost: 0,
		metered_cost: 0,
		standard_cost: 0,
		distinct_models: 0,
		last_active_at: null,
		success_count: 0,
		error_count: 0,
		...partial,
	};
}

describe('assembleKeyAnalytics', () => {
	it('includes unused keys as zeros and overlays log aggregates', () => {
		const rows = assembleKeyAnalytics(
			[
				{ id: 'k-used', name: 'prod' },
				{ id: 'k-idle', name: 'idle' },
			],
			[
				logRow({
					api_key_id: 'k-used',
					key_name: 'stale',
					request_count: 3,
					charged_cost: 1.25,
					input_tokens: 10,
					output_tokens: 20,
					last_active_at: '2026-08-01T00:00:00.000Z',
					success_count: 2,
					error_count: 1,
				}),
			]
		);
		assert.equal(rows.length, 2);
		assert.equal(rows[0]?.api_key_id, 'k-used');
		assert.equal(rows[0]?.key_name, 'prod');
		assert.equal(rows[0]?.request_count, 3);
		assert.equal(rows[0]?.charged_cost, 1.25);
		assert.equal(rows[1]?.api_key_id, 'k-idle');
		assert.equal(rows[1]?.key_name, 'idle');
		assert.equal(rows[1]?.request_count, 0);
		assert.equal(rows[1]?.last_active_at, null);
	});

	it('keeps a deleted-key orphan bucket when it has traffic', () => {
		const rows = assembleKeyAnalytics(
			[{ id: 'k1', name: 'live' }],
			[logRow({ api_key_id: null, request_count: 4, charged_cost: 0.5 })]
		);
		assert.equal(rows.length, 2);
		assert.equal(rows[1]?.api_key_id, null);
		assert.equal(rows[1]?.key_name, null);
		assert.equal(rows[1]?.request_count, 4);
		assert.equal(rows[1]?.charged_cost, 0.5);
	});

	it('drops an empty orphan bucket', () => {
		const rows = assembleKeyAnalytics([], [logRow({ api_key_id: '', request_count: 0 })]);
		assert.deepEqual(rows, []);
	});

	it('keeps log rows whose key id is no longer in api_keys', () => {
		const rows = assembleKeyAnalytics([], [logRow({ api_key_id: 'gone', key_name: 'old', request_count: 1 })]);
		assert.equal(rows.length, 1);
		assert.equal(rows[0]?.api_key_id, 'gone');
		assert.equal(rows[0]?.key_name, 'old');
		assert.equal(rows[0]?.request_count, 1);
	});
});
