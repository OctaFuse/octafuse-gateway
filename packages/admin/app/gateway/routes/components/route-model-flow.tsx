'use client';

import { useMemo, useState, type KeyboardEvent } from 'react';
import {
	ArrowDownIcon,
	ArrowLongRightIcon,
	CheckIcon,
	ChevronDownIcon,
	ClipboardDocumentIcon,
	ClockIcon,
	ExclamationTriangleIcon,
	PencilSquareIcon,
	PauseIcon,
	PlusIcon,
	PowerIcon,
	UsersIcon,
} from '@heroicons/react/24/outline';
import {
	isAudioModel,
	isAudioSpeechModel,
	isImageGenerationModel,
} from '@octafuse/core/db/model-modalities';
import { providerKindDisplayLabel, routeProviderAccountLabel } from '@/lib/provider-kind';
import { useLocale, useTranslations } from 'next-intl';
import { UpstreamProtocolBrandIcon } from '@/components/upstream-brand-logo';
import { formatCompactTokens } from '@/lib/format-compact-tokens';
import {
	parseChargedFactorFromPriceOverride,
	parseMeteredFactorFromPriceOverride,
} from '@/lib/pricing-ui';
import type { GatewayModel, GatewayProvider } from '@/lib/types';
import { tagBadgeClass } from '../../models/model-utils';
import { useStickySummary } from '../sticky-summary-store';
import type { RouteModelGroup, RequestSurfaceGroup } from '../route-utils';
import {
	compareRoutesWithinPriorityLayer,
	factorChipClassForValue,
	factorLevelForValue,
	formatFactorMultiplier,
	formatFactorMultiplierForChip,
	formatScheduleRange,
	formatSharedScheduleWindowsHint,
	resolveRouteScheduleDisplay,
	groupSectionsByRequestSurface,
	hasBasePricingInversion,
	parseModelTagsList,
	protocolBadgeClass,
	requestSurfacePath,
	resolveEffectiveRouteStrategy,
	routeHasCustomParamsForceOverride,
	splitRoutesByProtocolAndRouteGroup,
} from '../route-utils';
import {
	type RouteFlowDensity,
	type RouteListRow,
	type RouteProtocolGroupSection,
} from '../types';
import { FailoverRulesDialog } from './failover-rules-dialog';
import { ProviderStickyChip } from './provider-sticky-chip';

const EMPTY_STICKY_COUNTS = new Map<string, number>();

type PriorityTierPreviewItem = {
	id: string;
	name: string;
	enabled: boolean;
};

type PriorityTierSummary = {
	activeCount: number;
	totalCount: number;
	previewItems: PriorityTierPreviewItem[];
};

function summarizePriorityTier(
	routes: RouteListRow[],
	providerMeta: Map<string, GatewayProvider>,
	locale: string,
	customLabel: string,
): PriorityTierSummary {
	let activeCount = 0;
	const previewItems: PriorityTierPreviewItem[] = [];

	for (const route of routes) {
		const enabled = route.status === 'active';
		if (enabled) activeCount += 1;
		const provider = providerMeta.get(route.provider_id);
		previewItems.push({
			id: route.id,
			name: routeProviderAccountLabel(route, provider, locale, customLabel),
			enabled,
		});
	}

	return {
		activeCount,
		totalCount: routes.length,
		previewItems,
	};
}

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
	targets: Array<{ id: string; providerName: string; priority: number; weight: number }>
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
	onEdit: (route: RouteListRow) => void;
	onEditModel: (modelId: string) => void;
	onToggleStatus: (route: RouteListRow) => void;
	onOpenStrategyDialog: OpenStrategyDialog;
	onOpenProviderStickyDialog: OpenProviderStickyDialog;
};

