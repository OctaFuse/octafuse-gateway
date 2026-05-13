'use client';

import { useState, useEffect } from 'react';
import { BILLING_CURRENCY_KEY, normalizeBillingCurrencyCode } from '@octafuse/core/lib/billing-currency';
import { readApiJson } from '@/lib/api-json';
import type { SystemConfigRow } from '@/lib/types';

/**
 * 从 `/api/admin/config` 读取 `BILLING_CURRENCY`；失败或未配置时与 Proxy `/v1/me` 一致回退 USD。
 */
export function useBillingCurrency(): { currency: string; loading: boolean } {
	const [currency, setCurrency] = useState('USD');
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const res = await fetch('/api/admin/config');
				const data = await readApiJson<SystemConfigRow[]>(res);
				if (cancelled) return;
				if (data.success && Array.isArray(data.data)) {
					const row = data.data.find((r) => r.key === BILLING_CURRENCY_KEY);
					setCurrency(normalizeBillingCurrencyCode(row?.value));
				} else {
					setCurrency('USD');
				}
			} catch {
				if (!cancelled) setCurrency('USD');
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	return { currency, loading };
}
