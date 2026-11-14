'use client';

/**
 * OAuth 访问令牌（`oat_`）：授权服务器代用户签发给第三方 MCP 客户端的凭证。
 * 一行 = 一次授权（用户 × 应用）。支持按应用 / 用户 / 状态筛选，单条撤销、整应用撤销、清理过期。
 */
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MagnifyingGlassIcon, PlusIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useFeedback } from '@/components/feedback';
import { InfoHintPopover } from '@/components/InfoHintPopover';
import { readApiJson } from '@/lib/api-json';
import {
	oauthAccessTokenStatusDotClass,
	type OAuthAccessTokenListPage,
	type OAuthApp,
	type OAuthAppsOverview,
	type OAuthAccessTokenStatus,
	type GatewayOAuthAccessToken,
} from '@/lib/oauth-access-token-types';
import { useGatewayDateTime } from '@/lib/use-gateway-datetime';
import { OAUTH_APP_PRESETS, OAuthAppFormDialog, type OAuthAppDraft } from './oauth-app-form-dialog';

const PAGE_SIZE = 20;
type StatusFilter = '' | OAuthAccessTokenStatus;
const STATUSES: readonly OAuthAccessTokenStatus[] = ['active', 'renewable', 'expired', 'revoked'];

/** 授权明细的应用筛选：`appId` 为 `none` 表示未归属，此时再按客户端名称细分。 */
interface AppFilter {
	appId: string;
	clientName?: string;
	label: string;
}

const inputClass =
	'w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-100';

