'use client';

/**
 * Tools 配置：产品工具（`/v1/tools/*`）的 per-provider catalog + active；写入 `system_config`。
 * UI：高密度 Provider 总览 + 按需右侧抽屉编辑；须显式保存。
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
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
	entryHasRequiredCredentials as aiEntryHasRequiredCredentials,
	parseAiDetectionCatalogLenient,
	serializeAiDetectionCatalog,
	AI_DETECTION_PROVIDER_REQUIRED_CREDENTIALS,
	type AiDetectionCatalog,
	type AiDetectionCatalogEntry,
} from '@octafuse/core/lib/ai-detection-system-config';
import { toToolPricingFields } from '@octafuse/core/lib/tool-pricing';
import { WebSearchProviderGuideModal } from './components/web-search-provider-guide-modal';
import {
	cloneDrafts,
	draftPricesOk,
	parseDraftMoney,
	resolveProviderCardActions,
	resolveProviderCardStatus,
	wouldClearSavedActiveCredentials,
	type PriceTripleDraft,
} from './components/provider-card-state';
import { ToolPriceTripleInputs } from './components/tool-price-triple-inputs';
import { ToolProviderDrawer } from './components/tool-provider-drawer';
import {
	ToolOverviewSection,
	ToolProviderOverviewHints,
	ToolProviderPicker,
	ToolProviderSaveActions,
} from './components/tool-provider-picker';

type ProviderDraft = {
	apiKey: string;
} & PriceTripleDraft;

type AiDetectionProviderDraft = {
	apiKey: string;
	secretId: string;
	secretKey: string;
	email: string;
	region: string;
	bizType: string;
	billingUnitChars: string;
} & PriceTripleDraft;

function defaultPriceTriple(defaultCost: number): PriceTripleDraft {
	const s = String(defaultCost);
	return { metered: s, standard: s, charged: s };
}

function entryToDraftPrices(entry: {
	metered: number;
	standard: number;
	charged: number;
	cost: number;
}): PriceTripleDraft {
	const charged = entry.charged ?? entry.cost;
	return {
		metered: String(entry.metered ?? charged),
		standard: String(entry.standard ?? charged),
		charged: String(charged),
	};
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
	const prices = toToolPricingFields({
		metered: Number(d.metered.trim()),
		standard: Number(d.standard.trim()),
		charged: Number(d.charged.trim()),
	});
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
	return aiEntryHasRequiredCredentials(
		draftToAiEntry(d),
		AI_DETECTION_PROVIDER_REQUIRED_CREDENTIALS[provider]
	);
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
		const activeRaw = rows.find((r) => r.key === WEB_SEARCH_ACTIVE_KEY)?.value?.trim().toLowerCase() ?? '';
		const active = (WEB_SEARCH_PROVIDERS as readonly string[]).includes(activeRaw)
			? (activeRaw as WebSearchProvider)
			: DEFAULT_WEB_SEARCH_PROVIDER;
		const savedActive = (WEB_SEARCH_PROVIDERS as readonly string[]).includes(activeRaw)
			? (activeRaw as WebSearchProvider)
			: null;
		return { active, drafts, savedActive };
	}

	const providerRaw = rows.find((r) => r.key === WEB_SEARCH_PROVIDER_KEY)?.value?.trim().toLowerCase() ?? '';
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
		if (!draftPricesOk(d)) {
			return null;
		}
		catalog[p] = {
			apiKey: d.apiKey.trim(),
			...toToolPricingFields({
				metered: parseDraftMoney(d.metered)!,
				standard: parseDraftMoney(d.standard)!,
				charged: parseDraftMoney(d.charged)!,
			}),
		};
	}
	return catalog;
}

function buildFetchCatalog(drafts: Record<WebFetchProvider, ProviderDraft>): WebFetchCatalog | null {
	const catalog: WebFetchCatalog = {};
	for (const p of WEB_FETCH_PROVIDERS) {
		const d = drafts[p];
		if (!draftPricesOk(d)) {
			return null;
		}
		catalog[p] = {
			apiKey: d.apiKey.trim(),
			...toToolPricingFields({
				metered: parseDraftMoney(d.metered)!,
				standard: parseDraftMoney(d.standard)!,
				charged: parseDraftMoney(d.charged)!,
			}),
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
			rows.find((r) => r.key === WEB_DEEP_SEARCH_ACTIVE_KEY)?.value?.trim().toLowerCase() ?? '';
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
		if (!draftPricesOk(d)) {
			return null;
		}
		catalog[p] = {
			apiKey: d.apiKey.trim(),
			...toToolPricingFields({
				metered: parseDraftMoney(d.metered)!,
				standard: parseDraftMoney(d.standard)!,
				charged: parseDraftMoney(d.charged)!,
			}),
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
			rows.find((r) => r.key === AI_DETECTION_ACTIVE_KEY)?.value?.trim().toLowerCase() ?? '';
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
		if (!draftPricesOk(d)) {
			return null;
		}
		const unitChars = Number(d.billingUnitChars.trim());
		if (
			!d.billingUnitChars.trim() ||
			!Number.isFinite(unitChars) ||
			unitChars < 1 ||
			!Number.isInteger(unitChars)
		) {
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

const AI_DETECTION_FIELD_I18N: Record<
	AiDetectionCredentialField,
	`aiDetection.fields.${AiDetectionCredentialField}`
> = {
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
			role={feedback.kind === 'success' ? 'status' : undefined}
		>
			{feedback.message}
		</span>
	);
}

function ApiKeyField({
	value,
	onChange,
	placeholder,
	secretsVisible,
}: {
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
	secretsVisible: boolean;
}) {
	return (
		<input
			type={secretsVisible ? 'text' : 'password'}
			value={value}
			onChange={(e) => onChange(e.target.value)}
			placeholder={placeholder}
			autoComplete="off"
			spellCheck={false}
			className="w-full min-w-0 rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 shadow-sm"
		/>
	);
}

export default function GatewayToolsConfigPage() {
	const t = useTranslations('tools');
	const tCommon = useTranslations('common');
	const { currency: billingCurrency } = useBillingCurrency();
	const webSearchProviderOptions = getWebSearchProviderOptions((k) => t(k));
	const webFetchProviderOptions = getWebFetchProviderOptions((k) => t(k));
	const webDeepSearchProviderOptions = getWebDeepSearchProviderOptions((k) => t(k));
	const aiDetectionProviderOptions = getAiDetectionProviderOptions((k) => t(k));

	const [isLoading, setIsLoading] = useState(true);
	const [cardFeedback, setCardFeedback] = useState<Partial<Record<ToolCardKey, CardFeedback>>>({});
	const successTimersRef = useRef<Partial<Record<ToolCardKey, ReturnType<typeof setTimeout>>>>({});

	const [webSearchSelected, setWebSearchSelected] =
		useState<WebSearchProvider>(DEFAULT_WEB_SEARCH_PROVIDER);
	const [webSearchSavedActive, setWebSearchSavedActive] = useState<WebSearchProvider | null>(null);
	const [webSearchDrafts, setWebSearchDrafts] = useState(emptySearchDrafts);
	const [webSearchSavedDrafts, setWebSearchSavedDrafts] = useState(emptySearchDrafts);
	const [webSearchSaving, setWebSearchSaving] = useState(false);
	const [providerGuideOpen, setProviderGuideOpen] = useState(false);

	const [webFetchSelected, setWebFetchSelected] = useState<WebFetchProvider>(DEFAULT_WEB_FETCH_PROVIDER);
	const [webFetchSavedActive, setWebFetchSavedActive] = useState<WebFetchProvider | null>(null);
	const [webFetchDrafts, setWebFetchDrafts] = useState(emptyFetchDrafts);
	const [webFetchSavedDrafts, setWebFetchSavedDrafts] = useState(emptyFetchDrafts);
	const [webFetchSaving, setWebFetchSaving] = useState(false);

	const [webDeepSearchSelected, setWebDeepSearchSelected] = useState<WebDeepSearchProvider>(
		DEFAULT_WEB_DEEP_SEARCH_PROVIDER
	);
	const [webDeepSearchSavedActive, setWebDeepSearchSavedActive] =
		useState<WebDeepSearchProvider | null>(null);
	const [webDeepSearchDrafts, setWebDeepSearchDrafts] = useState(emptyDeepSearchDrafts);
	const [webDeepSearchSavedDrafts, setWebDeepSearchSavedDrafts] = useState(emptyDeepSearchDrafts);
	const [webDeepSearchSaving, setWebDeepSearchSaving] = useState(false);

	const [aiDetectionSelected, setAiDetectionSelected] =
		useState<AiDetectionProvider>(DEFAULT_AI_DETECTION_PROVIDER);
	const [aiDetectionSavedActive, setAiDetectionSavedActive] = useState<AiDetectionProvider | null>(
		null
	);
	const [aiDetectionDrafts, setAiDetectionDrafts] = useState(emptyAiDetectionDrafts);
	const [aiDetectionSavedDrafts, setAiDetectionSavedDrafts] = useState(emptyAiDetectionDrafts);
	const [aiDetectionSaving, setAiDetectionSaving] = useState(false);

	const [secretsVisible, setSecretsVisible] = useState(false);
	/** 右侧抽屉：点击总览卡片打开；null 表示关闭 */
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
			const response = await fetch('/api/admin/config');
			const data = await readApiJson<SystemConfigRow[]>(response);
			if (data.success && Array.isArray(data.data)) {
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

	const saveWebSearch = async (activateSelected: boolean) => {
		const catalog = buildSearchCatalog(webSearchDrafts);
		if (!catalog) {
			setCardError('webSearch', t('errors.invalidWebSearchCost'));
			return;
		}
		if (activateSelected && !catalog[webSearchSelected]?.apiKey?.trim()) {
			setCardError('webSearch', t('errors.noKeyCannotActivate'));
			return;
		}
		if (
			webSearchSavedActive &&
			!catalog[webSearchSavedActive]?.apiKey?.trim() &&
			!(activateSelected && webSearchSelected !== webSearchSavedActive)
		) {
			setCardError('webSearch', t('errors.switchActiveBeforeClearingKey'));
			return;
		}
		if (
			activateSelected &&
			wouldClearSavedActiveCredentials({
				savedActiveId: webSearchSavedActive,
				nextActiveId: webSearchSelected,
				hasCredentialsAfterSave: (id) => Boolean(catalog[id as WebSearchProvider]?.apiKey?.trim()),
			})
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
			if (activateSelected) {
				const actRes = await putConfig(WEB_SEARCH_ACTIVE_KEY, webSearchSelected);
				if (!actRes.ok) {
					setCardError('webSearch', actRes.message || tCommon('saveFailed'));
					return;
				}
				setWebSearchSavedActive(webSearchSelected);
				flashCardSuccess('webSearch', actRes.message ?? catRes.message);
			} else {
				flashCardSuccess('webSearch', catRes.message);
			}
			setWebSearchSavedDrafts(cloneDrafts(webSearchDrafts));
		} catch {
			setCardError('webSearch', tCommon('requestFailed'));
		} finally {
			setWebSearchSaving(false);
		}
	};

	const saveWebFetch = async (activateSelected: boolean) => {
		const catalog = buildFetchCatalog(webFetchDrafts);
		if (!catalog) {
			setCardError('webFetch', t('errors.invalidWebFetchCost'));
			return;
		}
		if (activateSelected && !catalog[webFetchSelected]?.apiKey?.trim()) {
			setCardError('webFetch', t('errors.noKeyCannotActivate'));
			return;
		}
		if (
			webFetchSavedActive &&
			!catalog[webFetchSavedActive]?.apiKey?.trim() &&
			!(activateSelected && webFetchSelected !== webFetchSavedActive)
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
			if (activateSelected) {
				const actRes = await putConfig(WEB_FETCH_ACTIVE_KEY, webFetchSelected);
				if (!actRes.ok) {
					setCardError('webFetch', actRes.message || tCommon('saveFailed'));
					return;
				}
				setWebFetchSavedActive(webFetchSelected);
				flashCardSuccess('webFetch', actRes.message ?? catRes.message);
			} else {
				flashCardSuccess('webFetch', catRes.message);
			}
			setWebFetchSavedDrafts(cloneDrafts(webFetchDrafts));
		} catch {
			setCardError('webFetch', tCommon('requestFailed'));
		} finally {
			setWebFetchSaving(false);
		}
	};

	const saveWebDeepSearch = async (activateSelected: boolean) => {
		const catalog = buildDeepSearchCatalog(webDeepSearchDrafts);
		if (!catalog) {
			setCardError('webDeepSearch', t('errors.invalidWebDeepSearchCost'));
			return;
		}
		if (activateSelected && !catalog[webDeepSearchSelected]?.apiKey?.trim()) {
			setCardError('webDeepSearch', t('errors.noKeyCannotActivate'));
			return;
		}
		if (
			webDeepSearchSavedActive &&
			!catalog[webDeepSearchSavedActive]?.apiKey?.trim() &&
			!(activateSelected && webDeepSearchSelected !== webDeepSearchSavedActive)
		) {
			setCardError('webDeepSearch', t('errors.switchActiveBeforeClearingKey'));
			return;
		}

		clearCardFeedback('webDeepSearch');
		setWebDeepSearchSaving(true);
		try {
			const catRes = await putConfig(
				WEB_DEEP_SEARCH_CATALOG_KEY,
				serializeWebDeepSearchCatalog(catalog)
			);
			if (!catRes.ok) {
				setCardError('webDeepSearch', catRes.message || tCommon('saveFailed'));
				return;
			}
			if (activateSelected) {
				const actRes = await putConfig(WEB_DEEP_SEARCH_ACTIVE_KEY, webDeepSearchSelected);
				if (!actRes.ok) {
					setCardError('webDeepSearch', actRes.message || tCommon('saveFailed'));
					return;
				}
				setWebDeepSearchSavedActive(webDeepSearchSelected);
				flashCardSuccess('webDeepSearch', actRes.message ?? catRes.message);
			} else {
				flashCardSuccess('webDeepSearch', catRes.message);
			}
			setWebDeepSearchSavedDrafts(cloneDrafts(webDeepSearchDrafts));
		} catch {
			setCardError('webDeepSearch', tCommon('requestFailed'));
		} finally {
			setWebDeepSearchSaving(false);
		}
	};

	const saveAiDetection = async (activateSelected: boolean) => {
		const catalog = buildAiDetectionCatalog(aiDetectionDrafts);
		if (!catalog) {
			setCardError('aiDetection', t('errors.invalidAiDetectionCost'));
			return;
		}
		if (activateSelected) {
			if (!isAiDetectionImplementedProvider(aiDetectionSelected)) {
				setCardError('aiDetection', t('errors.aiDetectionNotImplemented'));
				return;
			}
			if (!aiDraftHasRequiredCredentials(aiDetectionSelected, aiDetectionDrafts[aiDetectionSelected])) {
				setCardError('aiDetection', t('errors.noKeyCannotActivate'));
				return;
			}
		}
		if (
			aiDetectionSavedActive &&
			!aiDraftHasRequiredCredentials(
				aiDetectionSavedActive,
				aiDetectionDrafts[aiDetectionSavedActive]
			) &&
			!(activateSelected && aiDetectionSelected !== aiDetectionSavedActive)
		) {
			setCardError('aiDetection', t('errors.switchActiveBeforeClearingKey'));
			return;
		}

		clearCardFeedback('aiDetection');
		setAiDetectionSaving(true);
		try {
			const catRes = await putConfig(AI_DETECTION_CATALOG_KEY, serializeAiDetectionCatalog(catalog));
			if (!catRes.ok) {
				setCardError('aiDetection', catRes.message || tCommon('saveFailed'));
				return;
			}
			if (activateSelected) {
				const actRes = await putConfig(AI_DETECTION_ACTIVE_KEY, aiDetectionSelected);
				if (!actRes.ok) {
					setCardError('aiDetection', actRes.message || tCommon('saveFailed'));
					return;
				}
				setAiDetectionSavedActive(aiDetectionSelected);
				flashCardSuccess('aiDetection', actRes.message ?? catRes.message);
			} else {
				flashCardSuccess('aiDetection', catRes.message);
			}
			setAiDetectionSavedDrafts(cloneDrafts(aiDetectionDrafts));
		} catch {
			setCardError('aiDetection', tCommon('requestFailed'));
		} finally {
			setAiDetectionSaving(false);
		}
	};

	const webSearchDrawerSelected =
		drawer?.tool === 'webSearch' ? drawer.providerId : '';
	const webFetchDrawerSelected = drawer?.tool === 'webFetch' ? drawer.providerId : '';
	const webDeepSearchDrawerSelected =
		drawer?.tool === 'webDeepSearch' ? drawer.providerId : '';
	const aiDetectionDrawerSelected =
		drawer?.tool === 'aiDetection' ? drawer.providerId : '';

	const webSearchPickerItems = useMemo(
		() =>
			WEB_SEARCH_PROVIDERS.map((p) => ({
				id: p,
				label: webSearchProviderOptions.find((o) => o.value === p)?.label ?? p,
				prices: webSearchDrafts[p],
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
		[
			webSearchDrafts,
			webSearchDrawerSelected,
			webSearchProviderOptions,
			webSearchSavedActive,
			webSearchSavedDrafts,
		]
	);

	const webFetchPickerItems = useMemo(
		() =>
			WEB_FETCH_PROVIDERS.map((p) => ({
				id: p,
				label: webFetchProviderOptions.find((o) => o.value === p)?.label ?? p,
				prices: webFetchDrafts[p],
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
		[
			webFetchDrafts,
			webFetchDrawerSelected,
			webFetchProviderOptions,
			webFetchSavedActive,
			webFetchSavedDrafts,
		]
	);

	const webDeepSearchPickerItems = useMemo(
		() =>
			WEB_DEEP_SEARCH_PROVIDERS.map((p) => ({
				id: p,
				label: webDeepSearchProviderOptions.find((o) => o.value === p)?.label ?? p,
				prices: webDeepSearchDrafts[p],
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
		const p = id as WebSearchProvider;
		setWebSearchSelected(p);
		setDrawer({ tool: 'webSearch', providerId: p });
	};
	const openWebFetchDrawer = (id: string) => {
		const p = id as WebFetchProvider;
		setWebFetchSelected(p);
		setDrawer({ tool: 'webFetch', providerId: p });
	};
	const openWebDeepSearchDrawer = (id: string) => {
		const p = id as WebDeepSearchProvider;
		setWebDeepSearchSelected(p);
		setDrawer({ tool: 'webDeepSearch', providerId: p });
	};
	const openAiDetectionDrawer = (id: string) => {
		const p = id as AiDetectionProvider;
		setAiDetectionSelected(p);
		setDrawer({ tool: 'aiDetection', providerId: p });
	};
	const closeDrawer = useCallback(() => {
		setDrawer(null);
	}, []);

	const webSearchActions = resolveProviderCardActions({
		catalogPricesValid: buildSearchCatalog(webSearchDrafts) != null,
		selectedIsActive: webSearchSavedActive === webSearchSelected,
		selectedConfigured: webSearchDrafts[webSearchSelected].apiKey.trim().length > 0,
	});
	const webFetchActions = resolveProviderCardActions({
		catalogPricesValid: buildFetchCatalog(webFetchDrafts) != null,
		selectedIsActive: webFetchSavedActive === webFetchSelected,
		selectedConfigured: webFetchDrafts[webFetchSelected].apiKey.trim().length > 0,
	});
	const webDeepSearchActions = resolveProviderCardActions({
		catalogPricesValid: buildDeepSearchCatalog(webDeepSearchDrafts) != null,
		selectedIsActive: webDeepSearchSavedActive === webDeepSearchSelected,
		selectedConfigured: webDeepSearchDrafts[webDeepSearchSelected].apiKey.trim().length > 0,
	});
	const aiDetectionActions = resolveProviderCardActions({
		catalogPricesValid: buildAiDetectionCatalog(aiDetectionDrafts) != null,
		selectedIsActive: aiDetectionSavedActive === aiDetectionSelected,
		selectedConfigured: aiDraftHasRequiredCredentials(
			aiDetectionSelected,
			aiDetectionDrafts[aiDetectionSelected]
		),
		selectedImplemented: isAiDetectionImplementedProvider(aiDetectionSelected),
	});

	if (isLoading) {
		return (
			<div className="flex h-full items-center justify-center">
				<div className="text-gray-600">{tCommon('loading')}</div>
			</div>
		);
	}

	const webSearchSelectedLabel =
		webSearchProviderOptions.find((o) => o.value === webSearchSelected)?.label ?? webSearchSelected;
	const webFetchSelectedLabel =
		webFetchProviderOptions.find((o) => o.value === webFetchSelected)?.label ?? webFetchSelected;
	const webDeepSearchSelectedLabel =
		webDeepSearchProviderOptions.find((o) => o.value === webDeepSearchSelected)?.label ??
		webDeepSearchSelected;
	const aiDetectionSelectedLabel =
		aiDetectionProviderOptions.find((o) => o.value === aiDetectionSelected)?.label ??
		aiDetectionSelected;
	const webSearchActiveLabel = webSearchSavedActive
		? (webSearchProviderOptions.find((o) => o.value === webSearchSavedActive)?.label ??
			webSearchSavedActive)
		: null;
	const webFetchActiveLabel = webFetchSavedActive
		? (webFetchProviderOptions.find((o) => o.value === webFetchSavedActive)?.label ??
			webFetchSavedActive)
		: null;
	const webDeepSearchActiveLabel = webDeepSearchSavedActive
		? (webDeepSearchProviderOptions.find((o) => o.value === webDeepSearchSavedActive)?.label ??
			webDeepSearchSavedActive)
		: null;
	const aiDetectionActiveLabel = aiDetectionSavedActive
		? (aiDetectionProviderOptions.find((o) => o.value === aiDetectionSavedActive)?.label ??
			aiDetectionSavedActive)
		: null;
	const aiFields = getAiDetectionCredentialFields(aiDetectionSelected);
	const aiDraft = aiDetectionDrafts[aiDetectionSelected];

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

	return (
		<div className="min-w-0 p-4 sm:p-6 lg:p-8">
			<div className="mb-4 flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="text-3xl font-bold text-gray-900">{t('config.title')}</h1>
					<p className="mt-1 text-sm text-gray-500">{t('config.subtitle')}</p>
				</div>
				<div className="flex flex-wrap items-center gap-3">
					<button
						type="button"
						onClick={() => setSecretsVisible((v) => !v)}
						className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
						aria-pressed={secretsVisible}
					>
						{secretsVisible ? (
							<>
								<EyeSlashIcon className="h-4 w-4" aria-hidden />
								{t('config.hideSecrets')}
							</>
						) : (
							<>
								<EyeIcon className="h-4 w-4" aria-hidden />
								{t('config.showSecrets')}
							</>
						)}
					</button>
					<Link
						href="/gateway/tools/invocations"
						className="text-sm font-medium text-blue-600 hover:underline"
					>
						{t('config.viewInvocations')}
					</Link>
				</div>
			</div>

			<ToolProviderOverviewHints />

			<div className="grid items-start gap-4 2xl:grid-cols-2">
				<ToolOverviewSection
					id="web-search"
					title={t('webSearch.title')}
					description={t('webSearch.descriptionCatalog')}
					activeLabel={webSearchActiveLabel}
					headerExtra={
						<button
							type="button"
							onClick={() => setProviderGuideOpen(true)}
							className="text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline"
						>
							{t('webSearch.providerGuideLink')}
						</button>
					}
				>
					<ToolProviderPicker items={webSearchPickerItems} onSelect={openWebSearchDrawer} />
				</ToolOverviewSection>

				<ToolOverviewSection
					id="web-fetch"
					title={t('webFetch.title')}
					description={t('webFetch.descriptionCatalog')}
					activeLabel={webFetchActiveLabel}
				>
					<ToolProviderPicker items={webFetchPickerItems} onSelect={openWebFetchDrawer} />
				</ToolOverviewSection>

				<ToolOverviewSection
					id="web-deep-search"
					title={t('webDeepSearch.title')}
					description={t('webDeepSearch.descriptionCatalog')}
					activeLabel={webDeepSearchActiveLabel}
				>
					<ToolProviderPicker
						items={webDeepSearchPickerItems}
						onSelect={openWebDeepSearchDrawer}
					/>
				</ToolOverviewSection>

				<ToolOverviewSection
					id="ai-detection"
					title={t('aiDetection.title')}
					description={t('aiDetection.descriptionCatalog')}
					activeLabel={aiDetectionActiveLabel}
				>
					<ToolProviderPicker items={aiDetectionPickerItems} onSelect={openAiDetectionDrawer} />
				</ToolOverviewSection>
			</div>

			<ToolProviderDrawer
				open={drawer != null}
				title={drawerTitle}
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
								? `/gateway/playground?mode=tools&tool=web-deep-search&provider=${encodeURIComponent(webDeepSearchSelected)}`
								: drawer?.tool === 'aiDetection' &&
									  isAiDetectionImplementedProvider(aiDetectionSelected)
									? `/gateway/playground?mode=tools&tool=ai-detection&provider=${encodeURIComponent(aiDetectionSelected)}`
									: null
				}
				playgroundLabel={t('config.testInPlayground')}
				footer={
					drawer?.tool === 'webSearch' ? (
						<ToolProviderSaveActions
							saving={webSearchSaving}
							selectedIsActive={webSearchSavedActive === webSearchSelected}
							canSaveConfig={webSearchActions.canSaveConfig}
							canSaveAndActivate={webSearchActions.canSaveAndActivate}
							onSaveConfig={() => void saveWebSearch(false)}
							onSaveAndActivate={() => void saveWebSearch(true)}
							feedback={<CardSaveFeedback feedback={cardFeedback.webSearch} />}
						/>
					) : drawer?.tool === 'webFetch' ? (
						<ToolProviderSaveActions
							saving={webFetchSaving}
							selectedIsActive={webFetchSavedActive === webFetchSelected}
							canSaveConfig={webFetchActions.canSaveConfig}
							canSaveAndActivate={webFetchActions.canSaveAndActivate}
							onSaveConfig={() => void saveWebFetch(false)}
							onSaveAndActivate={() => void saveWebFetch(true)}
							feedback={<CardSaveFeedback feedback={cardFeedback.webFetch} />}
						/>
					) : drawer?.tool === 'webDeepSearch' ? (
						<ToolProviderSaveActions
							saving={webDeepSearchSaving}
							selectedIsActive={webDeepSearchSavedActive === webDeepSearchSelected}
							canSaveConfig={webDeepSearchActions.canSaveConfig}
							canSaveAndActivate={webDeepSearchActions.canSaveAndActivate}
							onSaveConfig={() => void saveWebDeepSearch(false)}
							onSaveAndActivate={() => void saveWebDeepSearch(true)}
							feedback={<CardSaveFeedback feedback={cardFeedback.webDeepSearch} />}
						/>
					) : drawer?.tool === 'aiDetection' ? (
						<ToolProviderSaveActions
							saving={aiDetectionSaving}
							selectedIsActive={aiDetectionSavedActive === aiDetectionSelected}
							canSaveConfig={aiDetectionActions.canSaveConfig}
							canSaveAndActivate={aiDetectionActions.canSaveAndActivate}
							onSaveConfig={() => void saveAiDetection(false)}
							onSaveAndActivate={() => void saveAiDetection(true)}
							feedback={<CardSaveFeedback feedback={cardFeedback.aiDetection} />}
						/>
					) : null
				}
			>
				{drawer?.tool === 'webSearch' ? (
					<div className="flex flex-col gap-4">
						<div>
							<label className="mb-1 block text-xs font-medium text-gray-600">
								{t('unitPrices.title', { currency: billingCurrency })}
							</label>
							<p className="mb-1 text-[10px] text-gray-500">{t('unitPrices.legend')}</p>
							<ToolPriceTripleInputs
								value={webSearchDrafts[webSearchSelected]}
								onChange={(patch) =>
									setWebSearchDrafts((prev) => ({
										...prev,
										[webSearchSelected]: { ...prev[webSearchSelected], ...patch },
									}))
								}
							/>
						</div>
						<div>
							<label className="mb-1 block text-xs font-medium text-gray-600">
								{t('webSearch.apiKey')}
							</label>
							<ApiKeyField
								value={webSearchDrafts[webSearchSelected].apiKey}
								onChange={(apiKey) =>
									setWebSearchDrafts((prev) => ({
										...prev,
										[webSearchSelected]: { ...prev[webSearchSelected], apiKey },
									}))
								}
								placeholder={t('webSearch.apiKeyPlaceholder')}
								secretsVisible={secretsVisible}
							/>
						</div>
					</div>
				) : null}
				{drawer?.tool === 'webFetch' ? (
					<div className="flex flex-col gap-4">
						<div>
							<label className="mb-1 block text-xs font-medium text-gray-600">
								{t('unitPrices.title', { currency: billingCurrency })}
							</label>
							<p className="mb-1 text-[10px] text-gray-500">{t('unitPrices.legend')}</p>
							<ToolPriceTripleInputs
								value={webFetchDrafts[webFetchSelected]}
								onChange={(patch) =>
									setWebFetchDrafts((prev) => ({
										...prev,
										[webFetchSelected]: { ...prev[webFetchSelected], ...patch },
									}))
								}
							/>
						</div>
						<div>
							<label className="mb-1 block text-xs font-medium text-gray-600">
								{t('webFetch.apiKey')}
							</label>
							<ApiKeyField
								value={webFetchDrafts[webFetchSelected].apiKey}
								onChange={(apiKey) =>
									setWebFetchDrafts((prev) => ({
										...prev,
										[webFetchSelected]: { ...prev[webFetchSelected], apiKey },
									}))
								}
								placeholder={t('webFetch.apiKeyPlaceholder')}
								secretsVisible={secretsVisible}
							/>
						</div>
					</div>
				) : null}
				{drawer?.tool === 'webDeepSearch' ? (
					<div className="flex flex-col gap-4">
						<div>
							<label className="mb-1 block text-xs font-medium text-gray-600">
								{t('unitPrices.title', { currency: billingCurrency })}
							</label>
							<p className="mb-1 text-[10px] text-gray-500">{t('unitPrices.legend')}</p>
							<ToolPriceTripleInputs
								value={webDeepSearchDrafts[webDeepSearchSelected]}
								onChange={(patch) =>
									setWebDeepSearchDrafts((prev) => ({
										...prev,
										[webDeepSearchSelected]: {
											...prev[webDeepSearchSelected],
											...patch,
										},
									}))
								}
							/>
						</div>
						<div>
							<label className="mb-1 block text-xs font-medium text-gray-600">
								{t('webDeepSearch.apiKey')}
							</label>
							<ApiKeyField
								value={webDeepSearchDrafts[webDeepSearchSelected].apiKey}
								onChange={(apiKey) =>
									setWebDeepSearchDrafts((prev) => ({
										...prev,
										[webDeepSearchSelected]: {
											...prev[webDeepSearchSelected],
											apiKey,
										},
									}))
								}
								placeholder={t('webDeepSearch.apiKeyPlaceholder')}
								secretsVisible={secretsVisible}
							/>
						</div>
					</div>
				) : null}
				{drawer?.tool === 'aiDetection' ? (
					<div className="flex flex-col gap-4">
						<div className="flex flex-col gap-4 sm:flex-row sm:items-start">
							<div className="min-w-0 flex-1">
								<label className="mb-1 block text-xs font-medium text-gray-600">
									{t('unitPrices.title', { currency: billingCurrency })}
								</label>
								<p className="mb-1 text-[10px] text-gray-500">{t('unitPrices.legend')}</p>
								<ToolPriceTripleInputs
									value={aiDraft}
									onChange={(patch) =>
										setAiDetectionDrafts((prev) => ({
											...prev,
											[aiDetectionSelected]: {
												...prev[aiDetectionSelected],
												...patch,
											},
										}))
									}
								/>
							</div>
							<div className="min-w-0 sm:w-36">
								<label className="mb-1 block text-xs font-medium text-gray-600">
									{t('aiDetection.billingUnitChars')}
								</label>
								<input
									type="number"
									min={1}
									step={1}
									value={aiDraft.billingUnitChars}
									onChange={(e) =>
										setAiDetectionDrafts((prev) => ({
											...prev,
											[aiDetectionSelected]: {
												...prev[aiDetectionSelected],
												billingUnitChars: e.target.value,
											},
										}))
									}
									className="w-full rounded-md border border-gray-300 px-2 py-1.5 font-mono text-sm shadow-sm"
								/>
							</div>
						</div>
						<div>
							<label className="mb-2 block text-xs font-medium text-gray-600">
								{t('aiDetection.credentials')}
							</label>
							<div className="flex flex-col gap-2">
								{aiFields.map((field) => (
									<div key={field} className="flex min-w-0 items-center gap-2">
										<span className="w-20 shrink-0 text-xs text-gray-500">
											{t(AI_DETECTION_FIELD_I18N[field])}
										</span>
										<input
											type={
												field === 'email'
													? 'email'
													: secretsVisible
														? 'text'
														: 'password'
											}
											value={aiDraft[field]}
											onChange={(e) =>
												setAiDetectionDrafts((prev) => ({
													...prev,
													[aiDetectionSelected]: {
														...prev[aiDetectionSelected],
														[field]: e.target.value,
													},
												}))
											}
											placeholder={t(AI_DETECTION_FIELD_I18N[field])}
											autoComplete="off"
											spellCheck={false}
											className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 font-mono text-sm text-gray-900 shadow-sm"
										/>
									</div>
								))}
								{aiDetectionSelected === 'tencent_tms' && (
									<>
										<div className="flex min-w-0 items-center gap-2">
											<span className="w-20 shrink-0 text-xs text-gray-500">
												{t('aiDetection.fields.region')}
											</span>
											<input
												type="text"
												value={aiDraft.region}
												onChange={(e) =>
													setAiDetectionDrafts((prev) => ({
														...prev,
														[aiDetectionSelected]: {
															...prev[aiDetectionSelected],
															region: e.target.value,
														},
													}))
												}
												placeholder={t('aiDetection.fields.region')}
												autoComplete="off"
												spellCheck={false}
												className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 font-mono text-sm text-gray-900 shadow-sm"
											/>
										</div>
										<div className="flex min-w-0 items-center gap-2">
											<span className="w-20 shrink-0 text-xs text-gray-500">
												{t('aiDetection.fields.bizType')}
											</span>
											<input
												type="text"
												value={aiDraft.bizType}
												onChange={(e) =>
													setAiDetectionDrafts((prev) => ({
														...prev,
														[aiDetectionSelected]: {
															...prev[aiDetectionSelected],
															bizType: e.target.value,
														},
													}))
												}
												placeholder={t('aiDetection.fields.bizTypeOptional')}
												autoComplete="off"
												spellCheck={false}
												className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 font-mono text-sm text-gray-900 shadow-sm"
											/>
										</div>
									</>
								)}
							</div>
						</div>
					</div>
				) : null}
			</ToolProviderDrawer>

			<WebSearchProviderGuideModal
				open={providerGuideOpen}
				activeProvider={webSearchSelected}
				onClose={() => setProviderGuideOpen(false)}
			/>
		</div>
	);
}
