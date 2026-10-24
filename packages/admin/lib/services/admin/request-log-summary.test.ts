import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { GatewayRepositories, RequestLogSummaryRow } from '@octafuse/core';
import {
	getRequestLogSummaryService,
	REQUEST_LOG_SUMMARY_MAX_GROUPS,
	REQUEST_LOG_SUMMARY_MAX_PAGE_SIZE,
} from './dashboard-service';
import { AdminServiceError } from './errors';

const metrics = {
	request_count: 3, success_count: 2, error_count: 1, incomplete_count: 0, cancelled_count: 0,
	input_tokens: 1, output_tokens: 2, cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0, total_tokens: 3,
	standard_cost: '2.000000', metered_cost: '1.234567', charged_cost: '3.000000', charged_wallet_cost: '0.000000',
	error_metered_cost: '0.000000', error_charged_cost: '0.000000',
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
		includeLabels: false, limit: REQUEST_LOG_SUMMARY_MAX_GROUPS + 1, offset: 0,
	}]);
	assert.equal(result.has_more, false);

	const byModel = await getRequestLogSummaryService(reposWith([]), { provider_ids: 'a', group_by: 'provider,model', start, end });
	assert.deepEqual(byModel.groups, []);
});

it('accepts any combination of dimensions and orders them canonically', async () => {
	const seen: unknown[] = [];
	const repos = { requestLogs: { getRequestLogSummary: async (o: { groupBy: string[] }) => (seen.push(o.groupBy), []) } } as unknown as GatewayRepositories;
	const outputs: string[] = [];
	for (const group_by of ['model', 'model,provider', 'provider,model', 'route_group', 'status', 'provider_key,user,model', ' user , provider_key ']) {
		outputs.push((await getRequestLogSummaryService(repos, { group_by, status: 'success', start, end })).group_by);
	}
	assert.deepEqual(seen, [
		['model'], ['provider', 'model'], ['provider', 'model'], ['route_group'], ['status'],
		['model', 'user', 'provider_key'], ['user', 'provider_key'],
	]);
	assert.deepEqual(outputs, ['model', 'provider,model', 'provider,model', 'route_group', 'status', 'model,user,provider_key', 'user,provider_key']);
});

it('rejects unsupported group_by, missing filters, bad timestamps, empty ranges and too many provider ids', async () => {
	const repos = reposWith([]);
	const ids11 = Array.from({ length: 11 }, (_, i) => `p${i}`).join(',');
	const bad: Array<Record<string, string | undefined>> = [
		{ provider_ids: 'a', group_by: 'api_key', start, end },
		{ provider_ids: 'a', group_by: 'user,,provider,user', start, end },
		{ provider_ids: 'a', group_by: 'provider;drop', start, end },
		{ provider_ids: 'a', group_by: 'provider,provider', start, end },
		{ start, end: '2026-12-25T00:52:54.000Z' },
		{ provider_ids: 'a', limit: '0', start, end },
		{ provider_ids: 'a', limit: String(REQUEST_LOG_SUMMARY_MAX_PAGE_SIZE + 1), start, end },
		{ provider_ids: 'a', limit: 'x', start, end },
		{ provider_ids: 'a', limit: '10', offset: '-1', start, end },
		{ provider_ids: 'a', offset: '10', start, end },
		{ provider_ids: ' , ', start, end: '2026-12-25T00:52:54.000Z' },
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

it('allows an unfiltered whole-day summary and passes labels, limit and offset through', async () => {
	const calls: Array<Record<string, unknown>> = [];
	const dayStart = '2026-10-24T16:00:00.000Z';
	const dayEnd = '2026-10-25T16:00:00.000Z';
	const rows = [{ user_id: 'u1', model_id: 'm', user_email: 'a@b.c', ...metrics }];
	const result = await getRequestLogSummaryService(reposWith(rows, calls), {
		group_by: 'user,model', include_labels: '1', start: dayStart, end: dayEnd,
	});
	assert.equal(result.groups.length, 1);
	assert.equal(calls[0].includeLabels, true);
	const noLabels = await getRequestLogSummaryService(reposWith(rows, calls), { group_by: 'user', include_labels: '0', start: dayStart, end: dayEnd });
	assert.equal(noLabels.has_more, false);
	assert.equal(calls[1].includeLabels, false);
});

it('paginates with limit and offset and reports has_more without truncating silently', async () => {
	const rows = Array.from({ length: 4 }, (_, i) => ({ user_id: `u${i}`, ...metrics }));
	const calls: Array<Record<string, unknown>> = [];
	const first = await getRequestLogSummaryService(reposWith(rows.slice(0, 3), calls), { group_by: 'user', limit: '2', start, end: '2026-10-23T00:00:00.000Z' });
	assert.equal(first.groups.length, 2);
	assert.equal(first.has_more, true);
	assert.equal(calls[0].limit, 3);
	assert.equal(calls[0].offset, 0);
	const last = await getRequestLogSummaryService(reposWith(rows.slice(2), calls), { group_by: 'user', limit: '2', offset: '2', start, end: '2026-10-23T00:00:00.000Z' });
	assert.equal(last.groups.length, 2);
	assert.equal(last.has_more, false);
	assert.equal(calls[1].offset, 2);
	// 显式分页的 provider 汇总不补零行
	const noFill = await getRequestLogSummaryService(reposWith([], calls), { provider_ids: 'a,b', limit: '10', start, end });
	assert.deepEqual(noFill.groups, []);
});
