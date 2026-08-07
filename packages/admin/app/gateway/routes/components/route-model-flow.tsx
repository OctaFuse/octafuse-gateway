'use client';

import { useState } from 'react';
import {
	ArrowDownIcon,
	ArrowLongRightIcon,
	ClipboardDocumentIcon,
	ExclamationTriangleIcon,
	PencilSquareIcon,
	PlusIcon,
	PowerIcon,
} from '@heroicons/react/24/outline';
import {
	isAudioModel,
	isAudioSpeechModel,
	isImageGenerationModel,
} from '@octafuse/core/db/model-modalities';
import { parseRoutePricingSchedule } from '@octafuse/core/db/pricing-schedule';
import { useTranslations } from 'next-intl';
import { UpstreamProtocolBrandIcon } from '@/components/upstream-brand-logo';
import { formatCompactTokens } from '@/lib/format-compact-tokens';
import {
	parseChargedFactorFromPriceOverride,
	parseMeteredFactorFromPriceOverride,
} from '@/lib/pricing-ui';
import type { GatewayModel, GatewayProvider } from '@/lib/types';
import { tagBadgeClass } from '../../models/model-utils';
import type { RouteModelGroup } from '../route-utils';
import {
	compareRoutesWithinPriorityLayer,
	factorChipClassForValue,
	factorLevelForValue,
	formatFactorMultiplier,
	formatFactorMultiplierForChip,
	formatScheduleWindowsHint,
	hasBasePricingInversion,
	parseModelTagsList,
	protocolBadgeClass,
	requestSurfacePath,
	resolveEffectiveRouteStrategy,
	splitRoutesByProtocolAndRouteGroup,
} from '../route-utils';
import {
	FACTOR_CHIP_BASE,
	type RouteListRow,
	type RouteProtocolGroupSection,
} from '../types';
import { FailoverRulesDialog } from './failover-rules-dialog';

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

type Props = {
	card: RouteModelGroup;
	meta: GatewayModel | undefined;
	providerMeta: Map<string, GatewayProvider>;
	globalRouteStrategy: string | null;
	copiedModelId: string | null;
	togglingId: string | null;
	onCopyModelId: (modelId: string) => void;
	onCreate: (modelId: string, preset?: { protocol?: string; operation?: string; group?: string }) => void;
	onEdit: (route: RouteListRow) => void;
	onEditModel: (modelId: string) => void;
	onToggleStatus: (route: RouteListRow) => void;
	onOpenStrategyDialog: OpenStrategyDialog;
};

