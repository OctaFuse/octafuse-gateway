'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { ModelModalitiesBadgeFromRaw } from '@/components/model-modalities-badge';
import { ModelVendorIcon } from '@/components/model-vendor-icon';
import { ReadOnlyImagePricing } from '@/components/read-only-image-pricing';
import { formatCompactTokens } from '@/lib/format-compact-tokens';
import {
	formatGatewayMoneyCompact,
	formatPerImageUnit,
	formatPerMillionTokenUnit,
} from '@/lib/format-gateway-currency';
import { getCatalogImagePricingDisplay } from '@/lib/pricing-ui';
import { isImageGenerationModel } from '@octafuse/core/db/model-modalities';
import {
	buildMetadataSummary,
	buildPricingMetricColumns,
	getMetadataButtonLabel,
	tagBadgeClass,
	type PricingMetricColumn,
} from '../model-utils';
import type { ModelListItem } from '../types';

function ModelIdentityHeader(props: { model: ModelListItem }) {
	const { model } = props;
	const t = useTranslations('models.card');
	const tagShown = model.tags?.length ? model.tags.slice(0, 6) : [];
	const tagExtra = (model.tags?.length ?? 0) - tagShown.length;
	const displayName = model.display_name || model.id;
	const routesLabel =
		model.routes_count === 1
			? t('routes', { count: model.routes_count })
			: t('routesPlural', { count: model.routes_count });

	return (
		<div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
			<div className="flex min-w-0 flex-1 items-start gap-2">
				<ModelVendorIcon vendor={model.vendor} size="identity" />
				<div className="min-w-0 flex-1">
					<h3 className="truncate text-sm font-semibold text-gray-900" title={displayName}>
						{displayName}
					</h3>
					<p className="mt-0.5 truncate font-mono text-xs text-gray-500" title={model.id}>
						{model.id}
					</p>
				</div>
			</div>
			<div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
				<div className="flex flex-wrap items-center justify-start gap-1 sm:justify-end">
					{tagShown.length ? (
						<>
							{tagShown.map((tag) => (
								<span
									key={tag}
									className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tagBadgeClass(tag)}`}
								>
									{tag}
								</span>
							))}
							{tagExtra > 0 ? (
								<span className="self-center text-[10px] text-gray-400">+{tagExtra}</span>
							) : null}
						</>
					) : (
						<span className="text-[10px] text-gray-400">{t('noTags')}</span>
					)}
				</div>
				<span
					className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600"
					title={t('routesTitle', {
						routes: routesLabel,
						active: t('activeRoutes', { count: model.active_routes_count }),
					})}
				>
					{routesLabel}
					<span className="mx-1 text-gray-300" aria-hidden>
						·
					</span>
					{t('activeRoutes', { count: model.active_routes_count })}
				</span>
			</div>
		</div>
	);
}

function ModelCapabilityPanel({ model }: { model: ModelListItem }) {
	const t = useTranslations('models.card');
	const tCommon = useTranslations('common');
	const isImage = isImageGenerationModel(model);
	const cellClass = 'rounded-md border border-gray-100 bg-gray-50/60 px-2 py-1.5';
	return (
		<div>
			<h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{t('capabilities')}</h4>
			<div className="mt-1.5 grid grid-cols-2 gap-1.5">
				{!isImage ? (
					<>
						<div className={cellClass}>
							<p className="text-[11px] text-gray-400">{t('totalContext')}</p>
							<p className="mt-0.5 text-xs font-semibold text-gray-900 tabular-nums tracking-tight">
								{formatCompactTokens(model.context_window)}
							</p>
						</div>
						<div className={cellClass}>
							<p className="text-[11px] text-gray-400">{t('maxOutput')}</p>
							<p className="mt-0.5 text-xs font-semibold text-gray-900 tabular-nums tracking-tight">
								{formatCompactTokens(model.max_tokens)}
							</p>
						</div>
					</>
				) : null}
				<div className={`min-w-0 ${cellClass}`}>
					<p className="text-[11px] text-gray-400">{t('modalities')}</p>
					<div className="mt-1">
						<ModelModalitiesBadgeFromRaw
							inputRaw={model.input_modalities}
							outputRaw={model.output_modalities}
							size="sm"
						/>
					</div>
				</div>
				<div className={cellClass}>
					<p className="text-[11px] text-gray-400">{t('released')}</p>
					<p className="mt-0.5 text-xs text-gray-700 tabular-nums">{model.released_at || tCommon('noData')}</p>
				</div>
			</div>
		</div>
	);
}

function ModelPricingPanel(props: {
	model: ModelListItem;
	pricingColumns: PricingMetricColumn[];
	billingCurrency: string;
}) {
	const { model, pricingColumns, billingCurrency } = props;
	const t = useTranslations('models.card');
	const tCommon = useTranslations('common');
	const imageDisplay = useMemo(
		() => getCatalogImagePricingDisplay(model, billingCurrency),
		[model, billingCurrency]
	);
	const tokenColumns = useMemo(
		() => pricingColumns.filter((c) => (c.unitKind ?? 'per_m') === 'per_m'),
		[pricingColumns]
	);
	const perImageColumns = useMemo(
		() => pricingColumns.filter((c) => c.unitKind === 'per_image'),
		[pricingColumns]
	);
	const hasTokenCols = tokenColumns.length > 0;
	const hasPerImageCols = perImageColumns.length > 0;
	const hasAnyCols = hasTokenCols || hasPerImageCols;
	const showPerImageSummary = imageDisplay?.billingKind === 'image_per_image';

	return (
		<div>
			<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
				<h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{t('pricing')}</h4>
				{hasTokenCols ? (
					<span className="text-[11px] font-normal normal-case tracking-normal text-gray-400 tabular-nums">
						{formatPerMillionTokenUnit(billingCurrency)}
					</span>
				) : null}
				{hasPerImageCols ? (
					<span className="text-[11px] font-normal normal-case tracking-normal text-gray-400 tabular-nums">
						{formatPerImageUnit(billingCurrency)}
					</span>
				) : null}
			</div>
			{!hasAnyCols ? (
				<p className="mt-1.5 text-xs text-gray-400">{tCommon('noData')}</p>
			) : (
				<div className="mt-1.5 space-y-1.5">
					<div
						className={
							isImageGenerationModel(model)
								? 'grid grid-cols-2 gap-1.5'
								: 'grid grid-cols-4 gap-1'
						}
					>
						{[...tokenColumns, ...perImageColumns].map((col) => (
							<div
								key={col.title}
								className="min-w-0 rounded-md border border-gray-100 bg-gray-50/70 px-1.5 py-1.5 sm:px-2"
							>
								<p
									className="truncate text-[11px] font-medium text-gray-500"
									title={col.headerTitle ?? col.title}
								>
									{col.title}
								</p>
								<div className="mt-1 space-y-1 tabular-nums leading-snug">
									{col.lines.map((line, lineIdx) => (
										<div
											key={`${col.title}-${lineIdx}`}
											className="flex min-w-0 flex-col gap-0.5 sm:flex-wrap sm:flex-row sm:items-baseline sm:gap-x-1"
											title={
												line.price == null
													? line.condition
													: `${line.condition} ${formatGatewayMoneyCompact(line.price, billingCurrency)}`
											}
										>
											<span className="shrink-0 truncate text-[10px] text-gray-400 sm:text-[11px]">
												{line.condition}
											</span>
											<span className="truncate text-xs font-semibold text-gray-900">
												{line.price == null
													? tCommon('noData')
													: formatGatewayMoneyCompact(line.price, billingCurrency)}
											</span>
										</div>
									))}
								</div>
							</div>
						))}
					</div>
					{showPerImageSummary ? (
						<ReadOnlyImagePricing
							compact
							display={imageDisplay}
							emptyLabel={tCommon('noData')}
							showTokenRates={false}
						/>
					) : null}
				</div>
			)}
		</div>
	);
}

function ModelMetadataCell(props: { model: ModelListItem; onView: (model: ModelListItem) => void }) {
	const t = useTranslations('models.card');
	const tCommon = useTranslations('common');
	const summary = useMemo(() => buildMetadataSummary(props.model.metadata), [props.model.metadata]);
	if (summary.kind === 'empty') {
		return <span className="text-xs text-gray-400">{tCommon('noData')}</span>;
	}
	const label = getMetadataButtonLabel(summary);
	return (
		<button
			type="button"
			onClick={(e) => {
				e.stopPropagation();
				props.onView(props.model);
			}}
			className="inline-flex max-w-full items-center truncate rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-medium text-gray-700 hover:border-gray-300 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
			title={t('viewMetadataJson')}
		>
			{label}
		</button>
	);
}

function ModelDetailsPanel(props: {
	model: ModelListItem;
	onViewMetadata: (model: ModelListItem) => void;
}) {
	const { model, onViewMetadata } = props;
	const t = useTranslations('models.card');
	const tCommon = useTranslations('common');
	const description = model.description?.trim();
	const metadataSummary = buildMetadataSummary(model.metadata);
	const hasMetadata = metadataSummary.kind !== 'empty';

	if (!description && !hasMetadata) {
		return null;
	}

	return (
		<div className="grid gap-2 border-t border-gray-100 pt-2.5 sm:grid-cols-2">
			<div className="min-w-0">
				<h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{t('description')}</h4>
				{description ? (
					<p className="mt-1 line-clamp-2 text-xs leading-relaxed text-gray-600" title={description}>
						{description}
					</p>
				) : (
					<p className="mt-1 text-xs text-gray-400">{tCommon('noData')}</p>
				)}
			</div>
			<div className="min-w-0">
				<h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{t('metadata')}</h4>
				<div className="mt-1">
					<ModelMetadataCell model={model} onView={onViewMetadata} />
				</div>
			</div>
		</div>
	);
}

export function ModelCard(props: {
	model: ModelListItem;
	billingCurrency: string;
	onEdit: (model: ModelListItem) => void;
	onViewMetadata: (model: ModelListItem) => void;
}) {
	const { model, billingCurrency, onEdit, onViewMetadata } = props;
	const pricingColumns = buildPricingMetricColumns(model.pricing_profile);

	return (
		<article
			role="button"
			tabIndex={0}
			className="cursor-pointer rounded-xl border border-gray-200/80 bg-white p-3 shadow-sm transition-all duration-200 ease-out hover:-translate-y-1 hover:border-blue-300 hover:bg-blue-50/30 hover:shadow-lg hover:shadow-blue-100/70 hover:ring-1 hover:ring-blue-200 focus:outline-none focus-visible:border-blue-400 focus-visible:bg-blue-50/30 focus-visible:shadow-lg focus-visible:ring-2 focus-visible:ring-blue-500 active:translate-y-0"
			onClick={() => void onEdit(model)}
			onKeyDown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					void onEdit(model);
				}
			}}
		>
			<ModelIdentityHeader model={model} />
			<div className="mt-2.5 space-y-2.5">
				<ModelCapabilityPanel model={model} />
				<ModelPricingPanel
					model={model}
					pricingColumns={pricingColumns}
					billingCurrency={billingCurrency}
				/>
				<ModelDetailsPanel model={model} onViewMetadata={onViewMetadata} />
			</div>
		</article>
	);
}
