'use client';
import { useTranslations } from 'next-intl';
import { DashboardRangeControl } from './dashboard/DashboardRangeControl';
import { useBusinessTimezone } from './BusinessTimezoneProvider';
import { formatGatewayRangeSummary, type GatewayTimeRangeValue } from '@/lib/analytics-range';
export function AnalyticsRangeControl({
	value,
	onChange,
}: {
	value: GatewayTimeRangeValue;
	onChange: (next: GatewayTimeRangeValue) => void;
}) {
	const t = useTranslations('timeRange');
	const timeZone = useBusinessTimezone();
	const label = formatGatewayRangeSummary(
		value,
		(preset) =>
			t(`${['today', 'this_week', 'this_month'].includes(preset) ? 'calendar' : 'presets'}.${preset}`),
		t('custom'),
		timeZone
	);
	return <DashboardRangeControl value={value} label={label} timeZone={timeZone} onChange={onChange} />;
}
