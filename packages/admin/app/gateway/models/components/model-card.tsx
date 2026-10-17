'use client';

import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { ModelVendorIcon } from '@/components/model-vendor-icon';
import { formatCompactTokens } from '@/lib/format-compact-tokens';
import { formatCatalogPricingTierRowsTooltip, getCatalogCardPricing } from '@/lib/pricing-ui';
import { resolveModelKind, type ModelKind } from '@octafuse/core/db/model-kind';
import { isModelRetiringSoon, resolveModelLifecycle } from '@/lib/model-lifecycle';
import type { CatalogView } from '../../components/catalog-view-toggle';
import { tagBadgeClass } from '../model-utils';
import type { ModelListItem } from '../types';

export const MODEL_LIST_COLUMNS = 'xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,0.6fr)]';

function routeUsageClass(routesCount: number, activeRoutesCount: number): string {
	if (routesCount <= 0) return 'text-slate-400';
	if (activeRoutesCount > 0) return 'text-emerald-700';
	return 'text-amber-800';
}

function kindBadgeClass(kind: ModelKind): string {
	if (kind === 'embedding') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
	if (kind === 'image') return 'bg-violet-50 text-violet-700 ring-violet-200';
	if (kind === 'asr') return 'bg-amber-50 text-amber-700 ring-amber-200';
	if (kind === 'tts') return 'bg-rose-50 text-rose-700 ring-rose-200';
	return 'bg-sky-50 text-sky-700 ring-sky-200';
}

