'use client';

import {
	ArrowPathIcon,
	CheckIcon,
	ClipboardDocumentIcon,
	ExclamationTriangleIcon,
	PowerIcon,
	KeyIcon,
	ShareIcon,
	ArrowUpRightIcon,
} from '@heroicons/react/24/outline';
import { useLocale, useTranslations } from 'next-intl';
import { VendorIcon } from '@/components/model-vendor-icon';
import { formatProviderAccountLabel, providerKindDisplayLabel } from '@/lib/provider-kind';
import type { CatalogView } from '../../components/catalog-view-toggle';
import type { GatewayProvider, ProviderKeyStatusKind } from '../types';
import {
	getProviderKeyStatus,
	getProviderProtocolSummaries,
	providerHasOfficialUpdate,
} from '../provider-utils';
import { ProviderProtocolBadges } from './provider-protocol-badges';
import { ProviderQuotaButton } from './provider-quota-popover';

type ProviderCardProps = {
	view?: CatalogView;
	provider: GatewayProvider;
	copiedId: string | null;
	statusTogglingId: string | null;
	onEdit: (provider: GatewayProvider) => void;
	onViewRoutes: (provider: GatewayProvider) => void;
	onViewEndpoints: (provider: GatewayProvider) => void;
	onToggleStatus: (provider: GatewayProvider) => void;
	onCopyApiKey: (provider: GatewayProvider) => void;
	/** 点击「有更新」徽标：打开与官方同步面板。 */
	onReviewOfficialUpdate: () => void;
};

const CARD_SHELL: Record<ProviderKeyStatusKind, string> = {
	key_set: 'border-slate-200 bg-white hover:border-gray-300',
	no_key: 'border-rose-200 bg-white hover:border-rose-300',
	pending: 'border-slate-200 bg-white hover:border-gray-300',
	disabled: 'border-gray-200 bg-gray-50/70 hover:border-gray-300',
};

const CARD_FOOTER: Record<ProviderKeyStatusKind, string> = {
	key_set: 'border-slate-100 bg-slate-50/70',
	no_key: 'border-slate-100 bg-slate-50/70',
	pending: 'border-slate-100 bg-slate-50/70',
	disabled: 'border-gray-100 bg-gray-50',
};

const STATUS_BADGE: Record<ProviderKeyStatusKind, string> = {
	key_set: 'text-gray-600 ring-transparent',
	no_key: 'bg-rose-100 text-rose-800 ring-rose-200',
	pending: 'bg-amber-50 text-amber-800 ring-transparent',
	disabled: 'bg-gray-100 text-gray-600 ring-transparent',
};



export const PROVIDER_LIST_COLUMNS =
	'xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1.4fr)_minmax(0,0.85fr)_minmax(0,0.8fr)]';

function routeUsageClass(routesCount: number, activeRoutesCount: number): string {
	if (routesCount <= 0) return 'text-slate-500';
	if (activeRoutesCount > 0) return 'text-emerald-700';
	return 'text-amber-800';
}

