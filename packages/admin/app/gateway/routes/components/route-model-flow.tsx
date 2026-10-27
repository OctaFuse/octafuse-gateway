'use client';

import { useEffect, useMemo, useState } from 'react';
import {
	ArrowDownIcon,
	ArrowsUpDownIcon,
	CheckCircleIcon,
	CheckIcon,
	ClipboardDocumentIcon,
	PencilSquareIcon,
	PlusIcon,
	PowerIcon,
	ScaleIcon,
} from '@heroicons/react/24/outline';
import {
	isAudioModel,
	isAudioSpeechModel,
	isEmbeddingModel,
	isImageGenerationModel,
} from '@octafuse/core/db/model-modalities';
import { providerAccountIdentity, providerKindDisplayLabel, routeProviderAccountLabel } from '@/lib/provider-kind';
import { useLocale, useTranslations } from 'next-intl';
import { VendorIcon } from '@/components/model-vendor-icon';
import { UpstreamProtocolBrandIcon } from '@/components/upstream-brand-logo';
import { formatCompactTokens } from '@/lib/format-compact-tokens';
import type { GatewayModel, GatewayProvider } from '@/lib/types';
import { tagBadgeClass } from '../../models/model-utils';
import { useStickySummary } from '../sticky-summary-store';
import type { RouteModelGroup, RequestSurfaceGroup } from '../route-utils';
import {
	compareRoutesWithinPriorityLayer,
	groupSectionsByRequestSurface,
	isRouteConfigurationAvailable,
	parseModelTagsList,
	protocolBadgeClass,
	requestSurfacePath,
	resolveEffectiveRouteStrategy,
	summarizeRouteCustomParams,
	splitRoutesByProtocolAndRouteGroup,
} from '../route-utils';
import {
	type RouteEditorTab,
	type RouteFlowDensity,
	type RouteListRow,
	type RouteProtocolGroupSection,
} from '../types';
import { FailoverRulesDialog } from './failover-rules-dialog';
import { ProviderStickyChip } from './provider-sticky-chip';
import { RouteStickyUsage } from './route-sticky-usage';
import { RouteTargetPricing } from './route-target-pricing';
import { useRoutePricingDisplay } from '../use-route-pricing-display';
import { useRoutePathDisplay } from '../use-route-path-display';

const EMPTY_STICKY_COUNTS = new Map<string, number>();

type OpenStrategyDialog = (
	modelId: string,
	modelTitle: string,
	protocol: string,
	protocolLabel: string,
	group: string,
	poolId?: string | null,
	poolStrategy?: string | null,
	requestOperation?: string,
	extras?: { priority?: number; poolTierStrategies?: string | null }
) => void;

type OpenProviderStickyDialog = (
	modelId: string,
	modelTitle: string,
	protocol: string,
	protocolLabel: string,
	group: string,
	requestOperation: string,
	poolId: string | null,
	enabled: boolean,
	idleTtlSeconds: number,
	targets: Array<{ id: string; providerName: string; priority: number; weight: number }>,
	initialTargetId?: string
) => void;

type Props = {
	card: RouteModelGroup;
	meta: GatewayModel | undefined;
	providerMeta: Map<string, GatewayProvider>;
	globalRouteStrategy: string | null;
	density: RouteFlowDensity;
	copiedModelId: string | null;
	togglingId: string | null;
	onCopyModelId: (modelId: string) => void;
	onCreate: (modelId: string, preset?: { protocol?: string; operation?: string; group?: string }) => void;
	onEdit: (route: RouteListRow, initialTab?: RouteEditorTab) => void;
	onEditModel: (modelId: string) => void;
	onToggleStatus: (route: RouteListRow) => void;
	onOpenStrategyDialog: OpenStrategyDialog;
	onOpenProviderStickyDialog: OpenProviderStickyDialog;
};

