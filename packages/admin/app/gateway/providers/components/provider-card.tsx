'use client';

import {
	CheckIcon,
	ClipboardDocumentIcon,
	PowerIcon,
} from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { VendorIcon } from '@/components/model-vendor-icon';
import type { GatewayProvider, ProviderKeyStatusKind } from '../types';
import { getProviderKeyStatus, getProviderProtocolSummaries } from '../provider-utils';
import { ProviderCatalogOutboundLink } from './provider-catalog-outbound-link';
import { ProviderProtocolIcon } from './provider-protocol-icon';

type ProviderCardProps = {
	provider: GatewayProvider;
	copiedId: string | null;
	statusTogglingId: string | null;
	onEdit: (provider: GatewayProvider) => void;
	onToggleStatus: (provider: GatewayProvider) => void;
	onCopyApiKey: (provider: GatewayProvider) => void;
};

const CARD_SHELL: Record<ProviderKeyStatusKind, string> = {
	key_set: 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60',
	no_key:
		'border-rose-200 border-l-[3px] border-l-rose-500 bg-rose-50/80 hover:border-rose-300 hover:border-l-rose-500 hover:bg-rose-50',
	pending:
		'border-amber-200 border-l-[3px] border-l-amber-500 bg-amber-50/80 hover:border-amber-300 hover:border-l-amber-500 hover:bg-amber-50',
	disabled:
		'border-slate-300 border-l-[3px] border-l-slate-500 bg-slate-200/90 text-slate-500 shadow-none hover:border-slate-400 hover:border-l-slate-500 hover:bg-slate-200',
};

const STATUS_BADGE: Record<ProviderKeyStatusKind, string> = {
	key_set: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
	no_key: 'bg-rose-100 text-rose-800 ring-rose-200',
	pending: 'bg-amber-100 text-amber-900 ring-amber-200',
	disabled: 'bg-slate-300 text-slate-700 ring-slate-400',
};

const STATUS_DOT: Record<ProviderKeyStatusKind, string> = {
	key_set: 'bg-emerald-500',
	pending: 'bg-amber-500',
	no_key: 'bg-rose-500',
	disabled: 'bg-slate-500',
};

function routeUsageClass(routesCount: number, activeRoutesCount: number): string {
	if (routesCount <= 0) return 'text-slate-400';
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
	const tCommon = useTranslations('common');

	const protocols = getProviderProtocolSummaries(provider);
	const keyStatus = getProviderKeyStatus(provider);
	const isActive = provider.status !== 'disabled';
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
			className={`group relative flex flex-col gap-3 rounded-xl border p-4 shadow-sm transition-colors ${CARD_SHELL[keyStatus]}`}
			data-provider-status={isActive ? 'active' : 'disabled'}
		>
			<button
				type="button"
				onClick={() => onEdit(provider)}
				className="absolute inset-0 z-0 cursor-pointer rounded-xl bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
				title={t('editProvider', { name: provider.name })}
				aria-label={t('editProvider', { name: provider.name })}
			/>

			<div className="pointer-events-none relative z-10 flex items-center gap-2.5">
				<VendorIcon
					vendor={provider.vendor_key}
					iconKey={provider.icon_key}
					size="default"
					className={`shrink-0 ${isActive ? '' : 'opacity-40 grayscale'}`}
				/>
				<div className="min-w-0 flex-1">
					<h2
						className={`truncate text-sm font-semibold leading-5 ${isActive ? 'text-gray-900' : 'text-slate-500'}`}
						title={provider.name}
					>
						{provider.name}
					</h2>
					<p
						className={`mt-0.5 truncate text-[11px] font-medium leading-4 ${
							isActive ? routeUsageClass(routesCount, activeRoutesCount) : 'text-slate-400'
						}`}
						title={routeTitle}
					>
						{routesCount <= 0 ? (
							t('noRoutes')
						) : (
							<>
								{routesLabel}
								<span className="mx-1 opacity-40" aria-hidden>
									·
								</span>
								{t('activeRoutes', { count: activeRoutesCount })}
							</>
						)}
					</p>
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
					className={`pointer-events-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1 ring-inset transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-50 ${
						isActive
							? 'bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100'
							: 'bg-red-50 text-red-600 ring-red-200 hover:bg-red-100'
					}`}
					title={isActive ? t('providerEnabled') : t('providerDisabled')}
					aria-label={isActive ? t('providerEnabled') : t('providerDisabled')}
				>
					<PowerIcon className="h-3.5 w-3.5" aria-hidden />
				</button>
			</div>

			<div className="pointer-events-none relative z-10 flex items-center justify-between gap-2">
				<div className="flex min-w-0 items-center gap-2">
					<span
						className={`inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${STATUS_BADGE[keyStatus]}`}
					>
						<span
							className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[keyStatus]}`}
							aria-hidden
						/>
						<span className="truncate">{statusLabel}</span>
					</span>
					{(keyStatus === 'no_key' || keyStatus === 'pending') && (
						<ProviderCatalogOutboundLink
							links={provider.catalog_links}
							stopPropagation
							className="pointer-events-auto inline-flex min-w-0 items-center gap-1 text-[11px] font-medium text-blue-700 hover:text-blue-800"
						/>
					)}
				</div>
				<button
					type="button"
					onClick={(event) => {
						event.stopPropagation();
						void onCopyApiKey(provider);
					}}
					disabled={!canCopyKey}
					className="pointer-events-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-slate-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-35"
					title={copiedId === apiKeyFeedbackId ? tCommon('copied') : t('copyApiKey')}
					aria-label={copiedId === apiKeyFeedbackId ? tCommon('copied') : t('copyApiKey')}
				>
					{copiedId === apiKeyFeedbackId ? (
						<CheckIcon className="h-4 w-4 text-emerald-600" aria-hidden />
					) : (
						<ClipboardDocumentIcon className="h-4 w-4" aria-hidden />
					)}
				</button>
			</div>

			<div className="pointer-events-none relative z-10 min-w-0">
				{protocols.length > 0 ? (
					<div className="flex flex-wrap gap-1">
						{protocols.map((protocol) => {
							const badgeLabels = protocol.badges.map((badge) => t(`cap.${badge}`));
							const capabilitySummary =
								badgeLabels.length > 0
									? badgeLabels.join(' · ')
									: t('endpointCount', { count: protocol.endpoints.length });

							return (
								<span
									key={protocol.key}
									className={`inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] ${
										isActive
											? 'border-slate-200 bg-slate-50 text-slate-600'
											: 'border-slate-200/80 bg-slate-200/50 text-slate-500 grayscale'
									}`}
									title={`${protocol.label} · ${capabilitySummary}`}
								>
									<span className="h-3.5 w-3.5 shrink-0">
										<ProviderProtocolIcon protocol={protocol.key} />
									</span>
									{badgeLabels.length > 0 ? (
										<span className={`min-w-0 truncate ${isActive ? 'text-slate-600' : 'text-slate-500'}`}>
											{badgeLabels.slice(0, 2).join(' · ')}
											{badgeLabels.length > 2 ? ` +${badgeLabels.length - 2}` : ''}
										</span>
									) : (
										<span className="sr-only">{protocol.label}</span>
									)}
								</span>
							);
						})}
					</div>
				) : (
					<span
						className={`inline-flex rounded-md border border-dashed px-2 py-0.5 text-[10px] ${
							isActive
								? 'border-gray-200 bg-white text-gray-400'
								: 'border-slate-300 bg-slate-200/40 text-slate-400'
						}`}
					>
						{t('noEndpoint')}
					</span>
				)}
			</div>
		</article>
	);
}