export function OAuthAccessTokensPanel({ active = true }: { active?: boolean }) {
	const t = useTranslations('oauthAccessTokensPage');
	const tCommon = useTranslations('common');
	const ui = useTranslations('mcp.ui');
	const requestId = useRef(0);
	const [loadError, setLoadError] = useState(false);
	const { notify, confirm } = useFeedback();
	const { formatDateTime } = useGatewayDateTime();

	const [items, setItems] = useState<GatewayOAuthAccessToken[]>([]);
	const [total, setTotal] = useState(0);
	const [page, setPage] = useState(1);
	const [overview, setOverview] = useState<OAuthAppsOverview>({
		apps: [],
		unattributed: [],
		unattributed_client_count: 0,
	});
	const [filterEmail, setFilterEmail] = useState('');
	const [filterApp, setFilterApp] = useState<AppFilter | null>(null);
	const [dialog, setDialog] = useState<{ app: OAuthApp | null; initial: OAuthAppDraft | null } | null>(null);
	const [filterStatus, setFilterStatus] = useState<StatusFilter>('');
	const [isLoading, setIsLoading] = useState(true);
	const [busyKey, setBusyKey] = useState<string | null>(null);

	const fetchStats = useCallback(async () => {
		try {
			const response = await fetch('/api/admin/oauth/apps');
			const data = await readApiJson<OAuthAppsOverview>(response);
			if (data.success && data.data) setOverview(data.data);
		} catch (error) {
			console.error('Fetch access token stats error:', error);
		}
	}, []);

	const fetchList = useCallback(async () => {
		const request = ++requestId.current;
		try {
			setLoadError(false);
			setIsLoading(true);
			const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
			if (filterEmail.trim()) params.set('email', filterEmail.trim());
			if (filterApp) {
				params.set('app_id', filterApp.appId);
				if (filterApp.clientName) params.set('client_name', filterApp.clientName);
			}
			if (filterStatus) params.set('status', filterStatus);
			const response = await fetch(`/api/admin/oauth-access-tokens?${params.toString()}`);
			const data = await readApiJson<OAuthAccessTokenListPage>(response);
			if (request !== requestId.current) return;
			if (!data.success || !data.data) throw new Error('Could not load access tokens');
			const lastPage = Math.max(1, Math.ceil(data.data.total / PAGE_SIZE));
			setTotal(data.data.total);
			// Revocation under a status filter or cleanup can remove the last page.
			if (page > lastPage) {
				setItems([]);
				setPage(lastPage);
				return;
			}
			setItems(data.data.items);
		} catch (error) {
			if (request === requestId.current) setLoadError(true);
			console.error('Fetch access tokens error:', error);
		} finally {
			if (request === requestId.current) setIsLoading(false);
		}
	}, [page, filterEmail, filterApp, filterStatus]);

	useEffect(() => {
		if (active) void fetchList();
	}, [active, fetchList]);
	useEffect(() => {
		if (active) void fetchStats();
	}, [active, fetchStats]);

	useEffect(
		() => () => {
			++requestId.current;
		},
		[]
	);

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

	/** 撤销一个应用（或「未归属」中的一个客户端名称组）的全部授权。 */
	const revokeGroup = async (target: { id: string; label: string; clientName?: string; liveCount: number }) => {
		if (busyKey != null || target.liveCount === 0) return;
		const ok = await confirm({
			title: t('revokeClientTitle'),
			message: t('revokeClientConfirm', { client: target.label, count: target.liveCount }),
			confirmLabel: t('revokeAll'),
			danger: true,
		});
		if (!ok) return;
		setBusyKey(`app:${target.id}:${target.clientName ?? ''}`);
		try {
			const response = await fetch(`/api/admin/oauth/apps/${encodeURIComponent(target.id)}/revoke`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(target.clientName ? { client_name: target.clientName } : {}),
			});
			const data = await readApiJson<{ revoked: number }>(response);
			if (data.success) {
				notify('success', t('revokedMany', { count: data.data?.revoked ?? 0 }));
				reload();
			} else {
				notify('error', data.message || t('revokeFailed'));
			}
		} catch (error) {
			console.error('Revoke app grants error:', error);
			notify('error', t('revokeFailed'));
		} finally {
			setBusyKey(null);
		}
	};

	const toggleApp = async (app: OAuthApp) => {
		setBusyKey(`toggle:${app.id}`);
		try {
			const response = await fetch(`/api/admin/oauth/apps/${encodeURIComponent(app.id)}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ enabled: !app.enabled }),
			});
			const data = await readApiJson(response);
			if (data.success) reload();
			else notify('error', data.message || t('apps.form.saveFailed'));
		} catch (error) {
			console.error('Toggle OAuth app error:', error);
			notify('error', t('apps.form.saveFailed'));
		} finally {
			setBusyKey(null);
		}
	};

	const deleteApp = async (app: OAuthApp) => {
		const ok = await confirm({
			title: t('apps.deleteTitle'),
			message: t('apps.deleteConfirm', { name: app.name, count: app.live_count }),
			confirmLabel: t('apps.delete'),
			danger: true,
		});
		if (!ok) return;
		setBusyKey(`delete:${app.id}`);
		try {
			const response = await fetch(`/api/admin/oauth/apps/${encodeURIComponent(app.id)}`, { method: 'DELETE' });
			const data = await readApiJson(response);
			if (data.success) {
				notify('success', t('apps.deleted'));
				if (filterApp?.appId === app.id) setFilterApp(null);
				reload();
			} else {
				notify('error', data.message || t('apps.form.saveFailed'));
			}
		} catch (error) {
			console.error('Delete OAuth app error:', error);
			notify('error', t('apps.form.saveFailed'));
		} finally {
			setBusyKey(null);
		}
	};

	const showGrants = (next: AppFilter) => {
		setFilterApp((current) =>
			current?.appId === next.appId && current.clientName === next.clientName ? null : next
		);
		setPage(1);
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

	const hasFilters = Boolean(filterEmail.trim() || filterApp || filterStatus);
	const existingSlugs = new Set(overview.apps.map((app) => app.slug));
	const availablePresets = OAUTH_APP_PRESETS.filter((preset) => !existingSlugs.has(preset.slug));
	const clearFilters = () => {
		setFilterEmail('');
		setFilterApp(null);
		setFilterStatus('');
		setPage(1);
	};
	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
	const showSkeleton = isLoading && items.length === 0;

	return (
		<section
			id="oauth-access-tokens"
			className="admin-content-panel admin-table-surface mb-6 scroll-mt-4 rounded-xl border border-gray-200 bg-white"
		>
			<header className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
				<div>
					<div className="flex items-center gap-2">
						<h2 className="text-base font-medium text-gray-900">{t('title')}</h2>
						<InfoHintPopover label={t('title')} portal openOnHover align="start">
							{t('subtitle')}
						</InfoHintPopover>
					</div>
					<p className="mt-1 text-sm leading-6 text-gray-500">{ui('tokenSummary')}</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					{availablePresets.length > 0 && (
						<details className="relative">
							<summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
								{t('apps.importPreset')}
							</summary>
							<div className="absolute right-0 z-10 mt-1 min-w-[12rem] rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
								{availablePresets.map((preset) => (
									<button
										key={preset.slug}
										type="button"
										onClick={(event) => {
											event.currentTarget.closest('details')?.removeAttribute('open');
											setDialog({ app: null, initial: preset });
										}}
										className="block w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
									>
										{preset.name}
									</button>
								))}
							</div>
						</details>
					)}
					<button
						type="button"
						onClick={() => setDialog({ app: null, initial: null })}
						className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
					>
						<PlusIcon className="h-4 w-4" aria-hidden />
						{t('apps.add')}
					</button>
					<button
						type="button"
						onClick={() => void cleanup()}
						disabled={busyKey != null}
						className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
						title={t('cleanupHint')}
					>
						<TrashIcon className="h-4 w-4" aria-hidden />
						{t('cleanup')}
					</button>
				</div>
			</header>
			<div className="space-y-4 border-t border-gray-100 p-4 sm:p-5">
				<div>
					<h3 className="mb-2 text-xs font-medium text-gray-500">{t('apps.title')}</h3>
					{overview.apps.length === 0 ? (
						<div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
							{t('apps.empty')}
						</div>
					) : (
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
							{overview.apps.map((app) => {
								const selected = filterApp?.appId === app.id;
								return (
									<div
										key={app.id}
										className={`rounded-xl border bg-white px-4 py-3 ${
											selected ? 'border-gray-500 ring-1 ring-gray-500' : 'border-gray-200'
										} ${app.enabled ? '' : 'opacity-70'}`}
									>
										<div className="flex items-start justify-between gap-2">
											<button
												type="button"
												onClick={() => showGrants({ appId: app.id, label: app.name })}
												className="min-w-0 text-left"
												title={t('apps.viewGrants')}
											>
												<div className="flex items-center gap-2">
													<span className="truncate text-sm font-medium text-gray-900">{app.name}</span>
													{!app.enabled && (
														<span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">
															{t('apps.disabledBadge')}
														</span>
													)}
												</div>
												<div className="truncate font-mono text-xs text-gray-400">{app.slug}</div>
											</button>
											<button
												type="button"
												onClick={() =>
													void revokeGroup({ id: app.id, label: app.name, liveCount: app.live_count })
												}
												disabled={app.live_count === 0 || busyKey != null}
												className="shrink-0 rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
											>
												{t('revokeAll')}
											</button>
										</div>
										<div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
											<span>{t('apps.statUsers', { count: app.user_count })}</span>
											<span>{t('apps.statClients', { count: app.client_count })}</span>
											<span>{t('statActive', { count: app.active_count })}</span>
											<span>
												{t('statLastUsed')} {formatDateTime(app.last_used_at) || tCommon('noData')}
											</span>
										</div>
										<div className="mt-2 flex gap-3 text-xs">
											<button
												type="button"
												onClick={() => setDialog({ app, initial: null })}
												className="text-gray-500 hover:text-gray-800 hover:underline"
											>
												{t('apps.edit')}
											</button>
											<button
												type="button"
												onClick={() => void toggleApp(app)}
												disabled={busyKey != null}
												className="text-gray-500 hover:text-gray-800 hover:underline disabled:opacity-40"
											>
												{app.enabled ? t('apps.disable') : t('apps.enable')}
											</button>
											<button
												type="button"
												onClick={() => void deleteApp(app)}
												disabled={busyKey != null}
												className="text-red-600 hover:underline disabled:opacity-40"
											>
												{t('apps.delete')}
											</button>
										</div>
									</div>
								);
							})}
						</div>
					)}
				</div>

				{overview.unattributed.length > 0 && (
					<div>
						<h3 className="text-xs font-medium text-gray-500">{t('apps.unattributedTitle')}</h3>
						<p className="mb-2 mt-1 text-xs leading-5 text-gray-400">{t('apps.unattributedHint')}</p>
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
							{overview.unattributed.map((stat) => {
								const label = stat.app_name || tCommon('noData');
								const selected = filterApp?.appId === 'none' && filterApp.clientName === stat.app_name;
								return (
									<div
										key={stat.app_name}
										className={`rounded-xl border border-dashed bg-white px-4 py-3 ${
											selected ? 'border-gray-500 ring-1 ring-gray-500' : 'border-gray-300'
										}`}
									>
										<div className="flex items-start justify-between gap-2">
											<button
												type="button"
												onClick={() =>
													showGrants({ appId: 'none', clientName: stat.app_name, label })
												}
												className="min-w-0 truncate text-left text-sm font-medium text-gray-900"
												title={t('apps.viewGrants')}
											>
												{label}
											</button>
											<button
												type="button"
												onClick={() =>
													void revokeGroup({
														id: 'none',
														label,
														clientName: stat.app_name,
														liveCount: stat.live_count,
													})
												}
												disabled={stat.live_count === 0 || busyKey != null}
												className="shrink-0 rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
											>
												{t('revokeAll')}
											</button>
										</div>
										<div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
											<span>{t('statActive', { count: stat.active_count })}</span>
											<span>{t('statTotal', { count: stat.total_count })}</span>
										</div>
									</div>
								);
							})}
						</div>
					</div>
				)}

				<div className="admin-content-panel rounded-xl border border-gray-200 bg-white px-4 py-3">
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
										aria-label={tCommon('email')}
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
									aria-label={t('table.status')}
									value={filterStatus}
									onChange={(e) => {
										setFilterStatus(e.target.value as StatusFilter);
										setPage(1);
									}}
									className={inputClass}
								>
									<option value="">{tCommon('all')}</option>
									{STATUSES.map((status) => (
										<option key={status} value={status}>
											{t(`status.${status}`)}
										</option>
									))}
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
							{STATUSES.map((status) => (
								<span key={status} className="inline-flex items-center gap-1.5">
									<span
										className={`inline-block h-2 w-2 rounded-full ${oauthAccessTokenStatusDotClass(
											status
										)}`}
										aria-hidden
									/>
									{t(`status.${status}`)}
								</span>
							))}
						</div>
					</div>
				</div>

				{filterApp ? (
					<div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
						<span>{t('apps.filteringBy', { name: filterApp.label })}</span>
						<button
							type="button"
							onClick={() => setFilterApp(null)}
							className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800"
						>
							<XMarkIcon className="h-3.5 w-3.5" aria-hidden />
							{tCommon('clearFilters')}
						</button>
					</div>
				) : null}
				{loadError ? (
					<div
						role="alert"
						className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-red-50 p-3 text-sm text-red-700"
					>
						<span>{ui('tokenLoadFailed')}</span>
						<button type="button" disabled={isLoading} onClick={reload} className="font-medium underline">
							{ui('retry')}
						</button>
					</div>
				) : null}
				<div className="admin-content-panel admin-table-surface overflow-hidden rounded-xl border border-gray-200 bg-white">
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
											className="px-4 py-2.5 text-left text-xs font-medium tracking-normal text-gray-500 whitespace-nowrap"
										>
											{t(`table.${column}`)}
										</th>
									))}
									<th className="px-4 py-2.5 text-right text-xs font-medium tracking-normal text-gray-500 whitespace-nowrap">
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
														className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${oauthAccessTokenStatusDotClass(
															token.status
														)}`}
														title={t(`status.${token.status}`)}
														role="img"
														aria-label={t(`status.${token.status}`)}
													/>
													<div className="min-w-0">
														<Link
															href={`/gateway/users/${encodeURIComponent(token.user_id)}`}
															title={token.user_id}
															className={`block truncate text-sm font-medium hover:underline ${
																live ? 'text-gray-800' : 'text-gray-500'
															}`}
														>
															{token.user_email || tCommon('noData')}
														</Link>
													</div>
												</div>
											</td>
											<td className="px-4 py-3.5 overflow-hidden">
												<button
													type="button"
													onClick={() =>
														showGrants(
															token.app_id
																? { appId: token.app_id, label: token.app_name || token.client_name }
																: { appId: 'none', clientName: token.client_name, label: token.client_name }
														)
													}
													className="block max-w-full text-left"
													title={t('filterByClient')}
												>
													<div
														className={`truncate text-sm font-medium ${
															live ? 'text-gray-900' : 'text-gray-500'
														}`}
													>
														{token.app_name || token.client_name}
													</div>
													<div className="truncate font-mono text-xs text-gray-400">
														{token.app_id ? token.client_name : t('apps.unattributedBadge')}
													</div>
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
														href={`/gateway/request-logs?user_email=${encodeURIComponent(
															token.user_email ?? ''
														)}`}
														className="text-gray-500 hover:text-gray-800 hover:underline"
													>
														{t('logs')}
													</Link>
													{live && (
														<button
															type="button"
															onClick={() => void revokeOne(token)}
															disabled={busyKey != null}
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
			<OAuthAppFormDialog
				open={dialog != null}
				app={dialog?.app ?? null}
				initial={dialog?.initial ?? null}
				onClose={() => setDialog(null)}
				onSaved={reload}
			/>
		</section>
	);
}
