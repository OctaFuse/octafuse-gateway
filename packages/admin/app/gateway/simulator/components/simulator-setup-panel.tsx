'use client';

import { useTranslations } from 'next-intl';
import type { SimulatorGeminiAction, SimulatorProtocol } from '@/lib/simulator/endpoint';
import { formatKeyOptionLabel, inputClass, labelClass, panelClass } from '../simulator-utils';
import type { AdminKeyListItem } from '../types';

type Props = {
	proxyBaseUrl: string;
	onProxyBaseUrlChange: (v: string) => void;
	protocol: SimulatorProtocol;
	onProtocolChange: (p: SimulatorProtocol) => void;
	/** Image-generation catalog models: only openai /images/generations is supported. */
	lockOpenaiForImage?: boolean;
	geminiAction: SimulatorGeminiAction;
	onGeminiActionChange: (a: SimulatorGeminiAction) => void;
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
	protocol,
	onProtocolChange,
	lockOpenaiForImage = false,
	geminiAction,
	onGeminiActionChange,
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

	return (
		<div className="space-y-4">
			<section className={panelClass}>
				<h2 className="text-sm font-semibold text-gray-900">{t('connection')}</h2>
				<div>
					<label className={labelClass}>{t('proxyBaseUrl')}</label>
					<input
						type="url"
						placeholder="https://your-proxy.example.com"
						value={proxyBaseUrl}
						onChange={(e) => onProxyBaseUrlChange(e.target.value)}
						className={inputClass}
						autoComplete="off"
					/>
					<p className="mt-1.5 text-xs text-amber-800/90">{t('localDevHint')}</p>
				</div>
				<div>
					<label className={labelClass}>{t('protocol')}</label>
					<div className="flex flex-wrap gap-3 pt-1 text-sm">
						{(['openai', 'anthropic', 'gemini'] as const).map((p) => {
							const disabled = lockOpenaiForImage && p !== 'openai';
							return (
								<label
									key={p}
									className={`inline-flex items-center gap-2 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
								>
									<input
										type="radio"
										name="simProtocol"
										checked={protocol === p}
										disabled={disabled}
										onChange={() => onProtocolChange(p)}
										className="text-blue-600 focus:ring-blue-500"
									/>
									{p}
								</label>
							);
						})}
					</div>
					{lockOpenaiForImage ? (
						<p className="mt-1.5 text-xs text-amber-800/90">{t('protocolLockedImage')}</p>
					) : null}
				</div>
				{protocol === 'gemini' && !lockOpenaiForImage ? (
					<fieldset className="flex flex-wrap items-center gap-3 text-sm border border-gray-200 rounded-md px-3 py-2">
						<legend className="sr-only">{t('geminiAction')}</legend>
						<span className="text-gray-600 font-medium">{t('geminiAction')}</span>
						<label className="inline-flex items-center gap-2 cursor-pointer">
							<input
								type="radio"
								name="geminiActionSim"
								className="text-blue-600 focus:ring-blue-500"
								checked={geminiAction === 'generateContent'}
								onChange={() => onGeminiActionChange('generateContent')}
							/>
							generateContent
						</label>
						<label className="inline-flex items-center gap-2 cursor-pointer">
							<input
								type="radio"
								name="geminiActionSim"
								checked={geminiAction === 'streamGenerateContent'}
								onChange={() => onGeminiActionChange('streamGenerateContent')}
							/>
							streamGenerateContent
						</label>
					</fieldset>
				) : null}
			</section>

			<section className={panelClass}>
				<h2 className="text-sm font-semibold text-gray-900">{t('apiKey')}</h2>
				<div>
					<label className={labelClass}>{t('emailContains')}</label>
					<input
						type="text"
						value={filterKeyEmail}
						onChange={(e) => onFilterKeyEmailChange(e.target.value)}
						className={inputClass}
					/>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<button
						type="button"
						onClick={onRefreshKeys}
						disabled={loadingKeys}
						className="px-3 py-1.5 text-sm rounded-md border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
					>
						{loadingKeys ? tCommon('refreshing') : t('refreshList')}
					</button>
					<span className="text-xs text-gray-500">
						{t('keysShowing', { shown: keys.length, total: keysTotal })}
						{keysTotal > keys.length ? t('keysLimitHint') : ''}
					</span>
				</div>
				{keysError ? (
					<div className="p-2 text-sm text-red-600 bg-red-50 rounded border border-red-100">{keysError}</div>
				) : null}
				<div>
					<label className={labelClass}>{t('apiKeyRowId')}</label>
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
					<div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
						{revealLoading && selectedKeyId ? <span>{t('loadingKey')}</span> : null}
						{!revealLoading && revealedSk && revealedSk.startsWith('sk-') ? (
							<span className="font-mono text-gray-700 break-all">
								{t('loadedKey', { prefix: revealedSk.slice(0, 12), suffix: revealedSk.slice(-4) })}
							</span>
						) : null}
					</div>
				</div>
				{revealError ? <div className="text-sm text-red-600">{revealError}</div> : null}
			</section>
		</div>
	);
}
