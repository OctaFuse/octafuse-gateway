'use client';

import { AdminInspector } from '@/components/admin-inspector';
import { ArrowPathIcon, KeyIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { formatKeyOptionLabel, inputClass, labelClass } from '../simulator-utils';
import type { AdminKeyListItem } from '../types';

type Props = {
	disabled: boolean;
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
	disabled,
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

	const keySelect = (id: string) => (
		<div className="min-w-0 flex-1">
			<label htmlFor={id} className={labelClass}>
				{t('apiKey')}
			</label>
			<select
				id={id}
				disabled={disabled}
				value={selectedKeyId}
				onChange={(event) => onSelectedKeyIdChange(event.target.value)}
				className={inputClass}
			>
				<option value="">{t('select')}</option>
				{selectedKeyId && !keys.some((key) => key.id === selectedKeyId) && (
					<option value={selectedKeyId}>
						{t('selectedKeyOutsideFilter', { id: selectedKeyId.slice(0, 8) })}
					</option>
				)}
				{keys.map((key) => (
					<option key={key.id} value={key.id}>
						{formatKeyOptionLabel(key)}
					</option>
				))}
			</select>
		</div>
	);
	return (
		<section aria-label={t('connection')} className="shrink-0 rounded-xl border border-gray-200 bg-white p-4">
			<div className="flex flex-wrap items-end gap-3">
				<div className="min-w-0 flex-1 basis-64">
					<label htmlFor="simulator-proxy" className={labelClass}>
						{t('proxyBaseUrl')}
					</label>
					<input
						id="simulator-proxy"
						type="url"
						disabled={disabled}
						placeholder="http://127.0.0.1:8787"
						value={proxyBaseUrl}
						onChange={(event) => onProxyBaseUrlChange(event.target.value)}
						className={inputClass}
						autoComplete="off"
						title={t('localDevHint')}
					/>
				</div>
				<div className="min-w-0 flex-[1.4] basis-72">{keySelect('simulator-key')}</div>
				<AdminInspector label={t('keyFilters')} size="md">
					<div className="flex items-end gap-2">
						<div className="min-w-0 flex-1">
							<label htmlFor="simulator-key-email" className={labelClass}>
								{t('emailContains')}
							</label>
							<input
								id="simulator-key-email"
								type="search"
								disabled={disabled}
								value={filterKeyEmail}
								onChange={(event) => onFilterKeyEmailChange(event.target.value)}
								className={inputClass}
							/>
						</div>
						<button
							type="button"
							disabled={disabled || loadingKeys}
							onClick={onRefreshKeys}
							className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-gray-200 px-3 text-xs text-gray-600 disabled:opacity-50"
						>
							<ArrowPathIcon className={`h-4 w-4 ${loadingKeys ? 'animate-spin' : ''}`} aria-hidden />
							{loadingKeys ? tCommon('refreshing') : t('refreshList')}
						</button>
					</div>
					{keySelect('simulator-filtered-key')}
					<p role="status" className="text-xs text-gray-500">
						{t('keysShowing', { shown: keys.length, total: keysTotal })}
					</p>
					{keysError && (
						<p role="alert" className="text-xs text-red-700">
							{keysError}
						</p>
					)}
				</AdminInspector>
			</div>
			<div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
				{selectedKeyId && (
					<span
						role="status"
						className={`inline-flex items-center gap-1.5 ${
							revealedSk && !revealLoading ? 'text-emerald-700' : ''
						}`}
					>
						<KeyIcon className="h-3.5 w-3.5" aria-hidden />
						{revealLoading ? t('loadingKey') : revealedSk ? t('keyReady') : t('errSelectKey')}
					</span>
				)}
				{keysError && (
					<span role="alert" className="text-red-700">
						{keysError}
					</span>
				)}
				{revealError && (
					<span role="alert" className="text-red-700">
						{revealError}
					</span>
				)}
			</div>
		</section>
	);
}
