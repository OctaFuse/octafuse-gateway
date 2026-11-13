import {
	detectRollingPreset,
	isCalendarPreset,
	isRollingPreset,
	type GatewayTimeRangeValue,
} from "./analytics-range";
import { parseGatewayDateTime } from "./datetime";
/** Exact UTC bounds survive reloads and log drill-downs; malformed ranges use the page default. */
export function analyticsRangeFromSearch(
	search: string
): GatewayTimeRangeValue | null {
	const q = new URLSearchParams(search);
	const start = q.get("start_date");
	const end = q.get("end_date");
	const from = parseGatewayDateTime(start);
	const to = parseGatewayDateTime(end);
	if (!start || !end || !from || !to || from.getTime() >= to.getTime())
		return null;
	const range = q.get("range");
	const preset =
		range === "custom" ? "custom" :
		range && isRollingPreset(range)
			? range === "24h"
				? "1d"
				: range
			: range && isCalendarPreset(range)
			? range
			: detectRollingPreset(start, end) ?? "custom";
	return { preset, start_date: start, end_date: end };
}
