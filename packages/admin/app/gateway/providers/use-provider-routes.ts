'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useFeedback } from '@/components/feedback';
import type { RouteListRow } from '../routes/types';
import { deleteProviderRoutes, fetchProviderRoutes } from './provider-api';

export function useProviderRoutes(
	providerId: string | null,
	onChanged: () => Promise<void>
) {
	const t = useTranslations('providers.modal.relatedRoutes');
	const tCommon = useTranslations('common');
	const { confirm, notify } = useFeedback();
	const [data, setData] = useState<{
		providerId: string;
		routes: RouteListRow[];
	} | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');
	const [revision, setRevision] = useState(0);
	const [isDeleting, setIsDeleting] = useState(false);
	const deletingRef = useRef(false);
	const reload = useCallback(() => setRevision((value) => value + 1), []);

	useEffect(() => {
		setData(null);
		setError('');
		if (!providerId) return;
		const controller = new AbortController();
		setLoading(true);
		void fetchProviderRoutes(providerId, controller.signal)
			.then((routes) => {
				if (!controller.signal.aborted) setData({ providerId, routes });
			})
			.catch((cause: unknown) => {
				if (!controller.signal.aborted)
					setError(cause instanceof Error ? cause.message : t('loadFailed'));
			})
			.finally(() => {
				if (!controller.signal.aborted) setLoading(false);
			});
		return () => controller.abort();
	}, [providerId, revision, t]);

	const routes = data?.providerId === providerId ? data?.routes ?? [] : [];
	const ready = Boolean(
		providerId && data?.providerId === providerId && !loading && !error
	);

	const remove = async (ids: string[]) => {
		if (deletingRef.current || !ready || !providerId) return;
		const requested = routes.filter((route) => ids.includes(route.id));
		if (!requested.length) return;
		deletingRef.current = true;
		setIsDeleting(true);
		try {
			const ok = await confirm({
				title: t('deleteTitle', { count: requested.length }),
				message: t('confirmDelete', { count: requested.length }),
				confirmLabel: tCommon('delete'),
				danger: true,
			});
			if (!ok) return;
			const result = await deleteProviderRoutes(providerId, requested, ids);
			const deleted = new Set(result.deletedIds);
			const failures = result.failures.map(
				({ route, message }) =>
					`${route.model_name || route.model_id}: ${
						message || tCommon('failed')
					}`
			);
			setData((current) =>
				current?.providerId === providerId
					? {
							...current,
							routes: current.routes.filter((route) => !deleted.has(route.id)),
					  }
					: current
			);
			if (deleted.size)
				notify('success', t('deleted', { count: deleted.size }));
			if (failures.length)
				notify(
					'error',
					t('deleteFailed', { count: failures.length }),
					failures.join('\n')
				);
			await onChanged();
			reload();
		} finally {
			deletingRef.current = false;
			setIsDeleting(false);
		}
	};

	return {
		routes,
		loading: Boolean(providerId) && (loading || ((!data || data.providerId !== providerId) && !error)),
		error,
		ready,
		isDeleting,
		reload,
		remove,
	};
}

export type ProviderRoutesState = ReturnType<typeof useProviderRoutes>;
