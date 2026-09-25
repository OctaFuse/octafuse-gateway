'use client';

import {
	CheckIcon,
	ClipboardDocumentIcon,
	PowerIcon,
	PencilSquareIcon,
	ShareIcon,
} from '@heroicons/react/24/outline';
import { useLocale, useTranslations } from 'next-intl';
import { VendorIcon } from '@/components/model-vendor-icon';
import { formatProviderAccountLabel, providerKindDisplayLabel } from '@/lib/provider-kind';
import type { GatewayProvider, ProviderKeyStatusKind } from '../types';
import { getProviderKeyStatus, getProviderProtocolSummaries } from '../provider-utils';
import { ProviderCatalogOutboundLink } from './provider-catalog-outbound-link';
import { ProviderProtocolIcon } from './provider-protocol-icon';
import { ProviderQuotaButton } from './provider-quota-popover';

type ProviderCardProps = {
	provider: GatewayProvider;
	copiedId: string | null;
	statusTogglingId: string | null;
	onEdit: (provider: GatewayProvider) => void;
	onToggleStatus: (provider: GatewayProvider) => void;
	onCopyApiKey: (provider: GatewayProvider) => void;
};

const CARD_SHELL: Record<ProviderKeyStatusKind, string> = {
	key_set: 'border-slate-200 bg-white hover:border-blue-300',
	no_key: 'border-rose-200 bg-white hover:border-rose-300',
	pending: 'border-amber-300 bg-amber-50 hover:border-amber-400',
	disabled: 'border-slate-300 bg-slate-200/80 hover:border-slate-400',
};

const CARD_FOOTER: Record<ProviderKeyStatusKind, string> = {
	key_set: 'border-slate-100 bg-slate-50/70',
	no_key: 'border-slate-100 bg-slate-50/70',
	pending: 'border-amber-200 bg-amber-100/70',
	disabled: 'border-slate-300/70 bg-slate-200',
};

const STATUS_BADGE: Record<ProviderKeyStatusKind, string> = {
	key_set: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
	no_key: 'bg-rose-100 text-rose-800 ring-rose-200',
	pending: 'bg-amber-700 text-white ring-amber-700',
	disabled: 'bg-slate-600 text-white ring-slate-600',
};

const STATUS_DOT: Record<ProviderKeyStatusKind, string> = {
	key_set: 'bg-emerald-500',
	pending: 'bg-amber-200',
	no_key: 'bg-rose-500',
	disabled: 'bg-slate-200',
};

function routeUsageClass(routesCount: number, activeRoutesCount: number): string {
	if (routesCount <= 0) return 'text-slate-500';
	if (activeRoutesCount > 0) return 'text-emerald-700';
	return 'text-amber-800';
}

