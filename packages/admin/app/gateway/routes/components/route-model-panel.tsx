'use client';

import { useState } from 'react';
import {
	ChatBubbleLeftRightIcon, CircleStackIcon, ClipboardDocumentIcon, MicrophoneIcon,
	PencilSquareIcon, PhotoIcon, PlusIcon, SpeakerWaveIcon,
} from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { formatCompactTokens } from '@/lib/format-compact-tokens';
import { tagBadgeClass } from '../../models/model-utils';
import { routeModelBillingLabel } from '../route-model-summary';
import {
	groupSectionsByRequestSurface, parseModelTagsList, splitRoutesByProtocolAndRouteGroup,
	type RequestSurfaceGroup,
} from '../route-utils';
import type { RouteModelLayout } from '../use-route-display-preferences';
import { FlowConnectorAdd, ModelSurface, RequestSurfaceNode, type RouteModelFlowProps } from './route-model-flow';
import { GroupToUpstreamBranch } from './route-surface-catalog';

function TiledSurface({ surface, ...flow }: Omit<RouteModelFlowProps, 'onEditModel'> & { surface: RequestSurfaceGroup }) {
	const t = useTranslations('routes.flow');
	return (
		<div className="xl:grid xl:grid-cols-[minmax(152px,184px)_minmax(0,1fr)]">
			<div className="route-flow-entry relative flex min-w-0 flex-col justify-center py-3 xl:pr-8">
				<RequestSurfaceNode surface={surface} modelId={flow.card.model_id} />
				<FlowConnectorAdd
					railClass="bg-gray-300"
					label={t('addRouteGroup')}
					onClick={() => flow.onCreate(flow.card.model_id, {
						protocol: surface.protocol, operation: surface.requestOperation, group: '',
					})}
				/>
			</div>
			<div>
				{surface.sections.map((section, index) => (
					<GroupToUpstreamBranch key={section.key} {...flow} byModel section={section}
						branchIndex={index} branchCount={surface.sections.length} />
				))}
			</div>
		</div>
	);
}

export function RouteModelPanel({ layout, onEditModel, ...flow }: RouteModelFlowProps & { layout: RouteModelLayout }) {
	const { card, meta, density, onCreate } = flow;
	const t = useTranslations('routes.card');
	const tFlow = useTranslations('routes.flow');
	const billingLabel = meta ? routeModelBillingLabel(meta) : null;
	const ModelIcon = billingLabel?.startsWith('image') ? PhotoIcon : billingLabel?.startsWith('asr') ? MicrophoneIcon : billingLabel?.startsWith('tts') ? SpeakerWaveIcon : billingLabel === 'embedding' ? CircleStackIcon : ChatBubbleLeftRightIcon;
	const stats = billingLabel
		? t(`modelBilling.${billingLabel}`)
		: t('contextLine', { context: formatCompactTokens(meta?.context_window), max: formatCompactTokens(meta?.max_tokens) });
	const tags = parseModelTagsList(meta);
	const sections = splitRoutesByProtocolAndRouteGroup(card.groupRoutes);
	const surfaceGroups = groupSectionsByRequestSurface(sections);

	const [selectedKey, setSelectedKey] = useState<string | null>(null);
	const surface = surfaceGroups.find(item => item.key === selectedKey) ?? surfaceGroups[0];

	const [selectedGroups, setSelectedGroups] = useState<Record<string, string>>({});
	const section = surface?.sections.find(item => item.group === selectedGroups[surface.key])
		?? surface?.sections.find(item => item.group === 'default') ?? surface?.sections[0];


	const tiled = layout === 'tiled';
	const tiledList = tiled && density === 'list';
	const copied = flow.copiedModelId === card.model_id;
	const metadata = (
		<>
			<span className="text-xs text-gray-500">{stats}</span>
			{tiled && (
				<span className="border-l border-gray-200 pl-2 text-xs tabular-nums text-gray-500" title={t('routeSummaryHint')}>
					{t('routeSummary', { active: card.activeCount, total: card.groupRoutes.length })}
				</span>
			)}
			{tags.slice(0, 4).map(tag => (
				<span key={tag} className={`rounded px-1.5 py-0.5 text-xs font-medium ${tagBadgeClass(tag)}`}>{tag}</span>
			))}
		</>
	);

	return (
		<article className={`route-model-panel overflow-hidden rounded-xl border border-gray-200 bg-white ${tiledList ? 'route-flow-list-layout' : ''}`}>
			<header className="route-model-heading border-b border-gray-100 bg-white px-4 py-4 sm:px-5">
				<div className="flex items-center justify-between gap-3">
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<span className="route-model-symbol" aria-hidden><ModelIcon className="h-4 w-4" /></span>
						<button type="button" onClick={() => onEditModel(card.model_id)} title={t('editModel', { title: card.title })}
							className="route-model-name truncate text-left text-base font-medium text-gray-900 underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-gray-500">
							{card.title}
						</button>
						{tiled ? (
							<div className="flex shrink-0 items-center gap-0.5">
								<button type="button" onClick={() => flow.onCopyModelId(card.model_id)}
									className={`rounded-md p-1 hover:bg-gray-100 ${copied ? 'text-emerald-600' : 'text-gray-400'}`}
									title={copied ? t('copiedModelId') : t('copyModelId', { id: card.model_id })}>
									<ClipboardDocumentIcon className="h-4 w-4" />
								</button>
								<button type="button" onClick={() => onEditModel(card.model_id)}
									className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
									title={t('editModel', { title: card.title })}>
									<PencilSquareIcon className="h-4 w-4" />
								</button>
							</div>
						) : metadata}
					</div>
					{!tiled && surface && section && (
						<button type="button" className="route-model-add-provider"
							aria-label={tFlow('addProvider')} title={tFlow('addProvider')}
							onClick={() => onCreate(card.model_id, {
								protocol: surface.protocol, operation: surface.requestOperation, group: section.group,
							})}>
							<PlusIcon aria-hidden className="h-4 w-4" />
						</button>
					)}
				</div>
				{tiled && (
					<div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
						<span className="min-w-0 font-mono text-xs text-gray-500 [overflow-wrap:anywhere]">{card.model_id}</span>
						<span className="text-gray-300">·</span>
						{metadata}
					</div>
				)}
			</header>

			<div className={`route-model-surfaces ${tiled ? 'route-model-tiled-surfaces' : 'route-model-card-surfaces'}`}>
				{!surface || !section ? (
					<div className="flex min-h-20 items-center justify-center py-5 text-sm font-medium text-gray-400">
						{tFlow('noProviders')}
					</div>
				) : tiled ? (
					surfaceGroups.map(item => <TiledSurface key={item.key} {...flow} surface={item} />)
				) : (
					<ModelSurface {...flow} surfaceGroups={surfaceGroups} surface={surface}
						selectSurface={setSelectedKey} section={section}
						selectGroup={group => setSelectedGroups(previous => ({ ...previous, [surface.key]: group }))} />
				)}
			</div>
		</article>
	);
}
