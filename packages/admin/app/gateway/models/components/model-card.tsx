'use client';

import { useTranslations } from 'next-intl';
import { ModelVendorIcon } from '@/components/model-vendor-icon';
import { formatCompactTokens } from '@/lib/format-compact-tokens';
import { formatCatalogPricingTierRowsTooltip, getCatalogCardPricing } from '@/lib/pricing-ui';
import { isAudioModel, isImageGenerationModel } from '@octafuse/core/db/model-modalities';
import { tagBadgeClass } from '../model-utils';
import type { ModelListItem } from '../types';

function routeUsageClass(routesCount: number, activeRoutesCount: number): string {
	if (routesCount <= 0) return 'text-slate-400';
	if (activeRoutesCount > 0) return 'text-emerald-700';
	return 'text-amber-800';
}

function kindBadgeClass(kind: 'llm' | 'image' | 'audio'): string {
	if (kind === 'image') return 'bg-violet-50 text-violet-700 ring-violet-200';
	if (kind === 'audio') return 'bg-amber-50 text-amber-700 ring-amber-200';
	return 'bg-sky-50 text-sky-700 ring-sky-200';
}

export function ModelCard(props: {
	model: ModelListItem;
	billingCurrency: string;
	onEdit: (model: ModelListItem) => void;
}) {
	const { model, billingCurrency, onEdit } = props;
	const t = useTranslations('models.card');
	const displayName = model.display_name || model.id;
	const kind = isImageGenerationModel(model) ? 'image' : isAudioModel(model) ? 'audio' : 'llm';
	const tagShown = model.tags?.length ? model.tags.slice(0, 2) : [];
	const tagExtra = (model.tags?.length ?? 0) - tagShown.length;
	const routesLabel =
		model.routes_count === 1
			? t('routes', { count: model.routes_count })
			: t('routesPlural', { count: model.routes_count });
	const specs =
		kind === 'audio'
			? t('audioHint')
			: kind === 'image'
				? t('imageHint')
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

	return (
		<article className="group relative flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50/60">
			<button
				type="button"
				onClick={() => void onEdit(model)}
				className="absolute inset-0 z-0 cursor-pointer rounded-xl bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
				title={t('editModel', { name: displayName })}
				aria-label={t('editModel', { name: displayName })}
			/>

			<div className="pointer-events-none relative z-10 flex items-start gap-2.5">
				<ModelVendorIcon vendor={model.vendor} size="default" className="shrink-0" />
				<div className="min-w-0 flex-1">
					<h3 className="truncate text-sm font-semibold leading-5 text-gray-900" title={displayName}>
						{displayName}
					</h3>
					<p className="mt-0.5 truncate font-mono text-[11px] leading-4 text-gray-500" title={model.id}>
						{model.id}
					</p>
				</div>
				{tagShown.length > 0 ? (
					<div className="flex max-w-[40%] shrink-0 flex-wrap justify-end gap-1">
						{tagShown.map((tag) => (
							<span
								key={tag}
								className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tagBadgeClass(tag)}`}
							>
								{tag}
							</span>
						))}
						{tagExtra > 0 ? <span className="self-center text-[10px] text-gray-400">+{tagExtra}</span> : null}
					</div>
				) : null}
			</div>

			<div className="pointer-events-none relative z-10 flex min-w-0 items-center gap-1.5">
				<span
					className={`inline-flex shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${kindBadgeClass(kind)}`}
				>
					{kind === 'image' ? t('kindImage') : kind === 'audio' ? t('kindAudio') : t('kindLlm')}
				</span>
				<span className="min-w-0 truncate text-[11px] tabular-nums text-gray-600" title={specs}>
					{specs}
				</span>
			</div>

			<div className="pointer-events-none relative z-10 flex items-center justify-between gap-2">
				<div className="flex min-w-0 items-baseline gap-1" title={pricingTitle}>
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
					className={`shrink-0 text-[11px] font-medium tabular-nums ${routeUsageClass(
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
		</article>
	);
}