function RouteTarget({
	listView = false,
	route,
	provider,
	stickyBindingCount,
	stickyEnabled,
	stickyTotal,
	togglingId,
	onEdit,
	onToggleStatus,
	onOpenStickyBindings,
}: {
	listView?: boolean;
	route: RouteListRow;
	provider: GatewayProvider | undefined;
	stickyBindingCount: number | null;
	stickyEnabled: boolean;
	stickyTotal: number | null;
	togglingId: string | null;
	onEdit: (route: RouteListRow, initialTab?: RouteEditorTab) => void;
	onToggleStatus: (route: RouteListRow) => void;
	onOpenStickyBindings: () => void;
}) {
	const t = useTranslations('routes.flow');
	const tList = useTranslations('routes.listItem');
	const tKind = useTranslations('providers.kind');
	const locale = useLocale();
	const providerName =
		provider?.name?.trim() || (route.provider_name ?? '').trim() || route.provider_id;
	const kindLabel = provider
		? providerKindDisplayLabel(provider, locale, tKind('custom'))
		: null;
	const showKind = Boolean(
		kindLabel && kindLabel.trim().toLowerCase() !== providerName.trim().toLowerCase()
	);
	const enabled = route.status === 'active';
	const providerDisabled = provider?.status === 'disabled';
	const available = isRouteConfigurationAvailable(route, provider);
	const availabilityHint = t(available ? 'availabilityAvailableTooltip' : !enabled ? 'availabilityRouteDisabledTooltip' : 'availabilityProviderDisabledTooltip');
	const params = summarizeRouteCustomParams(route.custom_params);
	const paramsBadges = (
		<div className={`flex min-w-0 flex-wrap items-center gap-1 ${listView ? 'route-provider-list-params' : 'ml-auto justify-end'}`}>
			{listView ? <span className="route-provider-mobile-label text-[10px] text-slate-500">{t('listParams')}</span> : null}
			{(['headers', 'body'] as const).filter((side) => params[side]).map((side) => (
				<button
					key={side}
					type="button"
					onClick={() => onEdit(route, 'request')}
					className={`rounded border px-1.5 py-0.5 text-[10px] leading-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${!available ? 'border-slate-300 bg-slate-100 text-slate-600 hover:bg-slate-200' : side === 'headers' ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100' : 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100'}`}
					title={side === 'headers'
						? t(params.forceOverrideHeaders ? 'paramsHeadersForceTooltip' : 'paramsHeadersTooltip')
						: t(params.forceOverrideBody ? 'paramsBodyForceTooltip' : 'paramsBodyTooltip')}
					aria-label={`${t('editRoute')}: ${t(side === 'headers' ? 'paramsHeaders' : 'paramsBody')}`}
				>
					{t(side === 'headers' ? 'paramsHeaders' : 'paramsBody')}
				</button>
			))}
			{listView && !params.headers && !params.body ? <span className="text-xs text-slate-400">—</span> : null}
		</div>
	);


	const statusBadges = (
		<div className={listView ? 'route-provider-list-status flex min-w-0 flex-wrap items-center gap-1 text-[10px]' : 'flex flex-wrap items-center gap-1.5'}>
			<button
				type="button"
				onClick={() => onToggleStatus(route)}
				disabled={togglingId === route.id}
				aria-pressed={enabled}
				className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-wait disabled:opacity-50 ${available ? 'bg-emerald-600 text-white hover:bg-emerald-700' : enabled ? 'bg-white text-slate-600 ring-1 ring-inset ring-slate-300 hover:bg-slate-200' : 'bg-slate-600 text-white hover:bg-slate-700'}`}
				title={`${availabilityHint} · ${enabled ? tList('routeEnabled') : tList('routeDisabled')}`}
				aria-label={enabled ? tList('routeEnabled') : tList('routeDisabled')}
			>
				{available ? <CheckCircleIcon className="h-3 w-3" aria-hidden /> : <PowerIcon className="h-3 w-3" aria-hidden />}
				{available ? t('availableShort') : enabled ? t('enabledShort') : t('disabledShort')}
			</button>
			{providerDisabled ? (
				<span className="rounded border border-amber-300 bg-amber-50 px-1 py-0.5 text-center text-[9px] font-semibold leading-3 text-amber-800" title={t('availabilityProviderDisabledTooltip')}>
					{t('providerDisabled')}
				</span>
			) : null}
		</div>
	);

	const upstreamModel = (
		<button
			type="button"
			onClick={() => onEdit(route)}
			className={`block w-full min-w-0 rounded-md text-left font-mono text-[10px] leading-4 text-slate-500 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${listView ? '[overflow-wrap:anywhere]' : 'mt-3 bg-slate-50 px-2 py-1.5 [overflow-wrap:anywhere] hover:bg-slate-100'}`}
			title={route.provider_model_name}
			aria-label={`${t('editRoute')}: ${route.provider_model_name}`}
		>
			{route.provider_model_name}
		</button>
	);

	const stickyUsage = (
		<RouteStickyUsage
			compact={listView}
			enabled={stickyEnabled}
			count={stickyBindingCount}
			total={stickyTotal}
			routeAvailable={available}
			providerName={providerName}
			onClick={onOpenStickyBindings}
		/>
	);

	return (
		<div
			role="listitem"
			data-available={available}
			className={`relative ${listView ? 'route-provider-list-grid w-full min-w-0 border-y border-slate-200 first:border-t-0 last:border-b-0 gap-x-3 gap-y-2 px-3 py-2.5' : 'flex w-full min-w-0 flex-col overflow-hidden rounded-xl border transition'} ${
				available
					? listView ? 'bg-white hover:bg-emerald-50/40' : 'border-emerald-200 bg-white shadow-[0_2px_6px_-2px_rgba(15,23,42,0.14)] hover:border-emerald-300 hover:shadow-md'
					: listView ? 'bg-slate-100 hover:bg-slate-200/60' : 'border-dashed border-slate-300 bg-slate-100 hover:border-slate-400'
			}`}
		>
			<span aria-hidden className={`pointer-events-none absolute inset-y-0 left-0 w-1 ${available ? 'bg-emerald-500' : enabled && providerDisabled ? 'bg-amber-500' : 'bg-slate-400'}`} />
			<div className={listView ? 'route-provider-list-content' : 'p-3'}>
				<div className={listView ? 'route-provider-list-summary' : 'contents'}>
					<div className={`flex min-w-0 items-center ${listView ? 'route-provider-list-identity gap-2' : 'gap-2.5'}`}>
						<VendorIcon vendor={provider?.vendor_key} iconKey={provider?.icon_key} size="compact" className={available ? '' : 'opacity-60 grayscale'} />
						<div className="flex min-w-0 flex-1 items-center gap-2">

							<button
								type="button"
								onClick={() => onEdit(route)}
								className="group min-w-0 flex-1 rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
								title={t('editRoute')}
							>
								<span className="flex items-center gap-1.5">
									<span className={`${listView ? 'route-provider-list-name ' : ''}min-w-0 truncate text-xs font-semibold group-hover:text-blue-700 ${available ? 'text-slate-900' : 'text-slate-600'}`} title={providerName}>{providerName}</span>
								</span>
								{showKind ? (
									<span className="mt-0.5 block truncate text-[10px] leading-4 text-slate-500" title={kindLabel ?? undefined}>
										{showKind ? kindLabel : null}
									</span>
								) : null}
							</button>
							{!listView ? (
								<div className="flex shrink-0 items-center gap-1.5">
									<span
										className={`inline-flex h-7 min-w-8 items-center justify-center gap-1 rounded-md border px-2 text-xs font-semibold tabular-nums ${available ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-300 bg-slate-100 text-slate-600'}`}
										title={t('badgeWeightTooltip', { value: route.weight ?? 1 })}
										aria-label={t('badgeWeightTooltip', { value: route.weight ?? 1 })}
									>
										<ScaleIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
										{route.weight ?? 1}
									</span>
									{stickyUsage}
								</div>
							) : null}
						</div>
					</div>
					{listView ? statusBadges : null}
				</div>
				{!listView ? upstreamModel : null}
				{listView ? <div className="route-provider-list-model min-w-0">{upstreamModel}</div> : null}
				<div className={listView ? 'route-provider-list-meta' : 'mt-3 flex min-h-4 flex-wrap items-center gap-x-2 gap-y-1 text-[10px] leading-4'}>
					{!listView ? statusBadges : null}
					{listView ? (
						<span className="route-provider-list-weight inline-flex min-w-0 items-center justify-center gap-1 tabular-nums" title={t('badgeWeightTooltip', { value: route.weight ?? 1 })} aria-label={t('badgeWeightTooltip', { value: route.weight ?? 1 })}>
							<span className="route-provider-mobile-label mr-1 text-[10px] text-slate-500">{t('listWeight')}</span>
							<span className={`text-sm font-bold ${available ? 'text-slate-900' : 'text-slate-600'}`}>{route.weight ?? 1}</span>
						</span>
					) : null}
					{!listView && (params.headers || params.body) ? paramsBadges : null}
					{listView ? (
						<div className="route-provider-list-sticky flex min-w-0 items-center justify-center gap-1">
							<span className="route-provider-mobile-label text-[10px] text-slate-500">{t('listStickyUsers')}</span>
							{stickyUsage}
						</div>
					) : null}
					{listView ? paramsBadges : null}
				</div>
			</div>
			<RouteTargetPricing muted={!available} compact={listView} priceOverride={route.price_override} onEdit={() => onEdit(route, 'pricing')} />
		</div>
	);
}