function RouteTarget({
	route,
	provider,
	requestProtocol,
	requestOperation,
	togglingId,
	onEdit,
	onToggleStatus,
}: {
	route: RouteListRow;
	provider: GatewayProvider | undefined;
	requestProtocol: string;
	requestOperation: string;
	togglingId: string | null;
	onEdit: (route: RouteListRow) => void;
	onToggleStatus: (route: RouteListRow) => void;
}) {
	const t = useTranslations('routes.flow');
	const tList = useTranslations('routes.listItem');
	const charged = parseChargedFactorFromPriceOverride(route.price_override);
	const metered = parseMeteredFactorFromPriceOverride(route.price_override);
	const chargedValue = charged != null && Number.isFinite(charged) ? charged : 1;
	const meteredValue = metered != null && Number.isFinite(metered) ? metered : 1;
	const schedule = parseRoutePricingSchedule(route.price_override);
	const scheduleHint =
		formatScheduleWindowsHint(schedule.charged) || formatScheduleWindowsHint(schedule.metered);
	const chargedLevel = factorLevelForValue(chargedValue);
	const meteredLevel = factorLevelForValue(meteredValue);
	const chargedStatus = tList(`factorStatus.charged.${chargedLevel}`);
	const meteredStatus = tList(`factorStatus.metered.${meteredLevel}`);
	const hasPricingInversion = hasBasePricingInversion(chargedValue, meteredValue);
	const enabled = route.status === 'active';
	const providerDisabled = provider?.status === 'disabled';
	const configuredUpstreamOperation = route.upstream_operation ?? '*';
	const effectiveUpstreamOperation =
		configuredUpstreamOperation === '*' ? requestOperation : configuredUpstreamOperation;
	const showUpstreamMapping =
		route.upstream_protocol !== requestProtocol ||
		effectiveUpstreamOperation !== requestOperation ||
		(route.adapter != null && route.adapter !== 'passthrough');

	return (
		<div
			className={`w-full min-w-0 rounded-lg border shadow-sm transition hover:shadow-md sm:w-64 sm:max-w-full ${
				enabled
					? 'border-emerald-300 bg-emerald-50/70 shadow-emerald-100/60 hover:border-emerald-400'
					: 'border-red-300 bg-red-50/70 shadow-red-100/60 hover:border-red-400'
			}`}
		>
			<div className="flex items-start gap-2 p-2.5">
				<button
					type="button"
					onClick={() => onToggleStatus(route)}
					disabled={togglingId === route.id}
					className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ring-1 ring-inset transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-wait disabled:opacity-50 ${
						enabled
							? 'bg-emerald-600 text-white ring-emerald-600 hover:bg-emerald-700'
							: 'bg-red-500 text-white ring-red-500 hover:bg-red-600'
					}`}
					title={enabled ? tList('routeEnabled') : tList('routeDisabled')}
					aria-label={enabled ? tList('routeEnabled') : tList('routeDisabled')}
				>
					<PowerIcon className="h-3.5 w-3.5" />
				</button>
				<button
					type="button"
					onClick={() => onEdit(route)}
					className="min-w-0 flex-1 rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
					title={t('editRoute')}
				>
					<div className="flex min-w-0 items-center gap-2">
						<span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-gray-900">
							{route.provider_name || provider?.name || route.provider_id}
						</span>
						<PencilSquareIcon className="h-3 w-3 shrink-0 text-gray-400" />
					</div>
					<p className="mt-0.5 truncate font-mono text-[10px] text-gray-500" title={route.provider_model_name}>
						{route.provider_model_name}
					</p>
				</button>
			</div>
			<div className={`flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t bg-white/55 px-2.5 py-1.5 ${
				enabled ? 'border-emerald-200' : 'border-red-200'
			}`}>
				<div className="flex min-w-0 flex-wrap items-center gap-1">
					{showUpstreamMapping ? (
						<span className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${protocolBadgeClass(route.upstream_protocol)}`}>
							<UpstreamProtocolBrandIcon protocol={route.upstream_protocol} />
							{route.upstream_protocol}.{effectiveUpstreamOperation}
						</span>
					) : null}
					<span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 ring-1 ring-inset ring-violet-200">
						{t('weight', { value: route.weight ?? 1 })}
					</span>
					{route.custom_params ? (
						<span
							className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 ring-1 ring-inset ring-gray-200"
							title={t('customParamsTooltip')}
						>
							{t('customParams')}
						</span>
					) : null}
					{providerDisabled ? (
						<span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
							<ExclamationTriangleIcon className="h-3 w-3" />
							{t('providerDisabled')}
						</span>
					) : null}
				</div>
				<div className="ml-auto flex flex-wrap items-center justify-end gap-1">
					<span
						className={factorChipClassForValue(chargedValue, 'charged')}
						title={tList('chargedTooltip', {
							value: formatFactorMultiplier(chargedValue),
							status: chargedStatus,
						})}
						aria-label={tList('chargedFactorAria', {
							value: formatFactorMultiplier(chargedValue),
							status: chargedStatus,
						})}
					>
						{t('chargedShort')} {formatFactorMultiplierForChip(chargedValue)}
					</span>
					<span
						className={factorChipClassForValue(meteredValue, 'metered')}
						title={tList('meteredTooltip', {
							value: formatFactorMultiplier(meteredValue),
							status: meteredStatus,
						})}
						aria-label={tList('meteredFactorAria', {
							value: formatFactorMultiplier(meteredValue),
							status: meteredStatus,
						})}
					>
						{t('meteredShort')} {formatFactorMultiplierForChip(meteredValue)}
					</span>
					{hasPricingInversion ? (
						<span
							className={`${FACTOR_CHIP_BASE} w-auto bg-rose-100 text-rose-950 ring-rose-300/90`}
							title={tList('baseInversionTooltip')}
						>
							{tList('baseInversionBadge')}
						</span>
					) : null}
					{scheduleHint ? (
						<span className={`${FACTOR_CHIP_BASE} w-auto bg-sky-50 text-sky-800 ring-sky-200`} title={scheduleHint}>
							{t('scheduled')}
						</span>
					) : null}
				</div>
			</div>
		</div>
	);
}

