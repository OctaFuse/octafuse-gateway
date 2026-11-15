import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	formatRequestCostMultiplier,
	requestLogUsageMetrics,
	requestLogDetailUsageMetrics,
} from './request-log-values';

describe('request usage measurements', () => {
	it('keeps reference and generated image counts separate, including unknown and zero', () => {
		assert.deepEqual(
			requestLogUsageMetrics({
				billing_kind: 'image_per_image',
				input_image_count: 2,
				output_image_count: 3,
			}).map(({ field, value }) => [field, value]),
			[
				['inputImages', 2],
				['outputImages', 3],
			]
		);
		assert.deepEqual(
			requestLogUsageMetrics({
				billing_kind: 'image_per_image',
				output_image_count: 0,
			}).map((metric) => metric.value),
			[undefined, 0]
		);
	});
	it('uses seconds or characters for audio, and tokens for token-billed image/audio/embedding requests', () => {
		assert.deepEqual(
			requestLogUsageMetrics({
				billing_kind: 'audio_per_second',
				audio_duration_seconds: 1.997,
				input_tokens: 500,
			}).map(({ unit, value }) => [unit, value]),
			[['seconds', 1.997]]
		);
		assert.deepEqual(
			requestLogUsageMetrics({
				billing_kind: 'audio_per_character',
				audio_characters: 26,
			}).map(({ unit, value }) => [unit, value]),
			[['characters', 26]]
		);
		for (const billing_kind of ['image_tokens', 'audio_tokens']) {
			assert.deepEqual(
				requestLogUsageMetrics({
					billing_kind,
					input_tokens: 8054,
					output_tokens: 729,
					cache_read_tokens: 7808,
					cache_write_tokens: 128,
				}).map(({ value }) => value),
				[8054, 729, 7808, 128]
			);
		}
	});
	it('omits unrecorded tool/MCP token usage but preserves recorded totals and reasoning', () => {
		for (const model_id of ['tool:web-search', 'mcp:service/tool']) {
			assert.deepEqual(
				requestLogUsageMetrics({ model_id, input_tokens: 0, output_tokens: 0 }),
				[]
			);
			assert.deepEqual(
				requestLogUsageMetrics({ model_id, total_tokens: 300 }).map(
					({ key, value }) => [key, value]
				),
				[['total', 300]]
			);
		}
		assert.deepEqual(
			requestLogUsageMetrics({ reasoning_tokens: 42 }).map(({ key, value }) => [
				key,
				value,
			]),
			[['reasoning', 42]]
		);
		assert.equal(
			requestLogUsageMetrics({
				input_tokens: 10,
				output_tokens: 0,
				cache_write_tokens: 2,
			}).at(-1)?.key,
			'cacheWrite'
		);
	});
});

describe('request accounting factors', () => {
	it('distinguishes true zero, tiny positive factors, and unavailable catalog amounts', () => {
		assert.equal(formatRequestCostMultiplier('0.000854', '0.000854'), '×1');
		assert.equal(formatRequestCostMultiplier('0', '0.000854'), '×0');
		assert.equal(formatRequestCostMultiplier('', 1), null);
		assert.equal(formatRequestCostMultiplier(0, 1), '×0');
		assert.equal(formatRequestCostMultiplier(0.5, 1), '×0.5');
		assert.equal(formatRequestCostMultiplier(0.0004, 1), '×0.0004');
		assert.equal(formatRequestCostMultiplier(1e-9, 1), '×1.00e-9');
		for (const [cost, catalog] of [
			[1, 0],
			[1, undefined],
			[undefined, 1],
			[NaN, 1],
			[-1, 1],
			[Infinity, 1],
			[1, -1],
		])
			assert.equal(formatRequestCostMultiplier(cost, catalog), null);
		assert.equal(formatRequestCostMultiplier(0.5, 1, 'ko'), '×0.5');
	});
});

