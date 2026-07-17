/**
 * 路由 `price_override.schedule`：每日循环时段倍率。
 * 与 `charged_factor` / `metered_factor` 组合：effective = base_factor × schedule_factor。
 * 时区由调用方传入（通常为 `system_config.BUSINESS_TIMEZONE`）。
 */
import type { BillingPriceSnapshot } from './pricing-profile';

export type DailyScheduleWindow = {
	start: string;
	end: string;
	factor: number;
};

export type RoutePricingSchedule = {
	charged: DailyScheduleWindow[];
	metered: DailyScheduleWindow[];
};

export type ScheduleFactorResolution = {
	factor: number;
	localTime: string;
	timezone: string;
	evaluatedAtUtc: string;
	window: DailyScheduleWindow | null;
};

const HH_MM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const END_24_RE = /^24:00$/;

/** 将 `HH:mm` 或 `24:00` 转为当日分钟数；非法返回 null。 */
export function parseHhMmToMinutes(value: string): number | null {
	const t = value.trim();
	if (END_24_RE.test(t)) {
		return 24 * 60;
	}
	const m = HH_MM_RE.exec(t);
	if (!m) {
		return null;
	}
	return Number(m[1]) * 60 + Number(m[2]);
}

function asNonNegativeFactor(v: unknown): number | null {
	if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
		return v;
	}
	if (typeof v === 'string' && v.trim() !== '') {
		const n = Number(v.trim());
		if (Number.isFinite(n) && n >= 0) {
			return n;
		}
	}
	return null;
}

function parseWindowRow(row: unknown): DailyScheduleWindow | null {
	if (!row || typeof row !== 'object' || Array.isArray(row)) {
		return null;
	}
	const o = row as Record<string, unknown>;
	const start = typeof o.start === 'string' ? o.start.trim() : '';
	const end = typeof o.end === 'string' ? o.end.trim() : '';
	const startMinutes = parseHhMmToMinutes(start);
	const endMinutes = parseHhMmToMinutes(end);
	// `24:00` is only a valid end-of-day marker. A window must have non-zero duration.
	if (
		startMinutes == null ||
		startMinutes === 24 * 60 ||
		endMinutes == null ||
		startMinutes === endMinutes
	) {
		return null;
	}
	const factor = asNonNegativeFactor(o.factor);
	if (factor == null) {
		return null;
	}
	return { start, end, factor };
}

function parseWindowArray(raw: unknown): DailyScheduleWindow[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	const out: DailyScheduleWindow[] = [];
	for (const item of raw) {
		const w = parseWindowRow(item);
		if (w) {
			out.push(w);
		}
	}
	return out;
}

/**
 * 从 `price_override` JSON 解析 `schedule`；缺省或非法侧返回空数组（运行时倍率 1）。
 */
export function parseRoutePricingSchedule(priceOverrideJson: string | null | undefined): RoutePricingSchedule {
	const empty: RoutePricingSchedule = { charged: [], metered: [] };
	if (priceOverrideJson == null || String(priceOverrideJson).trim() === '') {
		return empty;
	}
	try {
		const o = JSON.parse(priceOverrideJson) as Record<string, unknown>;
		const sch = o.schedule;
		if (!sch || typeof sch !== 'object' || Array.isArray(sch)) {
			return empty;
		}
		const s = sch as Record<string, unknown>;
		return {
			charged: parseWindowArray(s.charged),
			metered: parseWindowArray(s.metered),
		};
	} catch {
		return empty;
	}
}

function readRootFactor(obj: Record<string, unknown>, key: string): number | null {
	return asNonNegativeFactor(obj[key]);
}

/**
 * 读取路由基础倍率；缺省 1。`metered_factor` 缺失时回退 `provider_factor`。
 */
export function parseRouteBaseFactors(priceOverrideJson: string | null | undefined): {
	chargedFactor: number;
	meteredFactor: number;
} {
	const defaults = { chargedFactor: 1, meteredFactor: 1 };
	if (priceOverrideJson == null || String(priceOverrideJson).trim() === '') {
		return defaults;
	}
	try {
		const o = JSON.parse(priceOverrideJson) as Record<string, unknown>;
		const charged = readRootFactor(o, 'charged_factor');
		let metered = readRootFactor(o, 'metered_factor');
		if (metered == null) {
			metered = readRootFactor(o, 'provider_factor');
		}
		return {
			chargedFactor: charged ?? 1,
			meteredFactor: metered ?? 1,
		};
	} catch {
		return defaults;
	}
}

/** 在给定时区取本地 `HH:mm`（24h）。 */
export function formatLocalHhMm(nowUtc: Date, timeZone: string): string {
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone,
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
	}).formatToParts(nowUtc);
	const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
	const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
	return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
}

/**
 * 半开区间 `[start, end)`；`start > end` 表示跨午夜。
 * 未命中返回 factor 1、window null。
 */
