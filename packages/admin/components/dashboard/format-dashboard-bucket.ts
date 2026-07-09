/** 将 stats 时序 bucket 格式化为图表横轴标签。 */
export function formatDashboardBucketLabel(bucket: string, granularity: 'hour' | 'day'): string {
	if (!bucket) return '';
	if (granularity === 'day') return bucket.slice(5);
	const datePart = bucket.slice(0, 10);
	const timePart = bucket.slice(11, 16);
	return `${datePart.slice(5)} ${timePart}`;
}
