'use client';

import { useEffect, useId, useMemo, useState, type CSSProperties } from 'react';
import {
	ArrowDownIcon,
	ArrowRightEndOnRectangleIcon,
	ArrowsUpDownIcon,
	ArrowRightIcon,
	CheckIcon,
	ClipboardDocumentIcon,
	PencilSquareIcon,
	PlusIcon,
	ScaleIcon,
} from '@heroicons/react/24/outline';
import { providerAccountIdentity, providerKindDisplayLabel, routeProviderAccountLabel } from '@/lib/provider-kind';
import { useLocale, useTranslations } from 'next-intl';
import { InfoHintPopover } from '@/components/InfoHintPopover';
import { VendorIcon } from '@/components/model-vendor-icon';
import { StatusSwitchTrack } from '@/components/status-switch-track';
import { UpstreamProtocolBrandIcon } from '@/components/upstream-brand-logo';
import type { GatewayModel, GatewayProvider } from '@/lib/types';
import { useStickySummary } from '../sticky-summary-store';
import type { RouteModelGroup, RequestSurfaceGroup } from '../route-utils';
import {
	compareRoutesWithinPriorityLayer,
	isRouteConfigurationAvailable,
	protocolBadgeClass,
	requestSurfacePath,
	resolveEffectiveRouteStrategy,
	summarizeRouteCustomParams,
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

export type RouteModelFlowProps = {
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
	density,
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
	density: PoolDensity;
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
	const modelCard = density === 'model-card';
	const listView = density === 'list';
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
			{listView ? <span className="route-provider-mobile-label text-xs text-slate-500">{t('listParams')}</span> : null}
			{(['headers', 'body'] as const).filter((side) => params[side]).map((side) => (
				<button
					key={side}
					type="button"
					onClick={() => onEdit(route, 'request')}
					className={`rounded border px-1.5 py-0.5 text-xs leading-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 ${!available ? 'border-slate-300 bg-slate-100 text-slate-600 hover:bg-slate-200' : side === 'headers' ? 'border-gray-200 bg-gray-50 text-gray-800 hover:bg-gray-100' : 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100'}`}
					title={side === 'headers'
						? t(params.forceOverrideHeaders ? 'paramsHeadersForceTooltip' : 'paramsHeadersTooltip')
						: t(params.forceOverrideBody ? 'paramsBodyForceTooltip' : 'paramsBodyTooltip')}
					aria-label={`${t('editRoute')}: ${t(side === 'headers' ? 'paramsHeaders' : 'paramsBody')}`}
				>
					{t(side === 'headers' ? 'paramsHeaders' : 'paramsBody')}
				</button>
			))}
		</div>
	);

	const listWeight = (
		<span className="route-provider-list-weight inline-flex shrink-0 items-center gap-1 tabular-nums" title={t('badgeWeightTooltip', { value: route.weight ?? 1 })}>
			<span className="text-xs text-slate-500">{t('listWeight')}</span>
			<span className={`text-sm font-semibold ${available ? 'text-slate-900' : 'text-slate-600'}`}>{route.weight ?? 1}</span>
		</span>
	);

	const routeStatus = (
		<div className={`flex flex-col gap-1 text-xs ${listView ? 'route-provider-list-status min-w-0 items-start' : modelCard ? 'shrink-0 items-end' : 'items-start'}`}>
			<button
				type="button"
				role="switch"
				aria-checked={enabled}
				aria-label={t('toggleRouteStatus', { model: route.provider_model_name })}
				onClick={() => onToggleStatus(route)}
				disabled={togglingId === route.id}
				className={`route-provider-status-toggle inline-flex min-h-6 items-center gap-1.5 whitespace-nowrap rounded px-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 disabled:cursor-wait disabled:opacity-50 ${enabled ? 'text-emerald-700 hover:bg-emerald-50' : 'text-slate-600 hover:bg-slate-200/70'}`}
				title={availabilityHint}
			>
				<StatusSwitchTrack checked={enabled} compact={!listView} />
				{t(enabled ? 'enabledShort' : 'disabledShort')}
			</button>
			{providerDisabled ? (
				<span className="route-provider-status-reason rounded border border-amber-200 bg-amber-50 px-1 text-xs font-medium leading-4 text-amber-800" title={t('availabilityProviderDisabledTooltip')}>
					{t('providerDisabled')}
				</span>
			) : null}
		</div>
	);

	const upstreamModel = (
		<button
			type="button"
			onClick={() => onEdit(route)}
			className={`block w-full min-w-0 rounded-md text-left font-mono text-xs leading-4 text-slate-500 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 ${listView ? '[overflow-wrap:anywhere]' : 'mt-3 bg-slate-50 px-2 py-1.5 [overflow-wrap:anywhere] hover:bg-slate-100'}`}
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

	const cardMetrics = !listView && (
		<div className="flex shrink-0 items-center gap-1.5">
			<span
				className={`inline-flex h-7 min-w-8 items-center justify-center gap-1 rounded-md border px-2 text-xs font-medium tabular-nums ${available ? 'border-gray-200 bg-gray-50 text-gray-800' : 'border-slate-300 bg-slate-100 text-slate-600'}`}
				title={t('badgeWeightTooltip', { value: route.weight ?? 1 })}
				aria-label={t('badgeWeightTooltip', { value: route.weight ?? 1 })}
			>
				<ScaleIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
				{route.weight ?? 1}
			</span>
			{stickyEnabled && stickyUsage}
		</div>
	);

	return (
		<div
			role="listitem"
			data-available={available}
			data-provider-blocked={enabled && providerDisabled || undefined}
			className={`route-provider-target relative ${listView ? 'route-provider-list-grid w-full min-w-0 border-y border-slate-200 first:border-t-0 last:border-b-0 gap-x-3 gap-y-2 px-3 py-2.5' : 'flex w-full min-w-0 flex-col overflow-hidden rounded-xl border transition'} ${
				available
					? listView ? 'bg-white hover:bg-emerald-50/40' : 'border-emerald-200 bg-white shadow-[0_2px_6px_-2px_rgba(15,23,42,0.14)] hover:border-emerald-300 hover:shadow-panel'
					: listView ? 'bg-slate-100 hover:bg-slate-200/60' : 'border-dashed border-slate-300 bg-slate-100 hover:border-slate-400'
			}`}
		>
			<span aria-hidden className={`pointer-events-none absolute inset-y-0 left-0 w-1 ${available ? 'bg-emerald-500' : enabled && providerDisabled ? 'bg-amber-500' : 'bg-slate-400'}`} />
			<div className={listView ? 'route-provider-list-content' : 'p-3'}>
				<div className={listView ? 'route-provider-list-summary' : 'contents'}>
					<div className={`flex min-w-0 items-center ${listView ? 'route-provider-list-identity gap-2' : 'gap-2.5'}`}>
						<VendorIcon vendor={provider?.vendor_key} iconKey={provider?.icon_key} size="compact" className={available ? '' : 'opacity-60 grayscale'} />
						<div className={listView ? 'min-w-0 flex-1' : 'flex min-w-0 flex-1 items-center gap-2'}>

							<button
								type="button"
								onClick={() => onEdit(route)}
								className={`group min-w-0 rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 ${listView ? 'block w-full' : 'flex-1'}`}
								title={t('editRoute')}
							>
								<span className="flex items-center gap-1.5">
									<span className={`${listView ? 'route-provider-list-name ' : 'route-provider-card-name '}min-w-0 truncate text-xs font-medium group-hover:text-gray-800 ${available ? 'text-slate-900' : 'text-slate-600'}`} title={providerName}>{providerName}</span>
								</span>
								{showKind && !listView ? (
									<span className="mt-0.5 block truncate text-xs leading-4 text-slate-500" title={kindLabel ?? undefined}>
										{kindLabel}
									</span>
								) : null}
							</button>
							{density === 'list' ? (
								<div className="route-provider-list-secondary mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5">
									{showKind ? <span className="min-w-0 truncate text-slate-500" title={kindLabel ?? undefined}>{kindLabel}</span> : null}
									{routeStatus}
								</div>
							) : null}
							{!listView && (modelCard ? routeStatus : cardMetrics)}
						</div>
					</div>
				</div>
				{!listView ? upstreamModel : null}
				{listView ? (
					<div className="route-provider-list-model min-w-0">
						{upstreamModel}
					</div>
				) : null}
				<div className={listView ? 'route-provider-list-meta' : 'mt-3 flex min-h-4 flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-4'}>
					{modelCard ? cardMetrics : !listView && routeStatus}
					{density === 'list' ? listWeight : null}
					{!listView && (params.headers || params.body) ? paramsBadges : null}
					{density === 'list' && stickyEnabled ? (
						<div className="route-provider-list-sticky flex min-w-0 items-center justify-center gap-1">
							<span className="route-provider-mobile-label text-xs text-slate-500">{t('listStickyUsers')}</span>
							{stickyUsage}
						</div>
					) : null}
					{density === 'list' && (params.headers || params.body) ? paramsBadges : null}
				</div>
			</div>
			<RouteTargetPricing muted={!available} compact={listView} priceOverride={route.price_override} onEdit={() => onEdit(route, 'pricing')} />
		</div>
	);
}

const CONNECTOR_PLUS_BUTTON_CLASS =
	'inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-gray-50 hover:text-gray-800 hover:ring-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500';

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

type RouteGroupDetailsProps = {
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
};

function routeGroupModelId(modelId: string, group: string) {
	return group === 'default' ? modelId : `${modelId}:${group}`;
}

function RouteGroupDetails({ modelId, routeGroup, copiedModelId, onCopyModelId, sticky, modelIdLabel, stickyLabel }: RouteGroupDetailsProps & {
	modelIdLabel?: string;
	stickyLabel?: string;
}) {
	const tCard = useTranslations('routes.card');
	const tControls = useTranslations('routes.flow.controls');
	const requestedModelId = routeGroupModelId(modelId, routeGroup);
	const copied = copiedModelId === requestedModelId;

	return (
		<div className="route-group-details">
			<div className="flex min-w-0 items-start gap-1 pt-2">
				{modelIdLabel && <span className="shrink-0 text-xs font-medium text-slate-600">{modelIdLabel}</span>}
				{modelIdLabel ? (
					<InfoHintPopover
						label={`${requestedModelId} · ${tControls('modelHelpLabel')}`}
						openOnHover openOnFocus portal align="start"
						icon={<span className="cursor-help select-text text-left font-mono text-xs text-slate-600 underline decoration-dashed decoration-slate-400 underline-offset-4 [overflow-wrap:anywhere]">{requestedModelId}</span>}
					>
						<p className="leading-5">{tControls('modelHelp')}</p>
					</InfoHintPopover>
				) : (
					<span className="min-w-0 flex-1 font-mono text-xs leading-[14px] text-slate-600 [overflow-wrap:anywhere]" title={requestedModelId}>
						{requestedModelId}
					</span>
				)}
				<button
					type="button"
					onClick={() => void onCopyModelId(requestedModelId)}
					className={`shrink-0 rounded p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 ${copied ? 'bg-emerald-50 text-emerald-600' : 'text-slate-400 hover:bg-slate-100 hover:text-gray-800'}`}
					title={copied ? tCard('copiedModelId') : tCard('copyModelId', { id: requestedModelId })}
					aria-label={copied ? tCard('copiedModelId') : tCard('copyModelId', { id: requestedModelId })}
				>
					<ClipboardDocumentIcon className="h-3.5 w-3.5" />
				</button>
			</div>
			{sticky ? (
				<div className="route-group-sticky mt-2 flex min-w-0">
					{stickyLabel && <span className="text-xs font-medium text-slate-600">{stickyLabel}</span>}
					<ProviderStickyChip
						showLabel={!stickyLabel}
						enabled={sticky.enabled}
						idleTtlSeconds={sticky.idleTtlSeconds}
						poolId={sticky.poolId}
						onClick={sticky.onClick}
					/>
				</div>
			) : null}
		</div>
	);
}

export function RouteGroupInfo({ centered = false, ...details }: RouteGroupDetailsProps & { centered?: boolean }) {
	const t = useTranslations('routes.flow');
	const { routeGroup, modelId } = details;
	const requestedModelId = routeGroupModelId(modelId, routeGroup);
	const isDefaultGroup = routeGroup === 'default';

	return (
		<div data-default-group={isDefaultGroup} className={`route-group-node route-group-info relative w-full min-w-0 ${centered ? 'grid grid-rows-2' : ''}`} aria-label={t('routeMatchAria', { group: routeGroup, model: requestedModelId })}>
			<div className={`route-group-label flex min-w-0 gap-1.5 ${centered ? 'items-end pb-2' : 'h-8 items-start pt-1'}`}>
				<span className={`shrink-0 text-xs font-medium ${isDefaultGroup ? 'text-sky-700' : 'text-violet-700'}`}>{t('routeGroup')}</span>
				<span className={`min-w-0 truncate text-xs font-medium ${isDefaultGroup ? 'text-sky-900' : 'text-violet-900'}`} title={routeGroup}>{routeGroup}</span>
			</div>
			<span className={`route-group-rail absolute inset-x-0 h-px ${centered ? 'top-1/2' : 'top-8'} ${isDefaultGroup ? 'bg-sky-300' : 'bg-violet-300'}`} aria-hidden />
			<RouteGroupDetails {...details} />
		</div>
	);
}

export function RequestSurfaceNode({
	surface,
	modelId,
	selection,
}: {
	surface: Pick<RequestSurfaceGroup, 'protocol' | 'protocolLabel' | 'requestOperation'>;
	modelId?: string;
	selection?: { selected: boolean; panelId: string; onSelect: () => void };
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

	const protocolBadge = (
		<span
			className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded ring-1 ring-inset ${protocolBadgeClass(surface.protocol)}`}
			title={surface.protocolLabel}
			aria-label={surface.protocolLabel}
		>
			<UpstreamProtocolBrandIcon protocol={surface.protocol} />
		</span>
	);

	return (
		<div data-selected={selection?.selected} className="route-entry-node relative w-full min-w-0 rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-3">
			{selection && (
				<button type="button" className="route-entry-select" onClick={selection.onSelect}
					title={`${surface.protocolLabel} · ${surfacePath}`} aria-label={`${surface.protocolLabel} · ${surfacePath}`} aria-pressed={selection.selected} aria-controls={selection.panelId} />
			)}
			{!selection && (
				<div className="flex items-center justify-between gap-2">
					<span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-800">
						<ArrowRightEndOnRectangleIcon className="h-4 w-4" aria-hidden />
						{t('requestNode')}
					</span>
					{protocolBadge}
				</div>
			)}
			<div className={`flex min-w-0 items-center ${selection ? 'gap-1.5' : 'mt-1.5 gap-1'}`}>
				{selection && protocolBadge}
				<code
					className={`block min-w-0 flex-1 select-text font-mono text-xs font-medium leading-4 text-gray-800 ${pathDisplay === 'full' ? 'whitespace-normal [overflow-wrap:anywhere]' : 'truncate'}`}
					title={surfacePath}
				>
					{pathDisplay === 'full' ? surfacePath.split(/(?=\/)/).map((segment, index) => (
						<span key={index}><wbr />{segment}</span>
					)) : surfacePath}
				</code>
				<button
					type="button"
					onClick={() => void copyPath()}
					aria-label={copyStatus === 'copied' ? tCommon('copied') : `${tGuide('copyPath')} · ${surfacePath}`}
					title={copyStatus === 'copied' ? tCommon('copied') : `${tGuide('copyPath')} · ${surfacePath}`}
					className="route-path-copy inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-700 hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
				>
					{copyStatus === 'copied' ? <CheckIcon className="h-3.5 w-3.5" aria-hidden /> : <ClipboardDocumentIcon className="h-3.5 w-3.5" aria-hidden />}
				</button>
			</div>
			<span role="status" className={copyStatus === 'failed' ? 'mt-1 block text-xs text-red-600' : 'sr-only'}>
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

type PoolDensity = RouteFlowDensity | 'model-card';

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
	density: PoolDensity;
	section: RouteProtocolGroupSection<RouteListRow>;
	card: RouteModelGroup;
	meta: GatewayModel | undefined;
	providerMeta: Map<string, GatewayProvider>;
	globalRouteStrategy: string | null;
	stickyCountsByTarget: Map<string, number>;
	stickyTotal: number | null;
	togglingId: string | null;
	onEdit: RouteModelFlowProps['onEdit'];
	onToggleStatus: RouteModelFlowProps['onToggleStatus'];
	onOpenStrategyDialog: RouteModelFlowProps['onOpenStrategyDialog'];
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
	const layerLabel = t(layerIndex === 0 ? 'firstAttempt' : 'fallbackLayer');

	return (
		<div className="route-priority-tier w-full min-w-0" data-preferred={layerIndex === 0 || undefined}>
			<div className={isList ? `route-priority-heading flex min-w-0 flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/80 px-3 py-2 ${layerIndex > 0 ? 'border-t border-t-slate-200' : ''}` : 'route-priority-heading mb-3 flex min-w-0 flex-wrap items-center gap-2 px-0.5 py-1'}>
				<div className="route-tier-label contents">
					<span
						className="route-tier-number inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 text-gray-900"
						title={t('badgePriorityTooltip', { value: priority })}
						aria-label={t('badgePriorityTooltip', { value: priority })}
					>
						<ArrowsUpDownIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
						<span className="text-sm font-semibold tabular-nums">{priority}</span>
					</span>
					{layerIndex > 0 ? (
						<button type="button" onClick={onOpenFailover} title={t('failoverRules')} aria-label={t('failoverRules')} className="inline-flex items-center gap-1 rounded text-xs font-medium text-slate-600 hover:text-gray-800 focus-visible:outline-gray-500">
							<ArrowDownIcon className="route-fallback-direction h-3 w-3" aria-hidden />
							{layerLabel}
						</button>
					) : <span className="text-xs font-medium text-slate-700">{layerLabel}</span>}
				</div>
				<div className="route-tier-details contents">
					<span
						className={`route-tier-availability text-xs tabular-nums ${availableCount > 0 ? 'text-slate-500' : 'font-medium text-amber-700'}`}
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
					{density !== 'model-card' && (
						<span className={density === 'list' ? 'min-w-3 flex-1' : 'h-px min-w-0 flex-1 bg-slate-200'} aria-hidden />
					)}
					<div
						className="route-tier-strategy ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5"
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
							className={`inline-flex max-w-full items-center gap-1 rounded px-1 py-0.5 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 ${isList ? 'text-slate-500 hover:bg-white hover:text-gray-800' : 'text-gray-800 hover:bg-gray-50 hover:text-gray-900'}`}
							title={t('tierStrategyEdit', {
								strategy: displayName,
								source: sourceLabel,
							})}
						>
							<span className="truncate">{displayName}</span>
							<PencilSquareIcon className="h-3 w-3 shrink-0 text-gray-500" />
						</button>
					</div>
				</div>
			</div>


			<div className={isList ? 'route-provider-list-body flex min-w-0 flex-col gap-1.5 bg-white' : 'route-provider-card-grid'} role="list" aria-label={t('listProvider')}>
				{routes.map((route) => (
					<RouteTarget
						density={density}
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
					<span className="text-xs text-gray-400">{t('noProviders')}</span>
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
	density: PoolDensity;
	togglingId: string | null;
	onEdit: RouteModelFlowProps['onEdit'];
	onToggleStatus: RouteModelFlowProps['onToggleStatus'];
	onOpenStrategyDialog: RouteModelFlowProps['onOpenStrategyDialog'];
	onOpenProviderStickyDialog: RouteModelFlowProps['onOpenProviderStickyDialog'];
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

	return (
		<>
			<div
				className={
					density === 'list' ? 'route-upstream-pool route-provider-list flex min-w-0 flex-col items-stretch overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_3px_10px_-2px_rgba(15,23,42,0.22)]'
						: density === 'model-card' ? 'route-card-tiers'
						: `route-upstream-pool route-provider-card-group flex min-w-0 flex-col gap-5 rounded-xl border border-slate-300/70 border-l-[3px] p-3 sm:p-4 ${section.group === 'default' ? 'border-l-sky-300' : 'border-l-violet-300'}`
				}
				role="group"
				data-route-group={section.group}
				data-paired={density === 'model-card' && priorityLayers.length === 2 && priorityLayers[1][1].length === 1
					? (priorityLayers[0][1].length === 1 ? 'equal' : 'single-fallback') : undefined}
				aria-label={t('routeGroupProviders', { group: section.group })}
			>
				{priorityLayers.map(([priority, routes], layerIndex) => (
					<div
						key={priority}
						data-single={routes.length === 1}
						className="min-w-0"
					>
						{density === 'model-card' && layerIndex > 0 && (
							<ArrowRightIcon className="route-tier-connector" aria-hidden />
						)}
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

export function ModelUpstreamPool({ density, ...props }: Omit<UpstreamPoolPanelProps, 'density'> & { density: RouteFlowDensity }) {
	if (density === 'list') return <UpstreamPoolPanel {...props} density="list" />;

	const count = props.section.routes.length;
	return (
		<div className="route-card-upstreams" data-target-count={count}
			style={{ '--route-count': count } as CSSProperties}>
			<UpstreamPoolPanel {...props} density="model-card" />
		</div>
	);
}

type FlowSectionProps = Omit<RouteModelFlowProps, 'onEditModel' | 'onCreate'> & {
	surfaceGroups: RequestSurfaceGroup[];
	surface: RequestSurfaceGroup;
	selectSurface: (key: string) => void;
	section: RouteProtocolGroupSection<RouteListRow>;
	selectGroup: (group: string) => void;
};

export function ModelSurface({ surfaceGroups, surface, selectSurface, section, selectGroup, card, density, providerMeta, copiedModelId, onCopyModelId, ...pool }: FlowSectionProps) {
	const t = useTranslations('routes.flow');
	const tKind = useTranslations('providers.kind');
	const locale = useLocale();
	const id = useId();
	const tabId = (index: number) => `${id}-tab-${index}`;
	const sections = surface.sections;
	const groupSelector = (
		<div role="tablist" aria-label={t('routeGroup')} className="route-card-group-switch">
			{sections.map((item, index) => {
				const active = item.routes.filter(route => isRouteConfigurationAvailable(route, providerMeta.get(route.provider_id))).length;
				const isSelected = item.key === section.key;
				const hint = t('groupAvailableCount', { active });
				return (
					<button key={item.key} id={tabId(index)} type="button" role="tab" aria-selected={isSelected}
						aria-controls={`${id}-panel`} tabIndex={isSelected ? 0 : -1}
						className="route-card-group-tab" title={hint}
						onClick={() => selectGroup(item.group)}
						onKeyDown={event => {
							let next: number;
							switch (event.key) {
								case 'ArrowRight': next = (index + 1) % sections.length; break;
								case 'ArrowLeft': next = (index - 1 + sections.length) % sections.length; break;
								case 'Home': next = 0; break;
								case 'End': next = sections.length - 1; break;
								default: return;
							}
							event.preventDefault();
							selectGroup(sections[next].group);
							document.getElementById(tabId(next))?.focus();
						}}>
						<span className="truncate">{item.group}</span>
						<span className="text-xs font-normal tabular-nums" aria-label={hint}>
							{active}
						</span>
					</button>
				);
			})}
		</div>
	);

	return (
		<section className="route-card-surface route-model-surface-columns" aria-label={t('routeGroupProviders', { group: section.group })}>
			<div id={id} className="route-surface-toolbar">
				<div role="group" aria-label={t('requestNode')} className="route-entry-picker">
					<h3 className="text-xs font-medium text-slate-600">{t('controls.entry')}</h3>
					<div className="route-entry-options">
						{surfaceGroups.map(item => (
							<RequestSurfaceNode key={item.key} surface={item} modelId={card.model_id}
								selection={{ selected: item.key === surface.key, panelId: id, onSelect: () => selectSurface(item.key) }} />
						))}
					</div>
				</div>
				<div className="route-group-bookmarks">
					<span className="text-xs font-medium text-slate-600">{t('controls.group')}</span>
					{groupSelector}
				</div>
				<RouteGroupDetails modelId={card.model_id} routeGroup={section.group} copiedModelId={copiedModelId} onCopyModelId={onCopyModelId}
					modelIdLabel={t('controls.model')} stickyLabel={t('controls.sticky')}
					sticky={{
						enabled: section.poolStickyEnabled,
						idleTtlSeconds: section.poolStickyIdleTtlSeconds,
						poolId: section.poolId,
						onClick: () => openSectionStickyDialog(pool.onOpenProviderStickyDialog, card, section, providerMeta, locale, tKind('custom')),
					}}
				/>
			</div>
			<div id={`${id}-panel`} role="tabpanel" aria-labelledby={tabId(sections.indexOf(section))} className="min-w-0">
				<ModelUpstreamPool key={section.key} {...pool} density={density} card={card} section={section} providerMeta={providerMeta} />
			</div>
		</section>
	);
}
