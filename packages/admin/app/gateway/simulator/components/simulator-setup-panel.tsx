'use client';

import { useTranslations } from 'next-intl';
import { formatKeyOptionLabel, inputClass, labelClass } from '../simulator-utils';
import type { AdminKeyListItem } from '../types';

type Props = {
	proxyBaseUrl: string;
	onProxyBaseUrlChange: (v: string) => void;
	filterKeyEmail: string;
	onFilterKeyEmailChange: (v: string) => void;
	loadingKeys: boolean;
	keysError: string | null;
	keys: AdminKeyListItem[];
	keysTotal: number;
	onRefreshKeys: () => void;
	selectedKeyId: string;
	onSelectedKeyIdChange: (id: string) => void;
	revealedSk: string | null;
	revealLoading: boolean;
	revealError: string | null;
};

export function SimulatorSetupPanel({
	proxyBaseUrl,
	onProxyBaseUrlChange,
	filterKeyEmail,
	onFilterKeyEmailChange,
	loadingKeys,
	keysError,
	keys,
	keysTotal,
	onRefreshKeys,
	selectedKeyId,
	onSelectedKeyIdChange,
	revealedSk,
	revealLoading,
	revealError,
}: Props) {
	const t = useTranslations('simulator');
	const tCommon = useTranslations('common');
	const keyStatus = [
		t('keysShowing', { shown: keys.length, total: keysTotal }),
		revealLoading && selectedKeyId ? t('loadingKey') : null,
		!revealLoading && revealedSk && revealedSk.startsWith('sk-')
			? t('loadedKey', { prefix: revealedSk.slice(0, 12), suffix: revealedSk.slice(-4) })
			: null,
	]
		.filter(Boolean)
		.join(' · ');

	return (
		<section className="shrink-0 border-b border-gray-200/80 bg-white px-4 py-3 sm:px-5">
			<div className="flex flex-col gap-3 lg:flex-row lg:items-end">
				<div className="min-w-0 flex-1">
					<label className={labelClass}>{t('proxyBaseUrl')}</label>
					<input
						type="url"
						placeholder="http://127.0.0.1:8787"
						value={proxyBaseUrl}
						onChange={(e) => onProxyBaseUrlChange(e.target.value)}
						className={inputClass}
						autoComplete="off"
						title={t('localDevHint')}
					/>
				</div>
				<div className="min-w-0 flex-[1.4]">
					<label className={labelClass}>{t('apiKey')}</label>
					<select
						value={selectedKeyId}
						onChange={(e) => onSelectedKeyIdChange(e.target.value)}
						className={`${inputClass} font-mono`}
					>
						<option value="">{t('select')}</option>
						{keys.map((k) => (
							<option key={k.id} value={k.id}>
								{formatKeyOptionLabel(k)}
							</option>
						))}
					</select>
				</div>
				<div className="flex min-w-0 flex-1 items-end gap-2">
					<div className="min-w-0 flex-1">
						<label className={labelClass}>{t('emailContains')}</label>
						<input
							type="search"
							value={filterKeyEmail}
							onChange={(e) => onFilterKeyEmailChange(e.target.value)}
							placeholder={t('emailContains')}
							className={inputClass}
						/>
					</div>
					<button
						type="button"
						onClick={onRefreshKeys}
						disabled={loadingKeys}
						className="shrink-0 rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
					>
						{loadingKeys ? tCommon('refreshing') : t('refreshList')}
					</button>
				</div>
			</div>
			<p className="mt-2 truncate text-xs text-gray-500" title={keyStatus}>
				{keyStatus}
			</p>
			{keysError ? (
				<div className="mt-1 rounded border border-red-100 bg-red-50 px-2 py-1 text-xs text-red-600">{keysError}</div>
			) : null}
			{revealError ? <div className="mt-1 text-xs text-red-600">{revealError}</div> : null}
		</section>
	);
}
