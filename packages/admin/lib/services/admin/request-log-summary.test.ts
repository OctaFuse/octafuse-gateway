import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { GatewayRepositories, RequestLogSummaryRow } from '@octafuse/core';
import { getRequestLogSummaryService, REQUEST_LOG_SUMMARY_MAX_GROUPS } from './dashboard-service';
import { AdminServiceError } from './errors';

const metrics = {
	request_count: 3, success_count: 2, error_count: 1,
	input_tokens: 1, output_tokens: 2, cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0, total_tokens: 3,
	standard_cost: '2.000000', metered_cost: '1.234567', charged_cost: '3.000000', charged_wallet_cost: '0.000000',
};

function reposWith(rows: RequestLogSummaryRow[], calls: unknown[] = []) {
	return {
		requestLogs: {
			getRequestLogSummary: async (options: unknown) => {
				calls.push(options);
				return rows;
			},
		},
	} as unknown as GatewayRepositories;
}

const start = '2026-10-22T16:36:23.123Z';
const end = '2026-10-25T00:52:54.000Z';

it('zero-fills requested providers only when grouping by provider', async () => {
	const calls: unknown[] = [];
	const repos = reposWith([{ provider_id: 'a', ...metrics }], calls);
	const result = await getRequestLogSummaryService(repos, { provider_ids: ' a ,b,a', start, end: '2026-10-25T08:52:54+08:00' });
	assert.equal(result.group_by, 'provider');
	assert.equal(result.end, end);
	assert.deepEqual(result.groups.map((g) => [g.provider_id, g.request_count, g.metered_cost]), [
		['a', 3, '1.234567'],
		['b', 0, '0.000000'],
	]);
	assert.deepEqual(calls, [{
		groupBy: ['provider'], startDate: start, endDate: end, providerIds: ['a', 'b'],
		modelId: undefined, modelIdPrefix: undefined, routeGroup: undefined, status: undefined,
		limit: REQUEST_LOG_SUMMARY_MAX_GROUPS + 1,
	}]);

	const byModel = await getRequestLogSummaryService(reposWith([]), { provider_ids: 'a', group_by: 'provider,model', start, end });
	assert.deepEqual(byModel.groups, []);
});

it('maps group_by values to dimensions and treats model,provider as provider,model', async () => {
	const seen: unknown[] = [];
	const repos = { requestLogs: { getRequestLogSummary: async (o: { groupBy: string[] }) => (seen.push(o.groupBy), []) } } as unknown as GatewayRepositories;
	for (const group_by of ['model', 'model,provider', 'provider,model', 'route_group', 'status']) {
		await getRequestLogSummaryService(repos, { group_by, status: 'success', start, end });
	}
	assert.deepEqual(seen, [['model'], ['provider', 'model'], ['provider', 'model'], ['route_group'], ['status']]);
});

it('rejects unsupported group_by, missing filters, bad timestamps, empty ranges and too many provider ids', async () => {
	const repos = reposWith([]);
	const ids11 = Array.from({ length: 11 }, (_, i) => `p${i}`).join(',');
	const bad: Array<Record<string, string | undefined>> = [
		{ provider_ids: 'a', group_by: 'user', start, end },
		{ provider_ids: 'a', group_by: 'provider;drop', start, end },
		{ provider_ids: 'a', group_by: 'provider,provider', start, end },
		{ start, end },
		{ provider_ids: ' , ', start, end },
		{ provider_ids: 'a', end },
		{ provider_ids: 'a', start, end: '2026-10-25 00:52:54' },
		{ provider_ids: 'a', start: '2026-10-25T00:52:54', end },
		{ provider_ids: 'a', start: end, end: start },
		{ provider_ids: 'a', start, end: start },
		{ provider_ids: ids11, start, end },
	];
	for (const input of bad) {
		await assert.rejects(
			getRequestLogSummaryService(repos, input),
			(error) => error instanceof AdminServiceError && error.status === 400,
			JSON.stringify(input),
		);
	}
});

it('fails instead of truncating when there are too many groups', async () => {
	const rows = Array.from({ length: REQUEST_LOG_SUMMARY_MAX_GROUPS + 1 }, (_, i) => ({ model_id: `m${i}`, ...metrics }));
	await assert.rejects(
		getRequestLogSummaryService(reposWith(rows), { group_by: 'model', route_group: 'default', start, end }),
		(error) => error instanceof AdminServiceError && error.status === 400,
	);
	const ok = await getRequestLogSummaryService(reposWith(rows.slice(0, REQUEST_LOG_SUMMARY_MAX_GROUPS)), { group_by: 'model', route_group: 'default', start, end });
	assert.equal(ok.groups.length, REQUEST_LOG_SUMMARY_MAX_GROUPS);
});
