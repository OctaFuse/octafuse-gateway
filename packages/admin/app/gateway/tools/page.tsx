'use client';

import form from '@/components/settings-form.module.css';
import { AdminPageTitle } from '@/components/admin-page-title';

/**
 * Tools 配置：产品工具（`/v1/tools/*`）的 per-provider catalog + active；写入 `system_config`。
 * UI：按工具展开上游引擎，弹窗编辑连接与计费；须显式保存。
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { EyeIcon, EyeSlashIcon, ArrowPathIcon, KeyIcon, CurrencyDollarIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
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
	AI_DETECTION_ACTIVE_KEY,
	AI_DETECTION_CATALOG_KEY,
	AI_DETECTION_PROVIDER_DOCS_URL,
	AI_DETECTION_PROVIDERS,
	DEFAULT_AI_DETECTION_BILLING_UNIT_CHARS,
	DEFAULT_AI_DETECTION_COST,
	DEFAULT_AI_DETECTION_PROVIDER,
	getAiDetectionCredentialFields,
	getAiDetectionProviderOptions,
	isAiDetectionImplementedProvider,
	type AiDetectionCredentialField,
	type AiDetectionProvider,
} from '@/lib/ai-detection-options';
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
import {
	parseAiDetectionCatalogLenient,
	serializeAiDetectionCatalog,
	AI_DETECTION_PROVIDER_REQUIRED_CREDENTIALS,
	type AiDetectionCatalog,
	type AiDetectionCatalogEntry,
} from '@octafuse/core/lib/ai-detection-system-config';
import { type ToolCatalogPricingFields } from '@octafuse/core/lib/tool-pricing';
import { restPricingDraftFromEntry, restPricingFieldsFromDraft, type RestToolPricingDraft } from './tool-pricing-draft';
import {
	cloneDrafts,
	draftsForProviderSave,
	isDraftDirty,
	resolveProviderCardActions,
	resolveProviderCardStatus,
	type PriceTripleDraft,
} from './components/provider-card-state';
import { RestToolPricingEditor } from './components/rest-tool-pricing-editor';
import { ToolProviderDrawer } from './components/tool-provider-drawer';
import { ToolProviderSaveActions } from './components/tool-provider-picker';
import { activateSavedToolProvider, providerActivationBlock } from './tool-provider-activation';
import { ToolProviderUsage } from './components/tool-provider-usage';
import { ToolProviderList } from './components/tool-provider-list';

type ProviderDraft = {
	apiKey: string;
} & RestToolPricingDraft;

type AiDetectionProviderDraft = {
	apiKey: string;
	secretId: string;
	secretKey: string;
	email: string;
	region: string;
	bizType: string;
	billingUnitChars: string;
} & RestToolPricingDraft;

function defaultPriceTriple(defaultCost: number): PriceTripleDraft {
	const s = String(defaultCost);
	return { metered: s, standard: s, charged: s };
}

function entryToDraftPrices(entry: ToolCatalogPricingFields): RestToolPricingDraft {
	return restPricingDraftFromEntry(entry);
}

function emptySearchDrafts(): Record<WebSearchProvider, ProviderDraft> {
	const out = {} as Record<WebSearchProvider, ProviderDraft>;
	for (const p of WEB_SEARCH_PROVIDERS) {
		out[p] = { apiKey: '', ...defaultPriceTriple(DEFAULT_WEB_SEARCH_COST) };
	}
	return out;
}

function emptyFetchDrafts(): Record<WebFetchProvider, ProviderDraft> {
	const out = {} as Record<WebFetchProvider, ProviderDraft>;
	for (const p of WEB_FETCH_PROVIDERS) {
		out[p] = { apiKey: '', ...defaultPriceTriple(DEFAULT_WEB_FETCH_COST) };
	}
	return out;
}

function emptyDeepSearchDrafts(): Record<WebDeepSearchProvider, ProviderDraft> {
	const out = {} as Record<WebDeepSearchProvider, ProviderDraft>;
	for (const p of WEB_DEEP_SEARCH_PROVIDERS) {
		out[p] = { apiKey: '', ...defaultPriceTriple(DEFAULT_WEB_DEEP_SEARCH_COST) };
	}
	return out;
}

function emptyAiDetectionDrafts(): Record<AiDetectionProvider, AiDetectionProviderDraft> {
	const out = {} as Record<AiDetectionProvider, AiDetectionProviderDraft>;
	for (const p of AI_DETECTION_PROVIDERS) {
		out[p] = {
			apiKey: '',
			secretId: '',
			secretKey: '',
			email: '',
			region: p === 'tencent_tms' ? 'ap-guangzhou' : '',
			bizType: '',
			...defaultPriceTriple(DEFAULT_AI_DETECTION_COST),
			billingUnitChars: String(DEFAULT_AI_DETECTION_BILLING_UNIT_CHARS),
		};
	}
	return out;
}

function draftToAiEntry(d: AiDetectionProviderDraft): AiDetectionCatalogEntry {
	const prices = restPricingFieldsFromDraft(d);
	if (!prices) throw new Error('Invalid tool pricing');
	const entry: AiDetectionCatalogEntry = { ...prices };
	const billing = Number(d.billingUnitChars.trim());
	if (Number.isFinite(billing) && billing >= 1) {
		entry.billingUnitChars = Math.floor(billing);
	}
	if (d.apiKey.trim()) entry.apiKey = d.apiKey.trim();
	if (d.secretId.trim()) entry.secretId = d.secretId.trim();
	if (d.secretKey.trim()) entry.secretKey = d.secretKey.trim();
	if (d.email.trim()) entry.email = d.email.trim();
	if (d.region.trim()) entry.region = d.region.trim();
	if (d.bizType.trim()) entry.bizType = d.bizType.trim();
	return entry;
}

function aiDraftHasRequiredCredentials(provider: AiDetectionProvider, d: AiDetectionProviderDraft): boolean {
	if (!isAiDetectionImplementedProvider(provider)) {
		return false;
	}
	return AI_DETECTION_PROVIDER_REQUIRED_CREDENTIALS[provider].every((field) => Boolean(d[field].trim()));
}

function syncWebSearchFromRows(rows: SystemConfigRow[]): {
	active: WebSearchProvider;
	drafts: Record<WebSearchProvider, ProviderDraft>;
	savedActive: WebSearchProvider | null;
} {
	const drafts = emptySearchDrafts();
	const catalogRaw = rows.find((r) => r.key === WEB_SEARCH_CATALOG_KEY)?.value ?? null;
	const catalogPresent = catalogRaw != null && String(catalogRaw).trim().length > 0;

	if (catalogPresent) {
		const catalog = parseWebSearchCatalogLenient(catalogRaw) ?? {};
		for (const p of WEB_SEARCH_PROVIDERS) {
			const entry = catalog[p];
			if (entry) {
				drafts[p] = { apiKey: entry.apiKey, ...entryToDraftPrices(entry) };
			}
		}
		const activeRaw =
			rows
				.find((r) => r.key === WEB_SEARCH_ACTIVE_KEY)
				?.value?.trim()
				.toLowerCase() ?? '';
		const active = (WEB_SEARCH_PROVIDERS as readonly string[]).includes(activeRaw)
			? (activeRaw as WebSearchProvider)
			: DEFAULT_WEB_SEARCH_PROVIDER;
		const savedActive = (WEB_SEARCH_PROVIDERS as readonly string[]).includes(activeRaw)
			? (activeRaw as WebSearchProvider)
			: null;
		return { active, drafts, savedActive };
	}

	const providerRaw =
		rows
			.find((r) => r.key === WEB_SEARCH_PROVIDER_KEY)
			?.value?.trim()
			.toLowerCase() ?? '';
	const provider = (WEB_SEARCH_PROVIDERS as readonly string[]).includes(providerRaw)
		? (providerRaw as WebSearchProvider)
		: DEFAULT_WEB_SEARCH_PROVIDER;
	const apiKey = rows.find((r) => r.key === WEB_SEARCH_API_KEY_KEY)?.value ?? '';
	const costRaw = rows.find((r) => r.key === WEB_SEARCH_COST_KEY)?.value?.trim() ?? '';
	const legacyCost = costRaw || String(DEFAULT_WEB_SEARCH_COST);
	drafts[provider] = {
		apiKey,
		metered: legacyCost,
		standard: legacyCost,
		charged: legacyCost,
	};
	return { active: provider, drafts, savedActive: null };
}

function syncWebFetchFromRows(rows: SystemConfigRow[]): {
	active: WebFetchProvider;
	drafts: Record<WebFetchProvider, ProviderDraft>;
	savedActive: WebFetchProvider | null;
} {
	const drafts = emptyFetchDrafts();
	const catalogRaw = rows.find((r) => r.key === WEB_FETCH_CATALOG_KEY)?.value ?? null;
	const catalogPresent = catalogRaw != null && String(catalogRaw).trim().length > 0;

	if (catalogPresent) {
		const catalog = parseWebFetchCatalogLenient(catalogRaw) ?? {};
		for (const p of WEB_FETCH_PROVIDERS) {
			const entry = catalog[p];
			if (entry) {
				drafts[p] = { apiKey: entry.apiKey, ...entryToDraftPrices(entry) };
			}
		}
		const activeRaw =
			rows
				.find((r) => r.key === WEB_FETCH_ACTIVE_KEY)
				?.value?.trim()
				.toLowerCase() ?? '';
		const active = (WEB_FETCH_PROVIDERS as readonly string[]).includes(activeRaw)
			? (activeRaw as WebFetchProvider)
			: DEFAULT_WEB_FETCH_PROVIDER;
		const savedActive = (WEB_FETCH_PROVIDERS as readonly string[]).includes(activeRaw)
			? (activeRaw as WebFetchProvider)
			: null;
		return { active, drafts, savedActive };
	}

	const providerRaw =
		rows
			.find((r) => r.key === WEB_FETCH_PROVIDER_KEY)
			?.value?.trim()
			.toLowerCase() ?? '';
	const provider = (WEB_FETCH_PROVIDERS as readonly string[]).includes(providerRaw)
		? (providerRaw as WebFetchProvider)
		: DEFAULT_WEB_FETCH_PROVIDER;
	const apiKey = rows.find((r) => r.key === WEB_FETCH_API_KEY_KEY)?.value ?? '';
	const costRaw = rows.find((r) => r.key === WEB_FETCH_COST_KEY)?.value?.trim() ?? '';
	const legacyCost = costRaw || String(DEFAULT_WEB_FETCH_COST);
	drafts[provider] = {
		apiKey,
		metered: legacyCost,
		standard: legacyCost,
		charged: legacyCost,
	};
	return { active: provider, drafts, savedActive: null };
}

function buildSearchCatalog(drafts: Record<WebSearchProvider, ProviderDraft>): WebSearchCatalog | null {
	const catalog: WebSearchCatalog = {};
	for (const p of WEB_SEARCH_PROVIDERS) {
		const d = drafts[p];
		if (!restPricingFieldsFromDraft(d)) {
			return null;
		}
		catalog[p] = {
			apiKey: d.apiKey.trim(),
			...restPricingFieldsFromDraft(d)!,
		};
	}
	return catalog;
}

function buildFetchCatalog(drafts: Record<WebFetchProvider, ProviderDraft>): WebFetchCatalog | null {
	const catalog: WebFetchCatalog = {};
	for (const p of WEB_FETCH_PROVIDERS) {
		const d = drafts[p];
		if (!restPricingFieldsFromDraft(d)) {
			return null;
		}
		catalog[p] = {
			apiKey: d.apiKey.trim(),
			...restPricingFieldsFromDraft(d)!,
		};
	}
	return catalog;
}

function syncWebDeepSearchFromRows(rows: SystemConfigRow[]): {
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
				drafts[p] = { apiKey: entry.apiKey, ...entryToDraftPrices(entry) };
			}
		}
		const activeRaw =
			rows
				.find((r) => r.key === WEB_DEEP_SEARCH_ACTIVE_KEY)
				?.value?.trim()
				.toLowerCase() ?? '';
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

function buildDeepSearchCatalog(drafts: Record<WebDeepSearchProvider, ProviderDraft>): WebDeepSearchCatalog | null {
	const catalog: WebDeepSearchCatalog = {};
	for (const p of WEB_DEEP_SEARCH_PROVIDERS) {
		const d = drafts[p];
		if (!restPricingFieldsFromDraft(d)) {
			return null;
		}
		catalog[p] = {
			apiKey: d.apiKey.trim(),
			...restPricingFieldsFromDraft(d)!,
		};
	}
	return catalog;
}

function syncAiDetectionFromRows(rows: SystemConfigRow[]): {
	active: AiDetectionProvider;
	drafts: Record<AiDetectionProvider, AiDetectionProviderDraft>;
	savedActive: AiDetectionProvider | null;
} {
	const drafts = emptyAiDetectionDrafts();
	const catalogRaw = rows.find((r) => r.key === AI_DETECTION_CATALOG_KEY)?.value ?? null;
	const catalogPresent = catalogRaw != null && String(catalogRaw).trim().length > 0;
	if (catalogPresent) {
		const catalog = parseAiDetectionCatalogLenient(catalogRaw) ?? {};
		for (const p of AI_DETECTION_PROVIDERS) {
			const entry = catalog[p];
			if (entry) {
				drafts[p] = {
					apiKey: entry.apiKey ?? '',
					secretId: entry.secretId ?? '',
					secretKey: entry.secretKey ?? '',
					email: entry.email ?? '',
					region: entry.region ?? drafts[p].region,
					bizType: entry.bizType ?? '',
					...entryToDraftPrices(entry),
					billingUnitChars: String(entry.billingUnitChars ?? DEFAULT_AI_DETECTION_BILLING_UNIT_CHARS),
				};
			}
		}
		const activeRaw =
			rows
				.find((r) => r.key === AI_DETECTION_ACTIVE_KEY)
				?.value?.trim()
				.toLowerCase() ?? '';
		const active = (AI_DETECTION_PROVIDERS as readonly string[]).includes(activeRaw)
			? (activeRaw as AiDetectionProvider)
			: DEFAULT_AI_DETECTION_PROVIDER;
		const savedActive = (AI_DETECTION_PROVIDERS as readonly string[]).includes(activeRaw)
			? (activeRaw as AiDetectionProvider)
			: null;
		return { active, drafts, savedActive };
	}
	return { active: DEFAULT_AI_DETECTION_PROVIDER, drafts, savedActive: null };
}

function buildAiDetectionCatalog(
	drafts: Record<AiDetectionProvider, AiDetectionProviderDraft>
): AiDetectionCatalog | null {
	const catalog: AiDetectionCatalog = {};
	for (const p of AI_DETECTION_PROVIDERS) {
		const d = drafts[p];
		if (!restPricingFieldsFromDraft(d)) {
			return null;
		}
		const unitChars = Number(d.billingUnitChars.trim());
		if (!d.billingUnitChars.trim() || !Number.isFinite(unitChars) || unitChars < 1 || !Number.isInteger(unitChars)) {
			return null;
		}
		catalog[p] = draftToAiEntry(d);
	}
	return catalog;
}

async function putConfig(
	key: string,
	value: string
): Promise<{ ok: true; message?: string } | { ok: false; message: string }> {
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

type ToolCardKey = 'webSearch' | 'webFetch' | 'webDeepSearch' | 'aiDetection';
type DrawerTarget = { tool: ToolCardKey; providerId: string };
type CardFeedback = { kind: 'success' | 'error'; message: string };

const AI_DETECTION_FIELD_I18N: Record<AiDetectionCredentialField, `aiDetection.fields.${AiDetectionCredentialField}`> =
	{
		apiKey: 'aiDetection.fields.apiKey',
		secretId: 'aiDetection.fields.secretId',
		secretKey: 'aiDetection.fields.secretKey',
		email: 'aiDetection.fields.email',
	};

function CardSaveFeedback({ feedback }: { feedback?: CardFeedback }) {
	if (!feedback) {
		return null;
	}
	return (
		<span
			className={feedback.kind === 'success' ? 'text-sm text-green-700' : 'text-sm text-red-700'}
			role={feedback.kind === 'success' ? 'status' : 'alert'}
		>
			{feedback.message}
		</span>
	);
}

function ApiKeyField({
	id,
	label,
	value,
	onChange,
	placeholder,
}: {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
}) {
	const t = useTranslations('tools.config');
	const [visible, setVisible] = useState(false);
	const toggleLabel = t(visible ? 'hideSecrets' : 'showSecrets');
	return (
		<div className="relative min-w-0">
			<input
				id={id}
				type={visible ? 'text' : 'password'}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				placeholder={placeholder}
				autoComplete="off"
				spellCheck={false}
				className="h-10 w-full min-w-0 rounded-lg border border-gray-200 bg-white pl-3 pr-12 font-mono text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-100"
			/>
			<button
				type="button"
				onClick={() => setVisible((current) => !current)}
				aria-label={`${toggleLabel} (${label})`}
				title={toggleLabel}
				aria-pressed={visible}
				aria-controls={id}
				className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 disabled:opacity-40"
			>
				{visible ? (
					<EyeSlashIcon className="h-4 w-4" aria-hidden="true" />
				) : (
					<EyeIcon className="h-4 w-4" aria-hidden="true" />
				)}
			</button>
		</div>
	);
}

export default function GatewayToolsConfigPage() {
	const t = useTranslations('tools');
	const tPricing = useTranslations('toolPricing');
	const tCommon = useTranslations('common');
	const { currency: billingCurrency } = useBillingCurrency();
	const webSearchProviderOptions = getWebSearchProviderOptions((k) => t(k));
	const webFetchProviderOptions = getWebFetchProviderOptions((k) => t(k));
	const webDeepSearchProviderOptions = getWebDeepSearchProviderOptions((k) => t(k));
	const aiDetectionProviderOptions = getAiDetectionProviderOptions((k) => t(k));

	const [isLoading, setIsLoading] = useState(true);
	const [loadFailed, setLoadFailed] = useState(false);
	const [draftResetVersion, setDraftResetVersion] = useState(0);
	const [cardFeedback, setCardFeedback] = useState<Partial<Record<ToolCardKey, CardFeedback>>>({});
	const successTimersRef = useRef<Partial<Record<ToolCardKey, ReturnType<typeof setTimeout>>>>({});

	const [webSearchSelected, setWebSearchSelected] = useState<WebSearchProvider>(DEFAULT_WEB_SEARCH_PROVIDER);
	const [webSearchSavedActive, setWebSearchSavedActive] = useState<WebSearchProvider | null>(null);
	const [webSearchDrafts, setWebSearchDrafts] = useState(emptySearchDrafts);
	const [webSearchSavedDrafts, setWebSearchSavedDrafts] = useState(emptySearchDrafts);
	const [webSearchSaving, setWebSearchSaving] = useState(false);

	const [webFetchSelected, setWebFetchSelected] = useState<WebFetchProvider>(DEFAULT_WEB_FETCH_PROVIDER);
	const [webFetchSavedActive, setWebFetchSavedActive] = useState<WebFetchProvider | null>(null);
	const [webFetchDrafts, setWebFetchDrafts] = useState(emptyFetchDrafts);
	const [webFetchSavedDrafts, setWebFetchSavedDrafts] = useState(emptyFetchDrafts);
	const [webFetchSaving, setWebFetchSaving] = useState(false);

	const [webDeepSearchSelected, setWebDeepSearchSelected] = useState<WebDeepSearchProvider>(
		DEFAULT_WEB_DEEP_SEARCH_PROVIDER
	);
	const [webDeepSearchSavedActive, setWebDeepSearchSavedActive] = useState<WebDeepSearchProvider | null>(null);
	const [webDeepSearchDrafts, setWebDeepSearchDrafts] = useState(emptyDeepSearchDrafts);
	const [webDeepSearchSavedDrafts, setWebDeepSearchSavedDrafts] = useState(emptyDeepSearchDrafts);
	const [webDeepSearchSaving, setWebDeepSearchSaving] = useState(false);

	const [aiDetectionSelected, setAiDetectionSelected] = useState<AiDetectionProvider>(DEFAULT_AI_DETECTION_PROVIDER);
	const [aiDetectionSavedActive, setAiDetectionSavedActive] = useState<AiDetectionProvider | null>(null);
	const [aiDetectionDrafts, setAiDetectionDrafts] = useState(emptyAiDetectionDrafts);
	const [aiDetectionSavedDrafts, setAiDetectionSavedDrafts] = useState(emptyAiDetectionDrafts);
	const [aiDetectionSaving, setAiDetectionSaving] = useState(false);

	const serviceSearchRef = useRef<HTMLInputElement>(null);
	const activationLock = useRef(false);
	const [activating, setActivating] = useState<{ tool: ToolCardKey; providerId: string } | null>(null);
	const [savedCatalogs, setSavedCatalogs] = useState<Record<ToolCardKey, boolean>>({
		webSearch: false,
		webFetch: false,
		webDeepSearch: false,
		aiDetection: false,
	});
	/** 服务详情弹窗：点击服务行打开；null 表示关闭 */
	const [drawer, setDrawer] = useState<DrawerTarget | null>(null);

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
			setLoadFailed(false);
			const response = await fetch('/api/admin/config');
			const data = await readApiJson<SystemConfigRow[]>(response);
			if (!data.success || !Array.isArray(data.data)) throw new Error('Invalid config response');
			if (data.success && Array.isArray(data.data)) {
				setSavedCatalogs({
					webSearch: data.data.some((row) => row.key === WEB_SEARCH_CATALOG_KEY && Boolean(row.value?.trim())),
					webFetch: data.data.some((row) => row.key === WEB_FETCH_CATALOG_KEY && Boolean(row.value?.trim())),
					webDeepSearch: data.data.some((row) => row.key === WEB_DEEP_SEARCH_CATALOG_KEY && Boolean(row.value?.trim())),
					aiDetection: data.data.some((row) => row.key === AI_DETECTION_CATALOG_KEY && Boolean(row.value?.trim())),
				});
				const search = syncWebSearchFromRows(data.data);
				setWebSearchSelected(search.active);
				setWebSearchDrafts(search.drafts);
				setWebSearchSavedDrafts(cloneDrafts(search.drafts));
				setWebSearchSavedActive(search.savedActive);
				const fetch = syncWebFetchFromRows(data.data);
				setWebFetchSelected(fetch.active);
				setWebFetchDrafts(fetch.drafts);
				setWebFetchSavedDrafts(cloneDrafts(fetch.drafts));
				setWebFetchSavedActive(fetch.savedActive);
				const deep = syncWebDeepSearchFromRows(data.data);
				setWebDeepSearchSelected(deep.active);
				setWebDeepSearchDrafts(deep.drafts);
				setWebDeepSearchSavedDrafts(cloneDrafts(deep.drafts));
				setWebDeepSearchSavedActive(deep.savedActive);
				const ai = syncAiDetectionFromRows(data.data);
				setAiDetectionSelected(ai.active);
				setAiDetectionDrafts(ai.drafts);
				setAiDetectionSavedDrafts(cloneDrafts(ai.drafts));
				setAiDetectionSavedActive(ai.savedActive);
			}
		} catch (error) {
			console.error('Fetch tools config error:', error);
			setLoadFailed(true);
		} finally {
			setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		void fetchConfig();
	}, [fetchConfig]);

	useEffect(() => {
		const timers = successTimersRef.current;
		return () => {
			for (const timer of Object.values(timers)) {
				if (timer != null) {
					clearTimeout(timer);
				}
			}
		};
	}, []);

	const saveWebSearch = async () => {
		if (activationLock.current) return;
		const saved = draftsForProviderSave(webSearchSavedDrafts, webSearchDrafts, webSearchSelected);
		const catalog = buildSearchCatalog(saved);
		if (!catalog) {
			setCardError('webSearch', t('errors.invalidWebSearchCost'));
			return;
		}
		if (webSearchSavedActive && !catalog[webSearchSavedActive]?.apiKey?.trim()) {
			setCardError('webSearch', t('errors.switchActiveBeforeClearingKey'));
			return;
		}
		clearCardFeedback('webSearch');
		setWebSearchSaving(true);
		try {
			const result = await putConfig(WEB_SEARCH_CATALOG_KEY, serializeWebSearchCatalog(catalog));
			if (!result.ok) {
				setCardError('webSearch', result.message || tCommon('saveFailed'));
				return;
			}
			setWebSearchSavedDrafts(saved);
			setSavedCatalogs((previous) => ({ ...previous, webSearch: true }));
			flashCardSuccess('webSearch', result.message);
		} catch {
			setCardError('webSearch', tCommon('requestFailed'));
		} finally {
			setWebSearchSaving(false);
		}
	};

	const saveWebFetch = async () => {
		if (activationLock.current) return;
		const saved = draftsForProviderSave(webFetchSavedDrafts, webFetchDrafts, webFetchSelected);
		const catalog = buildFetchCatalog(saved);
		if (!catalog) {
			setCardError('webFetch', t('errors.invalidWebFetchCost'));
			return;
		}
		if (webFetchSavedActive && !catalog[webFetchSavedActive]?.apiKey?.trim()) {
			setCardError('webFetch', t('errors.switchActiveBeforeClearingKey'));
			return;
		}
		clearCardFeedback('webFetch');
		setWebFetchSaving(true);
		try {
			const result = await putConfig(WEB_FETCH_CATALOG_KEY, serializeWebFetchCatalog(catalog));
			if (!result.ok) {
				setCardError('webFetch', result.message || tCommon('saveFailed'));
				return;
			}
			setWebFetchSavedDrafts(saved);
			setSavedCatalogs((previous) => ({ ...previous, webFetch: true }));
			flashCardSuccess('webFetch', result.message);
		} catch {
			setCardError('webFetch', tCommon('requestFailed'));
		} finally {
			setWebFetchSaving(false);
		}
	};

	const saveWebDeepSearch = async () => {
		if (activationLock.current) return;
		const saved = draftsForProviderSave(webDeepSearchSavedDrafts, webDeepSearchDrafts, webDeepSearchSelected);
		const catalog = buildDeepSearchCatalog(saved);
		if (!catalog) {
			setCardError('webDeepSearch', t('errors.invalidWebDeepSearchCost'));
			return;
		}
		if (webDeepSearchSavedActive && !catalog[webDeepSearchSavedActive]?.apiKey?.trim()) {
			setCardError('webDeepSearch', t('errors.switchActiveBeforeClearingKey'));
			return;
		}
		clearCardFeedback('webDeepSearch');
		setWebDeepSearchSaving(true);
		try {
			const result = await putConfig(WEB_DEEP_SEARCH_CATALOG_KEY, serializeWebDeepSearchCatalog(catalog));
			if (!result.ok) {
				setCardError('webDeepSearch', result.message || tCommon('saveFailed'));
				return;
			}
			setWebDeepSearchSavedDrafts(saved);
			setSavedCatalogs((previous) => ({ ...previous, webDeepSearch: true }));
			flashCardSuccess('webDeepSearch', result.message);
		} catch {
			setCardError('webDeepSearch', tCommon('requestFailed'));
		} finally {
			setWebDeepSearchSaving(false);
		}
	};

	const saveAiDetection = async () => {
		if (activationLock.current) return;
		const saved = draftsForProviderSave(aiDetectionSavedDrafts, aiDetectionDrafts, aiDetectionSelected);
		const catalog = buildAiDetectionCatalog(saved);
		if (!catalog) {
			setCardError('aiDetection', t('errors.invalidAiDetectionCost'));
			return;
		}
		if (
			aiDetectionSavedActive &&
			!aiDraftHasRequiredCredentials(aiDetectionSavedActive, saved[aiDetectionSavedActive])
		) {
			setCardError('aiDetection', t('errors.switchActiveBeforeClearingKey'));
			return;
		}
		clearCardFeedback('aiDetection');
		setAiDetectionSaving(true);
		try {
			const result = await putConfig(AI_DETECTION_CATALOG_KEY, serializeAiDetectionCatalog(catalog));
			if (!result.ok) {
				setCardError('aiDetection', result.message || tCommon('saveFailed'));
				return;
			}
			setAiDetectionSavedDrafts(saved);
			setSavedCatalogs((previous) => ({ ...previous, aiDetection: true }));
			flashCardSuccess('aiDetection', result.message);
		} catch {
			setCardError('aiDetection', tCommon('requestFailed'));
		} finally {
			setAiDetectionSaving(false);
		}
	};

	const webSearchDrawerSelected = drawer?.tool === 'webSearch' ? drawer.providerId : '';
	const webFetchDrawerSelected = drawer?.tool === 'webFetch' ? drawer.providerId : '';
	const webDeepSearchDrawerSelected = drawer?.tool === 'webDeepSearch' ? drawer.providerId : '';
	const aiDetectionDrawerSelected = drawer?.tool === 'aiDetection' ? drawer.providerId : '';

	const webSearchPickerItems = useMemo(
		() =>
			WEB_SEARCH_PROVIDERS.map((p) => ({
				id: p,
				label: webSearchProviderOptions.find((o) => o.value === p)?.label ?? p,
				prices: webSearchDrafts[p],
				savedPrices: webSearchSavedDrafts[p],
				savedConfigured: Boolean(webSearchSavedDrafts[p].apiKey.trim()),
				status: resolveProviderCardStatus({
					providerId: p,
					selectedId: webSearchDrawerSelected,
					savedActiveId: webSearchSavedActive,
					isConfigured: webSearchDrafts[p].apiKey.trim().length > 0,
					prices: webSearchDrafts[p],
					draft: webSearchDrafts[p],
					savedDraft: webSearchSavedDrafts[p],
				}),
			})),
		[webSearchDrafts, webSearchDrawerSelected, webSearchProviderOptions, webSearchSavedActive, webSearchSavedDrafts]
	);

	const webFetchPickerItems = useMemo(
		() =>
			WEB_FETCH_PROVIDERS.map((p) => ({
				id: p,
				label: webFetchProviderOptions.find((o) => o.value === p)?.label ?? p,
				prices: webFetchDrafts[p],
				savedPrices: webFetchSavedDrafts[p],
				savedConfigured: Boolean(webFetchSavedDrafts[p].apiKey.trim()),
				status: resolveProviderCardStatus({
					providerId: p,
					selectedId: webFetchDrawerSelected,
					savedActiveId: webFetchSavedActive,
					isConfigured: webFetchDrafts[p].apiKey.trim().length > 0,
					prices: webFetchDrafts[p],
					draft: webFetchDrafts[p],
					savedDraft: webFetchSavedDrafts[p],
				}),
			})),
		[webFetchDrafts, webFetchDrawerSelected, webFetchProviderOptions, webFetchSavedActive, webFetchSavedDrafts]
	);

	const webDeepSearchPickerItems = useMemo(
		() =>
			WEB_DEEP_SEARCH_PROVIDERS.map((p) => ({
				id: p,
				label: webDeepSearchProviderOptions.find((o) => o.value === p)?.label ?? p,
				prices: webDeepSearchDrafts[p],
				savedPrices: webDeepSearchSavedDrafts[p],
				savedConfigured: Boolean(webDeepSearchSavedDrafts[p].apiKey.trim()),
				status: resolveProviderCardStatus({
					providerId: p,
					selectedId: webDeepSearchDrawerSelected,
					savedActiveId: webDeepSearchSavedActive,
					isConfigured: webDeepSearchDrafts[p].apiKey.trim().length > 0,
					prices: webDeepSearchDrafts[p],
					draft: webDeepSearchDrafts[p],
					savedDraft: webDeepSearchSavedDrafts[p],
				}),
			})),
		[
			webDeepSearchDrafts,
			webDeepSearchDrawerSelected,
			webDeepSearchProviderOptions,
			webDeepSearchSavedActive,
			webDeepSearchSavedDrafts,
		]
	);

	const aiDetectionPickerItems = useMemo(
		() =>
			AI_DETECTION_PROVIDERS.map((p) => ({
				id: p,
				label: aiDetectionProviderOptions.find((o) => o.value === p)?.label ?? p,
				prices: aiDetectionDrafts[p],
				savedPrices: aiDetectionSavedDrafts[p],
				savedConfigured: aiDraftHasRequiredCredentials(p, aiDetectionSavedDrafts[p]),
				status: resolveProviderCardStatus({
					providerId: p,
					selectedId: aiDetectionDrawerSelected,
					savedActiveId: aiDetectionSavedActive,
					isConfigured: aiDraftHasRequiredCredentials(p, aiDetectionDrafts[p]),
					isImplemented: isAiDetectionImplementedProvider(p),
					prices: aiDetectionDrafts[p],
					draft: aiDetectionDrafts[p],
					savedDraft: aiDetectionSavedDrafts[p],
				}),
			})),
		[
			aiDetectionDrafts,
			aiDetectionDrawerSelected,
			aiDetectionProviderOptions,
			aiDetectionSavedActive,
			aiDetectionSavedDrafts,
		]
	);

	const openWebSearchDrawer = (id: string) => {
		clearCardFeedback('webSearch');
		const p = id as WebSearchProvider;
		setWebSearchSelected(p);
		setDrawer({ tool: 'webSearch', providerId: p });
	};
	const openWebFetchDrawer = (id: string) => {
		clearCardFeedback('webFetch');
		const p = id as WebFetchProvider;
		setWebFetchSelected(p);
		setDrawer({ tool: 'webFetch', providerId: p });
	};
	const openWebDeepSearchDrawer = (id: string) => {
		clearCardFeedback('webDeepSearch');
		const p = id as WebDeepSearchProvider;
		setWebDeepSearchSelected(p);
		setDrawer({ tool: 'webDeepSearch', providerId: p });
	};
	const openAiDetectionDrawer = (id: string) => {
		clearCardFeedback('aiDetection');
		const p = id as AiDetectionProvider;
		setAiDetectionSelected(p);
		setDrawer({ tool: 'aiDetection', providerId: p });
	};
	const closeDrawer = useCallback(() => {
		setDrawer(null);
	}, []);

	const webSearchActions = resolveProviderCardActions({
		catalogPricesValid:
			buildSearchCatalog(draftsForProviderSave(webSearchSavedDrafts, webSearchDrafts, webSearchSelected)) != null,
		selectedIsActive: webSearchSavedActive === webSearchSelected,
		selectedConfigured: webSearchDrafts[webSearchSelected].apiKey.trim().length > 0,
	});
	const webFetchActions = resolveProviderCardActions({
		catalogPricesValid:
			buildFetchCatalog(draftsForProviderSave(webFetchSavedDrafts, webFetchDrafts, webFetchSelected)) != null,
		selectedIsActive: webFetchSavedActive === webFetchSelected,
		selectedConfigured: webFetchDrafts[webFetchSelected].apiKey.trim().length > 0,
	});
	const webDeepSearchActions = resolveProviderCardActions({
		catalogPricesValid:
			buildDeepSearchCatalog(
				draftsForProviderSave(webDeepSearchSavedDrafts, webDeepSearchDrafts, webDeepSearchSelected)
			) != null,
		selectedIsActive: webDeepSearchSavedActive === webDeepSearchSelected,
		selectedConfigured: webDeepSearchDrafts[webDeepSearchSelected].apiKey.trim().length > 0,
	});
	const aiDetectionActions = resolveProviderCardActions({
		catalogPricesValid:
			buildAiDetectionCatalog(draftsForProviderSave(aiDetectionSavedDrafts, aiDetectionDrafts, aiDetectionSelected)) !=
			null,
		selectedIsActive: aiDetectionSavedActive === aiDetectionSelected,
		selectedConfigured: aiDraftHasRequiredCredentials(aiDetectionSelected, aiDetectionDrafts[aiDetectionSelected]),
		selectedImplemented: isAiDetectionImplementedProvider(aiDetectionSelected),
	});

	const anySaving = webSearchSaving || webFetchSaving || webDeepSearchSaving || aiDetectionSaving;
	async function activateProvider(tool: ToolCardKey, providerId: string) {
		if (activationLock.current || anySaving) return;
		const items =
			tool === 'webSearch'
				? webSearchPickerItems
				: tool === 'webFetch'
				? webFetchPickerItems
				: tool === 'webDeepSearch'
				? webDeepSearchPickerItems
				: aiDetectionPickerItems;
		const item = items.find((entry) => entry.id === providerId);
		if (!item || item.status.isActive || providerActivationBlock(item)) return;
		activationLock.current = true;
		setActivating({ tool, providerId });
		clearCardFeedback(tool);
		try {
			const activeKey = {
				webSearch: WEB_SEARCH_ACTIVE_KEY,
				webFetch: WEB_FETCH_ACTIVE_KEY,
				webDeepSearch: WEB_DEEP_SEARCH_ACTIVE_KEY,
				aiDetection: AI_DETECTION_ACTIVE_KEY,
			}[tool];
			const catalogKey = {
				webSearch: WEB_SEARCH_CATALOG_KEY,
				webFetch: WEB_FETCH_CATALOG_KEY,
				webDeepSearch: WEB_DEEP_SEARCH_CATALOG_KEY,
				aiDetection: AI_DETECTION_CATALOG_KEY,
			}[tool];
			let savedCatalog: string | null = null;
			if (!savedCatalogs[tool]) {
				if (tool === 'webSearch') {
					const catalog = buildSearchCatalog(webSearchSavedDrafts);
					if (catalog) savedCatalog = serializeWebSearchCatalog(catalog);
				} else if (tool === 'webFetch') {
					const catalog = buildFetchCatalog(webFetchSavedDrafts);
					if (catalog) savedCatalog = serializeWebFetchCatalog(catalog);
				} else if (tool === 'webDeepSearch') {
					const catalog = buildDeepSearchCatalog(webDeepSearchSavedDrafts);
					if (catalog) savedCatalog = serializeWebDeepSearchCatalog(catalog);
				} else {
					const catalog = buildAiDetectionCatalog(aiDetectionSavedDrafts);
					if (catalog) savedCatalog = serializeAiDetectionCatalog(catalog);
				}
			}
			const result = await activateSavedToolProvider({
				providerId,
				activeKey,
				catalogKey,
				hasSavedCatalog: savedCatalogs[tool],
				savedCatalog,
				write: putConfig,
			});
			if (result.catalogInitialized) setSavedCatalogs((previous) => ({ ...previous, [tool]: true }));
			if (!result.ok) {
				setCardError(tool, result.message || tCommon('requestFailed'));
				return;
			}
			if (tool === 'webSearch') setWebSearchSavedActive(providerId as WebSearchProvider);
			else if (tool === 'webFetch') setWebFetchSavedActive(providerId as WebFetchProvider);
			else if (tool === 'webDeepSearch') setWebDeepSearchSavedActive(providerId as WebDeepSearchProvider);
			else setAiDetectionSavedActive(providerId as AiDetectionProvider);
			flashCardSuccess(tool, t('serviceList.enabledFeedback', { name: item.label }));
		} finally {
			activationLock.current = false;
			setActivating(null);
		}
	}

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center">
				<div className="text-gray-600">{tCommon('loading')}</div>
			</div>
		);
	}

	if (loadFailed) {
		return (
			<div className="admin-content-workspace content-tone-tools p-4 sm:p-6 lg:p-8">
				<AdminPageTitle>{t('config.title')}</AdminPageTitle>
				<div role="alert" className="admin-content-panel mt-6 rounded-xl border border-gray-200 bg-white p-6">
					<p className="text-sm text-gray-600">{t('ui.loadFailed')}</p>
					<button
						type="button"
						onClick={() => void fetchConfig()}
						className="mt-4 inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 hover:bg-gray-50"
					>
						<ArrowPathIcon className="h-4 w-4" aria-hidden="true" />
						{t('ui.retry')}
					</button>
				</div>
			</div>
		);
	}

	const webSearchSelectedLabel =
		webSearchProviderOptions.find((o) => o.value === webSearchSelected)?.label ?? webSearchSelected;
	const webFetchSelectedLabel =
		webFetchProviderOptions.find((o) => o.value === webFetchSelected)?.label ?? webFetchSelected;
	const webDeepSearchSelectedLabel =
		webDeepSearchProviderOptions.find((o) => o.value === webDeepSearchSelected)?.label ?? webDeepSearchSelected;
	const aiDetectionSelectedLabel =
		aiDetectionProviderOptions.find((o) => o.value === aiDetectionSelected)?.label ?? aiDetectionSelected;
	const aiFields = getAiDetectionCredentialFields(aiDetectionSelected);
	const aiDraft = aiDetectionDrafts[aiDetectionSelected];

	const currentDraft =
		drawer?.tool === 'webSearch'
			? webSearchDrafts[webSearchSelected]
			: drawer?.tool === 'webFetch'
			? webFetchDrafts[webFetchSelected]
			: drawer?.tool === 'webDeepSearch'
			? webDeepSearchDrafts[webDeepSearchSelected]
			: drawer?.tool === 'aiDetection'
			? aiDraft
			: null;
	const currentSavedDraft =
		drawer?.tool === 'webSearch'
			? webSearchSavedDrafts[webSearchSelected]
			: drawer?.tool === 'webFetch'
			? webFetchSavedDrafts[webFetchSelected]
			: drawer?.tool === 'webDeepSearch'
			? webDeepSearchSavedDrafts[webDeepSearchSelected]
			: drawer?.tool === 'aiDetection'
			? aiDetectionSavedDrafts[aiDetectionSelected]
			: null;
	const currentDirty = isDraftDirty(currentDraft, currentSavedDraft);
	function discardCurrentDraft() {
		if (!drawer || !currentSavedDraft) return;
		if (drawer.tool === 'webSearch')
			setWebSearchDrafts((prev) => ({
				...prev,
				[webSearchSelected]: cloneDrafts(webSearchSavedDrafts[webSearchSelected]),
			}));
		else if (drawer.tool === 'webFetch')
			setWebFetchDrafts((prev) => ({
				...prev,
				[webFetchSelected]: cloneDrafts(webFetchSavedDrafts[webFetchSelected]),
			}));
		else if (drawer.tool === 'webDeepSearch')
			setWebDeepSearchDrafts((prev) => ({
				...prev,
				[webDeepSearchSelected]: cloneDrafts(webDeepSearchSavedDrafts[webDeepSearchSelected]),
			}));
		else
			setAiDetectionDrafts((prev) => ({
				...prev,
				[aiDetectionSelected]: cloneDrafts(aiDetectionSavedDrafts[aiDetectionSelected]),
			}));
		clearCardFeedback(drawer.tool);
		setDraftResetVersion((version) => version + 1);
	}

	const currentConfigured =
		drawer?.tool === 'aiDetection'
			? aiFields.every((field) => Boolean(aiDraft[field].trim()))
			: Boolean(currentDraft?.apiKey.trim());
	const aiUnitValid =
		Boolean(aiDraft.billingUnitChars.trim()) &&
		Number.isSafeInteger(Number(aiDraft.billingUnitChars)) &&
		Number(aiDraft.billingUnitChars) > 0;
	function updateAiDraft(patch: Partial<AiDetectionProviderDraft>) {
		setAiDetectionDrafts((prev) => ({
			...prev,
			[aiDetectionSelected]: { ...prev[aiDetectionSelected], ...patch },
		}));
	}
	function updateCurrentDraft(patch: Partial<ProviderDraft>) {
		if (drawer?.tool === 'webSearch')
			setWebSearchDrafts((prev) => ({
				...prev,
				[webSearchSelected]: { ...prev[webSearchSelected], ...patch },
			}));
		else if (drawer?.tool === 'webFetch')
			setWebFetchDrafts((prev) => ({
				...prev,
				[webFetchSelected]: { ...prev[webFetchSelected], ...patch },
			}));
		else if (drawer?.tool === 'webDeepSearch')
			setWebDeepSearchDrafts((prev) => ({
				...prev,
				[webDeepSearchSelected]: { ...prev[webDeepSearchSelected], ...patch },
			}));
		else if (drawer?.tool === 'aiDetection') updateAiDraft(patch);
	}

	const drawerBusy =
		(drawer?.tool === 'webSearch' && webSearchSaving) ||
		(drawer?.tool === 'webFetch' && webFetchSaving) ||
		(drawer?.tool === 'webDeepSearch' && webDeepSearchSaving) ||
		(drawer?.tool === 'aiDetection' && aiDetectionSaving);

	const drawerTitle =
		drawer?.tool === 'webSearch'
			? t('providerCards.detailTitle', { name: webSearchSelectedLabel })
			: drawer?.tool === 'webFetch'
			? t('providerCards.detailTitle', { name: webFetchSelectedLabel })
			: drawer?.tool === 'webDeepSearch'
			? t('providerCards.detailTitle', { name: webDeepSearchSelectedLabel })
			: drawer?.tool === 'aiDetection'
			? t('providerCards.detailTitle', { name: aiDetectionSelectedLabel })
			: '';

	const drawerItems =
		drawer?.tool === 'webSearch'
			? webSearchPickerItems
			: drawer?.tool === 'webFetch'
			? webFetchPickerItems
			: drawer?.tool === 'webDeepSearch'
			? webDeepSearchPickerItems
			: aiDetectionPickerItems;

	const selectedProvider = drawerItems.find((item) => item.id === drawer?.providerId);
	const configSaveHint =
		selectedProvider?.status.isActive && !currentConfigured
			? t('errors.switchActiveBeforeClearingKey')
			: selectedProvider?.status.isActive
			? t('serviceList.activeHint')
			: t('serviceList.saveOnlyHint');

	return (
		<div className="admin-content-workspace content-tone-tools min-w-0 p-4 sm:p-6 lg:p-8">
			<div className="mb-4 flex flex-wrap items-start justify-between gap-4">
				<div>
					<AdminPageTitle>{t('config.title')}</AdminPageTitle>
					<p className="mt-1 text-sm text-gray-500">{t('config.subtitle')}</p>
				</div>
			</div>

			<ToolProviderList
				searchRef={serviceSearchRef}
				currency={billingCurrency}
				groups={[
					{
						id: 'web-search',
						label: t('webSearch.title'),
						description: t('toolGroups.webSearch'),
						unitLabel: t('serviceList.perRequest'),
						items: webSearchPickerItems,
						onSelect: openWebSearchDrawer,
						onActivate: (id) => void activateProvider('webSearch', id),
						busy: anySaving || activating != null,
						activatingId: activating?.tool === 'webSearch' ? activating.providerId : null,
						feedback: drawer?.tool === 'webSearch' ? undefined : cardFeedback.webSearch,
					},
					{
						id: 'web-fetch',
						label: t('webFetch.title'),
						description: t('toolGroups.webFetch'),
						unitLabel: t('serviceList.perRequest'),
						items: webFetchPickerItems,
						onSelect: openWebFetchDrawer,
						onActivate: (id) => void activateProvider('webFetch', id),
						busy: anySaving || activating != null,
						activatingId: activating?.tool === 'webFetch' ? activating.providerId : null,
						feedback: drawer?.tool === 'webFetch' ? undefined : cardFeedback.webFetch,
					},
					{
						id: 'web-deep-search',
						label: t('webDeepSearch.title'),
						description: t('toolGroups.webDeepSearch'),
						unitLabel: t('serviceList.perRequest'),
						items: webDeepSearchPickerItems,
						onSelect: openWebDeepSearchDrawer,
						onActivate: (id) => void activateProvider('webDeepSearch', id),
						busy: anySaving || activating != null,
						activatingId: activating?.tool === 'webDeepSearch' ? activating.providerId : null,
						feedback: drawer?.tool === 'webDeepSearch' ? undefined : cardFeedback.webDeepSearch,
					},
					{
						id: 'ai-detection',
						label: t('aiDetection.title'),
						description: t('toolGroups.aiDetection'),
						unitLabel: t('serviceList.perRequest'),
						items: aiDetectionPickerItems.map((item) => ({
							...item,
							unitLabel: t('serviceList.perCharacters', {
								count: aiDetectionDrafts[item.id as AiDetectionProvider].billingUnitChars.trim() || '—',
							}),
							savedUnitLabel: t('serviceList.perCharacters', {
								count: aiDetectionSavedDrafts[item.id as AiDetectionProvider].billingUnitChars.trim() || '—',
							}),
						})),
						onSelect: openAiDetectionDrawer,
						onActivate: (id) => void activateProvider('aiDetection', id),
						busy: anySaving || activating != null,
						activatingId: activating?.tool === 'aiDetection' ? activating.providerId : null,
						feedback: drawer?.tool === 'aiDetection' ? undefined : cardFeedback.aiDetection,
					},
				]}
			/>

			<ToolProviderDrawer
				fallbackFocusRef={serviceSearchRef}
				open={drawer != null}
				title={drawerTitle}
				subtitle={drawer ? t(`${drawer.tool}.title`) : undefined}
				busy={Boolean(drawerBusy)}
				onClose={closeDrawer}
				docsHref={
					drawer?.tool === 'webSearch'
						? WEB_SEARCH_PROVIDER_DOCS_URL[webSearchSelected]
						: drawer?.tool === 'webFetch'
						? WEB_FETCH_PROVIDER_DOCS_URL[webFetchSelected]
						: drawer?.tool === 'webDeepSearch'
						? WEB_DEEP_SEARCH_PROVIDER_DOCS_URL[webDeepSearchSelected]
						: drawer?.tool === 'aiDetection'
						? AI_DETECTION_PROVIDER_DOCS_URL[aiDetectionSelected]
						: undefined
				}
				docsLabel={
					drawer?.tool === 'webSearch'
						? t('webSearch.providerDocs')
						: drawer?.tool === 'webFetch'
						? t('webFetch.providerDocs')
						: drawer?.tool === 'webDeepSearch'
						? t('webDeepSearch.providerDocs')
						: drawer?.tool === 'aiDetection'
						? t('aiDetection.providerDocs')
						: undefined
				}
				playgroundHref={
					drawer?.tool === 'webSearch'
						? `/gateway/playground?mode=tools&tool=web-search&provider=${encodeURIComponent(webSearchSelected)}`
						: drawer?.tool === 'webFetch'
						? `/gateway/playground?mode=tools&tool=web-fetch&provider=${encodeURIComponent(webFetchSelected)}`
						: drawer?.tool === 'webDeepSearch'
						? `/gateway/playground?mode=tools&tool=web-deep-search&provider=${encodeURIComponent(
								webDeepSearchSelected
						  )}`
						: drawer?.tool === 'aiDetection' && isAiDetectionImplementedProvider(aiDetectionSelected)
						? `/gateway/playground?mode=tools&tool=ai-detection&provider=${encodeURIComponent(aiDetectionSelected)}`
						: null
				}
				playgroundLabel={t('ui.test')}
				playgroundHint={t('ui.testSavedConfig')}
				footer={
					drawer?.tool === 'webSearch' ? (
						<ToolProviderSaveActions
							hint={configSaveHint}
							dirty={currentDirty}
							onDiscard={discardCurrentDraft}
							saving={webSearchSaving}
							canSaveConfig={webSearchActions.canSaveConfig}
							onSaveConfig={() => void saveWebSearch()}
							feedback={<CardSaveFeedback feedback={cardFeedback.webSearch} />}
						/>
					) : drawer?.tool === 'webFetch' ? (
						<ToolProviderSaveActions
							hint={configSaveHint}
							dirty={currentDirty}
							onDiscard={discardCurrentDraft}
							saving={webFetchSaving}
							canSaveConfig={webFetchActions.canSaveConfig}
							onSaveConfig={() => void saveWebFetch()}
							feedback={<CardSaveFeedback feedback={cardFeedback.webFetch} />}
						/>
					) : drawer?.tool === 'webDeepSearch' ? (
						<ToolProviderSaveActions
							hint={configSaveHint}
							dirty={currentDirty}
							onDiscard={discardCurrentDraft}
							saving={webDeepSearchSaving}
							canSaveConfig={webDeepSearchActions.canSaveConfig}
							onSaveConfig={() => void saveWebDeepSearch()}
							feedback={<CardSaveFeedback feedback={cardFeedback.webDeepSearch} />}
						/>
					) : drawer?.tool === 'aiDetection' ? (
						<ToolProviderSaveActions
							hint={configSaveHint}
							dirty={currentDirty}
							onDiscard={discardCurrentDraft}
							saving={aiDetectionSaving}
							canSaveConfig={aiDetectionActions.canSaveConfig}
							onSaveConfig={() => void saveAiDetection()}
							feedback={<CardSaveFeedback feedback={cardFeedback.aiDetection} />}
						/>
					) : null
				}
			>
				{drawer && currentDraft ? (
					<fieldset disabled={Boolean(drawerBusy)} className={`${form.form} min-w-0`}>
						<legend className="sr-only">{drawerTitle}</legend>
						<section aria-labelledby="rest-connection-heading">
							<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
								<h3 id="rest-connection-heading" className="flex items-center gap-2 text-sm font-medium text-gray-900">
									<span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
										<KeyIcon className="h-4 w-4" aria-hidden="true" />
									</span>
									{t('serviceList.connection')}
								</h3>
							</div>
							<div className={form.field}>
								<span id="rest-provider-label" className={form.label}>
									{t('serviceList.engines')}
								</span>
								<div className={`${form.control} flex min-w-0 items-center gap-3`}>
									{drawerItems.length > 1 ? (
										<select
											id="rest-provider-select"
											aria-labelledby="rest-provider-label"
											value={drawer.providerId}
											disabled={Boolean(drawerBusy)}
											onChange={(event) => {
												if (drawer.tool === 'webSearch') openWebSearchDrawer(event.target.value);
												else if (drawer.tool === 'webFetch') openWebFetchDrawer(event.target.value);
												else if (drawer.tool === 'webDeepSearch') openWebDeepSearchDrawer(event.target.value);
												else openAiDetectionDrawer(event.target.value);
											}}
											className="h-10 min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800"
										>
											{drawerItems.map((item) => (
												<option key={item.id} value={item.id}>
													{item.label}
													{item.status.isDirty ? ` · ${t('providerCards.unsaved')}` : ''}
												</option>
											))}
										</select>
									) : (
										<span className="text-sm font-medium text-gray-800">{drawerItems[0]?.label}</span>
									)}
									{selectedProvider ? (
										<span className="shrink-0">
											<ToolProviderUsage
												active={selectedProvider.status.isActive}
												configured={selectedProvider.savedConfigured}
												implemented={selectedProvider.status.isImplemented}
											/>
										</span>
									) : null}
								</div>
							</div>
							{drawer.tool === 'aiDetection' ? (
								<div className="mt-4 space-y-4">
									{aiFields.map((field) => (
										<div key={field} className={form.field}>
											<label htmlFor={`rest-credential-${field}`} className={form.label}>
												{t(AI_DETECTION_FIELD_I18N[field])}
											</label>
											{field === 'email' ? (
												<input
													id={`rest-credential-${field}`}
													type="email"
													value={aiDraft[field]}
													onChange={(event) => updateAiDraft({ [field]: event.target.value })}
													placeholder={t(AI_DETECTION_FIELD_I18N[field])}
													autoComplete="off"
													spellCheck={false}
													className="h-10 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3 font-mono text-sm"
												/>
											) : (
												<ApiKeyField
													key={`${drawer.providerId}-${field}-${draftResetVersion}`}
													id={`rest-credential-${field}`}
													label={t(AI_DETECTION_FIELD_I18N[field])}
													value={aiDraft[field]}
													onChange={(value) => updateAiDraft({ [field]: value })}
													placeholder={t(AI_DETECTION_FIELD_I18N[field])}
												/>
											)}
										</div>
									))}
									{aiDetectionSelected === 'tencent_tms' ? (
										<>
											<label className={form.field}>
												<span className={form.label}>{t('aiDetection.fields.region')}</span>
												<input
													type="text"
													value={aiDraft.region}
													onChange={(e) => updateAiDraft({ region: e.target.value })}
													autoComplete="off"
													spellCheck={false}
													className="h-10 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3 font-mono text-sm"
												/>
											</label>
											<label className={form.field}>
												<span className={form.label}>{t('aiDetection.fields.bizTypeOptional')}</span>
												<input
													type="text"
													value={aiDraft.bizType}
													onChange={(e) => updateAiDraft({ bizType: e.target.value })}
													autoComplete="off"
													spellCheck={false}
													className="h-10 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3 font-mono text-sm"
												/>
											</label>
										</>
									) : null}
								</div>
							) : (
								<div className={`${form.field} mt-4`}>
									<label htmlFor="rest-provider-api-key" className={form.label}>
										{t(`${drawer.tool}.apiKey`)}
									</label>
									<div className={form.control}>
										<ApiKeyField
											key={`${drawer.tool}-${drawer.providerId}-${draftResetVersion}`}
											id="rest-provider-api-key"
											label={t(`${drawer.tool}.apiKey`)}
											value={currentDraft.apiKey}
											onChange={(apiKey) => updateCurrentDraft({ apiKey })}
											placeholder={t(`${drawer.tool}.apiKeyPlaceholder`)}
										/>
									</div>
								</div>
							)}
							{!currentConfigured ? (
								<div className={`${form.field} mt-2`}>
									<p className={`${form.note} text-amber-700`}>{t('serviceList.credentialsRequired')}</p>
								</div>
							) : null}
						</section>
						<section aria-labelledby="rest-pricing-heading" className="mt-6 border-t border-gray-100 pt-6">
							<h3 id="rest-pricing-heading" className="mb-4 flex items-center gap-2 text-sm font-medium text-gray-900">
								<span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
									<CurrencyDollarIcon className="h-4 w-4" aria-hidden="true" />
								</span>
								{t('serviceList.pricing')}
							</h3>
							{drawer.tool === 'aiDetection' ? (
								<div className="mb-4 space-y-2">
									<label className={form.field}>
										<span className={form.label}>{t('aiDetection.billingUnitChars')}</span>
										<input
											type="number"
											min={1}
											step={1}
											required
											value={aiDraft.billingUnitChars}
											onChange={(e) => updateAiDraft({ billingUnitChars: e.target.value })}
											aria-invalid={!aiUnitValid}
											className="h-10 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-3 font-mono text-sm"
										/>
									</label>
									<div className={form.field}>
										<p className={`${form.note} text-gray-500`}>{t('aiDetection.billingUnitHint')}</p>
									</div>
									{!aiUnitValid ? (
										<div className={form.field}>
											<p role="status" className={`${form.note} text-red-600`}>
												{t('aiDetection.billingUnitInvalid')}
											</p>
										</div>
									) : null}
								</div>
							) : null}
							<RestToolPricingEditor
								key={`${drawer.tool}-${drawer.providerId}-${draftResetVersion}`}
								currency={billingCurrency}
								value={currentDraft}
								unitLabel={
									drawer.tool === 'aiDetection'
										? tPricing('charactersUnit', {
												count: aiUnitValid ? Number(aiDraft.billingUnitChars) : '—',
										  })
										: undefined
								}
								onChange={updateCurrentDraft}
							/>
						</section>
					</fieldset>
				) : null}
			</ToolProviderDrawer>
		</div>
	);
}