function UpstreamToolbar({ onAdd }: { onAdd: () => void }) {
	const t = useTranslations('routes.flow');

	return (
		<div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
			<span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">
				{t('providerStep')}
			</span>
			<button
				type="button"
				onClick={onAdd}
				className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-white px-2 py-1 text-[10px] font-semibold text-blue-600 ring-1 ring-inset ring-blue-200 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
			>
				<PlusIcon className="h-3 w-3" />
				{t('addProvider')}
			</button>
		</div>
	);
}

function RoutingMatchConnector({
	modelId,
	routeGroup,
}: {
	modelId: string;
	routeGroup: string;
}) {
	const t = useTranslations('routes.flow');
	const requestedModelId = routeGroup === 'default' ? modelId : `${modelId}:${routeGroup}`;

	return (
		<>
			<div
				className="hidden min-w-0 flex-col items-center justify-center gap-1 xl:flex"
				aria-label={t('routeMatchAria', { group: routeGroup, model: requestedModelId })}
			>
				<span className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-200">
					{t('routeGroup')} · {routeGroup}
				</span>
				<p
					className="line-clamp-2 break-all text-center font-mono text-[10px] font-medium leading-3 text-blue-600"
					title={`model=${requestedModelId}`}
				>
					model={requestedModelId}
				</p>
			</div>
			<div
				className="flex min-w-0 flex-col items-center gap-1 py-0.5 xl:hidden"
				aria-label={t('routeMatchAria', { group: routeGroup, model: requestedModelId })}
			>
				<span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-200">
					{t('routeGroup')} · {routeGroup}
				</span>
				<span
					className="line-clamp-2 max-w-full break-all text-center font-mono text-[10px] font-medium leading-3 text-blue-600"
					title={`model=${requestedModelId}`}
				>
					model={requestedModelId}
				</span>
			</div>
		</>
	);
}

type RequestSurfaceGroup = {
	key: string;
	protocol: string;
	protocolLabel: string;
	requestOperation: string;
	sections: RouteProtocolGroupSection<RouteListRow>[];
};

function groupSectionsByRequestSurface(
	sections: RouteProtocolGroupSection<RouteListRow>[]
): RequestSurfaceGroup[] {
	const groups = new Map<string, RequestSurfaceGroup>();
	for (const section of sections) {
		const key = `${section.protocol}\u0000${section.requestOperation}`;
		const group =
			groups.get(key) ??
			{
				key,
				protocol: section.protocol,
				protocolLabel: section.protocolLabel,
				requestOperation: section.requestOperation,
				sections: [],
			};
		group.sections.push(section);
		groups.set(key, group);
	}
	return [...groups.values()];
}

function RequestSurfaceNode({
	surface,
	modelId,
}: {
	surface: RequestSurfaceGroup;
	modelId: string;
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
		strategy === 'cache_affinity' ||
		strategy === 'weighted_random' ||
		strategy === 'fixed_order' ||
		strategy === 'weighted_round_robin'
	) {
		return strategy;
	}
	return strategy;
}

