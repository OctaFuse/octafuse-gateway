'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_BUSINESS_TIMEZONE } from '@/lib/business-timezone-client';
import { readApiJson } from '@/lib/api-json';

type BusinessTimezoneContextValue = {
	businessTimezone: string;
	isLoading: boolean;
	refresh: () => Promise<void>;
};

const BusinessTimezoneContext = createContext<BusinessTimezoneContextValue>({
	businessTimezone: DEFAULT_BUSINESS_TIMEZONE,
	isLoading: true,
	refresh: async () => {},
});

export function BusinessTimezoneProvider({ children }: { children: ReactNode }) {
	const [businessTimezone, setBusinessTimezone] = useState(DEFAULT_BUSINESS_TIMEZONE);
	const [isLoading, setIsLoading] = useState(true);

	const refresh = useCallback(async () => {
		try {
			const response = await fetch('/api/admin/business-timezone');
			const data = await readApiJson<{ business_timezone?: string }>(response);
			const tz = data.data?.business_timezone?.trim();
			if (tz) setBusinessTimezone(tz);
		} catch (error) {
			console.error('Failed to load business timezone:', error);
		} finally {
			setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const value = useMemo(
		() => ({ businessTimezone, isLoading, refresh }),
		[businessTimezone, isLoading, refresh]
	);

	return <BusinessTimezoneContext.Provider value={value}>{children}</BusinessTimezoneContext.Provider>;
}

export function useBusinessTimezone(): string {
	return useContext(BusinessTimezoneContext).businessTimezone;
}

export function useBusinessTimezoneContext(): BusinessTimezoneContextValue {
	return useContext(BusinessTimezoneContext);
}