export function ProviderCard(props: ProviderCardProps) {
	const {
		view = 'cards',
		provider,
		copiedId,
		statusTogglingId,
		onEdit,
		onViewRoutes,
		onViewEndpoints,
		onToggleStatus,
		onCopyApiKey,
		onReviewOfficialUpdate,
	} = props;

	const isList = view === 'list';
	const t = useTranslations('providers.card');
	const tKind = useTranslations('providers.kind');
	const tFilters = useTranslations('providers.filters');
	const tList = useTranslations('providers.list');
	const tCommon = useTranslations('common');
	const locale = useLocale();

	const protocols = getProviderProtocolSummaries(provider);
	const isActive = provider.status !== 'disabled';
	const hasOfficialUpdate = providerHasOfficialUpdate(provider);
	const keyStatus = getProviderKeyStatus(provider);
	const shellStatus: ProviderKeyStatusKind = isActive ? keyStatus : 'disabled';
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
		keyStatus === 'key_set' ? t('keySet') : keyStatus === 'pending' ? t('pending') : t('noKey');
	const statusControl = (
		<button
			type="button"
			role="switch"
			aria-checked={isActive}
			disabled={statusTogglingId === provider.id}
			onClick={(event) => { event.stopPropagation(); void onToggleStatus(provider); }}
			className={`provider-status-control pointer-events-auto inline-flex min-h-6 items-center gap-1.5 rounded px-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 disabled:cursor-wait disabled:opacity-50 ${isActive ? 'text-emerald-700 hover:bg-emerald-50' : 'text-gray-500 hover:bg-gray-200'}`}
			title={isActive ? t('providerEnabled') : t('providerDisabled')}
			aria-label={isActive ? t('providerEnabled') : t('providerDisabled')}
		>
			{isActive ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden /> : <PowerIcon className="h-3 w-3 shrink-0" aria-hidden />}
			{tFilters(isActive ? 'active' : 'disabled')}
		</button>
	);
	const officialUpdateButton = hasOfficialUpdate ? (
		<button
			type="button"
			onClick={(event) => {
				event.stopPropagation();
				onReviewOfficialUpdate();
			}}
			className="pointer-events-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200 transition-colors hover:bg-orange-100 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
			title={provider.kind_orphaned ? t('kindOrphanedTitle') : t('officialUpdateTitle')}
			aria-label={provider.kind_orphaned ? t('kindOrphanedTitle') : t('officialUpdateTitle')}
		>
			{provider.kind_orphaned ? (
				<ExclamationTriangleIcon className="h-4 w-4" aria-hidden />
			) : (
				<ArrowPathIcon className="h-4 w-4" aria-hidden />
			)}
		</button>
	) : null;

	return (
		<article
			role={isList ? 'listitem' : undefined}
			className={`provider-account group relative min-w-0 gap-3 p-4 transition-[border-color,box-shadow] ${CARD_SHELL[shellStatus]} ${isList ? `grid sm:grid-cols-2 xl:items-center xl:gap-4 hover:ring-1 hover:ring-inset hover:ring-gray-200 ${PROVIDER_LIST_COLUMNS}` : 'flex flex-col rounded-xl border'}`}
			data-view={view}
			data-key-status={keyStatus}
			data-provider-status={isActive ? 'active' : 'disabled'}
		>
			<button
				type="button"
				onClick={() => onEdit(provider)}
				className={`absolute inset-0 z-0 cursor-pointer bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-500 ${isList ? '' : 'rounded-xl'}`}
				title={t('editProvider', { name: accountTitle })}
				aria-label={t('editProvider', { name: accountTitle })}
			/>

			<div className={`pointer-events-none relative z-10 flex min-h-[2.625rem] gap-3 ${isList ? 'provider-identity order-1 items-center' : 'provider-identity items-start'}`}>
				<VendorIcon
					vendor={provider.vendor_key}
					iconKey={provider.icon_key}
					size="default"
					className={`shrink-0 ${isActive ? '' : 'opacity-60 grayscale'}`}
				/>
				<div className="min-w-0 flex-1">
					<h2
						className={`truncate text-sm font-medium leading-5 ${isActive ? 'text-gray-900' : 'text-slate-600'}`}
						title={accountTitle}
					>
						{provider.name}
					</h2>
					<div className="provider-account-meta mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5">
						{showKind ? <span className="min-w-0 truncate text-slate-500" title={kindLabel ?? undefined}>{kindLabel}</span> : null}
						{statusControl}
					</div>
				</div>
				{officialUpdateButton}
			</div>

			<div className={`provider-route-summary relative z-10 min-w-0 ${isList ? 'order-4' : ''}`}>
				<button
					type="button"
					onClick={() => onViewRoutes(provider)}
					title={routeTitle}
					aria-label={t('viewRoutes', { name: provider.name })}
					className="provider-route-link inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-lg py-1 text-left text-xs leading-5 text-gray-600 hover:text-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
				>
					<span className="provider-route-symbol" aria-hidden><ShareIcon className="h-4 w-4" /></span>
					<span>{routesCount <= 0 ? t('noRoutes') : routesLabel}</span>
					{routesCount > 0 ? <span className={isActive ? routeUsageClass(routesCount, activeRoutesCount) : 'text-gray-500'}>{t('activeRoutes', { count: activeRoutesCount })}</span> : null}
					<ArrowUpRightIcon className="h-3 w-3 text-gray-400" aria-hidden />
				</button>
			</div>

			<div className={`provider-capabilities pointer-events-none relative z-10 min-w-0 ${isList ? 'order-2' : 'flex-1'}`}>
				{!isList ? <p className="mb-2 text-xs font-medium text-gray-500">{tList('protocols')}</p> : null}
				{protocols.length > 0 ? (
					<button type="button" onClick={() => onViewEndpoints(provider)} aria-label={t('editEndpoints', { name: provider.name })} title={t('editEndpoints', { name: provider.name })} className="provider-protocol-trigger pointer-events-auto block w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500">
						<ProviderProtocolBadges summaries={protocols} muted={!isActive} compact={isList} />
					</button>
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

			<div data-key-status={keyStatus}
				className={`provider-key-well pointer-events-none relative z-10 flex flex-wrap items-center gap-x-2 gap-y-1 ${isList ? 'order-3' : `-mx-4 -mb-4 mt-1 justify-between rounded-b-xl border-t px-4 py-2 ${CARD_FOOTER[shellStatus]}`}`}>
				<div className="flex min-w-0 items-center gap-1">
					<span
						className={`provider-key-label inline-flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${STATUS_BADGE[keyStatus]}`}
					>
						<KeyIcon className={`h-3.5 w-3.5 shrink-0 ${keyStatus === 'key_set' ? 'text-slate-400' : ''}`} aria-hidden />
						<span className="truncate">{statusLabel}</span>
					</span>
					{canCopyKey ? (
						<button
							type="button"
							onClick={(event) => {
								event.stopPropagation();
								void onCopyApiKey(provider);
							}}
							className="pointer-events-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-slate-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500"
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
					{provider.quota_supported && !provider.has_pending_key ? (
						<ProviderQuotaButton providerId={provider.id} />
					) : null}
				</div>
			</div>
		</article>
	);
}
