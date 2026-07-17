'use client';

import {
	CheckIcon,
	ChevronDownIcon,
	ClipboardDocumentIcon,
	ExclamationTriangleIcon,
	PlusIcon,
} from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { PROVIDER_KEY_LABEL_MAX_LENGTH } from '@/lib/provider-key-label';
import type { GatewayProvider, ProviderKeyRow } from '../types';
import { formatLimitConfig, getProviderProtocolSummaries, sortProviderKeyRows } from '../provider-utils';
import { ProviderProtocolIcon } from './provider-protocol-icon';

type ProviderCardProps = {
	provider: GatewayProvider;
	copiedId: string | null;
	isExpanded: boolean;
	previewRows: ProviderKeyRow[];
	previewError?: string;
	isPreviewLoading: boolean;
	providerKeyTogglingId: string | null;
	onEdit: (provider: GatewayProvider) => void;
	onCopyEndpoint: (text: string, feedbackId: string) => void;
	onToggleKeyPreview: (providerId: string) => void;
	onAddKey: (provider: GatewayProvider) => void;
	onEditKey: (providerId: string, key: ProviderKeyRow) => void;
	onToggleKeyStatus: (key: ProviderKeyRow, providerId: string) => void;
	onCopyKey: (key: ProviderKeyRow) => void;
};

