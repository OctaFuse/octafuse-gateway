'use client';

/**
 * Tools 配置：产品工具（`/v1/tools/*`）的引擎、密钥与单价；写入 `system_config`。
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ConfigCardShell } from '@/components/ConfigCardShell';
import { readApiJson } from '@/lib/api-json';
import type { SystemConfigRow } from '@/lib/types';
import {
	DEFAULT_WEB_SEARCH_COST,
	DEFAULT_WEB_SEARCH_PROVIDER,
	getWebSearchProviderOptions,
	WEB_SEARCH_API_KEY_KEY,
	WEB_SEARCH_COST_KEY,
	WEB_SEARCH_PROVIDER_KEY,
	WEB_SEARCH_PROVIDERS,
	type WebSearchProvider,
} from '@/lib/web-search-options';

function syncWebSearchUi(
	rows: SystemConfigRow[],
	setProvider: (v: WebSearchProvider) => void,
	setApiKey: (v: string) => void,
	setCost: (v: string) => void
) {
	const providerRaw = rows.find((r) => r.key === WEB_SEARCH_PROVIDER_KEY)?.value?.trim().toLowerCase() ?? '';
	setProvider(
		(WEB_SEARCH_PROVIDERS as readonly string[]).includes(providerRaw)
			? (providerRaw as WebSearchProvider)
			: DEFAULT_WEB_SEARCH_PROVIDER
	);
	setApiKey(rows.find((r) => r.key === WEB_SEARCH_API_KEY_KEY)?.value ?? '');
	const costRaw = rows.find((r) => r.key === WEB_SEARCH_COST_KEY)?.value?.trim() ?? '';
	setCost(costRaw || String(DEFAULT_WEB_SEARCH_COST));
}

export default function GatewayToolsConfigPage() {
	const t = useTranslations('tools');
	const tCommon = useTranslations('common');
	const webSearchProviderOptions = getWebSearchProviderOptions((k) => t(k));

	const [isLoading, setIsLoading] = useState(true);
	const [saveError, setSaveError] = useState('');
	const [saveSuccess, setSaveSuccess] = useState('');
	const saveSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const [webSearchProvider, setWebSearchProvider] = useState<WebSearchProvider>(DEFAULT_WEB_SEARCH_PROVIDER);
	const [webSearchApiKeyDraft, setWebSearchApiKeyDraft] = useState('');
	const [webSearchApiKeyVisible, setWebSearchApiKeyVisible] = useState(false);
	const [webSearchCostDraft, setWebSearchCostDraft] = useState(String(DEFAULT_WEB_SEARCH_COST));
	const [webSearchSaving, setWebSearchSaving] = useState(false);

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
				syncWebSearchUi(data.data, setWebSearchProvider, setWebSearchApiKeyDraft, setWebSearchCostDraft);
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

	const handleSaveWebSearch = async () => {
		if (!(WEB_SEARCH_PROVIDERS as readonly string[]).includes(webSearchProvider)) {
			clearSaveSuccess();
			setSaveError(t('errors.invalidWebSearchProvider'));
			return;
		}
		const costRaw = webSearchCostDraft.trim();
		const costNum = Number(costRaw);
		if (!costRaw || !Number.isFinite(costNum) || costNum < 0) {
			clearSaveSuccess();
			setSaveError(t('errors.invalidWebSearchCost'));
			return;
		}
		const apiKey = webSearchApiKeyDraft.trim();
		setSaveError('');
		clearSaveSuccess();
		setWebSearchSaving(true);
		try {
			const puts: Array<{ key: string; value: string }> = [
				{ key: WEB_SEARCH_PROVIDER_KEY, value: webSearchProvider },
				{ key: WEB_SEARCH_COST_KEY, value: String(costNum) },
				{ key: WEB_SEARCH_API_KEY_KEY, value: apiKey },
			];
			let successMessage: string | undefined;
			for (const body of puts) {
				const response = await fetch('/api/admin/config', {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body),
				});
				const data = await readApiJson(response);
				if (!data.success) {
					clearSaveSuccess();
					setSaveError(data.message || tCommon('saveFailed'));
					return;
				}
				successMessage = data.message;
			}
			setWebSearchCostDraft(String(costNum));
			flashSaveSuccess(successMessage);
		} catch {
			clearSaveSuccess();
			setSaveError(tCommon('requestFailed'));
		} finally {
			setWebSearchSaving(false);
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

			<ConfigCardShell
				id="web-search"
				title={t('webSearch.title')}
				description={t('webSearch.description')}
			>
				<div className="flex flex-col gap-4">
					<div className="flex flex-wrap items-end gap-3">
						<div>
							<label className="mb-1 block text-xs font-medium text-gray-600">{t('webSearch.provider')}</label>
							<select
								value={webSearchProvider}
								onChange={(e) => setWebSearchProvider(e.target.value as WebSearchProvider)}
								className="min-w-[16rem] rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm"
							>
								{webSearchProviderOptions.map((o) => (
									<option key={o.value} value={o.value}>
										{o.label}
									</option>
								))}
							</select>
						</div>
						<div className="min-w-[8rem]">
							<label htmlFor="web-search-cost" className="mb-1 block text-xs font-medium text-gray-600">
								{t('webSearch.cost')}
							</label>
							<input
								id="web-search-cost"
								type="number"
								min={0}
								step="0.0001"
								value={webSearchCostDraft}
								onChange={(e) => setWebSearchCostDraft(e.target.value)}
								className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm shadow-sm"
							/>
						</div>
					</div>
					<div className="min-w-[12rem] max-w-xl">
						<div className="mb-1 flex items-center justify-between gap-2">
							<label htmlFor="web-search-api-key" className="block text-xs font-medium text-gray-600">
								{t('webSearch.apiKey')}{' '}
								<span className="ml-1 text-[11px] font-normal text-gray-400">{tCommon('optional')}</span>
							</label>
							<button
								type="button"
								onClick={() => setWebSearchApiKeyVisible((v) => !v)}
								className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50"
								aria-pressed={webSearchApiKeyVisible}
							>
								{webSearchApiKeyVisible ? (
									<>
										<EyeSlashIcon className="h-4 w-4" aria-hidden />
										{tCommon('hide')}
									</>
								) : (
									<>
										<EyeIcon className="h-4 w-4" aria-hidden />
										{tCommon('show')}
									</>
								)}
							</button>
						</div>
						<input
							id="web-search-api-key"
							type={webSearchApiKeyVisible ? 'text' : 'password'}
							value={webSearchApiKeyDraft}
							onChange={(e) => setWebSearchApiKeyDraft(e.target.value)}
							placeholder={t('webSearch.apiKeyPlaceholder')}
							autoComplete="new-password"
							className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 shadow-sm"
						/>
						<p className="mt-1 text-xs text-gray-500">{t('webSearch.apiKeyHint')}</p>
					</div>
					<button
						type="button"
						onClick={() => void handleSaveWebSearch()}
						disabled={webSearchSaving}
						className="self-start rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
					>
						{webSearchSaving ? tCommon('saving') : t('config.saveWebSearch')}
					</button>
				</div>
			</ConfigCardShell>
		</div>
	);
}
