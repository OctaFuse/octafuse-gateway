import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildRequestLogSummaryQuery, mapRequestLogSummaryRows } from './request-log-summary';

const base = {
	startDate: '2026-10-22T16:36:23.123Z',
	endDate: '2026-10-25T00:52:54.000Z',
	limit: 1001,
};

describe('request log summary query', () => {
	it('groups by whitelisted columns and binds every filter in order', () => {
		const { sql, binds } = buildRequestLogSummaryQuery(
			{
				...base,
				groupBy: ['provider', 'model'],
				providerIds: ['p1', 'p2'],
				modelId: 'm1',
				modelIdPrefix: 'mcp:',
				routeGroup: 'default',
				status: 'success',
			},
			'd1',
		);
		assert.match(sql, /SELECT provider_id, model_id, COUNT\(\*\) AS request_count/);
		assert.match(sql, /GROUP BY provider_id, model_id\s+ORDER BY provider_id, model_id\s+LIMIT \?/);
		assert.match(sql, /provider_id IN \(\?, \?\) AND model_id = \? AND model_id LIKE \? ESCAPE/);
		assert.deepEqual(binds, [
			'p1', 'p2', 'm1', 'mcp:%', 'default', 'success',
			'2026-10-22 16:36:23.123', '2026-10-25 00:52:54.000', 1001,
		]);
		// 所有输入值只出现在绑定参数里
		assert.ok(!sql.includes('p1') && !sql.includes('default'));
	});

	it('uses explicit timestamptz casts on Postgres and ISO instants as binds', () => {
		const { sql, binds } = buildRequestLogSummaryQuery({ ...base, groupBy: ['provider'], providerIds: ['p'] }, 'postgres');
		assert.match(sql, /created_at >= \?::timestamptz AND created_at < \?::timestamptz/);
		assert.match(sql, /ROUND\(COALESCE\(SUM\(metered_cost\), 0\), 6\)::text AS metered_cost/);
		assert.deepEqual(binds, ['p', base.startDate, base.endDate, 1001]);
	});

	it('casts money to text on MySQL and leaves D1 numeric', () => {
		const q = { ...base, groupBy: ['status' as const], routeGroup: 'default' };
		assert.match(buildRequestLogSummaryQuery(q, 'mysql').sql, /CAST\(ROUND\(COALESCE\(SUM\(charged_wallet_cost\), 0\), 6\) AS CHAR\)/);
		assert.doesNotMatch(buildRequestLogSummaryQuery(q, 'd1').sql, /CAST|::text/);
	});

	it('refuses an empty grouping', () => {
		assert.throws(() => buildRequestLogSummaryQuery({ ...base, groupBy: [] }, 'd1'));
	});
});

describe('request log summary row mapping', () => {
	const metrics = {
		request_count: '3', success_count: 2, error_count: '1',
		input_tokens: '10', output_tokens: 20, cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0, total_tokens: '30',
	};

	it('keeps only grouped keys, converts counts, and normalizes money to six decimals', () => {
		const [pg, d1] = mapRequestLogSummaryRows(
			[
				{ provider_id: 'a', model_id: 'ignored', ...metrics, standard_cost: '1.5', metered_cost: '9.421632', charged_cost: '0', charged_wallet_cost: '0.000000' },
				{ provider_id: null, ...metrics, standard_cost: 1.5, metered_cost: 0.1 + 0.2, charged_cost: 0, charged_wallet_cost: null },
			],
			['provider'],
		);
		assert.deepEqual(pg, {
			provider_id: 'a', ...Object.fromEntries(Object.entries(metrics).map(([k, v]) => [k, Number(v)])),
			standard_cost: '1.500000', metered_cost: '9.421632', charged_cost: '0.000000', charged_wallet_cost: '0.000000',
		});
		assert.equal('model_id' in pg, false);
		assert.equal(d1.provider_id, null);
		assert.equal(d1.metered_cost, '0.300000');
		assert.equal(d1.charged_wallet_cost, '0.000000');
	});
});