function RouteTarget({
	route,
	provider,
	stickyBindingCount,
	togglingId,
	onEdit,
	onToggleStatus,
}: {
	route: RouteListRow;
	provider: GatewayProvider | undefined;
	stickyBindingCount: number;
	togglingId: string | null;
	onEdit: (route: RouteListRow) => void;
	onToggleStatus: (route: RouteListRow) => void;
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
	const charged = parseChargedFactorFromPriceOverride(route.price_override);
	const metered = parseMeteredFactorFromPriceOverride(route.price_override);
	const chargedValue = charged != null && Number.isFinite(charged) ? charged : 1;
	const meteredValue = metered != null && Number.isFinite(metered) ? metered : 1;
	const scheduleWindows = resolveRouteScheduleDisplay(route.price_override);
	const scheduleHint = formatSharedScheduleWindowsHint(scheduleWindows);
	const hasSchedule = Boolean(scheduleHint);
	const scheduleTooltip = t('badgeScheduleTooltip', {
		windows: scheduleHint || '',
	});
	const hasPricingInversion = hasBasePricingInversion(chargedValue, meteredValue);
	const enabled = route.status === 'active';
	const providerDisabled = provider?.status === 'disabled';

	const factorTooltip = (factor: number, side: 'charged' | 'metered') =>
		t(side === 'charged' ? 'badgeChargedTooltip' : 'badgeMeteredTooltip', {
			value: formatFactorMultiplier(factor),
			status: tList(`factorStatus.${side}.${factorLevelForValue(factor)}`),
		});
	const weekdayFormatter = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
	const formatWeekdays = (days: number[]) => {
		const sorted = [...new Set(days)].sort((a, b) => a - b);
		const ranges: number[][] = [];
		for (const day of sorted) {
			const last = ranges[ranges.length - 1];
			if (last && day === last[last.length - 1] + 1) last.push(day);
			else ranges.push([day]);
		}
		const label = (day: number) => weekdayFormatter.format(new Date(Date.UTC(2026, 0, 4 + day)));
		return ranges.map(range => range.length > 1 ? `${label(range[0])}–${label(range[range.length - 1])}` : label(range[0])).join(' / ');
	};
	const pricingColumns = 'grid grid-cols-[minmax(0,1fr)_3.75rem_3.75rem] items-center gap-x-1';

	return (
		<div
			className={`flex w-full min-w-[15rem] flex-col overflow-hidden rounded-xl border border-l-4 [border-left-style:solid] transition sm:w-64 sm:max-w-full ${
				enabled
					? 'border-emerald-200 border-l-emerald-500 bg-white shadow-sm hover:border-emerald-400 hover:shadow-md'
					: 'border-dashed border-slate-300 border-l-slate-400 bg-slate-100/80 hover:border-slate-400'
			}`}
		>
			<div className="p-3">
				<div className="flex items-start gap-2">
					<button
						type="button"
						onClick={() => onEdit(route)}
						className="group min-w-0 flex-1 rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
						title={t('editRoute')}
					>
						<span className="flex items-center gap-1.5">
							<span className={`min-w-0 truncate text-xs font-semibold ${enabled ? 'text-slate-900' : 'text-slate-600'}`} title={providerName}>{providerName}</span>
							<PencilSquareIcon className="h-3 w-3 shrink-0 text-slate-400 group-hover:text-blue-600" aria-hidden />
						</span>
						<span className="mt-1 block min-h-4 truncate text-[10px] leading-4 text-slate-500" title={kindLabel ?? undefined}>
							{showKind ? kindLabel : null}
						</span>
					</button>
					<button
						type="button"
						onClick={() => onToggleStatus(route)}
						disabled={togglingId === route.id}
						aria-pressed={enabled}
						className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-wait disabled:opacity-50 ${
							enabled ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
						}`}
						title={enabled ? tList('routeEnabled') : tList('routeDisabled')}
						aria-label={enabled ? tList('routeEnabled') : tList('routeDisabled')}
					>
						<PowerIcon className="h-3.5 w-3.5" aria-hidden />
					</button>
				</div>
				<button
					type="button"
					onClick={() => onEdit(route)}
					className={`mt-2 block w-full truncate rounded-md px-2 py-1.5 text-left font-mono text-[10px] leading-4 text-slate-600 hover:bg-slate-200/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${enabled ? 'bg-slate-50' : 'bg-white/80'}`}
					title={route.provider_model_name}
					aria-label={`${t('editRoute')}: ${route.provider_model_name}`}
				>
					{route.provider_model_name}
				</button>
				<div className="mt-2.5 flex min-h-4 flex-wrap items-center gap-x-2 gap-y-1 text-[10px] leading-4">
					<span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold ${enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-600 text-white'}`}>
						{enabled ? <CheckIcon className="h-3 w-3" aria-hidden /> : <PauseIcon className="h-3 w-3" aria-hidden />}
						{enabled ? t('enabledShort') : t('disabledShort')}
					</span>
					<span className="tabular-nums text-slate-600" title={t('badgeWeightTooltip', { value: route.weight ?? 1 })}>
						{t('targetWeight', { value: route.weight ?? 1 })}
					</span>
					{route.custom_params ? (
						<span className="rounded bg-slate-100 px-1.5 text-slate-500" title={routeHasCustomParamsForceOverride(route.custom_params) ? t('badgeParamsForceOverrideTooltip') : t('badgeParamsTooltip')}>
							{t('targetParams')}
						</span>
					) : null}
					{stickyBindingCount > 0 ? (
						<span className="ml-auto inline-flex items-center gap-1 tabular-nums text-orange-700" title={t('stickyBoundUsersTooltip', { count: stickyBindingCount })} aria-label={t('stickyBoundUsersTooltip', { count: stickyBindingCount })}>
							<UsersIcon className="h-3 w-3" aria-hidden />{stickyBindingCount}
						</span>
					) : null}
				</div>
			</div>
			<button
				type="button"
				onClick={() => onEdit(route)}
				className="w-full border-t border-slate-100 px-3 py-2 text-left transition hover:bg-slate-50/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
				title={hasSchedule ? scheduleTooltip : t('editRoute')}
				aria-label={`${t('editRoute')} · ${tList('factorsAria')}${hasSchedule ? ` · ${scheduleTooltip}` : ''}`}
			>
				<span className={`${pricingColumns} pb-1.5 text-[10px] leading-4 text-slate-500`}>
					<span className="inline-flex items-center gap-1"><ClockIcon className="h-3 w-3" aria-hidden />{t('pricingPeriod')}</span>
					<span className="text-right">{t('pricingCharged')}</span>
					<span className="text-right">{t('pricingMetered')}</span>
				</span>
				<span className={`${pricingColumns} min-h-7`}>
					<span className="text-[11px] text-slate-600">{t('basePricing')}</span>
					<span className="justify-self-end" title={factorTooltip(chargedValue, 'charged')} aria-label={factorTooltip(chargedValue, 'charged')}>
						<span className={factorChipClassForValue(chargedValue, 'charged')}>{formatFactorMultiplierForChip(chargedValue)}</span>
					</span>
					<span className="justify-self-end" title={factorTooltip(meteredValue, 'metered')} aria-label={factorTooltip(meteredValue, 'metered')}>
						<span className={factorChipClassForValue(meteredValue, 'metered')}>{formatFactorMultiplierForChip(meteredValue)}</span>
					</span>
				</span>
				{scheduleWindows.map((window, index) => (
					<span key={`${window.start}-${window.end}-${index}`} className={`${pricingColumns} min-h-7 border-t border-dashed border-slate-100 py-1 text-[11px]`}>
						<span className="min-w-0 text-slate-600">
							<span className="block whitespace-nowrap tabular-nums">{formatScheduleRange(window.start, window.end)}</span>
							{window.days && window.days.length < 7 ? (
								<span className="block text-[10px] leading-4 text-slate-500">{formatWeekdays(window.days)}</span>
							) : null}
						</span>
						<span className="justify-self-end px-1.5 font-mono font-medium tabular-nums text-slate-700" title={factorTooltip(window.charged_factor, 'charged')}>{formatFactorMultiplierForChip(window.charged_factor)}</span>
						<span className="justify-self-end px-1.5 font-mono font-medium tabular-nums text-slate-700" title={factorTooltip(window.metered_factor, 'metered')}>{formatFactorMultiplierForChip(window.metered_factor)}</span>
					</span>
				))}
			</button>
			{providerDisabled || hasPricingInversion ? (
				<div className="mt-auto space-y-1 border-t border-amber-100 bg-amber-50/70 px-3 py-1.5 text-[10px] leading-4 text-amber-800">
					{providerDisabled ? <span className="flex items-center gap-1.5"><ExclamationTriangleIcon className="h-3 w-3 shrink-0" aria-hidden />{t('providerDisabled')}</span> : null}
					{hasPricingInversion ? <span className="flex items-center gap-1.5" title={tList('baseInversionTooltip')}><ExclamationTriangleIcon className="h-3 w-3 shrink-0" aria-hidden />{tList('baseInversionBadge')}</span> : null}
				</div>
			) : null}
		</div>
	);
}

