/**
 * 对外目录折扣：从模型官方时段 + 代表路由 `price_override` 派生前台展示用 factor。
 * 不参与计费；计费仍走 usage-tracker。用户级 `charged_cost_factors` 不进入本结构。
 */
import { parsePricingProfile } from './pricing-profile';
import {
	formatLocalHhMm,
	formatLocalIsoWeekday,
	isEveryIsoWeekday,
	nextIsoWeekday,
	normalizeScheduleFactor,
	parseHhMmToMinutes,
	parseRouteBaseFactors,
	parseRoutePricingSchedule,
	resolveEffectiveRouteFactor,
	windowCoversLocal,
	effectiveIsoWeekdays,
	type DailyScheduleWindow,
	type RoutePricingScheduleMode,
} from './pricing-schedule';

export const DISPLAY_DISCOUNT_TAG_PREFIX = 'Discount:' as const;
export const DISPLAY_DISCOUNT_GROUP_TAG_PREFIX = 'Discount.' as const;

export type DisplayDiscountKind = 'flat' | 'schedule';

export type DisplayDiscountWindow = {
	start?: string;
	end?: string;
	days?: number[];
	catalog_factor: number;
	route_factor: number;
	composite_factor: number;
};

export type DisplayDiscountGroup = {
	timezone: string;
	kind: DisplayDiscountKind;
	schedule_mode: RoutePricingScheduleMode;
	route: { priority: number; weight: number };
	current: DisplayDiscountWindow;
	windows: DisplayDiscountWindow[];
};

export type DisplayDiscountRouteInput = {
	status: string;
	priority: number;
	weight?: number;
	route_group?: string | null;
	price_override: string | null;
};

const MINUTES_PER_DAY = 24 * 60;

export function normalizeDisplayRouteGroup(routeGroup?: string | null): string {
	const g = routeGroup?.trim();
	return g && g.length > 0 ? g : 'default';
}

export function isDisplayDiscountTag(tag: string): boolean {
	const lower = tag.trim().toLowerCase();
	return (
		lower.startsWith(DISPLAY_DISCOUNT_TAG_PREFIX.toLowerCase()) ||
		lower.startsWith(DISPLAY_DISCOUNT_GROUP_TAG_PREFIX.toLowerCase())
	);
}

export function formatDisplayDiscountLabel(composite: number): string {
	if (!Number.isFinite(composite) || composite <= 0 || composite >= 1) {
		return '';
	}
	const percent = (1 - composite) * 100;
	const percentLabel = Number.isInteger(percent) ? percent.toString() : percent.toFixed(1).replace(/\.0$/, '');
	return `-${percentLabel}%`;
}

export function formatDisplayDiscountFactor(n: number): string {
	const x = normalizeScheduleFactor(n);
	if (!Number.isFinite(x)) {
		return '1';
	}
	return x.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
}

export type PickRepresentativeRouteContext = {
	pricingProfileJson?: string | null;
	timezone: string;
	now?: Date;
};

/**
 * `status=active` 时按 priority DESC、同层 weight DESC 取代表路由。
 * 两者仍并列且提供了计价上下文时，取当刻 `current.composite_factor` 最小的一条；倍率相同则保持原顺序。
 */
export function pickRepresentativeRoute<T extends DisplayDiscountRouteInput>(
	routes: readonly T[],
	context?: PickRepresentativeRouteContext
): T | null {
	const active = routes.filter((r) => r.status === 'active');
	if (active.length === 0) {
		return null;
	}

	let bestPriority = Number.NEGATIVE_INFINITY;
	for (const row of active) {
		const priority = row.priority ?? 0;
		if (priority > bestPriority) {
			bestPriority = priority;
		}
	}
	const atPriority = active.filter((row) => (row.priority ?? 0) === bestPriority);

	let bestWeight = Number.NEGATIVE_INFINITY;
	for (const row of atPriority) {
		const weight = row.weight ?? 1;
		if (weight > bestWeight) {
			bestWeight = weight;
		}
	}
	const tied = atPriority.filter((row) => (row.weight ?? 1) === bestWeight);
	const first = tied[0];
	if (!first) {
		return null;
	}
	if (tied.length === 1 || !context) {
		return first;
	}

	let best = first;
	let bestFactor = currentCompositeFactor(first, context);
	for (let i = 1; i < tied.length; i++) {
		const row = tied[i]!;
		const factor = currentCompositeFactor(row, context);
		if (factor < bestFactor) {
			best = row;
			bestFactor = factor;
		}
	}
	return best;
}

function currentCompositeFactor(
	row: DisplayDiscountRouteInput,
	context: PickRepresentativeRouteContext
): number {
	return buildDisplayDiscountForRoute({
		pricingProfileJson: context.pricingProfileJson,
		priceOverrideJson: row.price_override,
		timezone: context.timezone,
		priority: row.priority ?? 0,
		weight: row.weight ?? 1,
		now: context.now,
	}).current.composite_factor;
}

