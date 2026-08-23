/**
 * 路由 `price_override.schedule`：分时时段倍率（可选星期几）。
 * - 缺省 / `mode: "multiply"`（存量）：effective = base_factor × schedule_factor（未命中窗 schedule=1）。
 * - `mode: "override"`（Admin UI 新写入）：命中窗用窗口 factor，未命中用 base_factor。
 * - 窗口可选 `days`（ISO 1=周一 … 7=周日）；缺省为每天循环。跨午夜时 `days` 锚定窗口开始日。
 * 时区由调用方传入（通常为 `system_config.BUSINESS_TIMEZONE`）。
 */
import type { BillingPriceSnapshot } from './pricing-profile';

/** ISO 8601 星期：1=周一 … 7=周日。 */
export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export const ISO_WEEKDAYS_MON_FRI = [1, 2, 3, 4, 5] as const;
export const ISO_WEEKDAYS_SAT_SUN = [6, 7] as const;

export type IsoWeekday = (typeof ISO_WEEKDAYS)[number];

export type DailyScheduleWindow = {
	start: string;
	end: string;
	factor: number;
	/** ISO 1–7；省略表示每天。 */
	days?: number[];
};

/** `multiply` = 旧叠乘；`override` = 窗口 factor 即对标准价的倍率。 */
export type RoutePricingScheduleMode = 'multiply' | 'override';

export type RoutePricingSchedule = {
	mode: RoutePricingScheduleMode;
	charged: DailyScheduleWindow[];
	metered: DailyScheduleWindow[];
};

/** Admin 合并编辑用：共享 start/end（及可选 days），两侧各一列倍率（均为对标准价的有效倍率）。 */
export type SharedScheduleWindow = {
	start: string;
	end: string;
	charged_factor: number;
	metered_factor: number;
	days?: number[];
};

export type ScheduleFactorResolution = {
	factor: number;
	localTime: string;
	/** 业务时区下的 ISO 星期（1=周一 … 7=周日）。 */
	localWeekday: number;
	timezone: string;
	evaluatedAtUtc: string;
	window: DailyScheduleWindow | null;
};

export type ScheduleAuditWindow = {
	start: string;
	end: string;
	factor: number;
	days?: number[];
};

export type ScheduleAuditSnapshot = {
	timezone: string;
	local_time: string;
	local_weekday: number;
	evaluated_at_utc: string;
	factor: number;
	window: ScheduleAuditWindow | null;
};

const HH_MM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const END_24_RE = /^24:00$/;
const MINUTES_PER_DAY = 24 * 60;
const WEEK_MINUTES = 7 * MINUTES_PER_DAY;
const ISO_WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const WEEKDAY_SHORT_TO_ISO: Record<string, number> = {
	Mon: 1,
	Monday: 1,
	Tue: 2,
	Tuesday: 2,
	Wed: 3,
	Wednesday: 3,
	Thu: 4,
	Thursday: 4,
	Fri: 5,
	Friday: 5,
	Sat: 6,
	Saturday: 6,
	Sun: 7,
	Sunday: 7,
};

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

export function isIsoWeekday(n: number): n is IsoWeekday {
	return Number.isInteger(n) && n >= 1 && n <= 7;
}

export function previousIsoWeekday(day: number): number {
	return day === 1 ? 7 : day - 1;
}

export function nextIsoWeekday(day: number): number {
	return day === 7 ? 1 : day + 1;
}

/** 省略 / 全 7 天 = 每天。 */
export function isEveryIsoWeekday(days: number[] | undefined): boolean {
	return days == null || days.length === 0 || days.length === 7;
}

export function effectiveIsoWeekdays(days: number[] | undefined): number[] {
	return isEveryIsoWeekday(days) ? [...ISO_WEEKDAYS] : [...days!];
}

/**
 * 解析 `days`：返回排序去重后的 1–7；全 7 天视为省略（每天）。
 * 非法（空数组、非整数、越界）返回 `null`。
 */
export function normalizeIsoWeekdays(raw: unknown): number[] | undefined | null {
	if (raw === undefined) {
		return undefined;
	}
	if (!Array.isArray(raw) || raw.length === 0) {
		return null;
	}
	const set = new Set<number>();
	for (const item of raw) {
		if (typeof item !== 'number' || !Number.isInteger(item) || !isIsoWeekday(item)) {
			return null;
		}
		set.add(item);
	}
	const days = [...set].sort((a, b) => a - b);
	if (days.length === 7) {
		return undefined;
	}
	return days;
}