const CONNECTOR_PLUS_BUTTON_CLASS =
	'inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-blue-50 hover:text-blue-600 hover:ring-blue-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

export function FlowConnectorAdd({
	alignTop = false,
	railClass,
	label,
	onClick,
}: {
	alignTop?: boolean;
	railClass: string;
	label: string;
	onClick: () => void;
}) {
	return (
		<>
			<div className={`pointer-events-none absolute right-0 hidden h-5 w-8 -translate-y-1/2 items-center justify-center xl:flex ${alignTop ? 'top-8' : 'top-1/2'}`}>
				<span className={`absolute inset-x-0 top-1/2 h-px ${railClass}`} aria-hidden />
				<span className="pointer-events-auto relative z-[1]">
					<button
						type="button"
						onClick={onClick}
						title={label}
						aria-label={label}
						className={CONNECTOR_PLUS_BUTTON_CLASS}
					>
						<PlusIcon className="h-3 w-3" />
					</button>
				</span>
			</div>
			<div className="route-flow-connector-stacked flex justify-center pt-1 xl:hidden">
				<button
					type="button"
					onClick={onClick}
					title={label}
					aria-label={label}
					className={CONNECTOR_PLUS_BUTTON_CLASS}
				>
					<PlusIcon className="h-3 w-3" />
				</button>
			</div>
		</>
	);
}

function stickyTargetsFromSection(
	section: RouteProtocolGroupSection<RouteListRow>,
	providerMeta: Map<string, GatewayProvider>,
	locale: string,
	customLabel: string,
) {
	return section.routes.map((route) => {
		const provider = providerMeta.get(route.provider_id);
		const identity = providerAccountIdentity(provider, locale, customLabel, route.provider_name || route.provider_id);
		return {
			id: route.id,
			providerName: routeProviderAccountLabel(route, provider, locale, customLabel),
			identity: {
				accountName: identity.name,
				kindLabel: identity.kind,
				vendorKey: provider?.vendor_key,
				iconKey: provider?.icon_key,
			},
			priority: route.priority,
			weight: Number(route.weight ?? 1) || 1,
			enabled: isRouteConfigurationAvailable(route, provider),
		};
	});
}

export function openSectionStickyDialog(
	onOpen: OpenProviderStickyDialog,
	card: RouteModelGroup,
	section: RouteProtocolGroupSection<RouteListRow>,
	providerMeta: Map<string, GatewayProvider>,
	locale: string,
	customLabel: string,
	initialTargetId?: string,
) {
	onOpen(
		card.model_id,
		card.title,
		section.protocol,
		section.protocolLabel,
		section.group,
		section.requestOperation,
		section.poolId,
		section.poolStickyEnabled,
		section.poolStickyIdleTtlSeconds,
		stickyTargetsFromSection(section, providerMeta, locale, customLabel),
		initialTargetId,
	);
}