const CONNECTOR_PLUS_BUTTON_CLASS =
	'inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm ring-1 ring-inset ring-slate-300 hover:bg-blue-50 hover:text-blue-600 hover:ring-blue-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

export function FlowConnectorAdd({
	railClass,
	label,
	onClick,
}: {
	railClass: string;
	label: string;
	onClick: () => void;
}) {
	return (
		<>
			<div className="pointer-events-none absolute right-0 top-1/2 hidden h-5 w-8 -translate-y-1/2 items-center justify-center xl:flex">
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
			<div className="flex justify-center pt-1 xl:hidden">
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
	return section.routes.map((route) => ({
		id: route.id,
		providerName: routeProviderAccountLabel(route, providerMeta.get(route.provider_id), locale, customLabel),
		priority: route.priority,
		weight: Number(route.weight ?? 1) || 1,
	}));
}

export function openSectionStickyDialog(
	onOpen: OpenProviderStickyDialog,
	card: RouteModelGroup,
	section: RouteProtocolGroupSection<RouteListRow>,
	providerMeta: Map<string, GatewayProvider>,
	locale: string,
	customLabel: string,
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
	);
}

export function RouteGroupNode({
	modelId,
	routeGroup,
	copiedModelId,
	onCopyModelId,
	sticky,
}: {
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
		<div className="w-full min-w-0">
			<div
				className={`w-full min-w-0 rounded-lg border px-3 py-2.5 shadow-sm ${
					isDefaultGroup
						? 'border-sky-200 bg-sky-50/75'
						: 'border-violet-200 bg-violet-50/75'
				}`}
				aria-label={t('routeMatchAria', { group: routeGroup, model: requestedModelId })}
			>
				<div className="flex min-w-0 items-center gap-1.5">
					<span
						className={`shrink-0 text-[10px] font-semibold uppercase tracking-wider ${
							isDefaultGroup ? 'text-sky-700' : 'text-violet-700'
						}`}
					>
						{t('routeGroup')}
					</span>
					<span
						className={`min-w-0 truncate text-[11px] font-semibold ${
							isDefaultGroup ? 'text-sky-900' : 'text-violet-900'
						}`}
					>
						{routeGroup}
					</span>
				</div>
				<div className="mt-1 flex min-w-0 items-center gap-0.5">
					<span
						className={`min-w-0 truncate font-mono text-[10px] ${
							isDefaultGroup ? 'text-sky-700' : 'text-violet-700'
						}`}
						title={`model=${requestedModelId}`}
					>
						model={requestedModelId}
					</span>
					<button
						type="button"
						onClick={() => void onCopyModelId(requestedModelId)}
						className={`shrink-0 rounded p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
							copied
								? 'bg-emerald-50 text-emerald-600'
								: isDefaultGroup
									? 'text-sky-500 hover:bg-sky-100 hover:text-sky-800'
									: 'text-violet-500 hover:bg-violet-100 hover:text-violet-800'
						}`}
						title={copied ? tCard('copiedModelId') : tCard('copyModelId', { id: requestedModelId })}
					>
						<ClipboardDocumentIcon className="h-3.5 w-3.5" />
					</button>
				</div>
			</div>
			{sticky ? (
				<div className="mt-1.5 flex justify-center">
					<ProviderStickyChip
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

export function RequestSurfaceNode({
	surface,
	modelId,
}: {
	surface: Pick<RequestSurfaceGroup, 'protocol' | 'protocolLabel' | 'requestOperation'>;
	modelId?: string;
}) {
	const t = useTranslations('routes.flow');
	const surfacePath = requestSurfacePath(
		surface.protocol,
		surface.requestOperation,
		modelId
	);

	return (
		<div className="w-full min-w-0 rounded-lg border border-blue-200 bg-blue-50/75 px-3 py-2.5 shadow-sm">
			<div className="flex items-center justify-between gap-2">
				<span className="text-[10px] font-semibold uppercase tracking-wider text-blue-600">
					{t('requestNode')}
				</span>
				<span
					className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded ring-1 ring-inset ${protocolBadgeClass(surface.protocol)}`}
					title={surface.protocolLabel}
					aria-label={surface.protocolLabel}
				>
					<UpstreamProtocolBrandIcon protocol={surface.protocol} />
				</span>
			</div>
			<div className="mt-1.5 min-w-0">
				<span
					className="block min-w-0 truncate font-mono text-[11px] font-semibold text-gray-800"
					title={surfacePath}
				>
					{surfacePath}
				</span>
			</div>
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

function FailoverConnector({
	density,
	onOpen,
}: {
	density: RouteFlowDensity;
	onOpen: () => void;
}) {
	const t = useTranslations('routes.flow');
	const isSummary = density === 'summary';

	return (
		<div
			className={
				isSummary
					? 'flex shrink-0 items-center justify-center py-0.5'
					: 'flex shrink-0 items-center justify-center py-0.5 md:px-0.5 md:py-0'
			}
		>
			<button
				type="button"
				onClick={onOpen}
				className={
					isSummary
						? 'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-slate-500 transition hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500'
						: 'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-slate-500 transition hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 md:flex-col md:gap-0.5'
				}
				title={t('failoverRules')}
				aria-label={t('failoverRules')}
			>
				{isSummary ? (
					<ArrowDownIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
				) : (
					<>
						<ArrowDownIcon className="h-3.5 w-3.5 shrink-0 md:hidden" aria-hidden />
						<ArrowLongRightIcon className="hidden h-4 w-4 shrink-0 md:block" aria-hidden />
					</>
				)}
				<span className="text-[9px] font-semibold leading-none tracking-wide">
					{t('failoverShort')}
				</span>
			</button>
		</div>
	);
}

function PriorityTierPanel({
	priority,
	routes,
	layerIndex,
	density,
	expanded,
	onToggleExpanded,
	section,
	card,
	meta,
	providerMeta,
	globalRouteStrategy,
	stickyCountsByTarget,
	togglingId,
	onEdit,
	onToggleStatus,
	onOpenStrategyDialog,
}: {
	priority: number;
	routes: RouteListRow[];
	layerIndex: number;
	density: RouteFlowDensity;
	expanded: boolean;
	onToggleExpanded: () => void;
	section: RouteProtocolGroupSection<RouteListRow>;
	card: RouteModelGroup;
	meta: GatewayModel | undefined;
	providerMeta: Map<string, GatewayProvider>;
	globalRouteStrategy: string | null;
	stickyCountsByTarget: Map<string, number>;
	togglingId: string | null;
	onEdit: Props['onEdit'];
	onToggleStatus: Props['onToggleStatus'];
	onOpenStrategyDialog: Props['onOpenStrategyDialog'];
}) {
	const t = useTranslations('routes.flow');
	const tStrategy = useTranslations('routes.strategy');
	const tKind = useTranslations('providers.kind');
	const locale = useLocale();
	const isSummary = density === 'summary';
	const summary = summarizePriorityTier(routes, providerMeta, locale, tKind('custom'));
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
	const showDetails = !isSummary || expanded;
	const layerLabel = layerIndex === 0 ? t('firstAttempt') : t('fallbackLayer');

	return (
		<div
			className={
				isSummary
					? 'min-w-0 max-w-full'
					: 'w-fit min-w-0 max-w-full'
			}
		>
			<div
				className={
					isSummary
						? 'mb-2 flex min-w-0 cursor-pointer flex-wrap items-center gap-1.5 rounded-md px-0.5 py-1 transition hover:bg-slate-100/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500'
						: 'mb-2 flex min-w-0 flex-wrap items-center gap-1.5 px-0.5 py-1'
				}
				{...(isSummary
					? {
							role: 'button' as const,
							tabIndex: 0,
							'aria-expanded': expanded,
							'aria-label': expanded
								? t('collapseTierAria', { priority })
								: t('expandTierAria', { priority }),
							title: expanded ? t('collapseTier') : t('expandTier'),
							onClick: onToggleExpanded,
							onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
								if (event.key === 'Enter' || event.key === ' ') {
									event.preventDefault();
									onToggleExpanded();
								}
							},
						}
					: {})}
			>
				{isSummary ? (
					<span
						className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-500"
						aria-hidden
					>
						<ChevronDownIcon
							className={`h-3.5 w-3.5 transition-transform ${expanded ? '' : '-rotate-90'}`}
						/>
					</span>
				) : null}
				<span className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
					P{priority}
				</span>
				<span className="text-[10px] font-medium text-gray-500">{layerLabel}</span>
				{isSummary ? (
					<span
						className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ring-1 ring-inset ${
							summary.activeCount > 0
								? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
								: 'bg-red-50 text-red-700 ring-red-200'
						}`}
						title={t('tierActiveTotal', {
							active: summary.activeCount,
							total: summary.totalCount,
						})}
					>
						{t('tierActiveTotal', {
							active: summary.activeCount,
							total: summary.totalCount,
						})}
					</span>
				) : null}
				<span className="h-px min-w-3 flex-1 bg-slate-200" aria-hidden />
				<div
					className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5"
					onClick={isSummary ? (event) => event.stopPropagation() : undefined}
					onKeyDown={isSummary ? (event) => event.stopPropagation() : undefined}
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
						className="inline-flex max-w-full items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium text-indigo-600 transition hover:bg-indigo-50 hover:text-indigo-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
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

			{isSummary && !expanded ? (
				<button
					type="button"
					onClick={onToggleExpanded}
					className="flex w-full min-w-0 flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2.5 text-left hover:border-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
					aria-label={t('expandTierAria', { priority })}
				>
					{summary.previewItems.map((item) => (
						<span
							key={item.id}
							className="inline-flex max-w-[12rem] items-center gap-1 truncate rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 ring-1 ring-inset ring-slate-200"
							title={
								item.enabled
									? t('tierPreviewEnabled', { name: item.name })
									: t('tierPreviewDisabled', { name: item.name })
							}
						>
							<span
								className={`h-1.5 w-1.5 shrink-0 rounded-full ${
									item.enabled ? 'bg-emerald-500' : 'bg-red-400'
								}`}
								aria-hidden
							/>
							<span className="min-w-0 truncate">{item.name}</span>
						</span>
					))}
					{summary.previewItems.length === 0 ? (
						<span className="text-[10px] text-gray-400">{t('noProviders')}</span>
					) : null}
				</button>
			) : null}

			{showDetails ? (
				<div className="flex min-w-0 flex-wrap gap-2 overflow-x-auto pb-0.5">
					{routes.map((route) => (
						<RouteTarget
							key={route.id}
							route={route}
							provider={providerMeta.get(route.provider_id)}
							stickyBindingCount={stickyCountsByTarget.get(route.id) ?? 0}
							togglingId={togglingId}
							onEdit={onEdit}
							onToggleStatus={onToggleStatus}
						/>
					))}
					{routes.length === 0 ? (
						<span className="text-[11px] text-gray-400">{t('noProviders')}</span>
					) : null}
				</div>
			) : null}
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
	const highestPriority = priorityLayers[0]?.[0];
	/** Explicit user overrides; missing keys mean "default" (highest priority expanded). */
	const [tierExpandOverrides, setTierExpandOverrides] = useState<Record<number, boolean>>({});
	const stickyPoolId = section.poolStickyEnabled ? section.poolId : null;
	const stickySummary = useStickySummary(stickyPoolId);
	const stickyCountsByTarget = useMemo(() => {
		if (!stickyPoolId || !stickySummary) return EMPTY_STICKY_COUNTS;
		return new Map(
			stickySummary.targets.map((row) => [row.route_target_id, row.active_count])
		);
	}, [stickyPoolId, stickySummary]);

	const isTierExpanded = (priority: number) => {
		if (density !== 'summary') return true;
		if (Object.prototype.hasOwnProperty.call(tierExpandOverrides, priority)) {
			return tierExpandOverrides[priority] === true;
		}
		return priority === highestPriority;
	};

	const togglePriority = (priority: number) => {
		setTierExpandOverrides((prev) => {
			const currently =
				Object.prototype.hasOwnProperty.call(prev, priority)
					? prev[priority] === true
					: priority === highestPriority;
			return { ...prev, [priority]: !currently };
		});
	};

	const isSummary = density === 'summary';

	return (
		<>
			<div
				className={
					isSummary
						? 'flex min-w-0 flex-col items-stretch gap-1'
						: 'flex min-w-0 flex-col items-stretch gap-3 md:flex-row md:flex-nowrap md:items-center md:overflow-x-auto'
				}
				aria-label={t('priorityLadderAria')}
			>
				{priorityLayers.map(([priority, routes], layerIndex) => (
					<div
						key={priority}
						className={
							isSummary
								? 'flex min-w-0 flex-col items-stretch'
								: 'flex min-w-0 shrink-0 flex-col items-stretch gap-2 md:flex-row md:items-center'
						}
					>
						{layerIndex > 0 ? (
							<FailoverConnector
								density={density}
								onOpen={() => setFailoverOpen(true)}
							/>
						) : null}
						<PriorityTierPanel
							priority={priority}
							routes={routes}
							layerIndex={layerIndex}
							density={density}
							expanded={isTierExpanded(priority)}
							onToggleExpanded={() => togglePriority(priority)}
							section={section}
							card={card}
							meta={meta}
							providerMeta={providerMeta}
							globalRouteStrategy={globalRouteStrategy}
							stickyCountsByTarget={stickyCountsByTarget}
							togglingId={togglingId}
							onEdit={onEdit}
							onToggleStatus={onToggleStatus}
							onOpenStrategyDialog={onOpenStrategyDialog}
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
	const isSummary = density === 'summary';
	const isDefaultGroup = section.group === 'default';
	const groupRail = isDefaultGroup ? 'bg-sky-300' : 'bg-violet-300';
	const railClass =
		branchIndex === 0
			? 'top-1/2 bottom-0'
			: branchIndex === branchCount - 1
				? 'top-0 bottom-1/2'
				: 'inset-y-0';

	return (
		<div className="relative py-3 xl:pl-4">
			{branchCount > 1 ? (
				<span
					className={`absolute left-0 hidden w-px bg-blue-300 xl:block ${railClass}`}
					aria-hidden
				/>
			) : null}
			<span
				className="absolute left-0 top-1/2 hidden h-px w-4 bg-blue-300 xl:block"
				aria-hidden
			/>
			<div
				className={
					isSummary
						? 'grid min-w-0 gap-y-3 xl:grid-cols-[minmax(140px,200px)_minmax(320px,1fr)] xl:items-center'
						: 'grid min-w-0 gap-y-3 xl:grid-cols-[minmax(140px,200px)_minmax(420px,1fr)] xl:items-center'
				}
			>
				<div className="relative flex min-w-0 flex-col justify-center xl:pr-8">
					<RouteGroupNode
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
		<div className="bg-slate-50/70 px-3 sm:px-4">
			<div className="xl:grid xl:grid-cols-[minmax(160px,210px)_minmax(0,1fr)]">
				<div className="relative flex min-w-0 flex-col justify-center py-3 xl:pr-8">
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
	const context = formatCompactTokens(meta?.context_window);
	const maxOutput = formatCompactTokens(meta?.max_tokens);
	// ASR 与 TTS 同属 Audio；必须按计费能力区分，避免 TTS 被标成按秒转写。
	const stats = isAudio
		? t(isAudioSpeech ? 'audioSpeechModelHint' : 'audioModelHint')
		: isImage
			? t('imageModelHint')
			: t('contextLine', { context, max: maxOutput });
	const tags = parseModelTagsList(meta);
	const sections = splitRoutesByProtocolAndRouteGroup(card.groupRoutes);
	const surfaceGroups = groupSectionsByRequestSurface(sections);

	return (
		<article className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
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
						<span className="font-mono text-[11px] text-gray-500">{card.model_id}</span>
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

			<div className="divide-y divide-slate-200/80 bg-slate-100/60 px-3 sm:px-4">
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
