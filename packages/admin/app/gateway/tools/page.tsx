'use client';

/**
 * Tools 配置：产品工具（`/v1/tools/*`）的 per-provider catalog + active；写入 `system_config`。
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ConfigCardShell } from '@/components/ConfigCardShell';
import { readApiJson } from '@/lib/api-json';
import type { SystemConfigRow } from '@/lib/types';
import { useBillingCurrency } from '@/lib/use-billing-currency';
import {
	DEFAULT_WEB_SEARCH_COST,
	DEFAULT_WEB_SEARCH_PROVIDER,
	getWebSearchProviderOptions,
	WEB_SEARCH_ACTIVE_KEY,
	WEB_SEARCH_API_KEY_KEY,
	WEB_SEARCH_CATALOG_KEY,
	WEB_SEARCH_COST_KEY,
	WEB_SEARCH_PROVIDER_DOCS_URL,
	WEB_SEARCH_PROVIDER_KEY,
	WEB_SEARCH_PROVIDERS,
	type WebSearchProvider,
} from '@/lib/web-search-options';
import {
	DEFAULT_WEB_FETCH_COST,
	DEFAULT_WEB_FETCH_PROVIDER,
	getWebFetchProviderOptions,
	WEB_FETCH_ACTIVE_KEY,
	WEB_FETCH_API_KEY_KEY,
	WEB_FETCH_CATALOG_KEY,
	WEB_FETCH_COST_KEY,
	WEB_FETCH_PROVIDER_DOCS_URL,
	WEB_FETCH_PROVIDER_KEY,
	WEB_FETCH_PROVIDERS,
	type WebFetchProvider,
} from '@/lib/web-fetch-options';
import {
	parseWebFetchCatalogLenient,
	serializeWebFetchCatalog,
	type WebFetchCatalog,
} from '@octafuse/core/lib/web-fetch-system-config';
import {
	parseWebSearchCatalogLenient,
	serializeWebSearchCatalog,
	type WebSearchCatalog,
} from '@octafuse/core/lib/web-search-system-config';
import { WebSearchProviderGuideModal } from './components/web-search-provider-guide-modal';

type ProviderDraft = { apiKey: string; cost: string };

function emptySearchDrafts(): Record<WebSearchProvider, ProviderDraft> {
	const out = {} as Record<WebSearchProvider, ProviderDraft>;
	for (const p of WEB_SEARCH_PROVIDERS) {
		out[p] = { apiKey: '', cost: String(DEFAULT_WEB_SEARCH_COST) };
	}
	return out;
}

function emptyFetchDrafts(): Record<WebFetchProvider, ProviderDraft> {
	const out = {} as Record<WebFetchProvider, ProviderDraft>;
	for (const p of WEB_FETCH_PROVIDERS) {
		out[p] = { apiKey: '', cost: String(DEFAULT_WEB_FETCH_COST) };
	}
	return out;
}

function syncWebSearchFromRows(
	rows: SystemConfigRow[]
): { active: WebSearchProvider; drafts: Record<WebSearchProvider, ProviderDraft>; savedActive: WebSearchProvider | null } {
	const drafts = emptySearchDrafts();
	const catalogRaw = rows.find((r) => r.key === WEB_SEARCH_CATALOG_KEY)?.value ?? null;
	const catalogPresent = catalogRaw != null && String(catalogRaw).trim().length > 0;

	if (catalogPresent) {
		const catalog = parseWebSearchCatalogLenient(catalogRaw) ?? {};
		for (const p of WEB_SEARCH_PROVIDERS) {
			const entry = catalog[p];
			if (entry) {
				drafts[p] = { apiKey: entry.apiKey, cost: String(entry.cost) };
			}
		}
		const activeRaw = rows.find((r) => r.key === WEB_SEARCH_ACTIVE_KEY)?.value?.trim().toLowerCase() ?? '';
		const active = (WEB_SEARCH_PROVIDERS as readonly string[]).includes(activeRaw)
			? (activeRaw as WebSearchProvider)
			: DEFAULT_WEB_SEARCH_PROVIDER;
		const savedActive = (WEB_SEARCH_PROVIDERS as readonly string[]).includes(activeRaw)
			? (activeRaw as WebSearchProvider)
			: null;
		return { active, drafts, savedActive };
	}

	// 旧三键 seed
	const providerRaw = rows.find((r) => r.key === WEB_SEARCH_PROVIDER_KEY)?.value?.trim().toLowerCase() ?? '';
	const provider = (WEB_SEARCH_PROVIDERS as readonly string[]).includes(providerRaw)
		? (providerRaw as WebSearchProvider)
		: DEFAULT_WEB_SEARCH_PROVIDER;
	const apiKey = rows.find((r) => r.key === WEB_SEARCH_API_KEY_KEY)?.value ?? '';
	const costRaw = rows.find((r) => r.key === WEB_SEARCH_COST_KEY)?.value?.trim() ?? '';
	drafts[provider] = {
		apiKey,
		cost: costRaw || String(DEFAULT_WEB_SEARCH_COST),
	};
	return { active: provider, drafts, savedActive: null };
}

function syncWebFetchFromRows(
	rows: SystemConfigRow[]
): { active: WebFetchProvider; drafts: Record<WebFetchProvider, ProviderDraft>; savedActive: WebFetchProvider | null } {
	const drafts = emptyFetchDrafts();
	const catalogRaw = rows.find((r) => r.key === WEB_FETCH_CATALOG_KEY)?.value ?? null;
	const catalogPresent = catalogRaw != null && String(catalogRaw).trim().length > 0;

	if (catalogPresent) {
		const catalog = parseWebFetchCatalogLenient(catalogRaw) ?? {};
		for (const p of WEB_FETCH_PROVIDERS) {
			const entry = catalog[p];
			if (entry) {
				drafts[p] = { apiKey: entry.apiKey, cost: String(entry.cost) };
			}
		}
		const activeRaw = rows.find((r) => r.key === WEB_FETCH_ACTIVE_KEY)?.value?.trim().toLowerCase() ?? '';
		const active = (WEB_FETCH_PROVIDERS as readonly string[]).includes(activeRaw)
			? (activeRaw as WebFetchProvider)
			: DEFAULT_WEB_FETCH_PROVIDER;
		const savedActive = (WEB_FETCH_PROVIDERS as readonly string[]).includes(activeRaw)
			? (activeRaw as WebFetchProvider)
			: null;
		return { active, drafts, savedActive };
	}

	const providerRaw = rows.find((r) => r.key === WEB_FETCH_PROVIDER_KEY)?.value?.trim().toLowerCase() ?? '';
	const provider = (WEB_FETCH_PROVIDERS as readonly string[]).includes(providerRaw)
		? (providerRaw as WebFetchProvider)
		: DEFAULT_WEB_FETCH_PROVIDER;
	const apiKey = rows.find((r) => r.key === WEB_FETCH_API_KEY_KEY)?.value ?? '';
	const costRaw = rows.find((r) => r.key === WEB_FETCH_COST_KEY)?.value?.trim() ?? '';
	drafts[provider] = {
		apiKey,
		cost: costRaw || String(DEFAULT_WEB_FETCH_COST),
	};
	return { active: provider, drafts, savedActive: null };
}

function buildSearchCatalog(drafts: Record<WebSearchProvider, ProviderDraft>): WebSearchCatalog | null {
	const catalog: WebSearchCatalog = {};
	for (const p of WEB_SEARCH_PROVIDERS) {
		const d = drafts[p];
		const costNum = Number(d.cost.trim());
		if (!d.cost.trim() || !Number.isFinite(costNum) || costNum < 0) {
			return null;
		}
		catalog[p] = { apiKey: d.apiKey.trim(), cost: costNum };
	}
	return catalog;
}

function buildFetchCatalog(drafts: Record<WebFetchProvider, ProviderDraft>): WebFetchCatalog | null {
	const catalog: WebFetchCatalog = {};
	for (const p of WEB_FETCH_PROVIDERS) {
		const d = drafts[p];
		const costNum = Number(d.cost.trim());
		if (!d.cost.trim() || !Number.isFinite(costNum) || costNum < 0) {
			return null;
		}
		catalog[p] = { apiKey: d.apiKey.trim(), cost: costNum };
	}
	return catalog;
}

async function putConfig(key: string, value: string): Promise<{ ok: true; message?: string } | { ok: false; message: string }> {
	const response = await fetch('/api/admin/config', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ key, value }),
	});
	const data = await readApiJson(response);
	if (!data.success) {
		return { ok: false, message: data.message || 'save failed' };
	}
	return { ok: true, message: data.message };
}

export default function GatewayToolsConfigPage() {
	const t = useTranslations('tools');
	const tCommon = useTranslations('common');
	const { currency: billingCurrency } = useBillingCurrency();
	const webSearchProviderOptions = getWebSearchProviderOptions((k) => t(k));
	const webFetchProviderOptions = getWebFetchProviderOptions((k) => t(k));

	const [isLoading, setIsLoading] = useState(true);
	const [saveError, setSaveError] = useState('');
	const [saveSuccess, setSaveSuccess] = useState('');
	const saveSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const [webSearchActive, setWebSearchActive] = useState<WebSearchProvider>(DEFAULT_WEB_SEARCH_PROVIDER);
	const [webSearchSavedActive, setWebSearchSavedActive] = useState<WebSearchProvider | null>(null);
	const [webSearchDrafts, setWebSearchDrafts] = useState(emptySearchDrafts);
	/** 默认明文显示；仅显式设为 false 时隐藏 */
	const [webSearchKeyVisible, setWebSearchKeyVisible] = useState<Partial<Record<WebSearchProvider, boolean>>>({});
	const [webSearchSaving, setWebSearchSaving] = useState(false);
	const [providerGuideOpen, setProviderGuideOpen] = useState(false);

	const [webFetchActive, setWebFetchActive] = useState<WebFetchProvider>(DEFAULT_WEB_FETCH_PROVIDER);
	const [webFetchSavedActive, setWebFetchSavedActive] = useState<WebFetchProvider | null>(null);
	const [webFetchDrafts, setWebFetchDrafts] = useState(emptyFetchDrafts);
	/** 默认明文显示；仅显式设为 false 时隐藏 */
	const [webFetchKeyVisible, setWebFetchKeyVisible] = useState<Partial<Record<WebFetchProvider, boolean>>>({});
	const [webFetchSaving, setWebFetchSaving] = useState(false);

	const clearSaveSuccess = useCallback(() => {
		if (saveSuccessTimerRef.current != null) {
			clearTimeout(saveSuccessTimerRef.current);
			saveSuccessTimerRef.current = null;
		}
		setSaveSuccess('');
	}, []);

	const flashSaveSuccess = useCallback(
		(message?: string) => {
			if (saveSuccessTimerRef.current != null) {
				clearTimeout(saveSuccessTimerRef.current);
				saveSuccessTimerRef.current = null;
			}
			setSaveError('');
			setSaveSuccess(message ?? tCommon('configUpdated'));
			saveSuccessTimerRef.current = setTimeout(() => {
				setSaveSuccess('');
				saveSuccessTimerRef.current = null;
			}, 2500);
		},
		[tCommon]
	);

	const fetchConfig = useCallback(async () => {
		try {
			setIsLoading(true);
			const response = await fetch('/api/admin/config');
			const data = await readApiJson<SystemConfigRow[]>(response);
			if (data.success && Array.isArray(data.data)) {
				const search = syncWebSearchFromRows(data.data);
				setWebSearchActive(search.active);
				setWebSearchDrafts(search.drafts);
				setWebSearchSavedActive(search.savedActive);
				const fetch = syncWebFetchFromRows(data.data);
				setWebFetchActive(fetch.active);
				setWebFetchDrafts(fetch.drafts);
				setWebFetchSavedActive(fetch.savedActive);
			}
		} catch (error) {
			console.error('Fetch tools config error:', error);
		} finally {
			setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		void fetchConfig();
	}, [fetchConfig]);

	useEffect(() => {
		return () => {
			if (saveSuccessTimerRef.current != null) {
				clearTimeout(saveSuccessTimerRef.current);
			}
		};
	}, []);

	const webSearchActivatable = useMemo(
		() => WEB_SEARCH_PROVIDERS.filter((p) => webSearchDrafts[p].apiKey.trim().length > 0),
		[webSearchDrafts]
	);
	const webFetchActivatable = useMemo(
		() => WEB_FETCH_PROVIDERS.filter((p) => webFetchDrafts[p].apiKey.trim().length > 0),
		[webFetchDrafts]
	);

	useEffect(() => {
		if (webSearchActivatable.length > 0 && !webSearchActivatable.includes(webSearchActive)) {
			setWebSearchActive(webSearchActivatable[0]!);
		}
	}, [webSearchActivatable, webSearchActive]);

	useEffect(() => {
		if (webFetchActivatable.length > 0 && !webFetchActivatable.includes(webFetchActive)) {
			setWebFetchActive(webFetchActivatable[0]!);
		}
	}, [webFetchActivatable, webFetchActive]);

	const handleSaveWebSearch = async () => {
		const catalog = buildSearchCatalog(webSearchDrafts);
		if (!catalog) {
			clearSaveSuccess();
			setSaveError(t('errors.invalidWebSearchCost'));
			return;
		}
		if (!webSearchDrafts[webSearchActive].apiKey.trim()) {
			clearSaveSuccess();
			setSaveError(t('errors.noKeyCannotActivate'));
			return;
		}

		if (
			webSearchSavedActive &&
			webSearchSavedActive !== webSearchActive &&
			!catalog[webSearchSavedActive]?.apiKey?.trim()
		) {
			clearSaveSuccess();
			setSaveError(t('errors.switchActiveBeforeClearingKey'));
			return;
		}

		setSaveError('');
		clearSaveSuccess();
		setWebSearchSaving(true);
		try {
			const catRes = await putConfig(WEB_SEARCH_CATALOG_KEY, serializeWebSearchCatalog(catalog));
			if (!catRes.ok) {
				clearSaveSuccess();
				setSaveError(catRes.message || tCommon('saveFailed'));
				return;
			}
			const actRes = await putConfig(WEB_SEARCH_ACTIVE_KEY, webSearchActive);
			if (!actRes.ok) {
				clearSaveSuccess();
				setSaveError(actRes.message || tCommon('saveFailed'));
				return;
			}
			setWebSearchSavedActive(webSearchActive);
			flashSaveSuccess(actRes.message ?? catRes.message);
		} catch {
			clearSaveSuccess();
			setSaveError(tCommon('requestFailed'));
		} finally {
			setWebSearchSaving(false);
		}
	};

	const handleSaveWebFetch = async () => {
		const catalog = buildFetchCatalog(webFetchDrafts);
		if (!catalog) {
			clearSaveSuccess();
			setSaveError(t('errors.invalidWebFetchCost'));
			return;
		}
		if (!webFetchDrafts[webFetchActive].apiKey.trim()) {
			clearSaveSuccess();
			setSaveError(t('errors.noKeyCannotActivate'));
			return;
		}
		if (
			webFetchSavedActive &&
			webFetchSavedActive !== webFetchActive &&
			!catalog[webFetchSavedActive]?.apiKey?.trim()
		) {
			clearSaveSuccess();
			setSaveError(t('errors.switchActiveBeforeClearingKey'));
			return;
		}

		setSaveError('');
		clearSaveSuccess();
		setWebFetchSaving(true);
		try {
			const catRes = await putConfig(WEB_FETCH_CATALOG_KEY, serializeWebFetchCatalog(catalog));
			if (!catRes.ok) {
				clearSaveSuccess();
				setSaveError(catRes.message || tCommon('saveFailed'));
				return;
			}
			const actRes = await putConfig(WEB_FETCH_ACTIVE_KEY, webFetchActive);
			if (!actRes.ok) {
				clearSaveSuccess();
				setSaveError(actRes.message || tCommon('saveFailed'));
				return;
			}
			setWebFetchSavedActive(webFetchActive);
			flashSaveSuccess(actRes.message ?? catRes.message);
		} catch {
			clearSaveSuccess();
			setSaveError(tCommon('requestFailed'));
		} finally {
			setWebFetchSaving(false);
		}
	};

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center">
				<div className="text-gray-600">{tCommon('loading')}</div>
			</div>
		);
	}

	return (
		<div className="p-8">
			<div className="mb-6 flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="text-3xl font-bold text-gray-900">{t('config.title')}</h1>
					<p className="mt-1 text-sm text-gray-500">{t('config.subtitle')}</p>
				</div>
				<Link
					href="/gateway/tools/invocations"
					className="text-sm font-medium text-blue-600 hover:underline"
				>
					{t('config.viewInvocations')}
				</Link>
			</div>

			{saveError && (
				<div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{saveError}</div>
			)}
			{saveSuccess && (
				<div className="mb-4 rounded-md bg-green-50 p-3 text-sm text-green-700" role="status">
					{saveSuccess}
				</div>
			)}

			<div className="flex flex-col gap-6">
				<ConfigCardShell
					id="web-search"
					title={t('webSearch.title')}
					description={t('webSearch.descriptionCatalog')}
				>
					<div className="flex flex-col gap-4">
						<div className="flex flex-wrap items-end gap-3">
							<div>
								<div className="mb-1 flex items-center gap-2">
									<label className="block text-xs font-medium text-gray-600">{t('webSearch.active')}</label>
									<button
										type="button"
										onClick={() => setProviderGuideOpen(true)}
										className="text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline"
									>
										{t('webSearch.providerGuideLink')}
									</button>
								</div>
								<select
									value={webSearchActive}
									onChange={(e) => setWebSearchActive(e.target.value as WebSearchProvider)}
									className="min-w-[16rem] rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm"
								>
									{webSearchProviderOptions.map((o) => (
										<option key={o.value} value={o.value} disabled={!webSearchActivatable.includes(o.value)}>
											{o.label}
											{!webSearchActivatable.includes(o.value) ? ` (${t('webSearch.noKey')})` : ''}
										</option>
									))}
								</select>
								{webSearchActivatable.length === 0 && (
									<p className="mt-1 text-xs text-amber-700">{t('webSearch.needKeyToActivate')}</p>
								)}
							</div>
						</div>

						<div className="overflow-x-auto rounded-md border border-gray-200">
							{/* table-fixed + 统一 col 宽，与 Web fetch 表对齐 */}
							<table className="w-full min-w-[40rem] table-fixed text-left text-sm">
								<colgroup>
									<col className="w-[14rem]" />
									<col className="w-[10.5rem]" />
									<col />
								</colgroup>
								<thead className="bg-gray-50 text-xs font-medium text-gray-600">
									<tr>
										<th className="px-3 py-2">{t('webSearch.catalogProvider')}</th>
										<th className="px-3 py-2">{t('webSearch.cost', { currency: billingCurrency })}</th>
										<th className="px-3 py-2">{t('webSearch.apiKey')}</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-gray-100">
									{WEB_SEARCH_PROVIDERS.map((p) => (
										<tr key={p} className={p === webSearchActive ? 'bg-blue-50/40' : undefined}>
											<td className="px-3 py-2 align-top">
												<div className="truncate font-medium text-gray-900" title={webSearchProviderOptions.find((o) => o.value === p)?.label ?? p}>
													{webSearchProviderOptions.find((o) => o.value === p)?.label ?? p}
												</div>
												<a
													href={WEB_SEARCH_PROVIDER_DOCS_URL[p]}
													target="_blank"
													rel="noopener noreferrer"
													className="text-xs font-medium text-blue-600 hover:underline"
												>
													{t('webSearch.providerDocs')}
												</a>
											</td>
											<td className="px-3 py-2 align-top">
												<input
													type="number"
													min={0}
													step="0.0001"
													value={webSearchDrafts[p].cost}
													onChange={(e) =>
														setWebSearchDrafts((prev) => ({
															...prev,
															[p]: { ...prev[p], cost: e.target.value },
														}))
													}
													className="w-full max-w-[7rem] rounded-md border border-gray-300 px-2 py-1.5 font-mono text-sm shadow-sm"
												/>
											</td>
											<td className="px-3 py-2 align-top">
												<div className="flex min-w-0 items-center gap-2">
													<input
														type={webSearchKeyVisible[p] === false ? 'password' : 'text'}
														value={webSearchDrafts[p].apiKey}
														onChange={(e) =>
															setWebSearchDrafts((prev) => ({
																...prev,
																[p]: { ...prev[p], apiKey: e.target.value },
															}))
														}
														placeholder={t('webSearch.apiKeyPlaceholder')}
														autoComplete="off"
														spellCheck={false}
														className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 font-mono text-sm text-gray-900 shadow-sm"
													/>
													<button
														type="button"
														onClick={() =>
															setWebSearchKeyVisible((v) => ({
																...v,
																[p]: v[p] === false,
															}))
														}
														className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50"
														aria-pressed={webSearchKeyVisible[p] !== false}
													>
														{webSearchKeyVisible[p] === false ? (
															<>
																<EyeIcon className="h-4 w-4" aria-hidden />
																{tCommon('show')}
															</>
														) : (
															<>
																<EyeSlashIcon className="h-4 w-4" aria-hidden />
																{tCommon('hide')}
															</>
														)}
													</button>
												</div>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>

						<button
							type="button"
							onClick={() => void handleSaveWebSearch()}
							disabled={webSearchSaving || webSearchActivatable.length === 0}
							className="self-start rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
						>
							{webSearchSaving ? tCommon('saving') : t('config.saveWebSearch')}
						</button>
					</div>
				</ConfigCardShell>

				<ConfigCardShell
					id="web-fetch"
					title={t('webFetch.title')}
					description={t('webFetch.descriptionCatalog')}
				>
					<div className="flex flex-col gap-4">
						<div>
							<label className="mb-1 block text-xs font-medium text-gray-600">{t('webFetch.active')}</label>
							<select
								value={webFetchActive}
								onChange={(e) => setWebFetchActive(e.target.value as WebFetchProvider)}
								className="min-w-[16rem] rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm"
							>
								{webFetchProviderOptions.map((o) => (
									<option key={o.value} value={o.value} disabled={!webFetchActivatable.includes(o.value)}>
										{o.label}
										{!webFetchActivatable.includes(o.value) ? ` (${t('webFetch.noKey')})` : ''}
									</option>
								))}
							</select>
							{webFetchActivatable.length === 0 && (
								<p className="mt-1 text-xs text-amber-700">{t('webFetch.needKeyToActivate')}</p>
							)}
						</div>

						<div className="overflow-x-auto rounded-md border border-gray-200">
							{/* 与 Web search 相同 col 宽，上下两表列对齐 */}
							<table className="w-full min-w-[40rem] table-fixed text-left text-sm">
								<colgroup>
									<col className="w-[14rem]" />
									<col className="w-[10.5rem]" />
									<col />
								</colgroup>
								<thead className="bg-gray-50 text-xs font-medium text-gray-600">
									<tr>
										<th className="px-3 py-2">{t('webFetch.catalogProvider')}</th>
										<th className="px-3 py-2">{t('webFetch.cost', { currency: billingCurrency })}</th>
										<th className="px-3 py-2">{t('webFetch.apiKey')}</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-gray-100">
									{WEB_FETCH_PROVIDERS.map((p) => (
										<tr key={p} className={p === webFetchActive ? 'bg-blue-50/40' : undefined}>
											<td className="px-3 py-2 align-top">
												<div className="truncate font-medium text-gray-900" title={webFetchProviderOptions.find((o) => o.value === p)?.label ?? p}>
													{webFetchProviderOptions.find((o) => o.value === p)?.label ?? p}
												</div>
												<a
													href={WEB_FETCH_PROVIDER_DOCS_URL[p]}
													target="_blank"
													rel="noopener noreferrer"
													className="text-xs font-medium text-blue-600 hover:underline"
												>
													{t('webFetch.providerDocs')}
												</a>
											</td>
											<td className="px-3 py-2 align-top">
												<input
													type="number"
													min={0}
													step="0.0001"
													value={webFetchDrafts[p].cost}
													onChange={(e) =>
														setWebFetchDrafts((prev) => ({
															...prev,
															[p]: { ...prev[p], cost: e.target.value },
														}))
													}
													className="w-full max-w-[7rem] rounded-md border border-gray-300 px-2 py-1.5 font-mono text-sm shadow-sm"
												/>
											</td>
											<td className="px-3 py-2 align-top">
												<div className="flex min-w-0 items-center gap-2">
													<input
														type={webFetchKeyVisible[p] === false ? 'password' : 'text'}
														value={webFetchDrafts[p].apiKey}
														onChange={(e) =>
															setWebFetchDrafts((prev) => ({
																...prev,
																[p]: { ...prev[p], apiKey: e.target.value },
															}))
														}
														placeholder={t('webFetch.apiKeyPlaceholder')}
														autoComplete="off"
														spellCheck={false}
														className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 font-mono text-sm text-gray-900 shadow-sm"
													/>
													<button
														type="button"
														onClick={() =>
															setWebFetchKeyVisible((v) => ({
																...v,
																[p]: v[p] === false,
															}))
														}
														className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50"
														aria-pressed={webFetchKeyVisible[p] !== false}
													>
														{webFetchKeyVisible[p] === false ? (
															<>
																<EyeIcon className="h-4 w-4" aria-hidden />
																{tCommon('show')}
															</>
														) : (
															<>
																<EyeSlashIcon className="h-4 w-4" aria-hidden />
																{tCommon('hide')}
															</>
														)}
													</button>
												</div>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>

						<button
							type="button"
							onClick={() => void handleSaveWebFetch()}
							disabled={webFetchSaving || webFetchActivatable.length === 0}
							className="self-start rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
						>
							{webFetchSaving ? tCommon('saving') : t('config.saveWebFetch')}
						</button>
					</div>
				</ConfigCardShell>
			</div>

			<WebSearchProviderGuideModal
				open={providerGuideOpen}
				activeProvider={webSearchActive}
				onClose={() => setProviderGuideOpen(false)}
			/>
		</div>
	);
}
