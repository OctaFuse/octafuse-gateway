import type { GatewayRequestLog } from '@/lib/types';
import type { ModelKindFields } from '@octafuse/core/db/model-modalities';
import { requestLogFeatureKind } from './request-log-display';

export type UsageMetric = {
	key:
		| 'input'
		| 'output'
		| 'cacheRead'
		| 'cacheWrite'
		| 'reasoning'
		| 'total'
		| 'inputImages'
		| 'outputImages'
		| 'seconds'
		| 'characters';
	field:
		| 'inputTokens'
		| 'uncachedInputTokens'
		| 'outputTokens'
		| 'cacheRead'
		| 'cacheWrite'
		| 'reasoningTokens'
		| 'totalTokens'
		| 'inputImages'
		| 'outputImages'
		| 'audioSeconds'
		| 'audioCharacters';
	value: number | null | undefined;
	inputTotal?: number | null;
	unit: 'tokens' | 'images' | 'seconds' | 'characters';
};

type UsageLog = Partial<GatewayRequestLog>;

/** Image counts are separate measurements; token counts must not substitute for audio units. */
export function requestLogUsageMetrics(
	log: UsageLog,
	{
		billableInput = true,
		catalogModel,
	}: { billableInput?: boolean; catalogModel?: ModelKindFields | null } = {}
): UsageMetric[] {
	if (log.billing_kind === 'image_per_image')
		return [
			{
				key: 'inputImages',
				field: 'inputImages',
				value: log.input_image_count,
				unit: 'images',
			},
			{
				key: 'outputImages',
				field: 'outputImages',
				value: log.output_image_count,
				unit: 'images',
			},
		];
	if (log.billing_kind === 'audio_per_second')
		return [
			{
				key: 'seconds',
				field: 'audioSeconds',
				value: log.audio_duration_seconds,
				unit: 'seconds',
			},
		];
	if (log.billing_kind === 'audio_per_character')
		return [
			{
				key: 'characters',
				field: 'audioCharacters',
				value: log.audio_characters,
				unit: 'characters',
			},
		];
	const kind = requestLogFeatureKind(log, catalogModel);
	const hasTokens = [
		log.input_tokens,
		log.output_tokens,
		log.cache_read_tokens,
		log.cache_write_tokens,
		log.reasoning_tokens,
		log.total_tokens,
	].some((value) => value != null && value > 0);
	if (!hasTokens && ['tool', 'mcp'].includes(kind)) return [];
	const metrics: UsageMetric[] = [];
	// Cache buckets belong to input only. Output (including reasoning) is charged independently.
	const splitInput = billableInput && kind === 'llm';
	const cacheRead = log.cache_read_tokens ?? 0;
	const cacheWrite = log.cache_write_tokens ?? 0;
	const inputTotal = log.input_tokens;
	const regularInput =
		inputTotal != null &&
		Number.isFinite(inputTotal) &&
		Number.isFinite(cacheRead) &&
		Number.isFinite(cacheWrite) &&
		cacheRead >= 0 &&
		cacheWrite >= 0 &&
		inputTotal >= cacheRead + cacheWrite
			? inputTotal - cacheRead - cacheWrite
			: undefined;
	// Legacy records can contain only a total or reasoning count. Do not replace it with 0 / 0.
	if (
		!log.input_tokens &&
		!log.output_tokens &&
		((log.total_tokens ?? 0) > 0 || (log.reasoning_tokens ?? 0) > 0)
	) {
		if ((log.total_tokens ?? 0) > 0)
			metrics.push({
				key: 'total',
				field: 'totalTokens',
				value: log.total_tokens,
				unit: 'tokens',
			});
		if ((log.reasoning_tokens ?? 0) > 0)
			metrics.push({
				key: 'reasoning',
				field: 'reasoningTokens',
				value: log.reasoning_tokens,
				unit: 'tokens',
			});
	} else {
		metrics.push(
			{
				key: 'input',
				field: splitInput ? 'uncachedInputTokens' : 'inputTokens',
				value: splitInput ? regularInput : log.input_tokens,
				...(splitInput ? { inputTotal } : {}),
				unit: 'tokens',
			},
			{
				key: 'output',
				field: 'outputTokens',
				value: log.output_tokens,
				unit: 'tokens',
			}
		);
	}
	if ((log.cache_read_tokens ?? 0) > 0)
		metrics.push({
			key: 'cacheRead',
			field: 'cacheRead',
			value: log.cache_read_tokens,
			unit: 'tokens',
		});
	if ((log.cache_write_tokens ?? 0) > 0)
		metrics.push({
			key: 'cacheWrite',
			field: 'cacheWrite',
			value: log.cache_write_tokens,
			unit: 'tokens',
		});
	return metrics;
}

/** Details retain additional observed measurements even when billing uses a different unit. */
export function requestLogDetailUsageMetrics(log: UsageLog): UsageMetric[] {
	const primary = requestLogUsageMetrics(log, { billableInput: false });
	const observed: UsageMetric[] = [
		{
			key: 'input',
			field: 'inputTokens',
			value: log.input_tokens,
			unit: 'tokens',
		},
		{
			key: 'output',
			field: 'outputTokens',
			value: log.output_tokens,
			unit: 'tokens',
		},
		{
			key: 'cacheRead',
			field: 'cacheRead',
			value: log.cache_read_tokens,
			unit: 'tokens',
		},
		{
			key: 'cacheWrite',
			field: 'cacheWrite',
			value: log.cache_write_tokens,
			unit: 'tokens',
		},
		{
			key: 'reasoning',
			field: 'reasoningTokens',
			value: log.reasoning_tokens,
			unit: 'tokens',
		},
		{
			key: 'total',
			field: 'totalTokens',
			value: log.total_tokens,
			unit: 'tokens',
		},
		{
			key: 'inputImages',
			field: 'inputImages',
			value: log.input_image_count,
			unit: 'images',
		},
		{
			key: 'outputImages',
			field: 'outputImages',
			value: log.output_image_count,
			unit: 'images',
		},
		{
			key: 'seconds',
			field: 'audioSeconds',
			value: log.audio_duration_seconds,
			unit: 'seconds',
		},
		{
			key: 'characters',
			field: 'audioCharacters',
			value: log.audio_characters,
			unit: 'characters',
		},
	];
	return [
		...primary,
		...observed.filter(
			(metric) =>
				!primary.some((item) => item.key === metric.key) &&
				metric.value != null &&
				(metric.value > 0 ||
					metric.unit === 'seconds' ||
					metric.unit === 'characters')
		),
	];
}

/** Preserve true zero, but never round a positive charge factor down to zero. */
export function formatRequestCostMultiplier(
	cost: number | string | null | undefined,
	standardCost: number | string | null | undefined,
	locale = 'en-US'
): string | null {
	if (
		cost == null ||
		standardCost == null ||
		String(cost).trim() === '' ||
		String(standardCost).trim() === ''
	)
		return null;
	// SQL decimal columns can arrive as numeric strings in historical detail responses.
	const amount = Number(cost);
	const catalog = Number(standardCost);
	if (
		!Number.isFinite(amount) ||
		!Number.isFinite(catalog) ||
		amount < 0 ||
		catalog <= 0
	)
		return null;
	const ratio = amount / catalog;
	if (!Number.isFinite(ratio)) return null;
	const value =
		ratio > 0 && (ratio < 0.000001 || ratio >= 1e9)
			? ratio.toExponential(2)
			: ratio.toLocaleString(
					locale,
					ratio > 0 && ratio < 0.001
						? { maximumSignificantDigits: 3 }
						: { maximumFractionDigits: 3 }
			  );
	return `×${value}`;
}