export function resolveDailyScheduleFactor(
	windows: DailyScheduleWindow[],
	nowUtc: Date,
	businessTimezone: string
): ScheduleFactorResolution {
	const localTime = formatLocalHhMm(nowUtc, businessTimezone);
	const evaluatedAtUtc = nowUtc.toISOString();
	const minutes = parseHhMmToMinutes(localTime);
	if (minutes == null) {
		return { factor: 1, localTime, timezone: businessTimezone, evaluatedAtUtc, window: null };
	}
	for (const w of windows) {
		const startM = parseHhMmToMinutes(w.start);
		const endM = parseHhMmToMinutes(w.end);
		if (startM == null || endM == null) {
			continue;
		}
		let hit = false;
		if (startM < endM) {
			hit = minutes >= startM && minutes < endM;
		} else {
			// 跨午夜：例如 22:00–06:00
			hit = minutes >= startM || minutes < endM;
		}
		if (hit) {
			return {
				factor: w.factor,
				localTime,
				timezone: businessTimezone,
				evaluatedAtUtc,
				window: w,
			};
		}
	}
	return { factor: 1, localTime, timezone: businessTimezone, evaluatedAtUtc, window: null };
}

/** 对单价快照统一乘 factor；`null` 保持 `null`。 */
export function scaleBillingPrices(prices: BillingPriceSnapshot, factor: number): BillingPriceSnapshot {
	const f = Number.isFinite(factor) && factor >= 0 ? factor : 1;
	const scale = (v: number | null): number | null => (v == null ? null : v * f);
	return {
		input_price: scale(prices.input_price),
		output_price: scale(prices.output_price),
		cache_read_price: scale(prices.cache_read_price),
		cache_write_price: scale(prices.cache_write_price),
		image_input_price: scale(prices.image_input_price),
		image_input_cache_price: scale(prices.image_input_cache_price),
		image_output_price: scale(prices.image_output_price),
	};
}

/**
 * Admin 校验用：解析并校验 schedule 两侧窗口（时间格式、factor≥0、禁止同侧重叠）。
 * @returns 规范化后的 schedule 对象，或错误信息
 */
export function coerceRoutePricingScheduleInput(
	raw: unknown
): { ok: true; schedule: RoutePricingSchedule } | { ok: false; message: string } {
	if (raw === undefined || raw === null) {
		return { ok: true, schedule: { charged: [], metered: [] } };
	}
	if (typeof raw !== 'object' || Array.isArray(raw)) {
		return { ok: false, message: 'price_override.schedule must be an object' };
	}
	const o = raw as Record<string, unknown>;
	const coerceSide = (side: 'charged' | 'metered'): DailyScheduleWindow[] | { error: string } => {
		const arr = o[side];
		if (arr === undefined || arr === null) {
			return [];
		}
		if (!Array.isArray(arr)) {
			return { error: `price_override.schedule.${side} must be an array` };
		}
		const windows: DailyScheduleWindow[] = [];
		for (let i = 0; i < arr.length; i++) {
			const w = parseWindowRow(arr[i]);
			if (!w) {
				return {
					error: `price_override.schedule.${side}[${i}]: expected { start, end, factor }; start must be HH:mm, end may also be 24:00, factor ≥ 0, duration must be non-zero`,
				};
			}
			windows.push(w);
		}
		const overlapErr = findDailyWindowOverlap(windows);
		if (overlapErr) {
			return { error: `price_override.schedule.${side}: ${overlapErr}` };
		}
		return windows;
	};
	const charged = coerceSide('charged');
	if ('error' in charged) {
		return { ok: false, message: charged.error };
	}
	const metered = coerceSide('metered');
	if ('error' in metered) {
		return { ok: false, message: metered.error };
	}
	return { ok: true, schedule: { charged, metered } };
}

/** 检测同侧窗口是否在「展开到两日」后重叠（含跨午夜）。 */
export function findDailyWindowOverlap(windows: DailyScheduleWindow[]): string | null {
	type Seg = { a: number; b: number; label: string };
	const segs: Seg[] = [];
	for (const w of windows) {
		const startM = parseHhMmToMinutes(w.start);
		const endM = parseHhMmToMinutes(w.end);
		if (startM == null || endM == null) {
			continue;
		}
		const label = `${w.start}-${w.end}`;
		if (startM < endM) {
			segs.push({ a: startM, b: endM, label });
		} else {
			segs.push({ a: startM, b: 24 * 60, label });
			segs.push({ a: 0, b: endM, label });
		}
	}
	segs.sort((x, y) => x.a - y.a || x.b - y.b);
	for (let i = 1; i < segs.length; i++) {
		const prev = segs[i - 1]!;
		const cur = segs[i]!;
		if (cur.a < prev.b) {
			return `overlapping windows ${prev.label} and ${cur.label}`;
		}
	}
	return null;
}