// The billing unit and the observed usage are related, but not interchangeable.
it('keeps additional observed token/audio data in details without duplicating metrics', () => {
	const metrics = requestLogDetailUsageMetrics({
		billing_kind: 'audio_per_second',
		audio_duration_seconds: 1.997,
		input_tokens: 500,
		output_tokens: 0,
		total_tokens: 500,
	});
	assert.deepEqual(
		metrics.map(({ key, value }) => [key, value]),
		[
			['seconds', 1.997],
			['input', 500],
			['total', 500],
		]
	);
	const tokenAudio = requestLogDetailUsageMetrics({
		billing_kind: 'audio_tokens',
		input_tokens: 10,
		output_tokens: 20,
		audio_duration_seconds: 0,
	});
	assert.equal(tokenAudio.at(-1)?.value, 0);
	assert.equal(
		new Set(tokenAudio.map((metric) => metric.key)).size,
		tokenAudio.length
	);
});

describe('LLM billable input display', () => {
	it('subtracts both input cache buckets and preserves output including reasoning', () => {
		const log = {
			input_tokens: 8054,
			output_tokens: 729,
			cache_read_tokens: 7808,
			cache_write_tokens: 128,
			reasoning_tokens: 600,
		};
		const metrics = requestLogUsageMetrics(log);
		assert.equal(metrics[0].value, 118);
		assert.equal(metrics[0].inputTotal, 8054);
		assert.equal(metrics[0].field, 'uncachedInputTokens');
		assert.equal(metrics[1].value, 729);
		assert.equal(requestLogDetailUsageMetrics(log)[0].value, 8054);
		assert.equal(requestLogDetailUsageMetrics(log)[0].field, 'inputTokens');
		// Four displayed buckets reproduce the existing token cost formula.
		assert.equal(
			metrics.reduce(
				(sum, metric, index) =>
					sum + (metric.value ?? 0) * [2, 8, 0.2, 2.5][index],
				0
			),
			118 * 2 + 729 * 8 + 7808 * 0.2 + 128 * 2.5
		);
	});
	it('keeps fully cached input as zero and leaves uncached requests unchanged', () => {
		assert.equal(
			requestLogUsageMetrics({
				input_tokens: 100,
				output_tokens: 10,
				cache_read_tokens: 40,
				cache_write_tokens: 60,
			})[0].value,
			0
		);
		assert.equal(
			requestLogUsageMetrics({ input_tokens: 100, output_tokens: 10 })[0].value,
			100
		);
	});
	it('does not invent a negative or zero split for inconsistent or missing totals', () => {
		for (const input_tokens of [undefined, 10, NaN]) {
			const log = {
				input_tokens,
				output_tokens: 1,
				cache_read_tokens: 20,
				cache_write_tokens: 5,
			};
			assert.equal(requestLogUsageMetrics(log)[0].value, undefined);
			assert.equal(
				requestLogUsageMetrics(log).find((metric) => metric.key === 'cacheRead')
					?.value,
				20
			);
			assert.equal(requestLogDetailUsageMetrics(log)[0].value, input_tokens);
		}
	});
	it('does not apply the LLM split to image/audio/embedding/tool/MCP measurements', () => {
		for (const extra of [
			{ billing_kind: 'image_tokens' },
			{ billing_kind: 'audio_tokens' },
			{ request_operation: 'embeddings' },
			{ model_id: 'tool:web-search' },
			{ model_id: 'mcp:service/tool' },
		]) {
			const metrics = requestLogUsageMetrics({
				input_tokens: 100,
				output_tokens: 2,
				cache_read_tokens: 40,
				...extra,
			});
			assert.equal(metrics[0].value, 100);
			assert.equal(metrics[0].field, 'inputTokens');
		}
	});
});

it('uses catalog model kind for legacy logs that have no operation or billing kind', () => {
	const metrics = requestLogUsageMetrics(
		{ input_tokens: 100, output_tokens: 2, cache_read_tokens: 40 },
		{
			catalogModel: {
				input_modalities: ['text'],
				output_modalities: ['embedding'],
			},
		}
	);
	assert.equal(metrics[0].value, 100);
	assert.equal(metrics[0].field, 'inputTokens');
});
