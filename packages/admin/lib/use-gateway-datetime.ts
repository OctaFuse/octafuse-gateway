'use client';

import { useCallback } from 'react';
import { useBusinessTimezone } from '@/components/BusinessTimezoneProvider';
import { formatGatewayDate, formatGatewayDateTime, formatGatewayTime } from '@/lib/datetime';

/** 按 `BUSINESS_TIMEZONE` 格式化 Gateway 时间戳。 */
export function useGatewayDateTime() {
	const businessTimezone = useBusinessTimezone();

	const formatDateTime = useCallback(
		(raw: string | null | undefined) => formatGatewayDateTime(raw, businessTimezone),
		[businessTimezone]
	);
	const formatDate = useCallback(
		(raw: string | null | undefined) => formatGatewayDate(raw, businessTimezone),
		[businessTimezone]
	);
	const formatTime = useCallback(
		(raw: string | null | undefined) => formatGatewayTime(raw, businessTimezone),
		[businessTimezone]
	);

	return { businessTimezone, formatDateTime, formatDate, formatTime };
}
