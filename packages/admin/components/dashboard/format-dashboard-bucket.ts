/**
 * 将趋势 bucket 格式化为图表横轴。
 * bucket 已是业务时区墙钟（`YYYY-MM-DD` 或 `YYYY-MM-DD HH:MM:SS`），按该时区再格式化，不把数字当成 UTC。
 */
import {
	instantToZonedDatetimeLocalInput,
	zonedDatetimeLocalInputToInstant,
} from '../../lib/business-timezone-client';

export function formatDashboardBucketLabel(
	bucket: string,
	granularity: 'hour' | 'day',
	timeZone: string,
): string {
	if (!bucket) return '';
	const wall = granularity === 'day'
		? `${bucket.slice(0, 10)}T00:00`
		: bucket.slice(0, 16).replace(' ', 'T');
	try {
		const instant = zonedDatetimeLocalInputToInstant(wall, timeZone);
		const zoned = instant ? instantToZonedDatetimeLocalInput(instant, timeZone) : wall;
		if (granularity === 'day') return zoned.slice(5, 10);
		return `${zoned.slice(5, 10)} ${zoned.slice(11, 16)}`;
	} catch {
		if (granularity === 'day') return bucket.slice(5, 10);
		return `${bucket.slice(5, 10)} ${bucket.slice(11, 16)}`;
	}
}
