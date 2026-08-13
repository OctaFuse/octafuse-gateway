'use client';

import { useMemo } from 'react';
import {
	ArrowDownIcon,
	ClipboardDocumentIcon,
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
import { RequestSurfaceNode, UpstreamPoolPanel } from './route-model-flow';

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
	copiedModelId,
	onCopyModelId,
	onEditModel,
	onCreate,
	showAddRoute = false,
	showCopy = false,
}: {
	card: RouteModelGroup;
	copiedModelId: string | null;
	onCopyModelId: (modelId: string) => void;
	onEditModel: (modelId: string) => void;
	onCreate: Props['onCreate'];
	showAddRoute?: boolean;
	showCopy?: boolean;
}) {
	const tCard = useTranslations('routes.card');
	const tFlow = useTranslations('routes.flow');

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
				<div className="flex shrink-0 items-center">
					{showCopy ? (
						<button
							type="button"
							onClick={() => void onCopyModelId(card.model_id)}
							className={`rounded p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
								copiedModelId === card.model_id
									? 'bg-emerald-50 text-emerald-600'
									: 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'
							}`}
							title={
								copiedModelId === card.model_id
									? tCard('copiedModelId')
									: tCard('copyModelId', { id: card.model_id })
							}
						>
							<ClipboardDocumentIcon className="h-3.5 w-3.5" />
						</button>
					) : null}
					<button
						type="button"
						onClick={() => onEditModel(card.model_id)}
						className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
						title={tCard('editModel', { title: card.title })}
					>
						<PencilSquareIcon className="h-3.5 w-3.5" />
					</button>
				</div>
			</div>
			<div className={`mt-2 flex items-center gap-2 ${showAddRoute ? 'justify-between' : ''}`}>
				{showAddRoute ? (
					<button
						type="button"
						onClick={() => onCreate(card.model_id)}
						className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700 ring-1 ring-inset ring-blue-200 hover:bg-blue-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
					>
						<PlusIcon className="h-3 w-3" />
						{tFlow('addRoute')}
					</button>
				) : null}
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

function RouteGroupNode({
	modelId,
	routeGroup,
	copiedModelId,
	onCopyModelId,
}: {
	modelId: string;
	routeGroup: string;
	copiedModelId: string | null;
	onCopyModelId: (modelId: string) => void;
}) {
	const t = useTranslations('routes.flow');
	const tCard = useTranslations('routes.card');
	const requestedModelId = routeGroup === 'default' ? modelId : `${modelId}:${routeGroup}`;
	const isDefaultGroup = routeGroup === 'default';
	const copied = copiedModelId === requestedModelId;

	return (
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
	);
}

function CatalogUpstream({
	section,
	card,
	meta,
	providerMeta,
	globalRouteStrategy,
	togglingId,
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
	togglingId: string | null;
	onCreate: Props['onCreate'];
	onEdit: Props['onEdit'];
	onToggleStatus: Props['onToggleStatus'];
	onOpenStrategyDialog: Props['onOpenStrategyDialog'];
	onOpenProviderStickyDialog: Props['onOpenProviderStickyDialog'];
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
			onCreate={onCreate}
			onEdit={onEdit}
			onToggleStatus={onToggleStatus}
			onOpenStrategyDialog={onOpenStrategyDialog}
			onOpenProviderStickyDialog={onOpenProviderStickyDialog}
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
	const isDefaultGroup = section.group === 'default';
	const railColor = isDefaultGroup ? 'bg-sky-300' : 'bg-violet-300';

	return (
		<div className="relative py-3 xl:pl-4">
			<BranchConnectors index={branchIndex} count={branchCount} colorClass={railColor} />
			<div className="grid min-w-0 gap-y-3 xl:grid-cols-[minmax(140px,200px)_minmax(420px,1fr)] xl:items-center">
				<div className="relative flex min-w-0 flex-col justify-center xl:pr-4">
					<RouteGroupNode
						modelId={card.model_id}
						routeGroup={section.group}
						copiedModelId={copiedModelId}
						onCopyModelId={onCopyModelId}
					/>
					<span
						className={`absolute right-0 top-1/2 hidden h-px w-4 xl:block ${railColor}`}
						aria-hidden
					/>
					<div className="flex justify-center pt-1 xl:hidden" aria-hidden>
						<ArrowDownIcon className="h-4 w-4 text-blue-400" />
					</div>
				</div>
				<CatalogUpstream
					section={section}
					card={card}
					meta={meta}
					providerMeta={providerMeta}
					globalRouteStrategy={globalRouteStrategy}
					togglingId={togglingId}
					onCreate={onCreate}
					onEdit={onEdit}
					onToggleStatus={onToggleStatus}
					onOpenStrategyDialog={onOpenStrategyDialog}
					onOpenProviderStickyDialog={onOpenProviderStickyDialog}
				/>
			</div>
		</div>
	);
}

function ModelToGroupsBranch({
	model,
	modelIndex,
	modelCount,
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
	const { card, sections } = model;

	return (
		<div className="relative py-3 xl:pl-4">
			<BranchConnectors index={modelIndex} count={modelCount} colorClass="bg-blue-300" />
			<div className="xl:grid xl:grid-cols-[minmax(160px,220px)_minmax(0,1fr)]">
				<div className="relative flex min-w-0 flex-col justify-center xl:pr-4">
					<CatalogModelNode
						card={card}
						copiedModelId={copiedModelId}
						onCopyModelId={onCopyModelId}
						onEditModel={onEditModel}
						onCreate={onCreate}
					/>
					<span
						className="absolute right-0 top-1/2 hidden h-px w-4 bg-blue-300 xl:block"
						aria-hidden
					/>
					<div className="flex justify-center pt-1 xl:hidden" aria-hidden>
						<ArrowDownIcon className="h-4 w-4 text-blue-400" />
					</div>
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
	const t = useTranslations('routes.flow');
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

			{catalog.unrouted.length > 0 ? (
				<section className="overflow-hidden rounded-xl border border-dashed border-gray-300 bg-white/80 shadow-sm">
					<div className="border-b border-gray-200 px-4 py-3">
						<h3 className="text-sm font-semibold text-gray-900">{t('unroutedTitle')}</h3>
						<p className="mt-0.5 text-xs text-gray-500">{t('unroutedHint')}</p>
					</div>
					<div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
						{catalog.unrouted.map((card) => (
							<CatalogModelNode
								key={card.model_id}
								card={card}
								copiedModelId={copiedModelId}
								onCopyModelId={onCopyModelId}
								onEditModel={onEditModel}
								onCreate={onCreate}
								showAddRoute
								showCopy
							/>
						))}
					</div>
				</section>
			) : null}
		</div>
	);
}
