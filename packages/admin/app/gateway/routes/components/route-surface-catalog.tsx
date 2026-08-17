'use client';

import { useMemo } from 'react';
import {
	ArrowDownIcon,
	PencilSquareIcon,
	PlusIcon,
} from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import type { GatewayModel, GatewayProvider } from '@/lib/types';
import {
	buildRouteSurfaceCatalog,
	type RouteModelGroup,
	type SurfaceCatalogGroup,
} from '../route-utils';
import type { RouteListRow, RouteProtocolGroupSection } from '../types';
import { FlowConnectorAdd, RequestSurfaceNode, RouteGroupNode, UpstreamPoolPanel, openSectionStickyDialog } from './route-model-flow';

type Props = {
	cards: RouteModelGroup[];
	modelMeta: Map<string, GatewayModel>;
	providerMeta: Map<string, GatewayProvider>;
	globalRouteStrategy: string | null;
	copiedModelId: string | null;
	togglingId: string | null;
	onCopyModelId: (modelId: string) => void;
	onCreate: (modelId: string, preset?: { protocol?: string; operation?: string; group?: string }) => void;
	onEdit: (route: RouteListRow) => void;
	onEditModel: (modelId: string) => void;
	onToggleStatus: (route: RouteListRow) => void;
	onOpenStrategyDialog: (
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
	onOpenProviderStickyDialog: (
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
};

function branchRailClass(index: number, count: number): string {
	if (index === 0) return 'top-1/2 bottom-0';
	if (index === count - 1) return 'top-0 bottom-1/2';
	return 'inset-y-0';
}

function BranchConnectors({
	index,
	count,
	colorClass,
}: {
	index: number;
	count: number;
	colorClass: string;
}) {
	return (
		<>
			{count > 1 ? (
				<span
					className={`absolute left-0 hidden w-px xl:block ${colorClass} ${branchRailClass(index, count)}`}
					aria-hidden
				/>
			) : null}
			<span
				className={`absolute left-0 top-1/2 hidden h-px w-4 xl:block ${colorClass}`}
				aria-hidden
			/>
		</>
	);
}

function CatalogModelNode({
	card,
	onEditModel,
}: {
	card: RouteModelGroup;
	onEditModel: (modelId: string) => void;
}) {
	const tCard = useTranslations('routes.card');

	return (
		<div className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
			<div className="flex min-w-0 items-center gap-1">
				<button
					type="button"
					onClick={() => onEditModel(card.model_id)}
					className="min-w-0 flex-1 truncate text-left text-[13px] font-semibold leading-5 text-gray-900 underline-offset-2 hover:text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
				>
					{card.title}
				</button>
				<button
					type="button"
					onClick={() => onEditModel(card.model_id)}
					className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
					title={tCard('editModel', { title: card.title })}
				>
					<PencilSquareIcon className="h-3.5 w-3.5" />
				</button>
			</div>
			<div className="mt-2 flex items-center">
				<span
					className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${
						card.activeCount > 0
							? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
							: 'bg-red-50 text-red-700 ring-red-200'
					}`}
				>
					{tCard('activeTotalRoutes', {
						active: card.activeCount,
						total: card.groupRoutes.length,
					})}
				</span>
			</div>
		</div>
	);
}

export function UnroutedModelsPanel({
	cards,
	onEditModel,
	onCreate,
}: {
	cards: RouteModelGroup[];
	onEditModel: (modelId: string) => void;
	onCreate: Props['onCreate'];
}) {
	const t = useTranslations('routes.flow');
	const tCard = useTranslations('routes.card');
	if (cards.length === 0) return null;

	return (
		<section
			className="mt-3 rounded-xl border border-dashed border-amber-200/90 bg-amber-50/70 px-3 py-2"
			title={t('unroutedHint')}
		>
			<div className="flex flex-wrap items-center gap-1.5">
				<span className="mr-1 inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-amber-900">
					{t('unroutedTitle')}
					<span className="rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-semibold tabular-nums text-amber-800 ring-1 ring-inset ring-amber-200">
						{cards.length}
					</span>
				</span>
				{cards.map((card) => (
					<span
						key={card.model_id}
						className="inline-flex max-w-full items-center gap-0.5 rounded-full border border-amber-200/80 bg-white pl-2 pr-0.5 text-[11px] text-gray-800 shadow-sm"
					>
						<button
							type="button"
							onClick={() => onEditModel(card.model_id)}
							className="max-w-[11rem] truncate py-0.5 font-medium hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
							title={tCard('editModel', { title: card.title })}
						>
							{card.title}
						</button>
						<button
							type="button"
							onClick={() => onCreate(card.model_id)}
							className="rounded-full p-0.5 text-amber-700 hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
							title={t('addRoute')}
							aria-label={`${t('addRoute')}: ${card.title}`}
						>
							<PlusIcon className="h-3.5 w-3.5" aria-hidden />
						</button>
					</span>
				))}
			</div>
		</section>
	);
}

function CatalogUpstream({
	section,
	card,
	meta,
	providerMeta,
	globalRouteStrategy,
	togglingId,
	onEdit,
	onToggleStatus,
	onOpenStrategyDialog,
}: {
	section: RouteProtocolGroupSection<RouteListRow>;
	card: RouteModelGroup;
	meta: GatewayModel | undefined;
	providerMeta: Map<string, GatewayProvider>;
	globalRouteStrategy: string | null;
	togglingId: string | null;
	onEdit: Props['onEdit'];
	onToggleStatus: Props['onToggleStatus'];
	onOpenStrategyDialog: Props['onOpenStrategyDialog'];
}) {
	return (
		<UpstreamPoolPanel
			section={section}
			card={card}
			meta={meta}
			providerMeta={providerMeta}
			globalRouteStrategy={globalRouteStrategy}
			density="topology"
			togglingId={togglingId}
			onEdit={onEdit}
			onToggleStatus={onToggleStatus}
			onOpenStrategyDialog={onOpenStrategyDialog}
		/>
	);
}

function GroupToUpstreamBranch({
	section,
	card,
	meta,
	providerMeta,
	globalRouteStrategy,
	branchIndex,
	branchCount,
	togglingId,
	copiedModelId,
	onCopyModelId,
	onCreate,
	onEdit,
	onToggleStatus,
	onOpenStrategyDialog,
	onOpenProviderStickyDialog,
}: {
	section: RouteProtocolGroupSection<RouteListRow>;
	card: RouteModelGroup;
	meta: GatewayModel | undefined;
	providerMeta: Map<string, GatewayProvider>;
	globalRouteStrategy: string | null;
	branchIndex: number;
	branchCount: number;
	togglingId: string | null;
	copiedModelId: string | null;
	onCopyModelId: Props['onCopyModelId'];
	onCreate: Props['onCreate'];
	onEdit: Props['onEdit'];
	onToggleStatus: Props['onToggleStatus'];
	onOpenStrategyDialog: Props['onOpenStrategyDialog'];
	onOpenProviderStickyDialog: Props['onOpenProviderStickyDialog'];
}) {
	const t = useTranslations('routes.flow');
	const isDefaultGroup = section.group === 'default';
	const railColor = isDefaultGroup ? 'bg-sky-300' : 'bg-violet-300';

	return (
		<div className="relative py-3 xl:pl-4">
			<BranchConnectors index={branchIndex} count={branchCount} colorClass={railColor} />
			<div className="grid min-w-0 gap-y-3 xl:grid-cols-[minmax(140px,200px)_minmax(420px,1fr)] xl:items-center">
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
							onClick: () => openSectionStickyDialog(onOpenProviderStickyDialog, card, section),
						}}
					/>
					<FlowConnectorAdd
						railClass={railColor}
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
				<CatalogUpstream
					section={section}
					card={card}
					meta={meta}
					providerMeta={providerMeta}
					globalRouteStrategy={globalRouteStrategy}
					togglingId={togglingId}
					onEdit={onEdit}
					onToggleStatus={onToggleStatus}
					onOpenStrategyDialog={onOpenStrategyDialog}
				/>
			</div>
		</div>
	);
}

function ModelToGroupsBranch({
	model,
	modelIndex,
	modelCount,
	protocol,
	requestOperation,
	modelMeta,
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
	onOpenProviderStickyDialog,
}: {
	model: SurfaceCatalogGroup['models'][number];
	modelIndex: number;
	modelCount: number;
	protocol: string;
	requestOperation: string;
	modelMeta: Map<string, GatewayModel>;
	providerMeta: Map<string, GatewayProvider>;
	globalRouteStrategy: string | null;
	copiedModelId: string | null;
	togglingId: string | null;
	onCopyModelId: Props['onCopyModelId'];
	onCreate: Props['onCreate'];
	onEdit: Props['onEdit'];
	onEditModel: Props['onEditModel'];
	onToggleStatus: Props['onToggleStatus'];
	onOpenStrategyDialog: Props['onOpenStrategyDialog'];
	onOpenProviderStickyDialog: Props['onOpenProviderStickyDialog'];
}) {
	const t = useTranslations('routes.flow');
	const { card, sections } = model;

	return (
		<div className="relative py-3 xl:pl-4">
			<BranchConnectors index={modelIndex} count={modelCount} colorClass="bg-blue-300" />
			<div className="xl:grid xl:grid-cols-[minmax(160px,220px)_minmax(0,1fr)]">
				<div className="relative flex min-w-0 flex-col justify-center xl:pr-8">
					<CatalogModelNode
						card={card}
						onEditModel={onEditModel}
					/>
					<FlowConnectorAdd
						railClass="bg-blue-300"
						label={t('addRouteGroup')}
						onClick={() =>
							onCreate(card.model_id, {
								protocol,
								operation: requestOperation,
								group: '',
							})
						}
					/>
				</div>
				<div>
					{sections.map((section, branchIndex) => (
						<GroupToUpstreamBranch
							key={section.key}
							section={section}
							card={card}
							meta={modelMeta.get(card.model_id)}
							providerMeta={providerMeta}
							globalRouteStrategy={globalRouteStrategy}
							branchIndex={branchIndex}
							branchCount={sections.length}
							togglingId={togglingId}
							copiedModelId={copiedModelId}
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

function SurfaceCatalogSection({
	surface,
	modelMeta,
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
	onOpenProviderStickyDialog,
}: {
	surface: SurfaceCatalogGroup;
	modelMeta: Map<string, GatewayModel>;
	providerMeta: Map<string, GatewayProvider>;
	globalRouteStrategy: string | null;
	copiedModelId: string | null;
	togglingId: string | null;
	onCopyModelId: Props['onCopyModelId'];
	onCreate: Props['onCreate'];
	onEdit: Props['onEdit'];
	onEditModel: Props['onEditModel'];
	onToggleStatus: Props['onToggleStatus'];
	onOpenStrategyDialog: Props['onOpenStrategyDialog'];
	onOpenProviderStickyDialog: Props['onOpenProviderStickyDialog'];
}) {
	return (
		<article className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
			<div className="bg-slate-50/70 px-3 sm:px-4">
				<div className="xl:grid xl:grid-cols-[minmax(160px,210px)_minmax(0,1fr)]">
					<div className="relative flex min-w-0 flex-col justify-center py-3 xl:pr-4">
						<RequestSurfaceNode surface={surface} />
						<span
							className="absolute right-0 top-1/2 hidden h-px w-4 bg-blue-300 xl:block"
							aria-hidden
						/>
						<div className="flex justify-center pt-1 xl:hidden" aria-hidden>
							<ArrowDownIcon className="h-4 w-4 text-blue-400" />
						</div>
					</div>
					<div>
						{surface.models.map((model, modelIndex) => (
							<ModelToGroupsBranch
								key={model.card.model_id}
								model={model}
								modelIndex={modelIndex}
								modelCount={surface.models.length}
								protocol={surface.protocol}
								requestOperation={surface.requestOperation}
								modelMeta={modelMeta}
								providerMeta={providerMeta}
								globalRouteStrategy={globalRouteStrategy}
								copiedModelId={copiedModelId}
								togglingId={togglingId}
								onCopyModelId={onCopyModelId}
								onCreate={onCreate}
								onEdit={onEdit}
								onEditModel={onEditModel}
								onToggleStatus={onToggleStatus}
								onOpenStrategyDialog={onOpenStrategyDialog}
								onOpenProviderStickyDialog={onOpenProviderStickyDialog}
							/>
						))}
					</div>
				</div>
			</div>
		</article>
	);
}

export function RouteSurfaceCatalog(props: Props) {
	const {
		cards,
		modelMeta,
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
		onOpenProviderStickyDialog,
	} = props;
	const catalog = useMemo(() => buildRouteSurfaceCatalog(cards), [cards]);

	return (
		<div className="space-y-6">
			{catalog.surfaces.map((surface) => (
				<SurfaceCatalogSection
					key={surface.key}
					surface={surface}
					modelMeta={modelMeta}
					providerMeta={providerMeta}
					globalRouteStrategy={globalRouteStrategy}
					copiedModelId={copiedModelId}
					togglingId={togglingId}
					onCopyModelId={onCopyModelId}
					onCreate={onCreate}
					onEdit={onEdit}
					onEditModel={onEditModel}
					onToggleStatus={onToggleStatus}
					onOpenStrategyDialog={onOpenStrategyDialog}
					onOpenProviderStickyDialog={onOpenProviderStickyDialog}
				/>
			))}
		</div>
	);
}