function formatMinutesToHhMm(minutes: number): string {
	if (minutes >= MINUTES_PER_DAY) {
		return '24:00';
	}
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function windowToDaySegments(w: DailyScheduleWindow): Array<{ start: number; end: number }> {
	const startM = parseHhMmToMinutes(w.start);
	const endM = parseHhMmToMinutes(w.end);
	if (startM == null || endM == null) {
		return [];
	}
	if (startM < endM) {
		return [{ start: startM, end: endM }];
	}
	return [
		{ start: startM, end: MINUTES_PER_DAY },
		{ start: 0, end: endM },
	];
}

function mergeAdjacentDailyWindows(windows: DailyScheduleWindow[]): DailyScheduleWindow[] {
	const sorted = [...windows].sort((a, b) => {
		const as = parseHhMmToMinutes(a.start) ?? 0;
		const bs = parseHhMmToMinutes(b.start) ?? 0;
		return as - bs;
	});
	const out: DailyScheduleWindow[] = [];
	for (const w of sorted) {
		const last = out[out.length - 1];
		if (last && last.end === w.start && last.factor === w.factor && isEveryIsoWeekday(last.days) && isEveryIsoWeekday(w.days)) {
			last.end = w.end;
		} else {
			out.push({ ...w });
		}
	}
	return out;
}

function mergeGapWindowsByDays(windows: DailyScheduleWindow[]): DailyScheduleWindow[] {
	const grouped = new Map<string, { window: DailyScheduleWindow; days: Set<number> }>();
	for (const w of windows) {
		const key = `${w.start}|${w.end}|${w.factor}`;
		const days = effectiveIsoWeekdays(w.days);
		const existing = grouped.get(key);
		if (existing) {
			for (const day of days) existing.days.add(day);
			continue;
		}
		grouped.set(key, { window: { start: w.start, end: w.end, factor: w.factor }, days: new Set(days) });
	}
	const out: DailyScheduleWindow[] = [];
	for (const { window, days } of grouped.values()) {
		const sorted = [...days].sort((a, b) => a - b);
		if (sorted.length === 7) {
			out.push(window);
		} else {
			out.push({ ...window, days: sorted });
		}
	}
	return out;
}

/**
 * 目录（或路由）时段未覆盖满每天 24h 时补 factor=1 的兜底窗。
 * 带 `days` 的窗口按 ISO 星期逐日补缝（工作日高峰之外的谷、周末整日）。
 */
export function fillDailyScheduleGaps(windows: DailyScheduleWindow[]): DailyScheduleWindow[] {
	if (windows.length === 0) {
		return [];
	}
	if (windows.every((w) => isEveryIsoWeekday(w.days))) {
		const bounds = new Set<number>([0, MINUTES_PER_DAY]);
		for (const w of windows) {
			for (const seg of windowToDaySegments(w)) {
				bounds.add(seg.start);
				bounds.add(seg.end);
			}
		}
		const sorted = [...bounds].sort((a, b) => a - b);
		const gaps: DailyScheduleWindow[] = [];
		for (let i = 0; i < sorted.length - 1; i++) {
			const a = sorted[i]!;
			const b = sorted[i + 1]!;
			if (a >= b) {
				continue;
			}
			const mid = Math.floor((a + b) / 2);
			const covered = windows.some((w) => windowCoversLocal(w, mid, 1));
			if (!covered) {
				gaps.push({
					start: formatMinutesToHhMm(a),
					end: formatMinutesToHhMm(b),
					factor: 1,
				});
			}
		}
		return [...windows, ...mergeAdjacentDailyWindows(gaps)];
	}

	const extras: DailyScheduleWindow[] = [];
	for (let day = 1; day <= 7; day++) {
		const applicable = windows.filter((w) => effectiveIsoWeekdays(w.days).includes(day));
		if (applicable.length === 0) {
			extras.push({ start: '00:00', end: '24:00', factor: 1, days: [day] });
			continue;
		}
		const bounds = new Set<number>([0, MINUTES_PER_DAY]);
		for (const w of applicable) {
			for (const seg of windowToDaySegments(w)) {
				bounds.add(seg.start);
				bounds.add(seg.end);
			}
		}
		const sorted = [...bounds].sort((a, b) => a - b);
		for (let i = 0; i < sorted.length - 1; i++) {
			const a = sorted[i]!;
			const b = sorted[i + 1]!;
			if (a >= b) {
				continue;
			}
			const mid = Math.floor((a + b) / 2);
			const covered = applicable.some((w) => windowCoversLocal(w, mid, day));
			if (!covered) {
				extras.push({
					start: formatMinutesToHhMm(a),
					end: formatMinutesToHhMm(b),
					factor: 1,
					days: [day],
				});
			}
		}
	}
	return [...windows, ...mergeGapWindowsByDays(extras)];
}

function windowMidpoint(w: DailyScheduleWindow): { minutes: number; isoWeekday: number } {
	const startM = parseHhMmToMinutes(w.start) ?? 0;
	const endM = parseHhMmToMinutes(w.end) ?? MINUTES_PER_DAY;
	const startDay = !isEveryIsoWeekday(w.days) && w.days?.[0] ? w.days[0] : 1;
	if (startM < endM) {
		return { minutes: Math.floor((startM + endM) / 2), isoWeekday: startDay };
	}
	const duration = MINUTES_PER_DAY - startM + endM;
	const midOffset = Math.floor(duration / 2);
	if (startM + midOffset < MINUTES_PER_DAY) {
		return { minutes: startM + midOffset, isoWeekday: startDay };
	}
	return { minutes: startM + midOffset - MINUTES_PER_DAY, isoWeekday: nextIsoWeekday(startDay) };
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

function resolveRouteFactorAt(
	chargedWindows: DailyScheduleWindow[],
	mode: RoutePricingScheduleMode,
	baseCharged: number,
	minutes: number,
	isoWeekday: number
): number {
	const hit = hitWindowAt(chargedWindows, minutes, isoWeekday);
	return resolveEffectiveRouteFactor(
		baseCharged,
		{
			factor: hit?.factor ?? 1,
			localTime: formatMinutesToHhMm(minutes),
			localWeekday: isoWeekday,
			timezone: 'UTC',
			evaluatedAtUtc: '',
			window: hit,
		},
		mode
	);
}

function toDisplayWindow(
	shape: DailyScheduleWindow | { start?: string; end?: string; days?: number[] },
	catalogFactor: number,
	routeFactor: number
): DisplayDiscountWindow {
	const composite = normalizeScheduleFactor(catalogFactor * routeFactor);
	const out: DisplayDiscountWindow = {
		catalog_factor: normalizeScheduleFactor(catalogFactor),
		route_factor: normalizeScheduleFactor(routeFactor),
		composite_factor: composite,
	};
	if (shape.start) {
		out.start = shape.start;
	}
	if (shape.end) {
		out.end = shape.end;
	}
	if (shape.days && shape.days.length > 0) {
		out.days = shape.days;
	}
	return out;
}

function flattenIfUniform(windows: DisplayDiscountWindow[]): {
	kind: DisplayDiscountKind;
	windows: DisplayDiscountWindow[];
} {
	if (windows.length === 0) {
		const flat = toDisplayWindow({}, 1, 1);
		return { kind: 'flat', windows: [flat] };
	}
	const first = windows[0]!.composite_factor;
	const uniform = windows.every((w) => w.composite_factor === first);
	if (uniform) {
		return {
			kind: 'flat',
			windows: [
				{
					catalog_factor: windows[0]!.catalog_factor,
					route_factor: windows[0]!.route_factor,
					composite_factor: first,
				},
			],
		};
	}
	return { kind: 'schedule', windows };
}

export function resolveDisplayDiscountAt(
	windows: DisplayDiscountWindow[],
	nowUtc: Date,
	timezone: string
): DisplayDiscountWindow | null {
	if (windows.length === 0) {
		return null;
	}
	if (windows.length === 1 && windows[0]!.start == null) {
		return windows[0]!;
	}
	const minutes = parseHhMmToMinutes(formatLocalHhMm(nowUtc, timezone));
	const weekday = formatLocalIsoWeekday(nowUtc, timezone);
	if (minutes == null) {
		return windows[0] ?? null;
	}
	for (const w of windows) {
		if (!w.start || !w.end) {
			continue;
		}
		const shape: DailyScheduleWindow = { start: w.start, end: w.end, factor: w.composite_factor, days: w.days };
		if (windowCoversLocal(shape, minutes, weekday)) {
			return w;
		}
	}
	return null;
}

export function buildDisplayDiscountForRoute(options: {
	pricingProfileJson: string | null | undefined;
	priceOverrideJson: string | null | undefined;
	timezone: string;
	priority: number;
	weight: number;
	now?: Date;
}): DisplayDiscountGroup {
	const now = options.now ?? new Date();
	const profile = parsePricingProfile(options.pricingProfileJson ?? undefined);
	const catalogWindows = profile?.schedule ?? [];
	const schedule = parseRoutePricingSchedule(options.priceOverrideJson);
	const bases = parseRouteBaseFactors(options.priceOverrideJson);
	const mode = schedule.mode;

	let sourceWindows: DailyScheduleWindow[];
	let catalogLookup: DailyScheduleWindow[];
	if (catalogWindows.length > 0) {
		sourceWindows = fillDailyScheduleGaps(catalogWindows);
		catalogLookup = catalogWindows;
	} else if (schedule.charged.length > 0) {
		sourceWindows = fillDailyScheduleGaps(schedule.charged);
		catalogLookup = [];
	} else {
		sourceWindows = [];
		catalogLookup = [];
	}

	const priced: DisplayDiscountWindow[] =
		sourceWindows.length === 0
			? [toDisplayWindow({}, 1, bases.chargedFactor)]
			: sourceWindows.map((w) => {
					const mid = windowMidpoint(w);
					const catalogHit = hitWindowAt(catalogLookup, mid.minutes, mid.isoWeekday);
					const catalogFactor = catalogHit?.factor ?? 1;
					const routeFactor = resolveRouteFactorAt(
						schedule.charged,
						mode,
						bases.chargedFactor,
						mid.minutes,
						mid.isoWeekday
					);
					return toDisplayWindow(w, catalogFactor, routeFactor);
				});

	const { kind, windows } = flattenIfUniform(priced);
	const liveMinutes = parseHhMmToMinutes(formatLocalHhMm(now, options.timezone));
	const liveWeekday = formatLocalIsoWeekday(now, options.timezone);
	const liveCatalog =
		liveMinutes == null ? 1 : (hitWindowAt(catalogLookup, liveMinutes, liveWeekday)?.factor ?? 1);
	const liveRoute =
		liveMinutes == null
			? bases.chargedFactor
			: resolveRouteFactorAt(schedule.charged, mode, bases.chargedFactor, liveMinutes, liveWeekday);
	const liveCurrent = toDisplayWindow(
		resolveDisplayDiscountAt(windows, now, options.timezone) ?? {},
		liveCatalog,
		liveRoute
	);
	const matched = resolveDisplayDiscountAt(windows, now, options.timezone);
	const current =
		matched ??
		(kind === 'flat'
			? windows[0]!
			: liveCurrent);

	return {
		timezone: options.timezone,
		kind,
		schedule_mode: mode,
		route: { priority: options.priority, weight: options.weight },
		current,
		windows,
	};
}

export function buildDisplayDiscountsByRouteGroup(options: {
	routes: readonly DisplayDiscountRouteInput[];
	pricingProfileJson: string | null | undefined;
	timezone: string;
	now?: Date;
	allowedRouteGroups?: readonly string[] | null;
}): Record<string, DisplayDiscountGroup> {
	const byGroup = new Map<string, DisplayDiscountRouteInput[]>();
	for (const row of options.routes) {
		if (row.status !== 'active') {
			continue;
		}
		const group = normalizeDisplayRouteGroup(row.route_group);
		const list = byGroup.get(group);
		if (list) {
			list.push(row);
		} else {
			byGroup.set(group, [row]);
		}
	}

	const allowed =
		options.allowedRouteGroups == null
			? null
			: new Set(options.allowedRouteGroups.map((g) => g.trim().toLowerCase()).filter(Boolean));

	const out: Record<string, DisplayDiscountGroup> = {};
	for (const [group, rows] of byGroup) {
		if (allowed && !allowed.has(group.toLowerCase())) {
			continue;
		}
		const representative = pickRepresentativeRoute(rows, {
			pricingProfileJson: options.pricingProfileJson,
			timezone: options.timezone,
			now: options.now,
		});
		if (!representative) {
			continue;
		}
		out[group] = buildDisplayDiscountForRoute({
			pricingProfileJson: options.pricingProfileJson,
			priceOverrideJson: representative.price_override,
			timezone: options.timezone,
			priority: representative.priority ?? 0,
			weight: representative.weight ?? 1,
			now: options.now,
		});
	}
	return out;
}

function derivedTagForGroup(group: string, composite: number): string | null {
	if (!Number.isFinite(composite) || composite <= 0 || composite >= 1) {
		return null;
	}
	return `${DISPLAY_DISCOUNT_GROUP_TAG_PREFIX}${group}:${formatDisplayDiscountFactor(composite)}`;
}

/**
 * 去掉手填 `Discount:*` / `Discount.*`，再按当刻 composite 注入 `Discount.<group>:<factor>`。
 */
export function mergeDerivedDiscountTags(
	tags: readonly string[],
	discounts: Record<string, DisplayDiscountGroup>
): string[] {
	const kept = tags.filter((tag) => typeof tag === 'string' && tag.trim() !== '' && !isDisplayDiscountTag(tag));
	const derived: string[] = [];
	const groups = Object.keys(discounts).sort((a, b) => a.localeCompare(b));
	for (const group of groups) {
		const tag = derivedTagForGroup(group, discounts[group]!.current.composite_factor);
		if (tag) {
			derived.push(tag);
		}
	}
	return [...kept, ...derived];
}
