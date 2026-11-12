import assert from 'node:assert/strict';
import test from 'node:test';
import type { GatewayRequestLog } from '@/lib/types';
import { dashboardActivityCostFactor, dashboardActivityDuration, dashboardActivityError, dashboardActivityMoney, dashboardActivityUsage } from './dashboard-activity-details';
import { dashboardActivityLogsHref } from './dashboard-links';

const labels = { tokens: 'tok', images: 'img', seconds: 's', characters: 'chars', calls: 'call', input: 'Input', output: 'Output', cacheRead: 'Cache' };
function log(patch: Partial<GatewayRequestLog> = {}): GatewayRequestLog {
	return { id: 'test', api_key_id: null, user_email: null, model_id: 'test', provider_id: null,
		input_tokens: 8100, output_tokens: 729, cache_read_tokens: 7800, cache_write_tokens: 0,
		metered_cost: 0, charged_cost: .000249, status: 'success', latency_ms: 8170, error_message: null,
		created_at: '2026-11-12T12:41:20Z', ...patch };
}

test('activity usage distinguishes token input/output and exposes cache context', () => {
	const usage = dashboardActivityUsage(log(), labels);
	assert.equal(usage.value, '8.1K / 729 tok');
	assert.match(usage.title, /Cache 7.8K/);
	assert.equal(dashboardActivityUsage(log({ input_tokens: 0, output_tokens: 0, total_tokens: 1234 }), labels).value, '1.23K tok');
});

test('image and audio logs show their real billing units, including explicit zero values', () => {
	assert.equal(dashboardActivityUsage(log({ billing_kind: 'image_per_image', input_image_count: 1, output_image_count: 2 }), labels).value, '1 / 2 img');
	assert.equal(dashboardActivityUsage(log({ billing_kind: 'audio_per_second', audio_duration_seconds: 12.75 }), labels).value, '12.75 s');
	assert.equal(dashboardActivityUsage(log({ billing_kind: 'audio_per_character', audio_characters: 1234 }), labels).value, '1.23K chars');
	assert.equal(dashboardActivityUsage(log({ billing_kind: 'audio_per_second', audio_duration_seconds: 0 }), labels).value, '0 s');
	assert.equal(dashboardActivityUsage(log({ billing_kind: 'audio_per_second' }), labels).value, '— s');
});

test('REST and MCP calls do not become fake zero-token requests', () => {
	for (const provider_id of ['octafuse-tools', 'octafuse-mcp']) {
		assert.equal(dashboardActivityUsage(log({ provider_id, input_tokens: 0, output_tokens: 0 }), labels).value, '1 call');
	}
});

test('timing and money keep missing observations distinct from zero and accept SQL decimal strings', () => {
	assert.equal(dashboardActivityDuration(0), '0ms');
	assert.equal(dashboardActivityDuration(8170), '8.17s');
	assert.equal(dashboardActivityDuration(null), '—');
	assert.equal(dashboardActivityMoney('0.000249'), .000249);
	assert.equal(dashboardActivityMoney('0'), 0);
	for (const value of [null, undefined, '', ' ', 'not-a-number', Infinity, -1]) assert.equal(dashboardActivityMoney(value), null);
});

test('cost factors preserve free requests and avoid dividing by missing or zero catalog prices', () => {
	assert.equal(dashboardActivityCostFactor(.000249, .000498), '×0.5');
	assert.equal(dashboardActivityCostFactor(0, .1), '×0');
	assert.equal(dashboardActivityCostFactor('0.04', '0.1'), '×0.4');
	assert.equal(dashboardActivityCostFactor(.1, 0), null);
	assert.equal(dashboardActivityCostFactor(null, .1), null);
	assert.match(dashboardActivityCostFactor(.00000005, .1)!, /e-/);
});

test('global activity links preserve all-time and error filters independent of the analysis window', () => {
	for (const view of ['recent', 'errors'] as const) {
		const params = new URL(dashboardActivityLogsHref(view), 'http://localhost').searchParams;
		assert.equal(params.get('start_date'), ''); assert.equal(params.get('end_date'), '');
		assert.equal(params.get('status'), view === 'errors' ? 'error' : null);
	}
});


test('error summaries retain diagnostic codes without repeating HTTP prefixes or exposing HTML', () => {
	assert.deepEqual(dashboardActivityError('HTTP 400: SVG generation requires svg.model', 'Upstream error'), {
		code: 'HTTP 400', summary: 'SVG generation requires svg.model', full: 'HTTP 400: SVG generation requires svg.model',
	});
	const html = dashboardActivityError('HTTP 502: <!DOCTYPE html><body>server page</body>', 'Upstream error');
	assert.equal(html.code, 'HTTP 502');
	assert.equal(html.summary, 'Upstream error');
	assert.equal(dashboardActivityError('Connection reset', 'Upstream error').code, null);
	assert.equal(dashboardActivityError(null, 'Upstream error').summary, 'Upstream error');
});