export function formatIsoWeekdaysHint(days: number[] | undefined): string | null {
	if (isEveryIsoWeekday(days)) {
		return null;
	}
	const sorted = effectiveIsoWeekdays(days);
	if (sorted.join(',') === ISO_WEEKDAYS_MON_FRI.join(',')) {
		return 'Mon–Fri';
	}
	if (sorted.join(',') === ISO_WEEKDAYS_SAT_SUN.join(',')) {
		return 'Sat–Sun';
	}
	const ranges: string[] = [];
	let i = 0;
	while (i < sorted.length) {
		let j = i;
		while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) {
			j++;
		}
		const start = ISO_WEEKDAY_SHORT[sorted[i]! - 1]!;
		const end = ISO_WEEKDAY_SHORT[sorted[j]! - 1]!;
		ranges.push(j === i ? start : `${start}–${end}`);
		i = j + 1;
	}
	return ranges.join(', ');
}

function parseWindowTimeAndFactor(row: unknown): Omit<DailyScheduleWindow, 'days'> | null {
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

function attachParsedDays(
	base: Omit<DailyScheduleWindow, 'days'>,
	raw: Record<string, unknown>
): DailyScheduleWindow | null {
	if (!Object.prototype.hasOwnProperty.call(raw, 'days')) {
		return base;
	}
	const days = normalizeIsoWeekdays(raw.days);
	if (days === null) {
		return null;
	}
	return days ? { ...base, days } : base;
}

function parseWindowRow(row: unknown): DailyScheduleWindow | null {
	const base = parseWindowTimeAndFactor(row);
	if (!base || !row || typeof row !== 'object' || Array.isArray(row)) {
		return null;
	}
	return attachParsedDays(base, row as Record<string, unknown>);
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

/** 在给定时区取 ISO 星期（1=周一 … 7=周日）。 */
export function formatLocalIsoWeekday(nowUtc: Date, timeZone: string): number {
	try {
		const parts = new Intl.DateTimeFormat('en-US', {
			timeZone,
			weekday: 'short',
		}).formatToParts(nowUtc);
		const raw = parts.find((p) => p.type === 'weekday')?.value ?? '';
		const iso = WEEKDAY_SHORT_TO_ISO[raw];
		if (iso) {
			return iso;
		}
	} catch {
		// invalid IANA timezone — fall through
	}
	const js = nowUtc.getUTCDay();
	return js === 0 ? 7 : js;
}

function appliesOnStartDay(w: DailyScheduleWindow, startDay: number): boolean {
	if (isEveryIsoWeekday(w.days)) {
		return true;
	}
	return w.days!.includes(startDay);
}

/** 半开区间；跨午夜时 `days` 锚定窗口开始日。 */
export function windowCoversLocal(
	w: DailyScheduleWindow,
	minutes: number,
	isoWeekday: number
): boolean {
	const startM = parseHhMmToMinutes(w.start);
	const endM = parseHhMmToMinutes(w.end);
	if (startM == null || endM == null) {
		return false;
	}
	if (startM < endM) {
		if (!(minutes >= startM && minutes < endM)) {
			return false;
		}
		return appliesOnStartDay(w, isoWeekday);
	}
	if (minutes >= startM) {
		return appliesOnStartDay(w, isoWeekday);
	}
	if (minutes < endM) {
		return appliesOnStartDay(w, previousIsoWeekday(isoWeekday));
	}
	return false;
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
	const localWeekday = formatLocalIsoWeekday(nowUtc, businessTimezone);
	const evaluatedAtUtc = nowUtc.toISOString();
	const miss: ScheduleFactorResolution = {
		factor: 1,
		localTime,
		localWeekday,
		timezone: businessTimezone,
		evaluatedAtUtc,
		window: null,
	};
	const minutes = parseHhMmToMinutes(localTime);
	if (minutes == null) {
		return miss;
	}
	for (const w of windows) {
		if (windowCoversLocal(w, minutes, localWeekday)) {
			return {
				factor: w.factor,
				localTime,
				localWeekday,
				timezone: businessTimezone,
				evaluatedAtUtc,
				window: w,
			};
		}
	}
	return miss;
}

export function toScheduleAudit(sch: ScheduleFactorResolution): ScheduleAuditSnapshot {
	return {
		timezone: sch.timezone,
		local_time: sch.localTime,
		local_weekday: sch.localWeekday,
		evaluated_at_utc: sch.evaluatedAtUtc,
		factor: sch.factor,
		window: sch.window
			? sch.window.days
				? { start: sch.window.start, end: sch.window.end, factor: sch.window.factor, days: sch.window.days }
				: { start: sch.window.start, end: sch.window.end, factor: sch.window.factor }
			: null,
	};
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

const WINDOW_SHAPE_HINT =
	'expected { start, end, factor, days? }; start must be HH:mm, end may also be 24:00, factor ≥ 0, duration must be non-zero; days if present must be a non-empty unique array of integers 1–7 (Mon–Sun)';

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
			const item = arr[i];
			const base = parseWindowTimeAndFactor(item);
			if (!base || !item || typeof item !== 'object' || Array.isArray(item)) {
				return {
					error: `price_override.schedule.${side}[${i}]: ${WINDOW_SHAPE_HINT}`,
				};
			}
			const rec = item as Record<string, unknown>;
			if (Object.prototype.hasOwnProperty.call(rec, 'days')) {
				const days = normalizeIsoWeekdays(rec.days);
				if (days === null) {
					return {
						error: `price_override.schedule.${side}[${i}]: days must be a non-empty unique array of integers 1–7 (Mon–Sun)`,
					};
				}
				windows.push(days ? { ...base, days } : base);
			} else {
				windows.push(base);
			}
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

function hitWindowAt(
	windows: DailyScheduleWindow[],
	minutes: number,
	isoWeekday: number
): DailyScheduleWindow | null {
	for (const w of windows) {
		if (windowCoversLocal(w, minutes, isoWeekday)) {
			return w;
		}
	}
	return null;
}

function effectiveSideFactorAt(
	windows: DailyScheduleWindow[],
	minutes: number,
	isoWeekday: number,
	mode: RoutePricingScheduleMode,
	base: number
): number {
	const hit = hitWindowAt(windows, minutes, isoWeekday);
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

function weekMinute(isoDay: number, minutes: number): number {
	return (isoDay - 1) * MINUTES_PER_DAY + minutes;
}

function weekMinuteToLocal(wm: number): { minutes: number; isoWeekday: number } {
	const wrapped = ((wm % WEEK_MINUTES) + WEEK_MINUTES) % WEEK_MINUTES;
	return {
		isoWeekday: Math.floor(wrapped / MINUTES_PER_DAY) + 1,
		minutes: wrapped % MINUTES_PER_DAY,
	};
}

function addWindowBounds(bounds: Set<number>, w: DailyScheduleWindow): void {
	const startM = parseHhMmToMinutes(w.start);
	const endM = parseHhMmToMinutes(w.end);
	if (startM == null || endM == null) {
		return;
	}
	for (const startDay of effectiveIsoWeekdays(w.days)) {
		if (startM < endM) {
			bounds.add(weekMinute(startDay, startM));
			bounds.add(weekMinute(startDay, endM));
		} else {
			const startWm = weekMinute(startDay, startM);
			const endWm = weekMinute(nextIsoWeekday(startDay), endM);
			bounds.add(startWm);
			bounds.add(endWm);
			if (startWm > endWm) {
				bounds.add(0);
				bounds.add(WEEK_MINUTES);
			}
		}
	}
}

type DayPiece = {
	start: string;
	end: string;
	isoWeekday: number;
	charged_factor: number;
	metered_factor: number;
};

/**
 * 将两侧独立窗口并成共享 start/end 行，并把旧叠乘 bake 成对标准价的有效倍率。
 * 仅输出至少一侧命中窗口的区间；缺侧按「未命中」处理（override=base，multiply=base×1）。
 * 按 days 集合拆行，避免工作日窗与周末窗被拼成一行。
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
	for (const w of charged) {
		addWindowBounds(bounds, w);
	}
	for (const w of metered) {
		addWindowBounds(bounds, w);
	}
	const sorted = [...bounds].sort((a, b) => a - b);
	const dayPieces: DayPiece[] = [];
	for (let i = 0; i < sorted.length - 1; i++) {
		const a = sorted[i]!;
		const b = sorted[i + 1]!;
		if (a >= b) {
			continue;
		}
		const mid = (a + b) / 2;
		if (mid >= WEEK_MINUTES) {
			continue;
		}
		const { minutes, isoWeekday } = weekMinuteToLocal(mid);
		if (!hitWindowAt(charged, minutes, isoWeekday) && !hitWindowAt(metered, minutes, isoWeekday)) {
			continue;
		}
		const chargedFactor = effectiveSideFactorAt(
			charged,
			minutes,
			isoWeekday,
			options.mode,
			options.chargedBase
		);
		const meteredFactor = effectiveSideFactorAt(
			metered,
			minutes,
			isoWeekday,
			options.mode,
			options.meteredBase
		);
		let t = a;
		while (t < b) {
			const dayStart = Math.floor(t / MINUTES_PER_DAY) * MINUTES_PER_DAY;
			const nextMidnight = dayStart + MINUTES_PER_DAY;
			const pieceEnd = Math.min(b, nextMidnight);
			const dayIndex = Math.floor(t / MINUTES_PER_DAY);
			if (dayIndex >= 7) {
				break;
			}
			const startMin = t - dayStart;
			const endMin = pieceEnd - dayStart;
			if (startMin < endMin) {
				dayPieces.push({
					start: formatMinutesToHhMm(startMin),
					end: formatMinutesToHhMm(endMin),
					isoWeekday: dayIndex + 1,
					charged_factor: chargedFactor,
					metered_factor: meteredFactor,
				});
			}
			t = pieceEnd;
		}
	}

	const mergedSameDay: DayPiece[] = [];
	for (const row of dayPieces) {
		const last = mergedSameDay[mergedSameDay.length - 1];
		if (
			last &&
			last.isoWeekday === row.isoWeekday &&
			last.end === row.start &&
			last.charged_factor === row.charged_factor &&
			last.metered_factor === row.metered_factor
		) {
			last.end = row.end;
		} else {
			mergedSameDay.push({ ...row });
		}
	}

	const isOvernightJoin = (evening: DayPiece, morning: DayPiece): boolean =>
		evening.end === '24:00' &&
		morning.start === '00:00' &&
		morning.isoWeekday === nextIsoWeekday(evening.isoWeekday) &&
		evening.start !== '00:00' &&
		morning.end !== '24:00' &&
		evening.charged_factor === morning.charged_factor &&
		evening.metered_factor === morning.metered_factor;

	const rejoined: DayPiece[] = [];
	for (const row of mergedSameDay) {
		const last = rejoined[rejoined.length - 1];
		if (last && isOvernightJoin(last, row)) {
			last.end = row.end;
			continue;
		}
		rejoined.push({ ...row });
	}
	if (rejoined.length >= 2) {
		const first = rejoined[0]!;
		const last = rejoined[rejoined.length - 1]!;
		if (isOvernightJoin(last, first)) {
			last.end = first.end;
			rejoined.shift();
		}
	}

	type Group = SharedScheduleWindow & { daysAcc: number[] };
	const groups: Group[] = [];
	for (const row of rejoined) {
		const existing = groups.find(
			(g) =>
				g.start === row.start &&
				g.end === row.end &&
				g.charged_factor === row.charged_factor &&
				g.metered_factor === row.metered_factor
		);
		if (existing) {
			if (!existing.daysAcc.includes(row.isoWeekday)) {
				existing.daysAcc.push(row.isoWeekday);
			}
		} else {
			groups.push({
				start: row.start,
				end: row.end,
				charged_factor: row.charged_factor,
				metered_factor: row.metered_factor,
				daysAcc: [row.isoWeekday],
			});
		}
	}

	return groups.map((g) => {
		const days = [...g.daysAcc].sort((a, b) => a - b);
		const out: SharedScheduleWindow = {
			start: g.start,
			end: g.end,
			charged_factor: g.charged_factor,
			metered_factor: g.metered_factor,
		};
		if (days.length < 7) {
			out.days = days;
		}
		return out;
	});
}

function windowOverlapLabel(w: DailyScheduleWindow): string {
	const time = `${w.start}-${w.end}`;
	const daysHint = formatIsoWeekdaysHint(w.days);
	return daysHint ? `${time} ${daysHint}` : time;
}

/** 检测同侧窗口是否在一周循环上重叠（含跨午夜；无 `days` 视为每天）。 */
export function findDailyWindowOverlap(windows: DailyScheduleWindow[]): string | null {
	type Seg = { a: number; b: number; label: string };
	const segs: Seg[] = [];
	for (const w of windows) {
		const startM = parseHhMmToMinutes(w.start);
		const endM = parseHhMmToMinutes(w.end);
		if (startM == null || endM == null) {
			continue;
		}
		const label = windowOverlapLabel(w);
		for (const startDay of effectiveIsoWeekdays(w.days)) {
			if (startM < endM) {
				segs.push({ a: weekMinute(startDay, startM), b: weekMinute(startDay, endM), label });
			} else {
				const startWm = weekMinute(startDay, startM);
				const endWm = weekMinute(nextIsoWeekday(startDay), endM);
				if (startWm < endWm) {
					segs.push({ a: startWm, b: endWm, label });
				} else {
					segs.push({ a: startWm, b: WEEK_MINUTES, label });
					segs.push({ a: 0, b: endWm, label });
				}
			}
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
