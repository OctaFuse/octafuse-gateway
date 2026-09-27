'use client';

import { useState } from 'react';
import { useBusinessTimezone } from '@/components/BusinessTimezoneProvider';
import { createRangeValue, DEFAULT_GATEWAY_TIME_RANGE_PRESET, isCalendarPreset, type GatewayTimeRangeValue } from './analytics-range';

/** Calendar defaults must use the business timezone, including after async config loading. */
export function useAnalyticsRange() {
  const timeZone = useBusinessTimezone();
  const [previousZone, setPreviousZone] = useState(timeZone);
  const [value, setValue] = useState<GatewayTimeRangeValue>(() => createRangeValue(DEFAULT_GATEWAY_TIME_RANGE_PRESET, timeZone));
  if (previousZone !== timeZone) {
    setPreviousZone(timeZone);
    setValue(current => isCalendarPreset(current.preset) ? createRangeValue(current.preset, timeZone) : current);
  }
  return [value, setValue] as const;
}
