'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useFeedback } from '@/components/feedback';
import { clearStickyBinding, fetchStickyBindingsList } from '../route-api';
import type { StickyBindingsList } from '../types';

const PAGE_SIZE = 20;

type Props = {
	poolId: string;
	/** route_target_id → Provider 名称，用于展示与筛选。 */
	targets: Array<{ id: string; providerName: string }>;
	/** 父级在解绑 / 清空后递增，触发列表重新加载。 */
	reloadToken: number;
	disabled?: boolean;
	/** 本组件解绑成功后通知父级刷新汇总。 */
	onChanged: () => void;
	onBusyChange: (busy: boolean) => void;
	onRefresh: () => void;
	refreshing: boolean;
	search: ReactNode;
	searchResult?: ReactNode;
};

function formatRemaining(seconds: number): string {
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	return m > 0 ? `${h}h${m}m` : `${h}h`;
}

export function StickyBindingsListPanel(props: Props) {
	const {
		poolId,
		targets,
		reloadToken,
		disabled,
		onChanged,
		onBusyChange,
		onRefresh,
		refreshing,
		search,
		searchResult,
	} = props;
	const t = useTranslations('routes.providerSticky');
	const tCommon = useTranslations('common');
	const { confirm } = useFeedback();

	const [page, setPage] = useState(1);
	const [targetFilter, setTargetFilter] = useState('');
	const [list, setList] = useState<StickyBindingsList | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');
	const [busyHash, setBusyHash] = useState('');
	const [message, setMessage] = useState('');
	const [localReload, setLocalReload] = useState(0);
	const showingLookup = searchResult !== undefined;

	const providerNameById = useCallback(
		(id: string) => targets.find((row) => row.id === id)?.providerName ?? id,
		[targets]
	);

	useEffect(() => {
		if (showingLookup) return;
		let cancelled = false;
		setLoading(true);
		setError('');
		void fetchStickyBindingsList({
			poolId,
			page,
			pageSize: PAGE_SIZE,
			routeTargetId: targetFilter || undefined,
		})
			.then((result) => {
				if (cancelled) return;
				if (!result.success) {
					setError(result.message);
					setList(null);
					return;
				}
				// 解绑后当前页可能被清空：回退到最后一页。
				const lastPage = Math.max(1, Math.ceil(result.data.total / PAGE_SIZE));
				if (page > lastPage) {
					setPage(lastPage);
					return;
				}
				setList(result.data);
			})
			.catch(() => {
				if (!cancelled) {
					setError(t('loadFailed'));
					setList(null);
				}
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [poolId, page, targetFilter, reloadToken, localReload, showingLookup, t]);

	const handleUnbind = async (affinityHash: string) => {
		const ok = await confirm({
			title: t('clearBinding'),
			message: t('clearConfirm'),
			danger: true,
		});
		if (!ok) return;
		setBusyHash(affinityHash);
		onBusyChange(true);
		setError('');
		setMessage('');
		try {
			const result = await clearStickyBinding(poolId, affinityHash);
			if (!result.success) {
				setError(result.message);
				return;
			}
			setMessage(result.cleared ? t('clearDone') : t('clearMiss'));
			setLocalReload((n) => n + 1);
			onChanged();
		} catch {
			setError(t('actionFailed'));
		} finally {
			onBusyChange(false);
			setBusyHash('');
		}
	};

	const total = list?.total ?? 0;
	const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

	return (
		<div className="rounded-lg border border-gray-200 p-3.5">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="text-sm font-semibold text-gray-900">{t('usersTitle')}</h3>
				<div className="flex flex-wrap items-center gap-2">
					{!showingLookup ? (
						<div className="flex items-center gap-2">
							<select
								value={targetFilter}
								onChange={(event) => {
									setTargetFilter(event.target.value);
									setPage(1);
								}}
								disabled={disabled || loading || Boolean(busyHash)}
								aria-label={t('usersFilterProvider')}
								className="max-w-[12rem] rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:bg-gray-50"
							>
								<option value="">{t('usersAllProviders')}</option>
								{targets.map((row) => (
									<option key={row.id} value={row.id}>
										{row.providerName}
									</option>
								))}
							</select>
						</div>
					) : null}
					<button
						type="button"
						onClick={onRefresh}
						disabled={loading || refreshing || disabled || Boolean(busyHash)}
						className="rounded-md px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50"
					>
						{refreshing || loading ? tCommon('loadingEllipsis') : t('refresh')}
					</button>
				</div>
			</div>
			<p className="mt-1 text-[11px] leading-relaxed text-gray-500">{t('usersHint')}</p>

			<div className="mt-3">{search}</div>

			{showingLookup ? (
				searchResult
			) : (
				<>
					{error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
					{message ? <p className="mt-2 text-xs text-emerald-700">{message}</p> : null}

					<div className="mt-3 space-y-1.5" aria-busy={loading}>
						{loading ? (
							<p role="status" className="text-xs text-gray-500">
								{tCommon('loadingEllipsis')}
							</p>
						) : null}
						{list && list.items.length === 0 && !loading ? (
							<p className="text-xs text-gray-500">{t('usersEmpty')}</p>
						) : null}
						{(!loading ? list?.items ?? [] : []).map((item) => (
							<div
								key={item.affinity_hash}
								className="flex items-center justify-between gap-3 rounded-md border border-gray-100 bg-gray-50/70 px-3 py-2"
							>
								<div className="min-w-0 flex-1">
									{item.user_id ? (
										<>
											<p
												className="truncate text-xs font-medium text-gray-900"
												title={item.user_id}
											>
												{item.email ?? item.user_id}
											</p>
											{item.email ? (
												<p className="truncate font-mono text-[10px] text-gray-500">
													{item.user_id}
												</p>
											) : null}
										</>
									) : (
										<p className="text-xs text-gray-500">{t('usersLegacy')}</p>
									)}
									{item.model_id ? (
										<p className="mt-0.5 truncate font-mono text-[10px] text-gray-500">
											{item.model_id} · {item.route_group} · {item.protocol}
										</p>
									) : null}
								</div>
								<div className="shrink-0 text-right">
									<p
										title={providerNameById(item.route_target_id)}
										className="max-w-[10rem] truncate text-xs font-medium text-gray-800"
									>
										{providerNameById(item.route_target_id)}
									</p>
									<p className="font-mono text-[10px] text-gray-500">
										{t('usersRemaining', { time: formatRemaining(item.remaining_seconds) })}
									</p>
								</div>
								<button
									type="button"
									onClick={() => void handleUnbind(item.affinity_hash)}
									disabled={disabled || Boolean(busyHash)}
									className="shrink-0 rounded-md border border-red-200 bg-white px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
								>
									{t('clearBinding')}
								</button>
							</div>
						))}
					</div>

					{total > 0 ? (
						<div className="mt-3 flex items-center justify-between text-[11px] text-gray-600">
							<span>{t('usersTotal', { total, page, pages: lastPage })}</span>
							<div className="flex gap-1.5">
								<button
									type="button"
									onClick={() => setPage((p) => Math.max(1, p - 1))}
									disabled={loading || disabled || Boolean(busyHash) || page <= 1}
									className="rounded-md border border-gray-300 bg-white px-2 py-1 font-medium hover:bg-gray-50 disabled:opacity-50"
								>
									{t('usersPrev')}
								</button>
								<button
									type="button"
									onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
									disabled={loading || disabled || Boolean(busyHash) || page >= lastPage}
									className="rounded-md border border-gray-300 bg-white px-2 py-1 font-medium hover:bg-gray-50 disabled:opacity-50"
								>
									{t('usersNext')}
								</button>
							</div>
						</div>
					) : null}
				</>
			)}
		</div>
	);
}
