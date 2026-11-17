'use client';

/**
 * OAuth 访问令牌（`oat_`）：授权服务器代用户签发给第三方 MCP 客户端的凭证。
 * 一行 = 一次授权（用户 × 客户端实例）。支持按应用 / 用户 / 状态筛选，单条撤销、整应用撤销、清理过期。
 */
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
	MagnifyingGlassIcon,
	PlusIcon,
	RectangleStackIcon,
	Squares2X2Icon,
	TrashIcon,
	XMarkIcon,
} from '@heroicons/react/24/outline';
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
import styles from '../mcp-client-workspace.module.css';
import { OAUTH_APP_PRESETS, OAuthAppFormDialog, type OAuthAppDraft } from './oauth-app-form-dialog';
import { OAuthManualClientsDialog } from './oauth-manual-clients-dialog';

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
	const [appQuery, setAppQuery] = useState('');
	const [appsLoading, setAppsLoading] = useState(true);
	const [appsError, setAppsError] = useState(false);
	const [filterApp, setFilterApp] = useState<AppFilter | null>(null);
	const [dialog, setDialog] = useState<{
		app: OAuthApp | null;
		initial: OAuthAppDraft | null;
	} | null>(null);
	const [manualApp, setManualApp] = useState<OAuthApp | null>(null);
	const [presetMenuOpen, setPresetMenuOpen] = useState(false);
	const presetMenuRef = useRef<HTMLDivElement>(null);

	// 点击菜单外部或按 Esc 收起预设菜单。
	useEffect(() => {
		if (!presetMenuOpen) return;
		const onPointerDown = (event: PointerEvent) => {
			if (!presetMenuRef.current?.contains(event.target as Node)) setPresetMenuOpen(false);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setPresetMenuOpen(false);
		};
		document.addEventListener('pointerdown', onPointerDown);
		document.addEventListener('keydown', onKeyDown);
		return () => {
			document.removeEventListener('pointerdown', onPointerDown);
			document.removeEventListener('keydown', onKeyDown);
		};
	}, [presetMenuOpen]);
	const [filterStatus, setFilterStatus] = useState<StatusFilter>('');
	const [isLoading, setIsLoading] = useState(true);
	const [busyKey, setBusyKey] = useState<string | null>(null);

	const fetchStats = useCallback(async () => {
		setAppsLoading(true);
		setAppsError(false);
		try {
			const response = await fetch('/api/admin/oauth/apps');
			const data = await readApiJson<OAuthAppsOverview>(response);
			if (!data.success || !data.data) throw new Error('Could not load apps');
			setOverview(data.data);
		} catch (error) {
			console.error('Fetch access token stats error:', error);
			setAppsError(true);
		} finally {
			setAppsLoading(false);
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
	const revokeGroup = async (target: {
		id: string;
		label: string;
		clientName?: string;
		liveCount: number;
	}) => {
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

	const showGrants = (next: AppFilter | null) => {
		setFilterApp(next);
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

	const hasFilters = Boolean(filterEmail.trim() || filterStatus);
	const existingSlugs = new Set(overview.apps.map((app) => app.slug));
	const availablePresets = OAUTH_APP_PRESETS.filter((preset) => !existingSlugs.has(preset.slug));
	const clearFilters = () => {
		setFilterEmail('');
		setFilterStatus('');
		setPage(1);
	};
	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
	const showSkeleton = isLoading && items.length === 0;

	const selectedApp = overview.apps.find((app) => app.id === filterApp?.appId);
	const selectedLegacy =
		filterApp?.appId === 'none'
			? overview.unattributed.find((stat) => stat.app_name === filterApp.clientName)
			: undefined;
	const query = appQuery.trim().toLocaleLowerCase();
	const visibleApps = overview.apps.filter((app) =>
		[app.name, app.slug].some((value) => value.toLocaleLowerCase().includes(query))
	);
	const sidebarItem = (selected: boolean) =>
		`${styles.appItem} ${selected ? styles.appItemSelected : ''}`;

	return (
		<section id="oauth-access-tokens" className={`${styles.grantsPanel} min-w-0 scroll-mt-4`}>
			<header className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-5 py-4 sm:px-6">
				<span
					className="mr-1 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 text-teal-700"
					aria-hidden="true"
				>
					<Squares2X2Icon className="h-4 w-4" />
				</span>
				<h2 className="text-base font-medium text-gray-900">{t('managementTitle')}</h2>
				<InfoHintPopover label={t('managementTitle')} portal openOnHover align="start">
					<p>{t('relationshipHint')}</p>
					<p className="mt-2">{t('globalScope')}</p>
				</InfoHintPopover>
			</header>
			<div className={styles.grantsWorkspace}>
				<aside className={`${styles.appDirectory} space-y-3`} aria-label={t('apps.title')}>
					<div className="flex items-center justify-between gap-2">
						<div className="flex min-w-0 items-center gap-2">
							<h3 className="text-sm font-medium text-gray-900">{t('apps.title')}</h3>
							<span className="font-mono text-xs text-gray-400">{overview.apps.length}</span>
							<InfoHintPopover label={t('apps.title')} portal openOnHover align="start">
								{t('appsRoleHint')}
							</InfoHintPopover>
						</div>
						<div className="flex shrink-0 items-center gap-1">
							{availablePresets.length > 0 && (
								<div className="relative" ref={presetMenuRef}>
									<button
										type="button"
										onClick={() => setPresetMenuOpen((open) => !open)}
										title={t('apps.importPreset')}
										aria-label={t('apps.importPreset')}
										aria-haspopup="menu"
										aria-expanded={presetMenuOpen}
										className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:bg-gray-200/60 hover:text-gray-800 aria-expanded:bg-gray-200/60 aria-expanded:text-gray-800"
									>
										<RectangleStackIcon className="h-4 w-4" aria-hidden />
									</button>
									{presetMenuOpen && (
										<div
											role="menu"
											className="absolute left-0 z-20 mt-1 max-h-80 min-w-[12rem] overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 shadow-lg"
										>
											<p className="px-3 pb-1 pt-1.5 text-xs text-gray-400">{t('apps.importPreset')}</p>
											{availablePresets.map((preset) => (
												<button
													key={preset.slug}
													type="button"
													role="menuitem"
													onClick={() => {
														setPresetMenuOpen(false);
														setDialog({ app: null, initial: preset });
													}}
													className="block w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
												>
													{preset.name}
												</button>
											))}
										</div>
									)}
								</div>
							)}
							<button
								type="button"
								onClick={() => setDialog({ app: null, initial: null })}
								title={t('apps.add')}
								aria-label={t('apps.add')}
								className="inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:bg-gray-200/60 hover:text-gray-800"
							>
								<PlusIcon className="h-4 w-4" aria-hidden />
							</button>
						</div>
					</div>
					<input
						type="search"
						value={appQuery}
						onChange={(event) => setAppQuery(event.target.value)}
						aria-label={t('searchApps')}
						placeholder={t('searchApps')}
						className={inputClass}
					/>
					<nav className={styles.appList} aria-label={t('selectApp')}>
						<button
							type="button"
							aria-pressed={filterApp === null}
							onClick={() => showGrants(null)}
							className={sidebarItem(filterApp === null)}
						>
							<span className="block text-sm font-medium text-gray-900">{t('allGrants')}</span>
						</button>
						{appsLoading && !overview.apps.length ? (
							<p role="status" className="p-3 text-xs text-gray-500">
								{tCommon('loading')}
							</p>
						) : null}
						{appsError ? (
							<div role="alert" className="p-3 text-xs text-red-600">
								{tCommon('requestFailed')}{' '}
								<button type="button" onClick={() => void fetchStats()} className="underline">
									{ui('retry')}
								</button>
							</div>
						) : null}
						{visibleApps.map((app) => (
							<button
								key={app.id}
								type="button"
								aria-pressed={filterApp?.appId === app.id}
								onClick={() => showGrants({ appId: app.id, label: app.name })}
								className={sidebarItem(filterApp?.appId === app.id)}
							>
								<span className="flex items-center justify-between gap-2">
									<span className="truncate text-sm font-medium text-gray-900">{app.name}</span>
									{!app.enabled ? (
										<span className="shrink-0 text-xs text-gray-400">
											{t('apps.disabledBadge')}
										</span>
									) : null}
								</span>
								{app.name.toLocaleLowerCase() !== app.slug.toLocaleLowerCase() ? (
									<span className="mt-1 block truncate font-mono text-xs text-gray-400">
										{app.slug}
									</span>
								) : null}
								<span className="mt-1 block text-xs text-gray-500">
									{t('statActive', { count: app.active_count })} ·{' '}
									{t('apps.statUsers', { count: app.user_count })}
								</span>
							</button>
						))}
						{!appsLoading && !appsError && !visibleApps.length ? (
							<p className="p-3 text-xs text-gray-500">
								{query ? t('noMatchingApps') : t('apps.empty')}
							</p>
						) : null}
						{overview.unattributed.length ? (
							<div className={`${styles.legacyApps} space-y-1 border-t border-gray-200 pt-3`}>
								<button
									type="button"
									aria-pressed={filterApp?.appId === 'none' && !filterApp.clientName}
									onClick={() => showGrants({ appId: 'none', label: t('apps.unattributedTitle') })}
									className={sidebarItem(filterApp?.appId === 'none' && !filterApp.clientName)}
								>
									<span className="text-sm font-medium text-gray-700">
										{t('apps.unattributedTitle')}
									</span>
								</button>
								{overview.unattributed
									.filter((stat) => !query || stat.app_name?.toLocaleLowerCase().includes(query))
									.map((stat) => (
										<button
											key={stat.app_name}
											type="button"
											aria-pressed={
												filterApp?.appId === 'none' && filterApp.clientName === stat.app_name
											}
											onClick={() =>
												showGrants({
													appId: 'none',
													clientName: stat.app_name,
													label: stat.app_name || tCommon('noData'),
												})
											}
											className={sidebarItem(
												filterApp?.appId === 'none' && filterApp.clientName === stat.app_name
											)}
										>
											<span className="block truncate text-sm text-gray-700">
												{stat.app_name || tCommon('noData')}
											</span>
											<span className="mt-1 block text-xs text-gray-400">
												{t('statTotal', { count: stat.total_count })}
											</span>
										</button>
									))}
							</div>
						) : null}
					</nav>
				</aside>
				<section
					className={`${styles.grantsDetail} min-w-0 space-y-5`}
					aria-labelledby="mcp-user-grants-title"
				>
					<header className="flex flex-wrap items-start justify-between gap-3">
						<div className="min-w-0">
							<h3 id="mcp-user-grants-title" className="text-base font-medium text-gray-900">
								{t('grantsTitle')}
								{filterApp ? (
									<span className="ml-2 font-normal text-gray-500">· {filterApp.label}</span>
								) : null}
							</h3>
							<p className="mt-1 text-xs leading-5 text-gray-500">
								{filterApp?.appId === 'none' ? t('apps.unattributedHint') : t('grantsHint')}
							</p>
							{selectedApp ? (
								<div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
									<span>{t('apps.statClients', { count: selectedApp.client_count })}</span>
									<span>{t('apps.statUsers', { count: selectedApp.user_count })}</span>
									<span>{t('statActive', { count: selectedApp.active_count })}</span>
									{selectedApp.last_used_at ? (
										<span>
											{t('statLastUsed')} {formatDateTime(selectedApp.last_used_at)}
										</span>
									) : null}
								</div>
							) : null}
						</div>
						<div className="flex flex-wrap items-center gap-2 text-xs">
							{selectedApp ? (
								<>
									<button
										type="button"
										onClick={() => setDialog({ app: selectedApp, initial: null })}
										className="rounded-md px-2.5 py-2 text-gray-600 hover:bg-gray-50"
									>
										{t('apps.edit')}
									</button>
									<button
										type="button"
										onClick={() => setManualApp(selectedApp)}
										className="rounded-md px-2.5 py-2 text-gray-600 hover:bg-gray-50"
									>
										{t('apps.manualCredentials')}
									</button>
									<button
										type="button"
										disabled={busyKey != null}
										onClick={() => void toggleApp(selectedApp)}
										className="rounded-md px-2.5 py-2 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
									>
										{t(selectedApp.enabled ? 'apps.disable' : 'apps.enable')}
									</button>
									<button
										type="button"
										disabled={busyKey != null}
										onClick={() => void deleteApp(selectedApp)}
										className="rounded-md px-2.5 py-2 text-red-600 hover:bg-red-50 disabled:opacity-40"
									>
										{t('apps.delete')}
									</button>
								</>
							) : null}
							{selectedApp || selectedLegacy ? (
								<button
									type="button"
									disabled={
										busyKey != null ||
										(selectedApp?.live_count ?? selectedLegacy?.live_count ?? 0) === 0
									}
									onClick={() =>
										void revokeGroup(
											selectedApp
												? {
														id: selectedApp.id,
														label: selectedApp.name,
														liveCount: selectedApp.live_count,
												  }
												: {
														id: 'none',
														label: filterApp!.label,
														clientName: filterApp!.clientName,
														liveCount: selectedLegacy!.live_count,
												  }
										)
									}
									className="rounded-lg border border-red-200 px-3 py-2 text-red-600 hover:bg-red-50 disabled:opacity-40"
								>
									{t('revokeAll')}
								</button>
							) : null}
						</div>
					</header>

					<div className="border-y border-gray-100 py-3">
						<div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
							<div className="grid w-full min-w-0 grid-cols-1 gap-3 sm:max-w-xl sm:grid-cols-[minmax(0,1fr)_9rem]">
								<div className="min-w-0">
									<label className="mb-1 block text-xs font-medium text-gray-500">
										{tCommon('email')}
									</label>
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
									<label className="mb-1 block text-xs font-medium text-gray-500">
										{t('table.status')}
									</label>
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
								<button
									type="button"
									onClick={() => void cleanup()}
									disabled={busyKey != null}
									className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
									title={t('cleanupHint')}
								>
									<TrashIcon className="h-4 w-4" aria-hidden />
									{t('cleanup')}
								</button>
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
							</div>
						</div>
					</div>

					{loadError ? (
						<div
							role="alert"
							className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-red-50 p-3 text-sm text-red-700"
						>
							<span>{ui('tokenLoadFailed')}</span>
							<button
								type="button"
								disabled={isLoading}
								onClick={reload}
								className="font-medium underline"
							>
								{ui('retry')}
							</button>
						</div>
					) : null}
					<div className="min-w-0 bg-white">
						<div className={`overflow-x-auto ${isLoading ? 'opacity-70' : ''}`}>
							<table className="admin-data-table w-full min-w-[48rem] table-fixed">
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
																	? {
																			appId: token.app_id,
																			label: token.app_name || token.client_name,
																	  }
																	: {
																			appId: 'none',
																			clientName: token.client_name,
																			label: token.client_name,
																	  }
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
														{!token.app_id ||
														(token.app_name && token.app_name !== token.client_name) ? (
															<div className="truncate font-mono text-xs text-gray-400">
																{token.app_id ? token.client_name : t('apps.unattributedBadge')}
															</div>
														) : null}
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
							<div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
								<div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-gray-500">
									<span>{t('total', { count: total })}</span>
									<div className="flex flex-wrap items-center gap-3">
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
				</section>
			</div>
			<OAuthAppFormDialog
				open={dialog != null}
				app={dialog?.app ?? null}
				initial={dialog?.initial ?? null}
				onClose={() => setDialog(null)}
				onSaved={reload}
			/>
			<OAuthManualClientsDialog
				open={manualApp != null}
				app={manualApp}
				onClose={() => setManualApp(null)}
				onChanged={reload}
			/>
		</section>
	);
}
