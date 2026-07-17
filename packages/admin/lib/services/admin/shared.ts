/**
 * 管理后台共用工具：标签 JSON、元数据校验、统计时间范围、供应商 vendor 归一化等。
 */
export { nullIfEmpty } from '@octafuse/core/lib/string-utils';

export { normalizeModelVendorInput } from '../../model-vendor';

/** 将 D1 中 `json_group_array` 得到的 JSON 字符串解析为 string[]；非法则 []。 */
export function parseTagsJson(tagsJson: string | null): string[] {
	if (tagsJson == null || tagsJson === '') return [];
	try {
		const arr = JSON.parse(tagsJson);
		return Array.isArray(arr) ? arr : [];
	} catch {
		return [];
	}
}

/**
 * 仪表盘 KPI 相对时间窗：将 `1h`/`1d`/`24h`/`7d`/`14d`/`30d`（及 API 兼容的 `90d`）转为起止 `YYYY-MM-DD HH:mm:ss`（UTC 切片，与 Admin 分析页一致）。
 */
export function rangeToDates(range: string): { startDate: string; endDate: string } {
	const end = new Date();
	const start = new Date(end.getTime());
	switch (range) {
		case '1h':
			start.setTime(end.getTime() - 60 * 60 * 1000);
			break;
		case '1d':
		case '24h':
			start.setTime(end.getTime() - 24 * 60 * 60 * 1000);
			break;
		case '7d':
			start.setDate(start.getDate() - 7);
			break;
		case '14d':
			start.setDate(start.getDate() - 14);
			break;
		case '30d':
			start.setDate(start.getDate() - 30);
			break;
		case '90d':
			start.setDate(start.getDate() - 90);
			break;
		default:
			start.setDate(start.getDate() - 7);
	}
	return {
		startDate: start.toISOString().slice(0, 19).replace('T', ' '),
		endDate: end.toISOString().slice(0, 19).replace('T', ' '),
	};
}

/** 仪表盘时序粒度：`1h`/`1d`/`24h` 按小时，更长区间按天。 */
export function rangeToGranularity(range: string): 'hour' | 'day' {
	switch (range) {
		case '1h':
		case '1d':
		case '24h':
			return 'hour';
		default:
			return 'day';
	}
}

/** 按绝对时间窗时长推导时序粒度（自定义区间与 Request Logs 一致）。 */
export function durationToGranularity(startDate: string, endDate: string): 'hour' | 'day' {
	const startMs = apiUtcSqlStringToMs(startDate);
	const endMs = apiUtcSqlStringToMs(endDate);
	if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
		return 'hour';
	}
	const dur = endMs - startMs;
	return dur <= 2 * MS_PER_DAY ? 'hour' : 'day';
}

/**
 * 解析仪表盘 KPI 时间窗：优先 `startDate`/`endDate`（与 Request Logs / Analytics 一致），否则回退 `range` 预设。
 */
export function resolveStatsDateRange(input: {
	range?: string;
	startDate?: string;
	endDate?: string;
}): { startDate: string; endDate: string; granularity: 'hour' | 'day' } {
	const hasExplicit = Boolean(input.startDate?.trim() && input.endDate?.trim());
	if (hasExplicit) {
		const { start, end } = clampAnalyticsRange(input.startDate, input.endDate);
		return {
			startDate: start,
			endDate: end,
			granularity: durationToGranularity(start, end),
		};
	}
	const range = input.range ?? '1d';
	const { startDate, endDate } = rangeToDates(range);
	return {
		startDate,
		endDate,
		granularity: rangeToGranularity(range),
	};
}

const MAX_ANALYTICS_DAYS = 180;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * API/SQL UTC 字符串 → 毫秒。`YYYY-MM-DD HH:mm:ss` 按 UTC 解析（与 Request Logs / 分析页前端一致）。
 * 勿用 `new Date(无 Z 的串)`，否则在 UTC+8 等环境会按本地时区解析并导致查询窗偏移。
 */
export function apiUtcSqlStringToMs(sqlUtc: string): number {
	const trimmed = sqlUtc.trim();
	if (!trimmed) return NaN;
	return Date.parse(trimmed.includes('T') ? trimmed : `${trimmed.replace(' ', 'T')}Z`);
}

/** 毫秒 → API/SQL UTC 字符串（`YYYY-MM-DD HH:mm:ss`）。 */
export function msToApiUtcSqlString(ms: number): string {
	return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * 分析 API 绝对时间窗：默认最近 7 天；起始不早于结束日前 180 天。
 * @returns 与 SQL `created_at` 比较的字符串边界（UTC，与 `api_key_request_logs` 写入格式一致）
 */
export function clampAnalyticsRange(startDate?: string, endDate?: string): { start: string; end: string } {
	const nowMs = Date.now();
	const endMs = endDate?.trim() ? apiUtcSqlStringToMs(endDate) : nowMs;
	const resolvedEndMs = Number.isNaN(endMs) ? nowMs : endMs;

	let startMs: number;
	if (startDate?.trim()) {
		startMs = apiUtcSqlStringToMs(startDate);
		if (Number.isNaN(startMs)) {
			startMs = resolvedEndMs - 7 * MS_PER_DAY;
		}
	} else {
		startMs = resolvedEndMs - 7 * MS_PER_DAY;
	}

	const maxStartMs = resolvedEndMs - MAX_ANALYTICS_DAYS * MS_PER_DAY;
	if (startMs < maxStartMs) {
		startMs = maxStartMs;
	}

	return {
		start: msToApiUtcSqlString(startMs),
		end: msToApiUtcSqlString(resolvedEndMs),
	};
}

/**
 * 校验 metadata 为 JSON 字符串并规范化为紧凑字符串；空串视为 null。
 */
export function normalizeMetadataInput(raw: unknown): { ok: true; value: string | null } | { ok: false; message: string } {
	if (raw === undefined || raw === null || raw === '') return { ok: true, value: null };
	if (typeof raw !== 'string') return { ok: false, message: 'metadata must be a JSON string' };
	const t = raw.trim();
	if (t === '') return { ok: true, value: null };
	try {
		return { ok: true, value: JSON.stringify(JSON.parse(t)) };
	} catch {
		return { ok: false, message: 'metadata must be valid JSON' };
	}
}

/**
 * 路由 `custom_params`：接受 JSON 字符串或对象，存库前转为字符串；空为 null。
 */
export function normalizeJsonObjectField(
	value: unknown,
	fieldName: string
): { ok: true; value: string | null } | { ok: false; message: string } {
	if (value === undefined || value === null || value === '') return { ok: true, value: null };
	if (typeof value === 'string') {
		try {
			const parsed = JSON.parse(value) as unknown;
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
				return { ok: false, message: `${fieldName} must be a JSON object` };
			}
			return { ok: true, value: JSON.stringify(parsed) };
		} catch {
			return { ok: false, message: `${fieldName} must be valid JSON` };
		}
	}
	if (typeof value === 'object' && !Array.isArray(value)) return { ok: true, value: JSON.stringify(value) };
	return { ok: false, message: `${fieldName} must be a JSON object` };
}

/**
 * 判断 provider 行是否配置了某协议所需的 endpoints（base 或任一 capability；含 legacy 列回退）。
 */
export { providerSupportsUpstreamProtocol } from '@octafuse/core/provider-endpoints';
