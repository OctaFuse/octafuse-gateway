'use client';

import {
	ArrowPathIcon,
	ArrowUpRightIcon,
	ChatBubbleLeftRightIcon,
	PhotoIcon,
	MicrophoneIcon,
	SpeakerWaveIcon,
	CubeIcon,
	ShareIcon,
} from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { ModelVendorIcon } from '@/components/model-vendor-icon';
import { formatCompactTokens } from '@/lib/format-compact-tokens';
import { formatCatalogPricingTierRowsTooltip } from '@/lib/pricing-ui';
import { resolveModelKind } from '@octafuse/core/db/model-kind';
import {
	isModelRetiringSoon,
	resolveModelLifecycle,
} from '@/lib/model-lifecycle';
import type { CatalogView } from '../../components/catalog-view-toggle';
import { getModelCardPricing, tagBadgeClass } from '../model-utils';
import type { ModelListItem } from '../types';

export const MODEL_LIST_COLUMNS =
	'xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1.05fr)_minmax(0,1.2fr)_minmax(0,1fr)_1.75rem]';

function routeUsageClass(
	routesCount: number,
	activeRoutesCount: number
): string {
	if (routesCount <= 0) return 'text-slate-400';
	if (activeRoutesCount > 0) return 'text-emerald-700';
	return 'text-amber-800';
}

const kindBadgeClass = 'bg-gray-100 text-gray-600 ring-gray-200';

