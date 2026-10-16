/**
 * 模型厂商生命周期（现役 / 退役）。
 *
 * 退役日期 `retired`（`YYYY-MM-DD`）只来自内置静态目录（`model-presets/*.json`），按 `models.id` 匹配，
 * 不落库；目录里没有的模型一律视为现役。状态只由日期推导，仅用于 Admin 展示与筛选，不影响路由与计费。
 */

export type ModelLifecycle = 'active' | 'retired';

export type ModelLifecycleFilter = 'all' | ModelLifecycle;

const RETIRED_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 当天 UTC 日期 `YYYY-MM-DD`。 */
export function todayUtcDateString(now: Date = new Date()): string {
	return now.toISOString().slice(0, 10);
}

/**
 * 退役日期为空或仍在未来 → `active`；今天或更早 → `retired`。
 * 日期格式不合法时按现役处理（宁可多显示，不误判下线）。
 */
export function resolveModelLifecycle(
	retiredAt: string | null | undefined,
	today: string = todayUtcDateString()
): ModelLifecycle {
	const v = retiredAt?.trim();
	if (!v || !RETIRED_RE.test(v)) return 'active';
	return v <= today ? 'retired' : 'active';
}

/** 现役但已设置未来退役日期（用于展示“将于 X 退役”）。 */
export function isModelRetiringSoon(
	retiredAt: string | null | undefined,
	today: string = todayUtcDateString()
): boolean {
	const v = retiredAt?.trim();
	if (!v || !RETIRED_RE.test(v)) return false;
	return v > today;
}

export function modelLifecycleMatchesFilter(
	retiredAt: string | null | undefined,
	filter: ModelLifecycleFilter,
	today: string = todayUtcDateString()
): boolean {
	if (filter === 'all') return true;
	return resolveModelLifecycle(retiredAt, today) === filter;
}

export function parseModelLifecycleFilter(raw: string | null | undefined): ModelLifecycleFilter {
	return raw === 'active' || raw === 'retired' ? raw : 'all';
}