export function ProviderCard(props: ProviderCardProps) {
	const {
		provider,
		copiedId,
		isExpanded,
		previewRows,
		previewError,
		isPreviewLoading,
		providerKeyTogglingId,
		onEdit,
		onCopyEndpoint,
		onToggleKeyPreview,
		onAddKey,
		onEditKey,
		onToggleKeyStatus,
		onCopyKey,
	} = props;

	const t = useTranslations('providers.card');
	const tUpstream = useTranslations('upstream');
	const tCommon = useTranslations('common');

	const protocols = getProviderProtocolSummaries(provider);
	const pendingKey = Boolean(provider.has_pending_key);
	const activeKeyCount = provider.active_key_count ?? 0;
	const inactiveKeyCount = previewRows.filter((key) => key.status !== 'active').length;

	return (
		<article
			role="button"
			tabIndex={0}
			onClick={() => onEdit(provider)}
			onKeyDown={(e) => {
				if (e.target !== e.currentTarget) return;
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					onEdit(provider);
				}
			}}
			className={
				'relative cursor-pointer overflow-hidden rounded-xl border bg-white shadow-md shadow-slate-200/70 ring-1 ring-black/[0.03] transition-all duration-200 ease-out hover:-translate-y-1 hover:border-blue-300 hover:bg-blue-50/30 hover:shadow-xl hover:shadow-blue-100/80 hover:ring-1 hover:ring-blue-200 focus:outline-none focus-visible:border-blue-400 focus-visible:bg-blue-50/30 focus-visible:shadow-lg focus-visible:ring-2 focus-visible:ring-blue-500 active:translate-y-0 ' +
				(pendingKey
					? 'border-amber-300 ring-amber-100'
					: activeKeyCount === 0
						? 'border-red-300 ring-red-100'
						: 'border-slate-200')
			}
		>
			<div
				aria-hidden
				className={
					'h-1 w-full ' +
					(pendingKey ? 'bg-amber-300' : activeKeyCount === 0 ? 'bg-red-300' : 'bg-slate-200')
				}
			/>
			<div className="flex min-h-[5.75rem] flex-col p-3">
				<div className="min-h-[2.75rem] min-w-0">
					<div className="flex min-w-0 items-start gap-2">
						<div className="min-w-0 flex-1">
							<h2 className="truncate text-base font-semibold leading-6 text-gray-900" title={provider.name}>
								{provider.name}
							</h2>
							<div className="mt-0.5 flex min-w-0 items-center gap-2">
								<span className="truncate font-mono text-[11px] leading-4 text-gray-500" title={provider.id}>
									{provider.id}
								</span>
							</div>
						</div>
						<div className="flex shrink-0 flex-wrap justify-end gap-1">
							{pendingKey && (
								<span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">
									<ExclamationTriangleIcon className="h-3.5 w-3.5" aria-hidden />
									{t('pending')}
								</span>
							)}
							{activeKeyCount === 0 && (
								<span className="inline-flex items-center gap-1 rounded-md bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-800">
									<ExclamationTriangleIcon className="h-3.5 w-3.5" aria-hidden />
									{t('noKey')}
								</span>
							)}
						</div>
					</div>
				</div>

				<div className="mt-2 flex min-h-[2rem] items-start">
					{protocols.length > 0 ? (
						<div className="flex w-full flex-wrap items-start gap-2">
							{protocols.map((protocol) => {
								const feedbackId = `endpoint:${provider.id}:${protocol.key}`;
								const badgeLabels = protocol.badges.map((badge) => t(`cap.${badge}`));
								const capabilitiesTitle =
									protocol.capabilities.length > 0
										? t('capabilitiesTitle', {
												label: protocol.label,
												caps: protocol.capabilities.join(', '),
												url: protocol.url,
											})
										: tUpstream('endpointCopyTitle', { label: protocol.label, url: protocol.url });
								return (
									<div key={protocol.key} className="inline-flex max-w-full items-center gap-1">
										<button
											type="button"
											onClick={(e) => {
												e.stopPropagation();
												void onCopyEndpoint(protocol.url, feedbackId);
											}}
											className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
											title={capabilitiesTitle}
										>
											{copiedId === feedbackId ? (
												<CheckIcon className="h-4 w-4 shrink-0 text-green-600" aria-hidden />
											) : (
												<ProviderProtocolIcon protocol={protocol.key} />
											)}
											<span className="sr-only">{protocol.label}</span>
										</button>
										{protocol.badges.length > 0 && (
											<div
												className="flex min-w-0 flex-wrap gap-0.5"
												title={capabilitiesTitle}
											>
												{protocol.badges.map((badge) => (
													<span
														key={badge}
														className="rounded bg-slate-100 px-1 py-0.5 text-[10px] font-medium leading-3 text-slate-600"
													>
														{t(`cap.${badge}`)}
													</span>
												))}
												<span className="sr-only">
													{t('capabilitiesSr', {
														label: protocol.label,
														caps: badgeLabels.join(', '),
													})}
												</span>
											</div>
										)}
									</div>
								);
							})}
						</div>
					) : (
						<div className="rounded-md border border-dashed border-gray-200 px-2 py-1.5 text-xs text-gray-400">
							{t('noEndpoint')}
						</div>
					)}
				</div>
			</div>

			<div className="border-t border-gray-100 bg-gray-50/70 px-3 py-1.5">
				<div className="flex items-center gap-1.5">
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							void onToggleKeyPreview(provider.id);
						}}
						className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-md px-1 py-0.5 text-left focus:outline-none focus:ring-2 focus:ring-blue-500"
						aria-expanded={isExpanded}
					>
						<span className="min-w-0 truncate text-xs font-medium text-gray-800">
							{t('keysActive', { count: activeKeyCount })}
							{(previewRows.length > 0 || isExpanded) && (
								<span className="ml-2 font-normal text-gray-500">
									{t('keysTotal', { count: previewRows.length })}
									{inactiveKeyCount > 0 ? t('keysInactive', { count: inactiveKeyCount }) : ''}
								</span>
							)}
						</span>
						<ChevronDownIcon
							className={`h-5 w-5 shrink-0 text-gray-500 transition ${isExpanded ? 'rotate-180' : ''}`}
							aria-hidden
						/>
					</button>
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							onAddKey(provider);
						}}
						className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-white hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
						title={t('addKeyFor', { name: provider.name })}
						aria-label={t('addKeyFor', { name: provider.name })}
					>
						<PlusIcon className="h-4 w-4" aria-hidden />
					</button>
				</div>

				{isExpanded && (
					<div className="mt-2" onClick={(e) => e.stopPropagation()}>
						{isPreviewLoading ? (
							<div className="py-3 text-sm text-gray-500">{tCommon('loadingEllipsis')}</div>
						) : previewError ? (
							<div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
								{previewError}
							</div>
						) : previewRows.length === 0 ? (
							<div className="rounded-md border border-dashed border-gray-200 bg-white px-3 py-3 text-sm text-gray-500">
								{t('noKeysConfigured')}
							</div>
						) : (
							<div className="space-y-2">
								{sortProviderKeyRows(previewRows).map((key) => (
									<div
										key={key.id}
										role="button"
										tabIndex={0}
										onClick={() => onEditKey(provider.id, key)}
										onKeyDown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												onEditKey(provider.id, key);
											}
										}}
										className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1.5 transition hover:border-blue-200 hover:bg-blue-50/40"
									>
										<input
											type="checkbox"
											checked={key.status === 'active'}
											disabled={providerKeyTogglingId === key.id}
											onClick={(e) => e.stopPropagation()}
											onChange={() => void onToggleKeyStatus(key, provider.id)}
											className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
											aria-label={
												key.status === 'active'
													? t('keyEnabled', { label: key.label })
													: t('keyDisabled', { label: key.label })
											}
										/>
										<span
											className="truncate font-mono text-xs font-semibold leading-4 text-gray-900"
											style={{ width: `${PROVIDER_KEY_LABEL_MAX_LENGTH}ch` }}
											title={key.label}
										>
											{key.label}
										</span>
										<div className="flex min-w-0 items-center justify-start gap-1.5">
											<span
												className="min-w-0 max-w-full truncate font-mono text-[11px] leading-4 text-gray-500"
												title={key.masked_api_key}
											>
												{key.masked_api_key}
											</span>
											<button
												type="button"
												onClick={(e) => {
													e.stopPropagation();
													void onCopyKey(key);
												}}
												className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
												title={
													copiedId === `provider-key:${key.id}`
														? tCommon('copied')
														: t('copyKey', { label: key.label })
												}
												aria-label={
													copiedId === `provider-key:${key.id}`
														? t('copiedKey', { label: key.label })
														: t('copyKey', { label: key.label })
												}
											>
												{copiedId === `provider-key:${key.id}` ? (
													<CheckIcon className="h-4 w-4 text-green-600" aria-hidden />
												) : (
													<ClipboardDocumentIcon className="h-4 w-4" aria-hidden />
												)}
											</button>
										</div>
										<div className="flex shrink-0 flex-wrap items-center justify-end gap-1 text-[11px] text-gray-600">
											{key.is_pending_import && (
												<span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900">
													{t('placeholder')}
												</span>
											)}
											{copiedId === `provider-key:${key.id}` && (
												<span className="rounded-md bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-800">
													{tCommon('copied')}
												</span>
											)}
											<span className="rounded-md bg-gray-100 px-1.5 py-0.5">P {key.priority}</span>
											<span className="rounded-md bg-gray-100 px-1.5 py-0.5">W {key.weight}</span>
											<span className="rounded-md bg-gray-100 px-1.5 py-0.5">
												{formatLimitConfig(key.limit_config)}
											</span>
										</div>
									</div>
								))}
							</div>
						)}
					</div>
				)}
			</div>
		</article>
	);
}