export function ModelCard(props: {
	view?: CatalogView;
	model: ModelListItem;
	billingCurrency: string;
	onEdit: (model: ModelListItem) => void;
	onViewPricing: (model: ModelListItem) => void;
	onViewRoutes: (model: ModelListItem) => void;
	/** 点击「有官方更新」图标：打开同步面板并定位到该模型所属厂商。 */
	onReviewOfficialUpdate?: (model: ModelListItem) => void;
}) {
	const {
		model,
		billingCurrency,
		onEdit,
		onViewPricing,
		onViewRoutes,
		onReviewOfficialUpdate,
		view = 'cards',
	} = props;
	const isList = view === 'list';
	const hasOfficialUpdate = Number(model.official_update_count ?? 0) > 0;
	const t = useTranslations('models.card');
	const displayName = model.display_name || model.id;
	const kind = resolveModelKind(model);
	const kindVisual = {
		llm: { Icon: ChatBubbleLeftRightIcon, tone: 'text-blue-600' },
		image: { Icon: PhotoIcon, tone: 'text-violet-600' },
		asr: { Icon: MicrophoneIcon, tone: 'text-amber-600' },
		tts: { Icon: SpeakerWaveIcon, tone: 'text-teal-600' },
		embedding: { Icon: CubeIcon, tone: 'text-indigo-600' },
	}[kind];
	const KindIcon = kindVisual.Icon;
	const isRetired = resolveModelLifecycle(model.retired_at) === 'retired';
	const isRetiringSoon = isModelRetiringSoon(model.retired_at);
	const tagShown = model.tags?.length ? model.tags.slice(0, 2) : [];
	const tagExtra = (model.tags?.length ?? 0) - tagShown.length;
	const routesLabel =
		model.routes_count === 1
			? t('routes', { count: model.routes_count })
			: t('routesPlural', { count: model.routes_count });
	const specs =
		kind === 'asr' || kind === 'tts' || kind === 'image'
			? ''
			: kind === 'embedding'
			? t('embeddingHint', {
					context: formatCompactTokens(model.context_window),
			  })
			: t('specs', {
					context: formatCompactTokens(model.context_window),
					max: formatCompactTokens(model.max_tokens),
			  });
	const pricing = getModelCardPricing(
		model,
		billingCurrency,
		t('pricingNoData')
	);
	const pricingTooltip = formatCatalogPricingTierRowsTooltip(
		model,
		billingCurrency
	);
	const pricingTitle =
		pricingTooltip === '—'
			? [pricing.amount, pricing.unit].filter(Boolean).join(' ')
			: pricingTooltip;

	const renderOfficialUpdateButton = () =>
		hasOfficialUpdate && onReviewOfficialUpdate ? (
			<button
				type="button"
				onClick={(event) => {
					event.stopPropagation();
					onReviewOfficialUpdate(model);
				}}
				className="pointer-events-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200 transition-colors hover:bg-orange-100 focus:outline-none focus:ring-2 focus:ring-orange-500"
				title={t('officialUpdateTitle')}
				aria-label={t('officialUpdateTitle')}
			>
				<ArrowPathIcon className="h-4 w-4" aria-hidden />
			</button>
		) : null;

	const tagBadges =
		tagShown.length > 0 ? (
			<div
				className={`flex shrink-0 flex-wrap gap-1 ${
					isList ? 'min-w-0' : 'min-w-0'
				}`}
				title={model.tags.join(' · ')}
			>
				{tagShown.map((tag) => (
					<span
						key={tag}
						className={`max-w-full break-words rounded px-1.5 py-0.5 text-xs font-medium ${tagBadgeClass(
							tag
						)}`}
					>
						{tag}
					</span>
				))}
				{tagExtra > 0 ? (
					<span className="self-center text-xs text-gray-400">+{tagExtra}</span>
				) : null}
			</div>
		) : null;

	return (
		<article
			role={isList ? 'listitem' : undefined}
			className={`group relative min-w-0 gap-3 bg-white p-4 transition-colors hover:bg-slate-50/60 ${
				isList
					? `grid sm:grid-cols-2 xl:items-center xl:gap-4 ${MODEL_LIST_COLUMNS}`
					: 'flex flex-col rounded-xl border border-gray-200 hover:border-gray-300'
			}${isRetired ? ' opacity-75' : ''}`}
		>
			<button
				type="button"
				onClick={() => void onEdit(model)}
				className={`absolute inset-0 z-0 cursor-pointer bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-500 ${
					isList ? '' : 'rounded-xl'
				}`}
				aria-label={t('editModel', { name: displayName })}
			/>

			<div
				className={`pointer-events-none relative z-10 flex min-w-0 gap-2.5 ${
					isList ? 'items-center' : 'items-start'
				}`}
			>
				<ModelVendorIcon
					vendor={model.vendor}
					size="default"
					className="shrink-0"
				/>
				<div className="min-w-0 flex-1">
					<h3
						className="truncate text-sm font-medium leading-5 text-gray-900"
						title={displayName}
					>
						{displayName}
					</h3>
					<p
						className="mt-0.5 truncate font-mono text-xs leading-4 text-gray-500"
						title={model.id}
					>
						{model.id}
					</p>
					{tagBadges ? <div className="mt-1.5">{tagBadges}</div> : null}
				</div>
				{isList ? (
					<span className="xl:hidden">{renderOfficialUpdateButton()}</span>
				) : (
					renderOfficialUpdateButton()
				)}
			</div>

			<div
				className={`pointer-events-none relative z-10 flex min-w-0 items-center gap-1.5 ${
					isList ? 'flex-wrap' : ''
				}`}
			>
				<span
					className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${kindBadgeClass}`}
				>
					<KindIcon className={`h-3.5 w-3.5 ${kindVisual.tone}`} aria-hidden />
					{kind === 'image'
						? t('kindImage')
						: kind === 'asr'
						? t('kindAsr')
						: kind === 'tts'
						? t('kindTts')
						: kind === 'embedding'
						? t('kindEmbedding')
						: t('kindLlm')}
				</span>
				{isRetired || isRetiringSoon ? (
					<span
						className={`pointer-events-auto inline-flex shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
							isRetired
								? 'bg-stone-100 text-stone-500 ring-stone-200'
								: 'bg-stone-50 text-stone-600 ring-stone-300'
						}`}
						title={
							model.retired_at
								? t('retiredAt', { date: model.retired_at })
								: undefined
						}
					>
						{isRetired ? t('retired') : t('retiringSoon')}
					</span>
				) : null}
				{specs ? (
					<span
						className={`min-w-0 truncate text-xs tabular-nums text-gray-600 ${
							isList ? 'w-full' : ''
						}`}
						title={specs}
					>
						{specs}
					</span>
				) : null}
			</div>

			<div
				className={
					isList
						? 'contents'
						: 'relative z-10 mt-auto flex flex-wrap items-end justify-between gap-3 pt-2'
				}
			>
				<button
					type="button"
					onClick={() => onViewPricing(model)}
					aria-label={t('viewPricing', { name: displayName })}
					title={pricingTitle}
					className="admin-model-price relative z-10 min-w-0 rounded-md py-1 text-left hover:text-blue-700"
				>
					<span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
						<span className="font-mono text-sm tabular-nums text-gray-900">
							{pricing.amount}
						</span>
						<span className="text-xs text-gray-500">{pricing.unit}</span>
						<ArrowUpRightIcon className="h-3 w-3 text-gray-400" aria-hidden />
					</span>
					{pricing.unit === '/M' && (
						<span className="mt-1 block text-xs text-gray-500">
							{t(
								kind === 'embedding'
									? 'inputOnlyPricing'
									: kind === 'image'
									? 'textImagePricing'
									: 'inputOutputPricing'
							)}
							{pricing.tierCount > 1
								? ` · ${t('pricingTiers', { count: pricing.tierCount })}`
								: ''}
						</span>
					)}
				</button>
				<button
					type="button"
					onClick={() => onViewRoutes(model)}
					aria-label={t('viewRoutes', { name: displayName })}
					className="admin-model-route relative z-10 inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md py-1 text-left text-xs text-gray-600 hover:text-gray-950"
				>
					<ShareIcon
						className="h-3.5 w-3.5 shrink-0 text-gray-400"
						aria-hidden
					/>
					<span>{routesLabel}</span>
					{model.routes_count > 0 && (
						<span
							className={routeUsageClass(
								model.routes_count,
								model.active_routes_count
							)}
						>
							{t('activeRoutes', { count: model.active_routes_count })}
						</span>
					)}
					<ArrowUpRightIcon className="h-3 w-3 text-gray-400" aria-hidden />
				</button>
			</div>

			{isList && hasOfficialUpdate && onReviewOfficialUpdate ? (
				<div className="pointer-events-none relative z-10 hidden items-center justify-end xl:col-start-5 xl:row-start-1 xl:flex">
					{renderOfficialUpdateButton()}
				</div>
			) : null}
		</article>
	);
}