export function ProviderCard(props: ProviderCardProps) {
	const {
		provider,
		copiedId,
		statusTogglingId,
		onEdit,
		onToggleStatus,
		onCopyApiKey,
	} = props;

	const t = useTranslations('providers.card');
	const tKind = useTranslations('providers.kind');
	const tCommon = useTranslations('common');
	const locale = useLocale();

	const protocols = getProviderProtocolSummaries(provider);
	const isActive = provider.status !== 'disabled';
	const keyStatus = isActive ? getProviderKeyStatus(provider) : 'disabled';
	const canCopyKey = keyStatus === 'key_set';
	const apiKeyFeedbackId = `provider-api-key:${provider.id}`;
	const routesCount = Number(provider.routes_count ?? 0);
	const activeRoutesCount = Number(provider.active_routes_count ?? 0);
	const routesLabel =
		routesCount === 1
			? t('routes', { count: routesCount })
			: t('routesPlural', { count: routesCount });

	const routeTitle =
		routesCount <= 0
			? t('noRoutes')
			: t('routesTitle', {
					routes: routesLabel,
					active: t('activeRoutes', { count: activeRoutesCount }),
				});

	const kindLabel = providerKindDisplayLabel(provider, locale, tKind('custom'));
	const showKind = Boolean(
		kindLabel && kindLabel.trim().toLowerCase() !== provider.name.trim().toLowerCase()
	);
	const accountTitle = formatProviderAccountLabel(provider.name, kindLabel);
	const statusLabel =
		keyStatus === 'key_set'
			? t('keySet')
			: keyStatus === 'pending'
				? t('pending')
				: keyStatus === 'no_key'
					? t('noKey')
					: t('disabled');

	return (
		<article
			className={`group relative flex min-w-0 flex-col gap-3 rounded-xl border p-4 shadow-sm transition-[border-color,box-shadow] hover:shadow-md ${CARD_SHELL[keyStatus]}`}
			data-provider-status={isActive ? 'active' : 'disabled'}
		>
			<button
				type="button"
				onClick={() => onEdit(provider)}
				className="absolute inset-0 z-0 cursor-pointer rounded-xl bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
				title={t('editProvider', { name: accountTitle })}
				aria-label={t('editProvider', { name: accountTitle })}
			/>

			<div className="pointer-events-none relative z-10 flex min-h-[2.625rem] items-start gap-3">
				<VendorIcon
					vendor={provider.vendor_key}
					iconKey={provider.icon_key}
					size="default"
					className={`shrink-0 ${isActive ? '' : 'opacity-60 grayscale'}`}
				/>
				<div className="min-w-0 flex-1">
					<h2
						className={`truncate text-sm font-semibold leading-5 ${isActive ? 'text-gray-900' : 'text-slate-600'}`}
						title={accountTitle}
					>
						{provider.name}
					</h2>
					{showKind ? (
						<p className="mt-0.5 truncate text-xs leading-5 text-slate-500" title={kindLabel ?? undefined}>
							{kindLabel}
						</p>
					) : null}
				</div>
				<button
					type="button"
					role="switch"
					aria-checked={isActive}
					disabled={statusTogglingId === provider.id}
					onClick={(event) => {
						event.stopPropagation();
						void onToggleStatus(provider);
					}}
					className={`pointer-events-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-50 ${
						isActive
							? 'bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100'
							: 'bg-rose-50 text-rose-700 ring-rose-300 hover:bg-rose-100'
					}`}
					title={isActive ? t('providerEnabled') : t('providerDisabled')}
					aria-label={isActive ? t('providerEnabled') : t('providerDisabled')}
				>
					<PowerIcon className="h-4 w-4" aria-hidden />
				</button>
			</div>

			<div
				className="pointer-events-none relative z-10 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5"
				title={routeTitle}
			>
				<ShareIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
				<span className="text-slate-600">{routesCount <= 0 ? t('noRoutes') : routesLabel}</span>
				{routesCount > 0 ? (
					<>
						<span className="text-slate-300" aria-hidden>·</span>
						<span className={`font-medium tabular-nums ${isActive ? routeUsageClass(routesCount, activeRoutesCount) : 'text-slate-500'}`}>
							{t('activeRoutes', { count: activeRoutesCount })}
						</span>
					</>
				) : null}
			</div>

			<div className="pointer-events-none relative z-10 min-w-0 flex-1">
				{protocols.length > 0 ? (
					<div className="flex flex-wrap gap-1.5">
						{protocols.map((protocol) => {
							const badgeLabels = protocol.badges.map((badge) => t(`cap.${badge}`));
							const capabilitySummary =
								badgeLabels.length > 0
									? badgeLabels.join(' · ')
									: t('endpointCount', { count: protocol.endpoints.length });

							return (
								<span
									key={protocol.key}
									className={`inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] leading-4 ${
										isActive
											? 'border-slate-200 bg-slate-50 text-slate-600'
											: 'border-slate-200 bg-slate-100/60 text-slate-500 grayscale'
									}`}
									title={`${protocol.label} · ${capabilitySummary}`}
								>
									<span className="h-3.5 w-3.5 shrink-0">
										<ProviderProtocolIcon protocol={protocol.key} />
									</span>
									<span className="shrink-0 font-medium">{protocol.label}</span>
									{badgeLabels.length > 0 ? (
										<span className="min-w-0 truncate border-l border-slate-200 pl-1.5 text-slate-500">
											{badgeLabels.slice(0, 2).join(' · ')}
											{badgeLabels.length > 2 ? ` +${badgeLabels.length - 2}` : ''}
										</span>
									) : null}
								</span>
							);
						})}
					</div>
				) : (
					<span
						className={`inline-flex rounded-md border border-dashed px-2 py-1 text-xs ${
							isActive
								? 'border-gray-200 bg-white text-gray-400'
								: 'border-slate-300 bg-slate-50 text-slate-500'
						}`}
					>
						{t('noEndpoint')}
					</span>
				)}
			</div>

			<div className={`pointer-events-none relative z-10 -mx-4 -mb-4 mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-b-xl border-t px-4 py-2 ${CARD_FOOTER[keyStatus]}`}>
				<div className="flex min-w-0 items-center gap-2">
					<span
						className={`inline-flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium ring-1 ring-inset ${STATUS_BADGE[keyStatus]}`}
					>
						<span
							className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[keyStatus]}`}
							aria-hidden
						/>
						<span className="truncate">{statusLabel}</span>
					</span>
					{canCopyKey ? (
						<button
							type="button"
							onClick={(event) => {
								event.stopPropagation();
								void onCopyApiKey(provider);
							}}
							className="pointer-events-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-slate-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
							title={copiedId === apiKeyFeedbackId ? tCommon('copied') : t('copyApiKey')}
							aria-label={copiedId === apiKeyFeedbackId ? tCommon('copied') : t('copyApiKey')}
						>
							{copiedId === apiKeyFeedbackId ? (
								<CheckIcon className="h-4 w-4 text-emerald-600" aria-hidden />
							) : (
								<ClipboardDocumentIcon className="h-4 w-4" aria-hidden />
							)}
						</button>
					) : null}
					{(keyStatus === 'no_key' || keyStatus === 'pending') && (
						<ProviderCatalogOutboundLink
							links={provider.catalog_links}
							stopPropagation
							className="pointer-events-auto inline-flex min-w-0 items-center gap-1 text-[11px] font-medium text-blue-700 hover:text-blue-800"
						/>
					)}
				</div>
				<div className="pointer-events-auto ml-auto flex items-center gap-1">
					{provider.quota_supported && !provider.has_pending_key ? (
						<ProviderQuotaButton providerId={provider.id} />
					) : null}
					<button
						type="button"
						onClick={() => onEdit(provider)}
						className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-white hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
						title={t('editProvider', { name: accountTitle })}
						aria-label={t('editProvider', { name: accountTitle })}
					>
						<PencilSquareIcon className="h-4 w-4" aria-hidden />
					</button>
				</div>
			</div>
		</article>
	);
}