export function ModelCard(props: {
	view?: CatalogView;
	model: ModelListItem;
	billingCurrency: string;
	onEdit: (model: ModelListItem) => void;
	/** 点击「有官方更新」图标：打开同步面板并定位到该模型所属厂商。 */
	onReviewOfficialUpdate?: (model: ModelListItem) => void;
}) {
	const { model, billingCurrency, onEdit, onReviewOfficialUpdate, view = 'cards' } = props;
	const isList = view === 'list';
	const hasOfficialUpdate = Number(model.official_update_count ?? 0) > 0;
	const t = useTranslations('models.card');
	const displayName = model.display_name || model.id;
	const kind = resolveModelKind(model);
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
				? t('embeddingHint', { context: formatCompactTokens(model.context_window) })
				: t('specs', {
					context: formatCompactTokens(model.context_window),
					max: formatCompactTokens(model.max_tokens),
				});
	const pricing = getCatalogCardPricing(model, billingCurrency, t('pricingNoData'));
	const pricingTooltip = formatCatalogPricingTierRowsTooltip(model, billingCurrency);
	const pricingTitle =
		pricingTooltip === '—'
			? [pricing.amount, pricing.unit].filter(Boolean).join(' ')
			: pricingTooltip;

	const tagBadges = tagShown.length > 0 ? (
		<div className={`flex shrink-0 flex-wrap gap-1 ${isList ? 'min-w-0' : 'max-w-[40%] justify-end'}`} title={model.tags.join(' · ')}>
			{tagShown.map((tag) => (
				<span
					key={tag}
					className={`max-w-full break-words rounded px-1.5 py-0.5 text-[10px] font-medium ${tagBadgeClass(tag)}`}
				>
					{tag}
				</span>
			))}
			{tagExtra > 0 ? <span className="self-center text-[10px] text-gray-400">+{tagExtra}</span> : null}
		</div>
	) : null;

	return (
		<article
			role={isList ? 'listitem' : undefined}
			className={`group relative min-w-0 gap-3 bg-white p-4 transition-colors hover:bg-slate-50/60 ${isList ? `grid sm:grid-cols-2 xl:items-center xl:gap-4 ${MODEL_LIST_COLUMNS}` : 'flex flex-col rounded-xl border border-slate-200 shadow-sm hover:border-slate-300'}${isRetired ? ' opacity-75' : ''}`}
		>
			<button
				type="button"
				onClick={() => void onEdit(model)}
				className={`absolute inset-0 z-0 cursor-pointer bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${isList ? '' : 'rounded-xl'}`}
				aria-label={t('editModel', { name: displayName })}
			/>

			<div className={`pointer-events-none relative z-10 flex min-w-0 gap-2.5 ${isList ? 'items-center' : 'items-start'}`}>
				<ModelVendorIcon vendor={model.vendor} size="default" className="shrink-0" />
				<div className="min-w-0 flex-1">
					<h3 className="truncate text-sm font-semibold leading-5 text-gray-900" title={displayName}>
						{displayName}
					</h3>
					<p className="mt-0.5 truncate font-mono text-[11px] leading-4 text-gray-500" title={model.id}>
						{model.id}
					</p>
				</div>
				{hasOfficialUpdate && onReviewOfficialUpdate ? (
					<button
						type="button"
						onClick={(event) => {
							event.stopPropagation();
							onReviewOfficialUpdate(model);
						}}
						className="pointer-events-auto relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200 transition-colors hover:bg-orange-100 focus:outline-none focus:ring-2 focus:ring-orange-500"
						title={t('officialUpdateTitle')}
						aria-label={t('officialUpdateTitle')}
					>
						<ArrowPathIcon className="h-4 w-4" aria-hidden />
						<span
							className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-orange-500 ring-2 ring-white"
							aria-hidden
						/>
					</button>
				) : null}
				{!isList ? tagBadges : null}
			</div>

			<div className={`pointer-events-none relative z-10 flex min-w-0 items-center gap-1.5 ${isList ? 'flex-wrap' : ''}`}>
				<span
					className={`inline-flex shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${kindBadgeClass(kind)}`}
				>
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
						className={`pointer-events-auto inline-flex shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${
							isRetired
								? 'bg-stone-100 text-stone-500 ring-stone-200'
								: 'bg-stone-50 text-stone-600 ring-stone-300'
						}`}
						title={model.retired_at ? t('retiredAt', { date: model.retired_at }) : undefined}
					>
						{isRetired ? t('retired') : t('retiringSoon')}
					</span>
				) : null}
				{specs ? (
					<span className={`min-w-0 truncate text-[11px] tabular-nums text-gray-600 ${isList ? 'w-full' : ''}`} title={specs}>
						{specs}
					</span>
				) : null}
			</div>

			<div className={isList ? 'contents' : 'pointer-events-none relative z-10 flex items-center justify-between gap-2'}>
				<div className={`pointer-events-none relative z-10 flex min-w-0 items-baseline gap-1 ${isList ? 'flex-wrap' : ''}`} title={pricingTitle}>
					<span className="truncate text-xs font-semibold tabular-nums text-gray-900">
						{pricing.amount}
					</span>
					{pricing.unit ? (
						<span className="shrink-0 text-[10px] text-gray-400">{pricing.unit}</span>
					) : null}
					{pricing.tierCount > 1 ? (
						<span className="shrink-0 rounded bg-slate-100 px-1 py-0.5 text-[10px] font-medium text-slate-600">
							{t('pricingTiers', { count: pricing.tierCount })}
						</span>
					) : null}
				</div>
				<span
					className={`pointer-events-none relative z-10 text-[11px] font-medium tabular-nums ${isList ? 'min-w-0' : 'shrink-0'} ${routeUsageClass(
						model.routes_count,
						model.active_routes_count
					)}`}
					title={t('routesTitle', {
						routes: routesLabel,
						active: t('activeRoutes', { count: model.active_routes_count }),
					})}
				>
					{routesLabel}
					<span className="mx-1 opacity-40" aria-hidden>
						·
					</span>
					{t('activeRoutes', { count: model.active_routes_count })}
				</span>
			</div>
			{isList ? (
				<div className="pointer-events-none relative z-10 min-w-0 sm:col-span-2 xl:col-span-1">
					{tagBadges ?? <span className="text-xs text-slate-400">{t('noTags')}</span>}
				</div>
			) : null}
		</article>
	);
}