function FlowBranch({
	section,
	card,
	meta,
	providerMeta,
	globalRouteStrategy,
	branchIndex,
	branchCount,
	togglingId,
	onCreate,
	onEdit,
	onToggleStatus,
	onOpenStrategyDialog,
}: {
	section: RouteProtocolGroupSection<RouteListRow>;
	card: RouteModelGroup;
	meta: GatewayModel | undefined;
	providerMeta: Map<string, GatewayProvider>;
	globalRouteStrategy: string | null;
	branchIndex: number;
	branchCount: number;
	togglingId: string | null;
	onCreate: Props['onCreate'];
	onEdit: Props['onEdit'];
	onToggleStatus: Props['onToggleStatus'];
	onOpenStrategyDialog: Props['onOpenStrategyDialog'];
}) {
	const t = useTranslations('routes.flow');
	const tStrategy = useTranslations('routes.strategy');
	const [failoverOpen, setFailoverOpen] = useState(false);
	const priorityLayers = [...section.routes.reduce((map, route) => {
		const layer = map.get(route.priority) ?? [];
		layer.push(route);
		map.set(route.priority, layer);
		return map;
	}, new Map<number, RouteListRow[]>())]
		.sort(([a], [b]) => b - a)
		.map(([priority, routes]) =>
			[priority, [...routes].sort(compareRoutesWithinPriorityLayer)] as const
		);
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
			<div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(150px,240px)_auto_minmax(420px,1fr)] xl:items-center">
				<RoutingMatchConnector modelId={card.model_id} routeGroup={section.group} />

				<div className="flex items-center justify-center py-0.5 xl:px-0.5" aria-hidden>
					<span className="hidden h-px w-8 bg-blue-300 xl:block" />
					<ArrowDownIcon className="h-4 w-4 text-blue-400 xl:hidden" />
				</div>

				<div className="min-w-0">
					<UpstreamToolbar
						onAdd={() => onCreate(card.model_id, {
							protocol: section.protocol,
							operation: section.requestOperation,
							group: section.group,
						})}
					/>
					<div className="flex min-w-0 flex-col items-stretch gap-3 md:flex-row md:flex-wrap">
						{priorityLayers.map(([priority, routes], layerIndex) => {
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
								displayKey === 'cache_affinity' ||
								displayKey === 'weighted_random' ||
								displayKey === 'fixed_order' ||
								displayKey === 'weighted_round_robin'
									? tStrategy(`display.${displayKey}`)
									: strategy.strategy;
							const sourceLabel = t(`strategySource.${strategy.source}`);
							return (
								<div
									key={priority}
									className="flex min-w-0 flex-col items-stretch gap-2 md:flex-row"
								>
									{layerIndex > 0 ? (
										<div className="flex shrink-0 items-center justify-center py-1 md:px-0.5 md:py-0">
											<button
												type="button"
												onClick={() => setFailoverOpen(true)}
												className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1.5 text-[10px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-200 transition hover:bg-blue-50 hover:text-blue-700 hover:ring-blue-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
												title={t('failoverRules')}
											>
												<ArrowDownIcon className="h-3 w-3 md:hidden" />
												<ArrowLongRightIcon className="hidden h-4 w-4 md:block" />
												<span>{t('failoverRules')}</span>
											</button>
										</div>
									) : null}
									<div className="min-w-[18rem] max-w-full rounded-lg border border-slate-200 bg-white/80 p-2.5 shadow-sm">
										<div className="mb-2 flex min-w-0 flex-wrap items-center gap-1.5 border-b border-slate-100 pb-2">
											<span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] font-bold text-white">
												P{priority}
											</span>
											<span className="text-[10px] font-medium text-gray-500">
												{layerIndex === 0 ? t('firstAttempt') : t('fallbackLayer')}
											</span>
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
												className="ml-auto inline-flex max-w-full items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200 transition hover:bg-indigo-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
												title={t('tierStrategyEdit', {
													strategy: displayName,
													source: sourceLabel,
												})}
											>
												<span className="truncate">{displayName}</span>
												<PencilSquareIcon className="h-3 w-3 shrink-0 text-indigo-400" />
											</button>
										</div>
										<div className="flex min-w-0 flex-wrap gap-2">
											{routes.map((route) => (
												<RouteTarget
													key={route.id}
													route={route}
													provider={providerMeta.get(route.provider_id)}
													requestProtocol={section.protocol}
													requestOperation={section.requestOperation}
													togglingId={togglingId}
													onEdit={onEdit}
													onToggleStatus={onToggleStatus}
												/>
											))}
										</div>
									</div>
								</div>
							);
						})}
					</div>
				</div>
			</div>
			<FailoverRulesDialog open={failoverOpen} onClose={() => setFailoverOpen(false)} />
		</div>
	);
}

