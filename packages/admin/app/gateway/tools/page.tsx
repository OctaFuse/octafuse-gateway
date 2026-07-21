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
	DEFAULT_WEB_DEEP_SEARCH_COST,
	DEFAULT_WEB_DEEP_SEARCH_PROVIDER,
	getWebDeepSearchProviderOptions,
	WEB_DEEP_SEARCH_ACTIVE_KEY,
	WEB_DEEP_SEARCH_CATALOG_KEY,
	WEB_DEEP_SEARCH_PROVIDER_DOCS_URL,
	WEB_DEEP_SEARCH_PROVIDERS,
	type WebDeepSearchProvider,
} from '@/lib/web-deep-search-options';
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
import {
	parseWebDeepSearchCatalogLenient,
	serializeWebDeepSearchCatalog,
	type WebDeepSearchCatalog,
} from '@octafuse/core/lib/web-deep-search-system-config';
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

function emptyDeepSearchDrafts(): Record<WebDeepSearchProvider, ProviderDraft> {
	const out = {} as Record<WebDeepSearchProvider, ProviderDraft>;
	for (const p of WEB_DEEP_SEARCH_PROVIDERS) {
		out[p] = { apiKey: '', cost: String(DEFAULT_WEB_DEEP_SEARCH_COST) };
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

function syncWebDeepSearchFromRows(
	rows: SystemConfigRow[]
): {
	active: WebDeepSearchProvider;
	drafts: Record<WebDeepSearchProvider, ProviderDraft>;
	savedActive: WebDeepSearchProvider | null;
} {
	const drafts = emptyDeepSearchDrafts();
	const catalogRaw = rows.find((r) => r.key === WEB_DEEP_SEARCH_CATALOG_KEY)?.value ?? null;
	const catalogPresent = catalogRaw != null && String(catalogRaw).trim().length > 0;
	if (catalogPresent) {
		const catalog = parseWebDeepSearchCatalogLenient(catalogRaw) ?? {};
		for (const p of WEB_DEEP_SEARCH_PROVIDERS) {
			const entry = catalog[p];
			if (entry) {
				drafts[p] = { apiKey: entry.apiKey, cost: String(entry.cost) };
			}
		}
		const activeRaw = rows.find((r) => r.key === WEB_DEEP_SEARCH_ACTIVE_KEY)?.value?.trim().toLowerCase() ?? '';
		const active = (WEB_DEEP_SEARCH_PROVIDERS as readonly string[]).includes(activeRaw)
			? (activeRaw as WebDeepSearchProvider)
			: DEFAULT_WEB_DEEP_SEARCH_PROVIDER;
		const savedActive = (WEB_DEEP_SEARCH_PROVIDERS as readonly string[]).includes(activeRaw)
			? (activeRaw as WebDeepSearchProvider)
			: null;
		return { active, drafts, savedActive };
	}
	return { active: DEFAULT_WEB_DEEP_SEARCH_PROVIDER, drafts, savedActive: null };
}

function buildDeepSearchCatalog(
	drafts: Record<WebDeepSearchProvider, ProviderDraft>
): WebDeepSearchCatalog | null {
	const catalog: WebDeepSearchCatalog = {};
	for (const p of WEB_DEEP_SEARCH_PROVIDERS) {
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

type ToolCardKey = 'webSearch' | 'webFetch' | 'webDeepSearch';
type CardFeedback = { kind: 'success' | 'error'; message: string };

function CardSaveFeedback({ feedback }: { feedback?: CardFeedback }) {
	if (!feedback) {
		return null;
	}
	return (
		<span
			className={
				feedback.kind === 'success'
					? 'text-sm text-green-700'
					: 'text-sm text-red-700'
			}
			role={feedback.kind === 'success' ? 'status' : undefined}
		>
			{feedback.message}
		</span>
	);
}

export default function GatewayToolsConfigPage() {
	const t = useTranslations('tools');
	const tCommon = useTranslations('common');
	const { currency: billingCurrency } = useBillingCurrency();
	const webSearchProviderOptions = getWebSearchProviderOptions((k) => t(k));
	const webFetchProviderOptions = getWebFetchProviderOptions((k) => t(k));
	const webDeepSearchProviderOptions = getWebDeepSearchProviderOptions((k) => t(k));

	const [isLoading, setIsLoading] = useState(true);
	/** 各卡片 Save 旁的反馈；放按钮右侧，避免顶部横幅撑开布局抖动 */
	const [cardFeedback, setCardFeedback] = useState<Partial<Record<ToolCardKey, CardFeedback>>>({});
	const successTimersRef = useRef<Partial<Record<ToolCardKey, ReturnType<typeof setTimeout>>>>({});

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

	const [webDeepSearchActive, setWebDeepSearchActive] = useState<WebDeepSearchProvider>(
		DEFAULT_WEB_DEEP_SEARCH_PROVIDER
	);
	const [webDeepSearchSavedActive, setWebDeepSearchSavedActive] = useState<WebDeepSearchProvider | null>(null);
	const [webDeepSearchDrafts, setWebDeepSearchDrafts] = useState(emptyDeepSearchDrafts);
	const [webDeepSearchKeyVisible, setWebDeepSearchKeyVisible] = useState<
		Partial<Record<WebDeepSearchProvider, boolean>>
	>({});
	const [webDeepSearchSaving, setWebDeepSearchSaving] = useState(false);

	const clearCardSuccessTimer = useCallback((card: ToolCardKey) => {
		const timer = successTimersRef.current[card];
		if (timer != null) {
			clearTimeout(timer);
			delete successTimersRef.current[card];
		}
	}, []);

	const setCardError = useCallback(
		(card: ToolCardKey, message: string) => {
			clearCardSuccessTimer(card);
			setCardFeedback((prev) => ({ ...prev, [card]: { kind: 'error', message } }));
		},
		[clearCardSuccessTimer]
	);

	const flashCardSuccess = useCallback(
		(card: ToolCardKey, message?: string) => {
			clearCardSuccessTimer(card);
			setCardFeedback((prev) => ({
				...prev,
				[card]: { kind: 'success', message: message ?? tCommon('configUpdated') },
			}));
			successTimersRef.current[card] = setTimeout(() => {
				setCardFeedback((prev) => {
					const next = { ...prev };
					if (next[card]?.kind === 'success') {
						delete next[card];
					}
					return next;
				});
				delete successTimersRef.current[card];
			}, 2500);
		},
		[clearCardSuccessTimer, tCommon]
	);

	const clearCardFeedback = useCallback(
		(card: ToolCardKey) => {
			clearCardSuccessTimer(card);
			setCardFeedback((prev) => {
				const next = { ...prev };
				delete next[card];
				return next;
			});
		},
		[clearCardSuccessTimer]
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
				const deep = syncWebDeepSearchFromRows(data.data);
				setWebDeepSearchActive(deep.active);
				setWebDeepSearchDrafts(deep.drafts);
				setWebDeepSearchSavedActive(deep.savedActive);
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
			for (const timer of Object.values(successTimersRef.current)) {
				if (timer != null) {
					clearTimeout(timer);
				}
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
	const webDeepSearchActivatable = useMemo(
		() => WEB_DEEP_SEARCH_PROVIDERS.filter((p) => webDeepSearchDrafts[p].apiKey.trim().length > 0),
		[webDeepSearchDrafts]
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

	useEffect(() => {
		if (webDeepSearchActivatable.length > 0 && !webDeepSearchActivatable.includes(webDeepSearchActive)) {
			setWebDeepSearchActive(webDeepSearchActivatable[0]!);
		}
	}, [webDeepSearchActivatable, webDeepSearchActive]);

	const handleSaveWebSearch = async () => {
		const catalog = buildSearchCatalog(webSearchDrafts);
		if (!catalog) {
			setCardError('webSearch', t('errors.invalidWebSearchCost'));
			return;
		}
		if (!webSearchDrafts[webSearchActive].apiKey.trim()) {
			setCardError('webSearch', t('errors.noKeyCannotActivate'));
			return;
		}

		if (
			webSearchSavedActive &&
			webSearchSavedActive !== webSearchActive &&
			!catalog[webSearchSavedActive]?.apiKey?.trim()
		) {
			setCardError('webSearch', t('errors.switchActiveBeforeClearingKey'));
			return;
		}

		clearCardFeedback('webSearch');
		setWebSearchSaving(true);
		try {
			const catRes = await putConfig(WEB_SEARCH_CATALOG_KEY, serializeWebSearchCatalog(catalog));
			if (!catRes.ok) {
				setCardError('webSearch', catRes.message || tCommon('saveFailed'));
				return;
			}
			const actRes = await putConfig(WEB_SEARCH_ACTIVE_KEY, webSearchActive);
			if (!actRes.ok) {
				setCardError('webSearch', actRes.message || tCommon('saveFailed'));
				return;
			}
			setWebSearchSavedActive(webSearchActive);
			flashCardSuccess('webSearch', actRes.message ?? catRes.message);
		} catch {
			setCardError('webSearch', tCommon('requestFailed'));
		} finally {
			setWebSearchSaving(false);
		}
	};

	const handleSaveWebFetch = async () => {
		const catalog = buildFetchCatalog(webFetchDrafts);
		if (!catalog) {
			setCardError('webFetch', t('errors.invalidWebFetchCost'));
			return;
		}
		if (!webFetchDrafts[webFetchActive].apiKey.trim()) {
			setCardError('webFetch', t('errors.noKeyCannotActivate'));
			return;
		}
		if (
			webFetchSavedActive &&
			webFetchSavedActive !== webFetchActive &&
			!catalog[webFetchSavedActive]?.apiKey?.trim()
		) {
			setCardError('webFetch', t('errors.switchActiveBeforeClearingKey'));
			return;
		}

		clearCardFeedback('webFetch');
		setWebFetchSaving(true);
		try {
			const catRes = await putConfig(WEB_FETCH_CATALOG_KEY, serializeWebFetchCatalog(catalog));
			if (!catRes.ok) {
				setCardError('webFetch', catRes.message || tCommon('saveFailed'));
				return;
			}
			const actRes = await putConfig(WEB_FETCH_ACTIVE_KEY, webFetchActive);
			if (!actRes.ok) {
				setCardError('webFetch', actRes.message || tCommon('saveFailed'));
				return;
			}
			setWebFetchSavedActive(webFetchActive);
			flashCardSuccess('webFetch', actRes.message ?? catRes.message);
		} catch {
			setCardError('webFetch', tCommon('requestFailed'));
		} finally {
			setWebFetchSaving(false);
		}
	};

	const handleSaveWebDeepSearch = async () => {
		const catalog = buildDeepSearchCatalog(webDeepSearchDrafts);
		if (!catalog) {
			setCardError('webDeepSearch', t('errors.invalidWebDeepSearchCost'));
			return;
		}
		if (!webDeepSearchDrafts[webDeepSearchActive].apiKey.trim()) {
			setCardError('webDeepSearch', t('errors.noKeyCannotActivate'));
			return;
		}
		if (
			webDeepSearchSavedActive &&
			webDeepSearchSavedActive !== webDeepSearchActive &&
			!catalog[webDeepSearchSavedActive]?.apiKey?.trim()
		) {
			setCardError('webDeepSearch', t('errors.switchActiveBeforeClearingKey'));
			return;
		}

		clearCardFeedback('webDeepSearch');
		setWebDeepSearchSaving(true);
		try {
			const catRes = await putConfig(WEB_DEEP_SEARCH_CATALOG_KEY, serializeWebDeepSearchCatalog(catalog));
			if (!catRes.ok) {
				setCardError('webDeepSearch', catRes.message || tCommon('saveFailed'));
				return;
			}
			const actRes = await putConfig(WEB_DEEP_SEARCH_ACTIVE_KEY, webDeepSearchActive);
			if (!actRes.ok) {
				setCardError('webDeepSearch', actRes.message || tCommon('saveFailed'));
				return;
			}
			setWebDeepSearchSavedActive(webDeepSearchActive);
			flashCardSuccess('webDeepSearch', actRes.message ?? catRes.message);
		} catch {
			setCardError('webDeepSearch', tCommon('requestFailed'));
		} finally {
			setWebDeepSearchSaving(false);
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

						<div className="flex flex-wrap items-center gap-3">
							<button
								type="button"
								onClick={() => void handleSaveWebSearch()}
								disabled={webSearchSaving || webSearchActivatable.length === 0}
								className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
							>
								{webSearchSaving ? tCommon('saving') : t('config.saveWebSearch')}
							</button>
							<CardSaveFeedback feedback={cardFeedback.webSearch} />
						</div>
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

						<div className="flex flex-wrap items-center gap-3">
							<button
								type="button"
								onClick={() => void handleSaveWebFetch()}
								disabled={webFetchSaving || webFetchActivatable.length === 0}
								className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
							>
								{webFetchSaving ? tCommon('saving') : t('config.saveWebFetch')}
							</button>
							<CardSaveFeedback feedback={cardFeedback.webFetch} />
						</div>
					</div>
				</ConfigCardShell>

				<ConfigCardShell
					id="web-deep-search"
					title={t('webDeepSearch.title')}
					description={t('webDeepSearch.descriptionCatalog')}
				>
					<div className="flex flex-col gap-4">
						<div>
							<label className="mb-1 block text-xs font-medium text-gray-600">
								{t('webDeepSearch.active')}
							</label>
							<select
								value={webDeepSearchActive}
								onChange={(e) => setWebDeepSearchActive(e.target.value as WebDeepSearchProvider)}
								className="min-w-[16rem] rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm"
							>
								{webDeepSearchProviderOptions.map((o) => (
									<option
										key={o.value}
										value={o.value}
										disabled={!webDeepSearchActivatable.includes(o.value)}
									>
										{o.label}
										{!webDeepSearchActivatable.includes(o.value)
											? ` (${t('webDeepSearch.noKey')})`
											: ''}
									</option>
								))}
							</select>
							{webDeepSearchActivatable.length === 0 && (
								<p className="mt-1 text-xs text-amber-700">{t('webDeepSearch.needKeyToActivate')}</p>
							)}
						</div>

						<div className="overflow-x-auto rounded-md border border-gray-200">
							<table className="w-full min-w-[40rem] table-fixed text-left text-sm">
								<colgroup>
									<col className="w-[14rem]" />
									<col className="w-[10.5rem]" />
									<col />
								</colgroup>
								<thead className="bg-gray-50 text-xs font-medium text-gray-600">
									<tr>
										<th className="px-3 py-2">{t('webDeepSearch.catalogProvider')}</th>
										<th className="px-3 py-2">
											{t('webDeepSearch.cost', { currency: billingCurrency })}
										</th>
										<th className="px-3 py-2">{t('webDeepSearch.apiKey')}</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-gray-100">
									{WEB_DEEP_SEARCH_PROVIDERS.map((p) => (
										<tr
											key={p}
											className={p === webDeepSearchActive ? 'bg-blue-50/40' : undefined}
										>
											<td className="px-3 py-2 align-top">
												<div
													className="truncate font-medium text-gray-900"
													title={
														webDeepSearchProviderOptions.find((o) => o.value === p)?.label ?? p
													}
												>
													{webDeepSearchProviderOptions.find((o) => o.value === p)?.label ?? p}
												</div>
												<a
													href={WEB_DEEP_SEARCH_PROVIDER_DOCS_URL[p]}
													target="_blank"
													rel="noopener noreferrer"
													className="text-xs font-medium text-blue-600 hover:underline"
												>
													{t('webDeepSearch.providerDocs')}
												</a>
											</td>
											<td className="px-3 py-2 align-top">
												<input
													type="number"
													min={0}
													step="0.0001"
													value={webDeepSearchDrafts[p].cost}
													onChange={(e) =>
														setWebDeepSearchDrafts((prev) => ({
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
														type={webDeepSearchKeyVisible[p] === false ? 'password' : 'text'}
														value={webDeepSearchDrafts[p].apiKey}
														onChange={(e) =>
															setWebDeepSearchDrafts((prev) => ({
																...prev,
																[p]: { ...prev[p], apiKey: e.target.value },
															}))
														}
														placeholder={t('webDeepSearch.apiKeyPlaceholder')}
														autoComplete="off"
														spellCheck={false}
														className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 font-mono text-sm text-gray-900 shadow-sm"
													/>
													<button
														type="button"
														onClick={() =>
															setWebDeepSearchKeyVisible((v) => ({
																...v,
																[p]: v[p] === false,
															}))
														}
														className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50"
														aria-pressed={webDeepSearchKeyVisible[p] !== false}
													>
														{webDeepSearchKeyVisible[p] === false ? (
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

						<div className="flex flex-wrap items-center gap-3">
							<button
								type="button"
								onClick={() => void handleSaveWebDeepSearch()}
								disabled={webDeepSearchSaving || webDeepSearchActivatable.length === 0}
								className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
							>
								{webDeepSearchSaving ? tCommon('saving') : t('config.saveWebDeepSearch')}
							</button>
							<CardSaveFeedback feedback={cardFeedback.webDeepSearch} />
						</div>
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
