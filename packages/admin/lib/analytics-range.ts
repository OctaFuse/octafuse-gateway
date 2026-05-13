/**
 * Analytics 页共用：时间窗 UTC 字符串、成本汇总、表格排序。
 */
import type { AnalyticsRowCosts } from '@/lib/types';

/** 快捷时间窗（与仪表盘 `range` 查询共用短名：1h / 1d / 7d …）。 */
export type GatewayTimeRangePreset = '1h' | '1d' | '7d' | '14d' | '30d' | '90d' | 'custom';

/** @deprecated 使用 `GatewayTimeRangePreset`；保留 `24h` 别名以兼容旧代码。 */
export type AnalyticsRangePreset = GatewayTimeRangePreset | '24h';

const PRESET_ORDER: Array<Exclude<GatewayTimeRangePreset, 'custom'>> = ['1h', '1d', '7d', '14d', '30d', '90d'];

export const GATEWAY_TIME_RANGE_PRESETS = PRESET_ORDER;

export function rangeToParams(
	range: Exclude<GatewayTimeRangePreset, 'custom'> | '24h'
): { start_date: string; end_date: string } {
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
			start.setTime(end.getTime() - 24 * 60 * 60 * 1000);
	}
	return {
		start_date: start.toISOString().slice(0, 19).replace('T', ' '),
		end_date: end.toISOString().slice(0, 19).replace('T', ' '),
	};
}

/**
 * 若 `end` 接近当前时刻且时长与某滚动预设一致，返回该预设（用于列表页高亮快捷按钮）。
 */
export function detectRollingPreset(
	start_date: string,
	end_date: string,
	toleranceMs = 120_000
): Exclude<GatewayTimeRangePreset, 'custom'> | null {
	if (!start_date?.trim() || !end_date?.trim()) return null;
	const startMs = Date.parse(start_date.includes('T') ? start_date : `${start_date.replace(' ', 'T')}Z`);
	const endMs = Date.parse(end_date.includes('T') ? end_date : `${end_date.replace(' ', 'T')}Z`);
	if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null;
	const now = Date.now();
	if (Math.abs(now - endMs) > toleranceMs) return null;
	const dur = endMs - startMs;
	for (const p of PRESET_ORDER) {
		const { start_date: s, end_date: e } = rangeToParams(p);
		const sm = Date.parse(s.replace(' ', 'T') + 'Z');
		const em = Date.parse(e.replace(' ', 'T') + 'Z');
		const expectedDur = em - sm;
		if (!Number.isNaN(sm) && !Number.isNaN(em) && Math.abs(expectedDur - dur) < toleranceMs) {
			return p;
		}
	}
	return null;
}

export type GatewayTimeRangeValue = {
	preset: GatewayTimeRangePreset;
	start_date: string;
	end_date: string;
};

export function createRangeValue(preset: Exclude<GatewayTimeRangePreset, 'custom'>): GatewayTimeRangeValue {
	const { start_date, end_date } = rangeToParams(preset);
	return { preset, start_date, end_date };
}

/** UTC API string（`YYYY-MM-DD HH:MM:SS` 或 ISO 8601 `...Z`）→ value for `datetime-local` (browser local). */
export function apiUtcToDatetimeLocal(api: string): string {
	const d = new Date(api.includes('T') ? api : `${api.replace(' ', 'T')}Z`);
	if (isNaN(d.getTime())) return '';
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `datetime-local` (local) → UTC API string for `start_date` / `end_date`. */
export function datetimeLocalToApiUtc(localStr: string): string {
	const d = new Date(localStr);
	if (isNaN(d.getTime())) return '';
	return d.toISOString().slice(0, 19).replace('T', ' ');
}

/** API 串 `YYYY-MM-DD HH:MM:SS`（UTC）→ 毫秒；勿用 `new Date(无 Z 的串)`（会被当成本地时间）。 */
function apiUtcStringToMs(sqlUtc: string): number {
	return Date.parse(sqlUtc.includes('T') ? sqlUtc : `${sqlUtc.replace(' ', 'T')}Z`);
}

/**
 * 自定义起止：本地 → UTC 字符串后只比较/交换字符串，不再经 `Date` 解析无 Z 的串，避免 Apply 后时间偏移。
 */
export function normalizeCustomApiRange(
	startUtc: string,
	endUtc: string
): { start_date: string; end_date: string } | null {
	const sMs = apiUtcStringToMs(startUtc);
	const eMs = apiUtcStringToMs(endUtc);
	if (Number.isNaN(sMs) || Number.isNaN(eMs)) return null;
	if (sMs <= eMs) return { start_date: startUtc, end_date: endUtc };
	return { start_date: endUtc, end_date: startUtc };
}

/**
 * 解析当前选中的时间窗；custom 且输入非法时返回 null。
 */
export function computeAnalyticsDateRange(
	range: AnalyticsRangePreset,
	customStartLocal: string,
	customEndLocal: string
): { start_date: string; end_date: string } | null {
	if (range === 'custom') {
		const s = datetimeLocalToApiUtc(customStartLocal);
		const e = datetimeLocalToApiUtc(customEndLocal);
		if (!s || !e) return null;
		return normalizeCustomApiRange(s, e);
	}
	if (range === '24h') return rangeToParams('24h');
	return rangeToParams(range as Exclude<GatewayTimeRangePreset, 'custom'>);
}

export function sumAnalyticsCosts(rows: ReadonlyArray<AnalyticsRowCosts>): {
	standard: number;
	charged: number;
	metered: number;
} {
	let standard = 0;
	let charged = 0;
	let metered = 0;
	for (const r of rows) {
		standard += r.standard_cost ?? 0;
		charged += r.charged_cost;
		metered += r.metered_cost;
	}
	return { standard, charged, metered };
}

type SortDir = 'asc' | 'desc';

/** 分析表通用排序：`standard_cost` 按数值含缺省；其余数字 / 字符串 / null 与原先逻辑一致。 */
export function compareAnalyticsTableRows(a: object, b: object, sortKey: string, sortDir: SortDir): number {
	if (!sortKey) return 0;
	if (sortKey === 'standard_cost') {
		const na = Number((a as AnalyticsRowCosts).standard_cost ?? 0);
		const nb = Number((b as AnalyticsRowCosts).standard_cost ?? 0);
		return sortDir === 'asc' ? na - nb : nb - na;
	}
	const ra = a as Record<string, unknown>;
	const rb = b as Record<string, unknown>;
	const va = ra[sortKey];
	const vb = rb[sortKey];
	if (typeof va === 'number' && typeof vb === 'number') return sortDir === 'asc' ? va - vb : vb - va;
	if (typeof va === 'string' && typeof vb === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
	if (va == null && vb == null) return 0;
	if (va == null) return sortDir === 'asc' ? -1 : 1;
	if (vb == null) return sortDir === 'asc' ? 1 : -1;
	return 0;
}
