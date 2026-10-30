'use client';

/**
 * OAuth 访问令牌（`oat_`）：授权服务器代用户签发给第三方 MCP 客户端的凭证。
 * 一行 = 一次授权（用户 × 应用）。支持按应用 / 用户 / 状态筛选，单条撤销、整应用撤销、清理过期。
 */
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDownIcon, MagnifyingGlassIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useFeedback } from '@/components/feedback';
import { readApiJson } from '@/lib/api-json';
import {
	oauthAccessTokenStatusDotClass,
	type OAuthAccessTokenClientStat,
	type OAuthAccessTokenListPage,
	type OAuthAccessTokenStatus,
	type GatewayOAuthAccessToken,
} from '@/lib/oauth-access-token-types';
import { useGatewayDateTime } from '@/lib/use-gateway-datetime';

const PAGE_SIZE = 20;
type StatusFilter = '' | OAuthAccessTokenStatus;

const inputClass =
	'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500';

export function OAuthAccessTokensPanel() {
	const t = useTranslations('oauthAccessTokensPage');
	const tCommon = useTranslations('common');
	const { notify, confirm } = useFeedback();
	const { formatDateTime } = useGatewayDateTime();

	const [items, setItems] = useState<GatewayOAuthAccessToken[]>([]);
	const [total, setTotal] = useState(0);
	const [page, setPage] = useState(1);
	const [stats, setStats] = useState<OAuthAccessTokenClientStat[]>([]);
	const [filterEmail, setFilterEmail] = useState('');
	const [filterClientId, setFilterClientId] = useState('');
	const [filterStatus, setFilterStatus] = useState<StatusFilter>('');
	const [isLoading, setIsLoading] = useState(true);
	const [busyKey, setBusyKey] = useState<string | null>(null);
	// 默认折叠，展开后才请求数据；从用户详情等处带 #oauth-access-tokens 进入时自动展开。
	const [open, setOpen] = useState(false);
	const sectionRef = useRef<HTMLElement>(null);

	useEffect(() => {
		const revealHashTarget = () => {
			if (window.location.hash === '#oauth-access-tokens') {
				setOpen(true);
				sectionRef.current?.scrollIntoView({ block: 'start' });
			}
		};
		revealHashTarget();
		window.addEventListener('hashchange', revealHashTarget);
		return () => window.removeEventListener('hashchange', revealHashTarget);
	}, []);

	const fetchStats = useCallback(async () => {
		try {
			const response = await fetch('/api/admin/oauth-access-tokens/stats');
			const data = await readApiJson<OAuthAccessTokenClientStat[]>(response);
			if (data.success && data.data) setStats(data.data);
		} catch (error) {
			console.error('Fetch access token stats error:', error);
		}
	}, []);

	const fetchList = useCallback(async () => {
		try {
			setIsLoading(true);
			const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
			if (filterEmail.trim()) params.set('email', filterEmail.trim());
			if (filterClientId) params.set('client_id', filterClientId);
			if (filterStatus) params.set('status', filterStatus);
			const response = await fetch(`/api/admin/oauth-access-tokens?${params.toString()}`);
			const data = await readApiJson<OAuthAccessTokenListPage>(response);
			if (data.success && data.data) {
				setItems(data.data.items);
				setTotal(data.data.total);
			}
		} catch (error) {
			console.error('Fetch access tokens error:', error);
		} finally {
			setIsLoading(false);
		}
	}, [page, filterEmail, filterClientId, filterStatus]);

	useEffect(() => {
		if (open) void fetchList();
	}, [open, fetchList]);
	useEffect(() => {
		if (open) void fetchStats();
	}, [open, fetchStats]);

	const reload = () => {
		void fetchList();
		void fetchStats();
	};

	const revokeOne = async (token: GatewayOAuthAccessToken) => {
		const ok = await confirm({
			title: t('revokeTitle'),
			message: t('revokeConfirm', { client: token.client_name, user: token.user_email ?? token.user_id }),
			confirmLabel: t('revoke'),
			danger: true,
		});
		if (!ok) return;
		setBusyKey(token.id);
		try {
			const response = await fetch(`/api/admin/oauth-access-tokens/${encodeURIComponent(token.id)}/revoke`, {
				method: 'POST',
			});
			const data = await readApiJson(response);
			if (data.success) {
				notify('success', t('revoked'));
				reload();
			} else {
				notify('error', data.message || t('revokeFailed'));
			}
		} catch (error) {
			console.error('Revoke access token error:', error);
			notify('error', t('revokeFailed'));
		} finally {
			setBusyKey(null);
		}
	};

	const revokeClient = async (stat: OAuthAccessTokenClientStat) => {
		const ok = await confirm({
			title: t('revokeClientTitle'),
			message: t('revokeClientConfirm', { client: stat.client_name || stat.client_id, count: stat.total_count }),
			confirmLabel: t('revokeAll'),
			danger: true,
		});
		if (!ok) return;
		setBusyKey(`client:${stat.client_id}`);
		try {
			const response = await fetch('/api/admin/oauth-access-tokens/revoke', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ client_id: stat.client_id }),
			});
			const data = await readApiJson<{ revoked: number }>(response);
			if (data.success) {
				notify('success', t('revokedMany', { count: data.data?.revoked ?? 0 }));
				reload();
			} else {
				notify('error', data.message || t('revokeFailed'));
			}
		} catch (error) {
			console.error('Revoke client access tokens error:', error);
			notify('error', t('revokeFailed'));
		} finally {
			setBusyKey(null);
		}
	};

	const cleanup = async () => {
		const ok = await confirm({
			title: t('cleanupTitle'),
			message: t('cleanupConfirm'),
			confirmLabel: t('cleanup'),
			danger: true,
		});
		if (!ok) return;
		setBusyKey('cleanup');
		try {
			const response = await fetch('/api/admin/oauth-access-tokens/cleanup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({}),
			});
			const data = await readApiJson<{ deleted: number }>(response);
			if (data.success) {
				notify('success', t('cleanedUp', { count: data.data?.deleted ?? 0 }));
				reload();
			} else {
				notify('error', data.message || t('cleanupFailed'));
			}
		} catch (error) {
			console.error('Cleanup access tokens error:', error);
			notify('error', t('cleanupFailed'));
		} finally {
			setBusyKey(null);
		}
	};

	const hasFilters = Boolean(filterEmail.trim() || filterClientId || filterStatus);
	const clearFilters = () => {
		setFilterEmail('');
		setFilterClientId('');
		setFilterStatus('');
		setPage(1);
	};
	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
	const showSkeleton = isLoading && items.length === 0;

	return (
		<section
			id="oauth-access-tokens"
			ref={sectionRef}
			className="mb-6 scroll-mt-4 rounded-xl border border-gray-200 bg-white shadow-sm"
		>
			<button
				type="button"
				onClick={() => setOpen(!open)}
				aria-expanded={open}
				className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left"
			>
				<span className="min-w-0">
					<span className="block text-base font-semibold text-gray-900">{t('title')}</span>
					<span className="mt-1 block max-w-2xl text-sm leading-6 text-gray-500">{t('subtitle')}</span>
				</span>
				<ChevronDownIcon
					className={`mt-1 h-5 w-5 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
					aria-hidden
				/>
			</button>
			{open && (
				<div className="space-y-4 border-t border-gray-100 p-4 sm:p-5">
			<div className="flex justify-end">
				<button
					type="button"
					onClick={() => void cleanup()}
					disabled={busyKey === 'cleanup'}
					className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
					title={t('cleanupHint')}
				>
					<TrashIcon className="h-4 w-4" aria-hidden />
					{t('cleanup')}
				</button>
			</div>

			{stats.length > 0 && (
				<div>
					<h2 className="mb-2 text-xs font-semibold tracking-wide text-gray-500">{t('clientsTitle')}</h2>
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
						{stats.map((stat) => {
							const selected = filterClientId === stat.client_id;
							return (
								<div
									key={stat.client_id}
									className={`rounded-xl border bg-white px-4 py-3 shadow-sm ${
										selected ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-200'
									}`}
								>
									<div className="flex items-start justify-between gap-2">
										<button
											type="button"
											onClick={() => {
												setFilterClientId(selected ? '' : stat.client_id);
												setPage(1);
											}}
											className="min-w-0 text-left"
											title={t('filterByClient')}
										>
											<div className="truncate text-sm font-medium text-gray-900">
												{stat.client_name || stat.client_id}
											</div>
											<div className="truncate font-mono text-[11px] text-gray-400" title={stat.client_id}>
												{stat.client_id}
											</div>
										</button>
										<button
											type="button"
											onClick={() => void revokeClient(stat)}
											disabled={stat.total_count === 0 || busyKey === `client:${stat.client_id}`}
											className="shrink-0 rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
										>
											{t('revokeAll')}
										</button>
									</div>
									<div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
										<span>{t('statActive', { count: stat.active_count })}</span>
										<span>{t('statTotal', { count: stat.total_count })}</span>
										<span>
											{t('statLastUsed')} {formatDateTime(stat.last_used_at) || tCommon('noData')}
										</span>
									</div>
								</div>
							);
						})}
					</div>
				</div>
			)}

			<div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
				<div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
					<div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-2 xl:max-w-3xl">
						<div className="min-w-0">
							<label className="mb-1 block text-xs font-medium text-gray-500">{tCommon('email')}</label>
							<div className="relative">
								<MagnifyingGlassIcon
									className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
									aria-hidden
								/>
								<input
									type="search"
									value={filterEmail}
									onChange={(e) => {
										setFilterEmail(e.target.value);
										setPage(1);
									}}
									placeholder={t('emailPlaceholder')}
									className={`${inputClass} pl-9`}
									autoComplete="off"
								/>
							</div>
						</div>
						<div className="min-w-0">
							<label className="mb-1 block text-xs font-medium text-gray-500">{t('table.status')}</label>
							<select
								value={filterStatus}
								onChange={(e) => {
									setFilterStatus(e.target.value as StatusFilter);
									setPage(1);
								}}
								className={inputClass}
							>
								<option value="">{tCommon('all')}</option>
								<option value="active">{t('status.active')}</option>
								<option value="expired">{t('status.expired')}</option>
								<option value="revoked">{t('status.revoked')}</option>
							</select>
						</div>
					</div>
					<div className="flex flex-wrap items-center gap-3 pb-0.5 text-xs text-gray-500">
						{hasFilters && (
							<button
								type="button"
								onClick={clearFilters}
								className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800"
							>
								<XMarkIcon className="h-3.5 w-3.5" aria-hidden />
								{tCommon('clearFilters')}
							</button>
						)}
						{(['active', 'expired', 'revoked'] as const).map((status) => (
							<span key={status} className="inline-flex items-center gap-1.5">
								<span className={`inline-block h-2 w-2 rounded-full ${oauthAccessTokenStatusDotClass(status)}`} aria-hidden />
								{t(`status.${status}`)}
							</span>
						))}
					</div>
				</div>
			</div>

			<div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
				<div className={`overflow-x-auto ${isLoading ? 'opacity-70' : ''}`}>
					<table className="admin-data-table w-full min-w-[60rem] table-fixed">
						<colgroup>
							<col className="w-[24%]" />
							<col className="w-[20%]" />
							<col className="w-[10%]" />
							<col className="w-[15%]" />
							<col className="w-[15%]" />
							<col className="w-[16%]" />
						</colgroup>
						<thead className="border-b border-gray-200 bg-gray-50/80">
							<tr>
								{(['user', 'client', 'token', 'expires', 'lastUsed'] as const).map((column) => (
									<th
										key={column}
										className="px-4 py-2.5 text-left text-[11px] font-semibold tracking-wide text-gray-500 whitespace-nowrap"
									>
										{t(`table.${column}`)}
									</th>
								))}
								<th className="px-4 py-2.5 text-right text-[11px] font-semibold tracking-wide text-gray-500 whitespace-nowrap">
									{t('table.actions')}
								</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-gray-100">
							{showSkeleton &&
								Array.from({ length: 6 }).map((_, index) => (
									<tr key={`skeleton-${index}`} className="animate-pulse">
										{Array.from({ length: 6 }).map((__, cell) => (
											<td key={cell} className="px-4 py-4">
												<div className="h-4 w-24 rounded bg-gray-100" />
											</td>
										))}
									</tr>
								))}
							{items.map((token) => {
								const live = token.status !== 'revoked';
								return (
									<tr key={token.id} className={live ? '' : 'bg-gray-50/60'}>
										<td className="px-4 py-3.5 overflow-hidden">
											<div className="flex min-w-0 items-start gap-2.5">
												<span
													className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${oauthAccessTokenStatusDotClass(token.status)}`}
													title={t(`status.${token.status}`)}
													role="img"
													aria-label={t(`status.${token.status}`)}
												/>
												<div className="min-w-0">
													<Link
														href={`/gateway/users/${encodeURIComponent(token.user_id)}`}
														className={`block truncate text-sm font-medium hover:underline ${
															live ? 'text-blue-700' : 'text-gray-500'
														}`}
													>
														{token.user_email || tCommon('noData')}
													</Link>
													<div className="mt-0.5 truncate font-mono text-[11px] text-gray-400" title={token.user_id}>
														{token.user_id}
													</div>
												</div>
											</div>
										</td>
										<td className="px-4 py-3.5 overflow-hidden">
											<button
												type="button"
												onClick={() => {
													setFilterClientId(token.client_id);
													setPage(1);
												}}
												className="block max-w-full text-left"
												title={t('filterByClient')}
											>
												<div className={`truncate text-sm font-medium ${live ? 'text-gray-900' : 'text-gray-500'}`}>
													{token.client_name}
												</div>
												<div className="truncate font-mono text-[11px] text-gray-400">{token.client_id}</div>
											</button>
										</td>
										<td className="px-4 py-3.5 font-mono text-xs text-gray-600">
											{token.token_hint ? `oat_…${token.token_hint}` : tCommon('noData')}
										</td>
										<td className="px-4 py-3.5 text-xs text-gray-600">
											{token.status === 'revoked'
												? `${t('status.revoked')} · ${formatDateTime(token.revoked_at)}`
												: formatDateTime(token.expires_at) || tCommon('noData')}
										</td>
										<td className="px-4 py-3.5 text-xs text-gray-600">
											{formatDateTime(token.last_used_at) || tCommon('noData')}
										</td>
										<td className="px-4 py-3.5 text-right">
											<div className="flex items-center justify-end gap-3 text-xs">
												<Link
													href={`/gateway/request-logs?user_email=${encodeURIComponent(token.user_email ?? '')}`}
													className="text-gray-500 hover:text-gray-800 hover:underline"
												>
													{t('logs')}
												</Link>
												{live && (
													<button
														type="button"
														onClick={() => void revokeOne(token)}
														disabled={busyKey === token.id}
														className="font-medium text-red-600 hover:underline disabled:opacity-40"
													>
														{t('revoke')}
													</button>
												)}
											</div>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
				{!showSkeleton && items.length === 0 && (
					<div className="px-4 py-16 text-center text-sm text-gray-500">{t('empty')}</div>
				)}
				{!showSkeleton && (
					<div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-4 py-3">
						<div className="text-sm text-gray-500">{t('total', { count: total })}</div>
						{totalPages > 1 && (
							<div className="flex items-center gap-2">
								<button
									type="button"
									onClick={() => setPage(Math.max(1, page - 1))}
									disabled={page === 1}
									className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
								>
									{tCommon('previous')}
								</button>
								<span className="min-w-[7rem] text-center text-sm text-gray-600">
									{tCommon('pageOf', { page, totalPages })}
								</span>
								<button
									type="button"
									onClick={() => setPage(Math.min(totalPages, page + 1))}
									disabled={page === totalPages}
									className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
								>
									{tCommon('next')}
								</button>
							</div>
						)}
					</div>
				)}
			</div>
				</div>
			)}
		</section>
	);
}