export function RouteGroupInfo({
	centered = false,
	modelId,
	routeGroup,
	copiedModelId,
	onCopyModelId,
	sticky,
}: {
	centered?: boolean;
	modelId: string;
	routeGroup: string;
	copiedModelId: string | null;
	onCopyModelId: (modelId: string) => void;
	sticky?: {
		enabled: boolean;
		idleTtlSeconds: number;
		poolId: string | null;
		onClick: () => void;
	};
}) {
	const t = useTranslations('routes.flow');
	const tCard = useTranslations('routes.card');
	const requestedModelId = routeGroup === 'default' ? modelId : `${modelId}:${routeGroup}`;
	const isDefaultGroup = routeGroup === 'default';
	const copied = copiedModelId === requestedModelId;

	return (
		<div className={`route-group-info relative w-full min-w-0 ${centered ? 'grid grid-rows-2' : ''}`} aria-label={t('routeMatchAria', { group: routeGroup, model: requestedModelId })}>
			<div className={`route-group-label flex min-w-0 gap-1.5 ${centered ? 'items-end pb-2' : 'h-8 items-start pt-1'}`}>
				<span className={`shrink-0 text-[10px] font-medium ${isDefaultGroup ? 'text-sky-700' : 'text-violet-700'}`}>{t('routeGroup')}</span>
				<span className={`min-w-0 truncate text-[11px] font-semibold ${isDefaultGroup ? 'text-sky-900' : 'text-violet-900'}`} title={routeGroup}>{routeGroup}</span>
			</div>
			<span className={`route-group-rail absolute inset-x-0 h-px ${centered ? 'top-1/2' : 'top-8'} ${isDefaultGroup ? 'bg-sky-300' : 'bg-violet-300'}`} aria-hidden />
			<div className="route-group-details">
				<div className="flex min-w-0 items-start gap-1 pt-2">
					<span className="min-w-0 flex-1 font-mono text-[10px] leading-[14px] text-slate-600 [overflow-wrap:anywhere]" title={requestedModelId}>
						{requestedModelId}
					</span>
					<button
						type="button"
						onClick={() => void onCopyModelId(requestedModelId)}
						className={`shrink-0 rounded p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${copied ? 'bg-emerald-50 text-emerald-600' : 'text-slate-400 hover:bg-slate-100 hover:text-blue-600'}`}
						title={copied ? tCard('copiedModelId') : tCard('copyModelId', { id: requestedModelId })}
						aria-label={copied ? tCard('copiedModelId') : tCard('copyModelId', { id: requestedModelId })}
					>
						<ClipboardDocumentIcon className="h-3.5 w-3.5" />
					</button>
				</div>
				{sticky ? (
					<div className="mt-2 flex min-w-0">
						<ProviderStickyChip
							enabled={sticky.enabled}
							idleTtlSeconds={sticky.idleTtlSeconds}
							poolId={sticky.poolId}
							onClick={sticky.onClick}
						/>
					</div>
				) : null}
			</div>
		</div>
	);
}

