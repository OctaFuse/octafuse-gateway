/**
 * 路由 `price_override.schedule`：每日循环时段倍率。
 * - 缺省 / `mode: "multiply"`（存量）：effective = base_factor × schedule_factor（未命中窗 schedule=1）。
 * - `mode: "override"`（Admin UI 新写入）：命中窗用窗口 factor，未命中用 base_factor。
 * 时区由调用方传入（通常为 `system_config.BUSINESS_TIMEZONE`）。
 */
import type { BillingPriceSnapshot } from './pricing-profile';

export type DailyScheduleWindow = {
	start: string;
	end: string;
	factor: number;
};

/** `multiply` = 旧叠乘；`override` = 窗口 factor 即对标准价的倍率。 */
export type RoutePricingScheduleMode = 'multiply' | 'override';

export type RoutePricingSchedule = {
	mode: RoutePricingScheduleMode;
	charged: DailyScheduleWindow[];
	metered: DailyScheduleWindow[];
};

/** Admin 合并编辑用：共享 start/end，两侧各一列倍率（均为对标准价的有效倍率）。 */
export type SharedScheduleWindow = {
	start: string;
	end: string;
	charged_factor: number;
	metered_factor: number;
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

export function parseRoutePricingScheduleMode(raw: unknown): RoutePricingScheduleMode {
	return raw === 'override' ? 'override' : 'multiply';
}

const EMPTY_SCHEDULE: RoutePricingSchedule = { mode: 'multiply', charged: [], metered: [] };

/**
 * 从 `price_override` JSON 解析 `schedule`；缺省或非法侧返回空数组（运行时倍率 1）。
 * 无 `mode` 或非法值按存量叠乘（`multiply`）。
 */
export function parseRoutePricingSchedule(priceOverrideJson: string | null | undefined): RoutePricingSchedule {
	if (priceOverrideJson == null || String(priceOverrideJson).trim() === '') {
		return { ...EMPTY_SCHEDULE };
	}
	try {
		const o = JSON.parse(priceOverrideJson) as Record<string, unknown>;
		const sch = o.schedule;
		if (!sch || typeof sch !== 'object' || Array.isArray(sch)) {
			return { ...EMPTY_SCHEDULE };
		}
		const s = sch as Record<string, unknown>;
		return {
			mode: parseRoutePricingScheduleMode(s.mode),
			charged: parseWindowArray(s.charged),
			metered: parseWindowArray(s.metered),
		};
	} catch {
		return { ...EMPTY_SCHEDULE };
	}
}

/** 去掉浮点噪声，便于 bake / 并集拆窗后比较与展示。 */
export function normalizeScheduleFactor(n: number): number {
	if (!Number.isFinite(n) || n < 0) {
		return 1;
	}
	return Math.round(n * 1e10) / 1e10;
}

/**
 * 将一侧窗口倍率与基础倍率合成对标准价的有效倍率。
 * override：命中窗用窗口 factor，未命中用 base。
 * multiply：base ×（命中窗 factor，未命中为 1）。
 */
export function resolveEffectiveRouteFactor(
	baseFactor: number,
	scheduleFactor: ScheduleFactorResolution,
	mode: RoutePricingScheduleMode
): number {
	const base = Number.isFinite(baseFactor) && baseFactor >= 0 ? baseFactor : 1;
	if (mode === 'override') {
		return normalizeScheduleFactor(scheduleFactor.window ? scheduleFactor.factor : base);
	}
	return normalizeScheduleFactor(base * scheduleFactor.factor);
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
 * `persistMode` 为 true 时调用方应把 `schedule.mode` 写回 JSON；缺省不写（存量叠乘）。
 */
export function coerceRoutePricingScheduleInput(
	raw: unknown
):
	| { ok: true; schedule: RoutePricingSchedule; persistMode: boolean }
	| { ok: false; message: string } {
	if (raw === undefined || raw === null) {
		return { ok: true, schedule: { ...EMPTY_SCHEDULE }, persistMode: false };
	}
	if (typeof raw !== 'object' || Array.isArray(raw)) {
		return { ok: false, message: 'price_override.schedule must be an object' };
	}
	const o = raw as Record<string, unknown>;
	let persistMode = false;
	let mode: RoutePricingScheduleMode = 'multiply';
	if (Object.prototype.hasOwnProperty.call(o, 'mode')) {
		persistMode = true;
		if (o.mode === 'override') {
			mode = 'override';
		} else if (o.mode === 'multiply') {
			mode = 'multiply';
		} else {
			return { ok: false, message: 'price_override.schedule.mode must be "override" or "multiply"' };
		}
	}
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
	return { ok: true, schedule: { mode, charged, metered }, persistMode };
}

function minutesInWindow(w: DailyScheduleWindow, minutes: number): boolean {
	const startM = parseHhMmToMinutes(w.start);
	const endM = parseHhMmToMinutes(w.end);
	if (startM == null || endM == null) {
		return false;
	}
	if (startM < endM) {
		return minutes >= startM && minutes < endM;
	}
	return minutes >= startM || minutes < endM;
}

function hitWindowAt(windows: DailyScheduleWindow[], minutes: number): DailyScheduleWindow | null {
	for (const w of windows) {
		if (minutesInWindow(w, minutes)) {
			return w;
		}
	}
	return null;
}

function effectiveSideFactorAt(
	windows: DailyScheduleWindow[],
	minutes: number,
	mode: RoutePricingScheduleMode,
	base: number
): number {
	const hit = hitWindowAt(windows, minutes);
	if (mode === 'override') {
		return normalizeScheduleFactor(hit ? hit.factor : base);
	}
	return normalizeScheduleFactor(base * (hit ? hit.factor : 1));
}

function formatMinutesToHhMm(minutes: number): string {
	if (minutes >= 24 * 60) {
		return '24:00';
	}
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 将两侧独立窗口并成共享 start/end 行，并把旧叠乘 bake 成对标准价的有效倍率。
 * 仅输出至少一侧命中窗口的区间；缺侧按「未命中」处理（override=base，multiply=base×1）。
 */
export function mergeScheduleSidesToSharedWindows(
	charged: DailyScheduleWindow[],
	metered: DailyScheduleWindow[],
	options: {
		mode: RoutePricingScheduleMode;
		chargedBase: number;
		meteredBase: number;
	}
): SharedScheduleWindow[] {
	if (charged.length === 0 && metered.length === 0) {
		return [];
	}
	const bounds = new Set<number>();
	const addBounds = (w: DailyScheduleWindow) => {
		const startM = parseHhMmToMinutes(w.start);
		const endM = parseHhMmToMinutes(w.end);
		if (startM == null || endM == null) {
			return;
		}
		bounds.add(startM);
		bounds.add(endM);
		if (startM > endM) {
			bounds.add(0);
			bounds.add(24 * 60);
		}
	};
	for (const w of charged) {
		addBounds(w);
	}
	for (const w of metered) {
		addBounds(w);
	}
	const sorted = [...bounds].sort((a, b) => a - b);
	const raw: SharedScheduleWindow[] = [];
	for (let i = 0; i < sorted.length - 1; i++) {
		const a = sorted[i]!;
		const b = sorted[i + 1]!;
		if (a >= b) {
			continue;
		}
		const mid = (a + b) / 2;
		if (!hitWindowAt(charged, mid) && !hitWindowAt(metered, mid)) {
			continue;
		}
		raw.push({
			start: formatMinutesToHhMm(a),
			end: formatMinutesToHhMm(b),
			charged_factor: effectiveSideFactorAt(charged, mid, options.mode, options.chargedBase),
			metered_factor: effectiveSideFactorAt(metered, mid, options.mode, options.meteredBase),
		});
	}
	const merged: SharedScheduleWindow[] = [];
	for (const row of raw) {
		const last = merged[merged.length - 1];
		if (
			last &&
			last.end === row.start &&
			last.charged_factor === row.charged_factor &&
			last.metered_factor === row.metered_factor
		) {
			last.end = row.end;
		} else {
			merged.push({ ...row });
		}
	}
	if (merged.length >= 2) {
		const first = merged[0]!;
		const last = merged[merged.length - 1]!;
		if (
			first.start === '00:00' &&
			last.end === '24:00' &&
			first.charged_factor === last.charged_factor &&
			first.metered_factor === last.metered_factor
		) {
			merged[0] = {
				start: last.start,
				end: first.end,
				charged_factor: first.charged_factor,
				metered_factor: first.metered_factor,
			};
			merged.pop();
		}
	}
	return merged;
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
