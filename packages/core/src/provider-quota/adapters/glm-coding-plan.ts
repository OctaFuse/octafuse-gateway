/**
 * 智谱 / Z.AI Coding Plan `GET /api/monitor/usage/quota/limit`。
 * `CREDIT_LIMIT` 与 `TOKENS_LIMIT` 共用字段：`usage` 是窗口上限，`percentage` 是已用百分比，
 * `nextResetTime` 是毫秒时间戳。`unit=3,number=5` 为 5 小时，`unit=6,number=1` 为每周。
 */
import { fetchProviderQuotaJson, finiteNumber, isJsonRecord } from '../http';
import { buildProviderQuotaSnapshot, quotaCheckedAt } from '../state';
import {
	ProviderQuotaParseError,
	ProviderQuotaUpstreamError,
	type ProviderQuotaAdapter,
	type ProviderQuotaWindow,
} from '../types';

function epochIso(value: unknown): string | null {
	const raw = finiteNumber(value);
	if (raw == null || raw <= 0) return null;
	const ms = raw > 1e12 ? raw : raw > 1e9 ? raw * 1000 : null;
	if (ms == null) return null;
	const date = new Date(ms);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function windowId(unit: number, number: number): string | null {
	if (unit === 3 && number === 5) return '5h';
	if (unit === 6 && number === 1) return 'weekly';
	return null;
}

export function parseGlmCodingPlanLimits(body: unknown): ProviderQuotaWindow[] {
	if (!isJsonRecord(body)) throw new ProviderQuotaParseError();
	const code = finiteNumber(body.code);
	if (code != null && code !== 200) {
		throw new ProviderQuotaUpstreamError(200, 'Upstream quota request failed (200)');
	}
	if (body.success === false) {
		throw new ProviderQuotaUpstreamError(200, 'Upstream quota request failed (200)');
	}
	const data = isJsonRecord(body.data) ? body.data : body;
	if (!Array.isArray(data.limits)) throw new ProviderQuotaParseError();
	const windows: ProviderQuotaWindow[] = [];
	for (const entry of data.limits) {
		if (!isJsonRecord(entry)) continue;
		const type = typeof entry.type === 'string' ? entry.type.toUpperCase() : '';
		if (type !== 'CREDIT_LIMIT' && type !== 'TOKENS_LIMIT') continue;
		const unit = finiteNumber(entry.unit);
		const number = finiteNumber(entry.number);
		if (unit == null || number == null) continue;
		const id = windowId(unit, number);
		if (!id || windows.some((window) => window.id === id)) continue;
		const limit = finiteNumber(entry.usage);
		const usedPercent = finiteNumber(entry.percentage);
		const currentValue = finiteNumber(entry.currentValue);
		const remainingField = finiteNumber(entry.remaining);
		if (limit == null && usedPercent == null && currentValue == null && remainingField == null) continue;
		const used =
			currentValue ??
			(limit != null && remainingField != null
				? limit - remainingField
				: limit != null && usedPercent != null
					? (limit * usedPercent) / 100
					: undefined);
		const remaining =
			remainingField ?? (limit != null && used != null ? limit - used : undefined);
		windows.push({
			id,
			unit: 'tokens',
			...(used == null ? {} : { used }),
			...(limit == null ? {} : { limit }),
			...(remaining == null ? {} : { remaining }),
			...(usedPercent == null ? {} : { usedPercent }),
			resetsAt: epochIso(entry.nextResetTime),
		});
	}
	if (windows.length === 0) throw new ProviderQuotaParseError();
	return windows;
}

function createGlmCodingPlanQuotaAdapter(id: string, defaultOrigin: string): ProviderQuotaAdapter {
	return {
		id,
		defaultOrigin,
		async fetch(ctx) {
			const body = await fetchProviderQuotaJson(ctx, '/api/monitor/usage/quota/limit');
			return buildProviderQuotaSnapshot({
				adapter: id,
				checkedAt: quotaCheckedAt(ctx.now),
				balances: [],
				windows: parseGlmCodingPlanLimits(body),
			});
		},
	};
}

export const zhipuCodingPlanQuotaAdapter = createGlmCodingPlanQuotaAdapter(
	'zhipu-coding-plan',
	'https://open.bigmodel.cn',
);

export const zaiCodingPlanQuotaAdapter = createGlmCodingPlanQuotaAdapter(
	'zai-coding-plan',
	'https://api.z.ai',
);