function FlowSection({
	surface,
	card,
	meta,
	providerMeta,
	globalRouteStrategy,
	togglingId,
	onCreate,
	onEdit,
	onToggleStatus,
	onOpenStrategyDialog,
}: {
	surface: RequestSurfaceGroup;
	card: RouteModelGroup;
	meta: GatewayModel | undefined;
	providerMeta: Map<string, GatewayProvider>;
	globalRouteStrategy: string | null;
	togglingId: string | null;
	onCreate: Props['onCreate'];
	onEdit: Props['onEdit'];
	onToggleStatus: Props['onToggleStatus'];
	onOpenStrategyDialog: Props['onOpenStrategyDialog'];
}) {
	return (
		<div className="bg-slate-50/70 px-3 sm:px-4">
			<div className="xl:grid xl:grid-cols-[minmax(160px,210px)_minmax(0,1fr)]">
				<div className="relative flex min-w-0 flex-col justify-center py-3 xl:pr-4">
					<RequestSurfaceNode surface={surface} modelId={card.model_id} />
					<span
						className="absolute right-0 top-1/2 hidden h-px w-4 bg-blue-300 xl:block"
						aria-hidden
					/>
					<div className="flex justify-center pt-1 xl:hidden" aria-hidden>
						<ArrowDownIcon className="h-4 w-4 text-blue-400" />
					</div>
				</div>
				<div className="divide-y divide-slate-200/80">
					{surface.sections.map((section, branchIndex) => (
						<FlowBranch
							key={section.key}
							section={section}
							card={card}
							meta={meta}
							providerMeta={providerMeta}
							globalRouteStrategy={globalRouteStrategy}
							branchIndex={branchIndex}
							branchCount={surface.sections.length}
							togglingId={togglingId}
							onCreate={onCreate}
							onEdit={onEdit}
							onToggleStatus={onToggleStatus}
							onOpenStrategyDialog={onOpenStrategyDialog}
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
		copiedModelId,
		togglingId,
		onCopyModelId,
		onCreate,
		onEdit,
		onEditModel,
		onToggleStatus,
		onOpenStrategyDialog,
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
			<header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-2.5 sm:px-5">
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
				<div className="flex shrink-0 items-center gap-2">
					<span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${card.activeCount > 0 ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-red-50 text-red-700 ring-red-200'}`}>
						{t('activeTotalRoutes', { active: card.activeCount, total: card.groupRoutes.length })}
					</span>
					<button
						type="button"
						onClick={() => onCreate(card.model_id)}
						className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 ring-1 ring-inset ring-blue-200 hover:bg-blue-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
					>
						<PlusIcon className="h-3.5 w-3.5" />
						{tFlow('addRoute')}
					</button>
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
						togglingId={togglingId}
						onCreate={onCreate}
						onEdit={onEdit}
						onToggleStatus={onToggleStatus}
						onOpenStrategyDialog={onOpenStrategyDialog}
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
