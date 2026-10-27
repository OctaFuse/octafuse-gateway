'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useFeedback } from '@/components/feedback';
import { useGatewayDateTime } from '@/lib/use-gateway-datetime';
import { parseGatewayDateTime } from '@/lib/datetime';
import { StickyProviderIdentity } from './sticky-provider-identity';
import { StickyProviderFilter } from './sticky-provider-filter';
import { clearStickyBinding, fetchStickyBindingsList } from '../route-api';
import type { ProviderStickyIdentity, StickyBindingsList } from '../types';

const PAGE_SIZE = 20;

type Props = {
	poolId: string;
	/** route_target_id → Provider 名称，用于展示与筛选。 */
	targets: Array<{ id: string; providerName: string; identity?: ProviderStickyIdentity }>;
	/** 父级在解绑 / 清空后递增，触发列表重新加载。 */
	reloadToken: number;
	targetFilter: string;
	onTargetFilterChange: (targetId: string) => void;
	disabled?: boolean;
	/** 本组件解绑成功后通知父级刷新汇总。 */
	onChanged: () => void;
	onBusyChange: (busy: boolean) => void;
	onRefresh: () => void;
	refreshing: boolean;
	search: ReactNode;
	searchResult?: ReactNode;
};

type BindingDisplayRow = {
	id: string;
	userLabel: string;
	userHint?: string;
	providerLabel: string;
	providerIdentity?: ProviderStickyIdentity;
	expiresAt: string;
	status?: 'expired' | 'invalid';
};

export function StickyBindingTable({
	rows,
	disabled,
	onUnbind,
}: {
	rows: BindingDisplayRow[];
	disabled?: boolean;
	onUnbind: (id: string) => void;
}) {
	const t = useTranslations('routes.providerSticky');
	const tCommon = useTranslations('common');
	const { formatDateTime, businessTimezone } = useGatewayDateTime();
	const [now, setNow] = useState<number | null>(null);
	useEffect(() => {
		const update = () => setNow(Date.now());
		update();
		const timer = window.setInterval(update, 1000);
		return () => window.clearInterval(timer);
	}, []);
	const remainingLabel = (row: BindingDisplayRow) => {
		if (row.status) return t(row.status === 'invalid' ? 'lookupInvalid' : 'lookupExpired');
		const expires = parseGatewayDateTime(row.expiresAt)?.getTime();
		if (expires == null || now == null) return '—';
		const seconds = Math.max(0, Math.ceil((expires - now) / 1000));
		if (seconds === 0) return t('lookupExpired');
		if (seconds >= 3600)
			return t('durationHoursMinutes', {
				hours: Math.floor(seconds / 3600),
				minutes: Math.floor((seconds % 3600) / 60),
			});
		if (seconds >= 60) return t('durationMinutes', { minutes: Math.floor(seconds / 60) });
		return t('durationSeconds', { seconds });
	};
	return (
		<div className="overflow-x-auto rounded-lg border border-gray-200">
			<table className="w-full min-w-[36rem] table-fixed text-left text-xs">
				<colgroup>
					<col className="w-[30%]" />
					<col />
					<col className="w-32" />
					<col className="w-16" />
				</colgroup>
				<thead className="bg-gray-50 text-gray-500">
					<tr>
						<th scope="col" className="px-3 py-2 font-normal">
							{t('userColumn')}
						</th>
						<th scope="col" className="px-3 py-2 font-normal">
							{t('providerColumn')}
						</th>
						<th scope="col" title={businessTimezone} className="px-3 py-2 font-normal">
							{t('remainingColumn')}
						</th>
						<th scope="col" className="px-3 py-2 text-right font-normal">
							{tCommon('actions')}
						</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => (
						<tr key={row.id} className="border-t border-gray-100">
							<td className="px-3 py-3">
								<p
									title={row.userHint || row.userLabel}
									className="truncate font-medium text-gray-900"
								>
									{row.userLabel}
								</p>
							</td>
							<td className="px-3 py-3">
								<StickyProviderIdentity
									identity={row.providerIdentity}
									fallbackName={row.providerLabel}
								/>
							</td>
							<td className="px-3 py-3 text-gray-600">
								<time
									dateTime={row.expiresAt}
									title={t('expiresAtHint', {
										time: formatDateTime(row.expiresAt),
										timezone: businessTimezone,
									})}
									className="whitespace-nowrap tabular-nums"
								>
									{remainingLabel(row)}
								</time>
							</td>
							<td className="px-3 py-3 text-right">
								<button
									type="button"
									onClick={() => onUnbind(row.id)}
									disabled={disabled}
									aria-label={t('unbindUser', { user: row.userLabel })}
									className="whitespace-nowrap rounded-md border border-red-200 bg-white px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
								>
									{t('clearBinding')}
								</button>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

export function StickyBindingsListPanel(props: Props) {
	const {
		poolId,
		targets,
		reloadToken,
		targetFilter,
		onTargetFilterChange,
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
		<div>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="text-sm font-semibold text-gray-900">{t('usersTitle')}</h3>
				<div className="flex w-full min-w-0 items-center gap-2 sm:ml-auto sm:w-auto sm:justify-end">
					{!showingLookup ? (
						<StickyProviderFilter
							targets={targets}
							value={targetFilter}
							onChange={(id) => {
								onTargetFilterChange(id);
								setPage(1);
							}}
							disabled={disabled || loading || Boolean(busyHash)}
						/>
					) : null}
					<button
						type="button"
						onClick={onRefresh}
						disabled={loading || refreshing || disabled || Boolean(busyHash)}
						className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50"
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
						{!loading && list && list.items.length > 0 ? (
							<StickyBindingTable
								rows={list.items.map((item) => ({
									id: item.affinity_hash,
									userLabel: item.email ?? item.user_id ?? t('usersLegacy'),
									userHint: [item.user_id, item.model_id, item.route_group, item.protocol]
										.filter(Boolean)
										.join(' · '),
									providerLabel: providerNameById(item.route_target_id),
									providerIdentity: targets.find((target) => target.id === item.route_target_id)
										?.identity,
									expiresAt: item.expires_at,
								}))}
								disabled={disabled || Boolean(busyHash)}
								onUnbind={(id) => void handleUnbind(id)}
							/>
						) : null}
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
