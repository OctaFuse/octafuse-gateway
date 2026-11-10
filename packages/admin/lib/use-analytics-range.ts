"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { analyticsRangeFromSearch } from "./analytics-query";
import { useBusinessTimezone } from "@/components/BusinessTimezoneProvider";
import {
	createRangeValue,
	DEFAULT_GATEWAY_TIME_RANGE_PRESET,
	isCalendarPreset,
	type GatewayTimeRangeValue,
} from "./analytics-range";

const subscribeHydration = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/** Calendar defaults must use the business timezone, including after async config loading. */
export function useAnalyticsRange(persistUrl = false) {
	const timeZone = useBusinessTimezone();
	const [previousZone, setPreviousZone] = useState(timeZone);
	const [value, setValue] = useState<GatewayTimeRangeValue>(() =>
		createRangeValue(DEFAULT_GATEWAY_TIME_RANGE_PRESET, timeZone)
	);
	const hydrated = useSyncExternalStore(
		subscribeHydration,
		clientSnapshot,
		serverSnapshot
	);
	const [ready, setReady] = useState(!persistUrl);
	// Restore once after hydration so the server and first client render agree.
	if (persistUrl && hydrated && !ready) {
		setReady(true);
		const restored = analyticsRangeFromSearch(window.location.search);
		if (restored) setValue(restored);
	}
	useEffect(() => {
		if (!persistUrl || !ready) return;
		const url = new URL(window.location.href);
		url.searchParams.set("start_date", value.start_date);
		url.searchParams.set("end_date", value.end_date);
		url.searchParams.set("range", value.preset);
		if (url.href !== window.location.href)
			window.history.replaceState(
				window.history.state,
				"",
				`${url.pathname}${url.search}${url.hash}`
			);
	}, [persistUrl, ready, value]);
	if (previousZone !== timeZone) {
		setPreviousZone(timeZone);
		setValue((current) =>
			isCalendarPreset(current.preset)
				? createRangeValue(current.preset, timeZone)
				: current
		);
	}
	return [value, setValue] as const;
}