export function RequestSurfaceNode({
	surface,
	modelId,
}: {
	surface: Pick<RequestSurfaceGroup, 'protocol' | 'protocolLabel' | 'requestOperation'>;
	modelId?: string;
}) {
	const t = useTranslations('routes.flow');
	const tGuide = useTranslations('routes.modal.guide');
	const tCommon = useTranslations('common');
	const [pathDisplay] = useRoutePathDisplay();
	const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
	useEffect(() => {
		if (copyStatus === 'idle') return;
		const timer = setTimeout(() => setCopyStatus('idle'), 2500);
		return () => clearTimeout(timer);
	}, [copyStatus]);
	const surfacePath = requestSurfacePath(
		surface.protocol,
		surface.requestOperation,
		modelId
	);

	async function copyPath() {
		try {
			await navigator.clipboard.writeText(surfacePath);
			setCopyStatus('copied');
		} catch {
			setCopyStatus('failed');
		}
	}

	return (
		<div className="w-full min-w-0 rounded-lg border border-blue-200 bg-blue-50/75 px-3 py-2.5 shadow-sm">
			<div className="flex items-center justify-between gap-2">
				<span className="text-[10px] font-semibold uppercase tracking-wider text-blue-600">
					{t('requestNode')}
				</span>
				<div className="ml-auto flex shrink-0 items-center gap-1.5">
					<button
						type="button"
						onClick={() => void copyPath()}
						aria-label={copyStatus === 'copied' ? tCommon('copied') : tGuide('copyPath')}
						title={copyStatus === 'copied' ? tCommon('copied') : tGuide('copyPath')}
						className="rounded p-0.5 text-blue-500 hover:bg-blue-100 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
					>
						{copyStatus === 'copied' ? <CheckIcon className="h-3.5 w-3.5" aria-hidden /> : <ClipboardDocumentIcon className="h-3.5 w-3.5" aria-hidden />}
					</button>
					<span
						className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded ring-1 ring-inset ${protocolBadgeClass(surface.protocol)}`}
						title={surface.protocolLabel}
						aria-label={surface.protocolLabel}
					>
						<UpstreamProtocolBrandIcon protocol={surface.protocol} />
					</span>
				</div>
			</div>
			<div className="mt-1.5 min-w-0">
				<code
					className={`block w-full min-w-0 select-text font-mono text-[11px] font-semibold leading-4 text-gray-800 ${pathDisplay === 'full' ? 'whitespace-normal [overflow-wrap:anywhere]' : 'truncate'}`}
					title={surfacePath}
				>
					{pathDisplay === 'full' ? surfacePath.split(/(?=\/)/).map((segment, index) => (
						<span key={index}><wbr />{segment}</span>
					)) : surfacePath}
				</code>
			</div>
			<span role="status" className={copyStatus === 'failed' ? 'mt-1 block text-[10px] text-red-600' : 'sr-only'}>
				{copyStatus === 'failed' ? tGuide('copyFailed') : copyStatus === 'copied' ? tCommon('copied') : ''}
			</span>
		</div>
	);
}

function strategyDisplayKey(strategy: string): string {
	if (
		strategy === 'hash_affinity' ||
		strategy === 'weighted_random' ||
		strategy === 'weight_priority' ||
		strategy === 'weighted_round_robin'
	) {
		return strategy;
	}
	return strategy;
}

function RouteProviderListHeader() {
	const t = useTranslations('routes.flow');
	const modal = useTranslations('routes.modal');
	const [pricingDisplay] = useRoutePricingDisplay();
	const configuredView = pricingDisplay === 'configured';
	return (
		<div className="route-provider-list-header route-provider-list-grid gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2.5 text-[10px] font-medium text-slate-600" aria-hidden>
			<span>{t('listProviderAccount')}</span>
			<span>{t('listUpstreamModel')}</span>
			<span className="text-center">{t('listStatus')}</span>
			<span className="text-center">{t('listWeight')}</span>
			<span className="text-center">{t('listStickyUsers')}</span>
			<span>{t('listParams')}</span>
			<div className={`route-provider-pricing-columns ${configuredView ? 'route-provider-pricing-configured' : ''}`}>
				<span>{t('pricingPeriod')}</span>
				{configuredView ? (
					<>
						<span className="text-right whitespace-nowrap" title={modal('providerFactor')}>{t('pricingProviderFactor')}</span>
						<span className="text-right whitespace-nowrap" title={modal('editor.chargedFactorLabel')}>{t('pricingBillingMultiplier')}</span>
						<span className="text-right whitespace-nowrap" title={modal('editor.meteredFactorLabel')}>{t('pricingCostMultiplier')}</span>
					</>
				) : (
					<>
						<span className="text-right whitespace-nowrap">{t('effectivePricing.charged')}</span>
						<span className="text-right whitespace-nowrap">{t('effectivePricing.metered')}</span>
					</>
				)}
			</div>
		</div>
	);
}

function PriorityTierPanel({
	priority,
	routes,
	layerIndex,
	density,
	section,
	card,
	meta,
	providerMeta,
	globalRouteStrategy,
	stickyCountsByTarget,
	stickyTotal,
	togglingId,
	onEdit,
	onToggleStatus,
	onOpenStrategyDialog,
	onOpenFailover,
	onOpenStickyBindings,
}: {
	priority: number;
	routes: RouteListRow[];
	layerIndex: number;
	density: RouteFlowDensity;
	section: RouteProtocolGroupSection<RouteListRow>;
	card: RouteModelGroup;
	meta: GatewayModel | undefined;
	providerMeta: Map<string, GatewayProvider>;
	globalRouteStrategy: string | null;
	stickyCountsByTarget: Map<string, number>;
	stickyTotal: number | null;
	togglingId: string | null;
	onEdit: Props['onEdit'];
	onToggleStatus: Props['onToggleStatus'];
	onOpenStrategyDialog: Props['onOpenStrategyDialog'];
	onOpenFailover: () => void;
	onOpenStickyBindings: (targetId: string) => void;
}) {
	const t = useTranslations('routes.flow');
	const tStrategy = useTranslations('routes.strategy');
	const isList = density === 'list';
	const availableCount = routes.filter(route => isRouteConfigurationAvailable(route, providerMeta.get(route.provider_id))).length;
	const strategy = resolveEffectiveRouteStrategy({
		poolStrategy: section.poolStrategy,
		poolTierStrategies: section.poolTierStrategies,
		priority,
		routePolicyRaw: meta?.route_policy ?? null,
		protocol: section.protocol,
		requestOperation: section.requestOperation,
		routeGroup: section.group,
		globalStrategy: globalRouteStrategy,
	});
	const displayKey = strategyDisplayKey(strategy.strategy);
	const displayName =
		displayKey === 'hash_affinity' ||
		displayKey === 'weighted_random' ||
		displayKey === 'weight_priority' ||
		displayKey === 'weighted_round_robin'
			? tStrategy(`display.${displayKey}`)
			: strategy.strategy;
	const sourceLabel = t(`strategySource.${strategy.source}`);
	const layerLabel = layerIndex === 0 ? t('firstAttempt') : t('fallbackLayer');

	return (
		<div className="w-full min-w-0">
			<div className={isList ? `flex min-w-0 flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/80 px-3 py-2 ${layerIndex > 0 ? 'border-t border-t-slate-200' : ''}` : 'mb-3 flex min-w-0 flex-wrap items-center gap-2 px-0.5 py-1'}>
				<span
					className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-2 text-indigo-800"
					title={t('badgePriorityTooltip', { value: priority })}
					aria-label={t('badgePriorityTooltip', { value: priority })}
				>
					<ArrowsUpDownIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
					<span className="text-sm font-bold tabular-nums">{priority}</span>
				</span>
				{layerIndex > 0 ? (
					<button type="button" onClick={onOpenFailover} title={t('failoverRules')} aria-label={t('failoverRules')} className="inline-flex items-center gap-1 rounded text-[11px] font-medium text-slate-600 hover:text-blue-700 focus-visible:outline-blue-500">
						<ArrowDownIcon className="h-3 w-3" aria-hidden />
						{layerLabel}
					</button>
				) : <span className="text-[11px] font-semibold text-slate-700">{layerLabel}</span>}
				<span
					className={`text-[10px] tabular-nums ${availableCount > 0 ? 'text-slate-500' : 'font-medium text-amber-700'}`}
					title={t('tierAvailableTooltip', {
						active: availableCount,
						total: routes.length,
					})}
				>
					{t('tierActiveTotal', {
						active: availableCount,
						total: routes.length,
					})}
				</span>
				<span className={isList ? 'min-w-3 flex-1' : 'h-px min-w-3 flex-1 bg-slate-200'} aria-hidden />
				<div
					className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5"
				>
					<button
						type="button"
						onClick={() =>
							onOpenStrategyDialog(
								card.model_id,
								card.title,
								section.protocol,
								section.protocolLabel,
								section.group,
								section.poolId,
								section.poolStrategy,
								section.requestOperation,
								{
									priority,
									poolTierStrategies: section.poolTierStrategies,
								}
							)
						}
						className={`inline-flex max-w-full items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${isList ? 'text-slate-500 hover:bg-white hover:text-blue-700' : 'text-indigo-600 hover:bg-indigo-50 hover:text-indigo-800'}`}
						title={t('tierStrategyEdit', {
							strategy: displayName,
							source: sourceLabel,
						})}
					>
						<span className="truncate">{displayName}</span>
						<PencilSquareIcon className="h-3 w-3 shrink-0 text-indigo-400" />
					</button>
				</div>
			</div>

			<div className={isList ? 'route-provider-list-body flex min-w-0 flex-col gap-1.5 bg-white' : 'route-provider-card-grid'} role="list" aria-label={t('listProvider')}>
				{routes.map((route) => (
					<RouteTarget
						listView={isList}
						key={route.id}
						route={route}
						provider={providerMeta.get(route.provider_id)}
						stickyBindingCount={stickyTotal == null ? null : stickyCountsByTarget.get(route.id) ?? 0}
						stickyEnabled={section.poolStickyEnabled}
						stickyTotal={stickyTotal}
						togglingId={togglingId}
						onEdit={onEdit}
						onToggleStatus={onToggleStatus}
						onOpenStickyBindings={() => onOpenStickyBindings(route.id)}
					/>
				))}
				{routes.length === 0 ? (
					<span className="text-[11px] text-gray-400">{t('noProviders')}</span>
				) : null}
			</div>
		</div>
	);
}

type UpstreamPoolPanelProps = {
	section: RouteProtocolGroupSection<RouteListRow>;
	card: RouteModelGroup;
	meta: GatewayModel | undefined;
	providerMeta: Map<string, GatewayProvider>;
	globalRouteStrategy: string | null;
	density: RouteFlowDensity;
	togglingId: string | null;
	onEdit: Props['onEdit'];
	onToggleStatus: Props['onToggleStatus'];
	onOpenStrategyDialog: Props['onOpenStrategyDialog'];
	onOpenProviderStickyDialog: Props['onOpenProviderStickyDialog'];
};

export function UpstreamPoolPanel({
	section,
	card,
	meta,
	providerMeta,
	globalRouteStrategy,
	density,
	togglingId,
	onEdit,
	onToggleStatus,
	onOpenStrategyDialog,
	onOpenProviderStickyDialog,
}: UpstreamPoolPanelProps) {
	const t = useTranslations('routes.flow');
	const tKind = useTranslations('providers.kind');
	const locale = useLocale();
	const [failoverOpen, setFailoverOpen] = useState(false);
	const priorityLayers = [...section.routes.reduce((map, route) => {
		const layer = map.get(route.priority) ?? [];
		layer.push(route);
		map.set(route.priority, layer);
		return map;
	}, new Map<number, RouteListRow[]>())]
		.sort(([a], [b]) => b - a)
		.map(([priority, routes]) =>
			[priority, [...routes].sort((a, b) => compareRoutesWithinPriorityLayer(a, b, {
				providersById: providerMeta,
				locale,
				customKindLabel: tKind('custom'),
			}))] as const
		);
	const stickyPoolId = section.poolStickyEnabled ? section.poolId : null;
	const stickySummary = useStickySummary(stickyPoolId);
	const stickyCountsByTarget = useMemo(() => {
		if (!stickyPoolId || !stickySummary) return EMPTY_STICKY_COUNTS;
		return new Map(
			stickySummary.targets.map((row) => [row.route_target_id, row.active_count])
		);
	}, [stickyPoolId, stickySummary]);

	const isList = density === 'list';

	return (
		<>
			<div
				className={
					isList
						? 'route-provider-list flex min-w-0 flex-col items-stretch overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_3px_10px_-2px_rgba(15,23,42,0.22)]'
						: `route-provider-card-group flex min-w-0 flex-col gap-5 rounded-xl border border-slate-300/70 border-l-[3px] p-3 sm:p-4 ${section.group === 'default' ? 'border-l-sky-300' : 'border-l-violet-300'}`
				}
				role="group"
				data-route-group={section.group}
				aria-label={t('routeGroupProviders', { group: section.group })}
			>
				{isList ? <RouteProviderListHeader /> : null}
				{priorityLayers.map(([priority, routes], layerIndex) => (
					<div
						key={priority}
						className="min-w-0"
					>
						<PriorityTierPanel
							priority={priority}
							routes={routes}
							layerIndex={layerIndex}
							density={density}
							section={section}
							card={card}
							meta={meta}
							providerMeta={providerMeta}
							globalRouteStrategy={globalRouteStrategy}
							stickyCountsByTarget={stickyCountsByTarget}
							stickyTotal={stickySummary?.total_active ?? null}
							togglingId={togglingId}
							onEdit={onEdit}
							onToggleStatus={onToggleStatus}
							onOpenFailover={() => setFailoverOpen(true)}
							onOpenStrategyDialog={onOpenStrategyDialog}
							onOpenStickyBindings={(targetId) => openSectionStickyDialog(onOpenProviderStickyDialog, card, section, providerMeta, locale, tKind('custom'), targetId)}
						/>
					</div>
				))}
			</div>
			<FailoverRulesDialog open={failoverOpen} onClose={() => setFailoverOpen(false)} />
		</>
	);
}

function FlowBranch({
	section,
	card,
	meta,
	providerMeta,
	globalRouteStrategy,
	density,
	branchIndex,
	branchCount,
	copiedModelId,
	togglingId,
	onCopyModelId,
	onCreate,
	onEdit,
	onToggleStatus,
	onOpenStrategyDialog,
	onOpenProviderStickyDialog,
}: UpstreamPoolPanelProps & {
	branchIndex: number;
	branchCount: number;
	copiedModelId: string | null;
	onCopyModelId: (modelId: string) => void;
	onCreate: Props['onCreate'];
	onOpenProviderStickyDialog: Props['onOpenProviderStickyDialog'];
}) {
	const t = useTranslations('routes.flow');
	const tKind = useTranslations('providers.kind');
	const locale = useLocale();
	const isDefaultGroup = section.group === 'default';
	const groupRail = isDefaultGroup ? 'bg-sky-300' : 'bg-violet-300';
	const singleGroup = branchCount === 1;
	const railClass = branchIndex === 0 ? 'top-14 bottom-0'
		: branchIndex === branchCount - 1 ? 'top-0 bottom-[calc(100%-3.5rem)]' : 'inset-y-0';

	return (
		<div className="route-flow-branch relative py-3 xl:pl-4">
			{!singleGroup ? <span className={`absolute left-0 hidden w-px bg-blue-300 xl:block ${railClass}`} aria-hidden /> : null}
			<span
				className={`absolute left-0 hidden h-px w-4 bg-blue-300 xl:block ${singleGroup ? 'top-1/2' : 'top-14'}`}
				aria-hidden
			/>
			<div className={`route-flow-branch-layout grid min-w-0 gap-y-3 xl:grid-cols-[minmax(180px,240px)_minmax(0,1fr)] ${singleGroup ? 'xl:items-center' : 'xl:items-start'}`}>
				<div className={`route-flow-group relative flex min-w-0 flex-col xl:pr-8 ${singleGroup ? '' : 'mt-3'}`}>
					<RouteGroupInfo
						centered={singleGroup}
						modelId={card.model_id}
						routeGroup={section.group}
						copiedModelId={copiedModelId}
						onCopyModelId={onCopyModelId}
						sticky={{
							enabled: section.poolStickyEnabled,
							idleTtlSeconds: section.poolStickyIdleTtlSeconds,
							poolId: section.poolId,
							onClick: () =>
								openSectionStickyDialog(
									onOpenProviderStickyDialog,
									card,
									section,
									providerMeta,
									locale,
									tKind('custom'),
								),
						}}
					/>
					<FlowConnectorAdd
						alignTop={!singleGroup}
						railClass={groupRail}
						label={t('addProvider')}
						onClick={() =>
							onCreate(card.model_id, {
								protocol: section.protocol,
								operation: section.requestOperation,
								group: section.group,
							})
						}
					/>
				</div>
				<UpstreamPoolPanel
					section={section}
					card={card}
					meta={meta}
					providerMeta={providerMeta}
					globalRouteStrategy={globalRouteStrategy}
					density={density}
					togglingId={togglingId}
					onEdit={onEdit}
					onToggleStatus={onToggleStatus}
					onOpenStrategyDialog={onOpenStrategyDialog}
					onOpenProviderStickyDialog={onOpenProviderStickyDialog}
				/>
			</div>
		</div>
	);
}

function FlowSection({
	surface,
	card,
	meta,
	providerMeta,
	globalRouteStrategy,
	density,
	copiedModelId,
	togglingId,
	onCopyModelId,
	onCreate,
	onEdit,
	onToggleStatus,
	onOpenStrategyDialog,
	onOpenProviderStickyDialog,
}: {
	surface: RequestSurfaceGroup;
	card: RouteModelGroup;
	meta: GatewayModel | undefined;
	providerMeta: Map<string, GatewayProvider>;
	globalRouteStrategy: string | null;
	density: RouteFlowDensity;
	copiedModelId: string | null;
	togglingId: string | null;
	onCopyModelId: (modelId: string) => void;
	onCreate: Props['onCreate'];
	onEdit: Props['onEdit'];
	onToggleStatus: Props['onToggleStatus'];
	onOpenStrategyDialog: Props['onOpenStrategyDialog'];
	onOpenProviderStickyDialog: Props['onOpenProviderStickyDialog'];
}) {
	const t = useTranslations('routes.flow');

	return (
		<div className="px-3 sm:px-4">
			<div className="xl:grid xl:grid-cols-[minmax(160px,210px)_minmax(0,1fr)]">
				<div className="route-flow-entry relative flex min-w-0 flex-col justify-center py-3 xl:pr-8">
					<RequestSurfaceNode surface={surface} modelId={card.model_id} />
					<FlowConnectorAdd
						railClass="bg-blue-300"
						label={t('addRouteGroup')}
						onClick={() =>
							onCreate(card.model_id, {
								protocol: surface.protocol,
								operation: surface.requestOperation,
								group: '',
							})
						}
					/>
				</div>
				<div>
					{surface.sections.map((section, branchIndex) => (
						<FlowBranch
							key={section.key}
							section={section}
							card={card}
							meta={meta}
							providerMeta={providerMeta}
							globalRouteStrategy={globalRouteStrategy}
							density={density}
							branchIndex={branchIndex}
							branchCount={surface.sections.length}
							copiedModelId={copiedModelId}
							togglingId={togglingId}
							onCopyModelId={onCopyModelId}
							onCreate={onCreate}
							onEdit={onEdit}
							onToggleStatus={onToggleStatus}
							onOpenStrategyDialog={onOpenStrategyDialog}
							onOpenProviderStickyDialog={onOpenProviderStickyDialog}
						/>
					))}
				</div>
			</div>
		</div>
	);
}

export function RouteModelFlow(props: Props) {
	const {
		card,
		meta,
		providerMeta,
		globalRouteStrategy,
		density,
		copiedModelId,
		togglingId,
		onCopyModelId,
		onCreate,
		onEdit,
		onEditModel,
		onToggleStatus,
		onOpenStrategyDialog,
		onOpenProviderStickyDialog,
	} = props;
	const t = useTranslations('routes.card');
	const tFlow = useTranslations('routes.flow');
	const tModelsCard = useTranslations('models.card');
	const isImage = meta ? isImageGenerationModel(meta) : false;
	const isAudio = meta ? isAudioModel(meta) : false;
	const isAudioSpeech = meta ? isAudioSpeechModel(meta) : false;
	const isEmbedding = meta ? isEmbeddingModel(meta) : false;
	const context = formatCompactTokens(meta?.context_window);
	const maxOutput = formatCompactTokens(meta?.max_tokens);
	// ASR 与 TTS 同属 Audio；必须按计费能力区分，避免 TTS 被标成按秒转写。
	const stats = isAudio
		? t(isAudioSpeech ? 'audioSpeechModelHint' : 'audioModelHint')
		: isImage
			? t('imageModelHint')
			: isEmbedding
				? t('embeddingModelHint')
				: t('contextLine', { context, max: maxOutput });
	const tags = parseModelTagsList(meta);
	const sections = splitRoutesByProtocolAndRouteGroup(card.groupRoutes);
	const surfaceGroups = groupSectionsByRequestSurface(sections);

	return (
		<article className={`${density === 'list' ? 'route-flow-list-layout route-model-list-layout ' : ''}overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm`}>
			<header className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 bg-white px-4 py-2.5 sm:px-5">
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<button
							type="button"
							onClick={() => onEditModel(card.model_id)}
							className="truncate text-left text-sm font-semibold text-gray-900 underline-offset-2 hover:text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
						>
							{card.title}
						</button>
						<div className="flex shrink-0 items-center gap-0.5">
							<button
								type="button"
								onClick={() => void onCopyModelId(card.model_id)}
								className={`rounded-md p-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${copiedModelId === card.model_id ? 'bg-emerald-50 text-emerald-600' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'}`}
								title={copiedModelId === card.model_id ? t('copiedModelId') : t('copyModelId', { id: card.model_id })}
							>
								<ClipboardDocumentIcon className="h-4 w-4" />
							</button>
							<button
								type="button"
								onClick={() => onEditModel(card.model_id)}
								className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
								title={t('editModel', { title: card.title })}
							>
								<PencilSquareIcon className="h-4 w-4" />
							</button>
						</div>
					</div>
					<div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
						<span className="min-w-0 font-mono text-[11px] text-gray-500 [overflow-wrap:anywhere]">{card.model_id}</span>
						<span className="text-gray-300">·</span>
						<span className="text-[11px] text-gray-500">{stats}</span>
						{tags.length ? tags.slice(0, 4).map((tag) => (
							<span key={tag} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tagBadgeClass(tag)}`}>
								{tag}
							</span>
						)) : <span className="text-[10px] text-gray-400">{tModelsCard('noTags')}</span>}
					</div>
				</div>
				<div className="flex shrink-0 flex-col items-end gap-1">
					<button
						type="button"
						onClick={() => onCreate(card.model_id)}
						className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 ring-1 ring-inset ring-blue-200 hover:bg-blue-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
					>
						<PlusIcon className="h-3.5 w-3.5" />
						{tFlow('addRoute')}
					</button>
					<span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${card.activeCount > 0 ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-red-50 text-red-700 ring-red-200'}`}>
						{t('activeTotalRoutes', { active: card.activeCount, total: card.groupRoutes.length })}
					</span>
				</div>
			</header>

			<div className={`${density === 'list' ? 'route-model-list-surfaces' : 'divide-y divide-slate-300/80'} bg-slate-200/80 px-3 py-3 sm:px-4`}>
				{surfaceGroups.length ? surfaceGroups.map((surface) => (
					<FlowSection
						key={surface.key}
						surface={surface}
						card={card}
						meta={meta}
						providerMeta={providerMeta}
						globalRouteStrategy={globalRouteStrategy}
						density={density}
						copiedModelId={copiedModelId}
						togglingId={togglingId}
						onCopyModelId={onCopyModelId}
						onCreate={onCreate}
						onEdit={onEdit}
						onToggleStatus={onToggleStatus}
						onOpenStrategyDialog={onOpenStrategyDialog}
						onOpenProviderStickyDialog={onOpenProviderStickyDialog}
					/>
				)) : (
					<div className="flex min-h-20 items-center justify-center py-5 text-sm font-medium text-gray-400">
						{tFlow('noProviders')}
					</div>
				)}
			</div>
		</article>
	);
}
