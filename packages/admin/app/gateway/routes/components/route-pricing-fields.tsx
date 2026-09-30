'use client';

import { PricingInfoHint } from '@/components/PricingInfoHint';
import { useMemo, useState } from 'react';
import { CodeBracketIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { ReadOnlyImagePricing } from '@/components/read-only-image-pricing';
import { getUserChargedCatalogTierRows } from '@/lib/pricing-ui';
import { resolveDailyScheduleFactor, scheduleWindowKey } from '@octafuse/core/db/pricing-schedule';
import {
	alignRouteScheduleWindowsToCatalog,
	independentProviderWindows,
	catalogScheduleWindowsFromModel,
	formatRoutePriceOverridePreview,
} from '../route-utils';
import { RouteEditorSection } from './route-editor-ui';
import { RouteBillingFactors } from './route-billing-factors';
import { RouteCatalogPricingTable } from './route-catalog-pricing-table';
import { ScheduleWindowEffectivePrices } from './schedule-window-effective-prices';
import type { RouteModalProps } from './route-modal-types';

type Props = Pick<
	RouteModalProps,
	| 'formData'
	| 'onFormChange'
	| 'selectedModel'
	| 'billingCurrency'
	| 'businessTimezone'
	| 'catalogStandardTierRows'
	| 'catalogImagePricingDisplay'
	| 'catalogAudioPricingDisplay'
	| 'selectedModelIsImage'
	| 'selectedModelIsAudio'
>;

export function RoutePricingFields({
	formData,
	onFormChange,
	selectedModel,
	billingCurrency,
	businessTimezone,
	catalogStandardTierRows,
	catalogImagePricingDisplay,
	catalogAudioPricingDisplay,
	selectedModelIsImage,
	selectedModelIsAudio,
}: Props) {
	const t = useTranslations('routes.modal');
	const tModels = useTranslations('models.modal');
	const tCommon = useTranslations('common');
	const [priceOverrideJsonOpen, setPriceOverrideJsonOpen] = useState(false);
	const [priceOverrideJsonCopied, setPriceOverrideJsonCopied] = useState(false);
	const priceOverridePreview = useMemo(() => formatRoutePriceOverridePreview(formData), [formData]);
	const catalogScheduleWindows = useMemo(
		() => catalogScheduleWindowsFromModel(selectedModel),
		[selectedModel]
	);
	const catalogScheduleLocked = catalogScheduleWindows.length > 0;
	const editorScheduleWindows = catalogScheduleLocked
		? alignRouteScheduleWindowsToCatalog(
				catalogScheduleWindows,
				formData.schedule_windows,
				'1',
				formData.provider_factor
		  )
		: formData.schedule_windows;
	const catalogNowSchedule = useMemo(
		() => resolveDailyScheduleFactor(catalogScheduleWindows, new Date(), businessTimezone),
		[catalogScheduleWindows, businessTimezone]
	);
	const catalogNowWindowKey = catalogNowSchedule.window ? scheduleWindowKey(catalogNowSchedule.window) : null;

	return (
		<section className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="text-xs leading-5 text-gray-500">
					{t('editor.pricingTimezone', { timezone: businessTimezone })}
				</p>
				<button
					type="button"
					onClick={() => setPriceOverrideJsonOpen((openJson) => !openJson)}
					aria-expanded={priceOverrideJsonOpen}
					aria-controls="route-price-override-json"
					title={priceOverrideJsonOpen ? t('hidePriceOverrideJson') : t('viewPriceOverrideJson')}
					className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 ${
						priceOverrideJsonOpen
							? 'border-blue-300 bg-blue-50 text-blue-800'
							: 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
					}`}
				>
					<CodeBracketIcon className="h-3.5 w-3.5" aria-hidden />
					JSON
				</button>
			</div>
			{priceOverrideJsonOpen ? (
				<div
					id="route-price-override-json"
					className="mb-3 space-y-1.5 rounded-md border border-dashed border-gray-300 bg-gray-50/90 p-2"
				>
					<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
						<code className="rounded bg-white px-1 py-0.5 text-[11px] font-semibold text-gray-600">
							price_override
						</code>
						{priceOverridePreview.ok ? (
							<button
								type="button"
								onClick={() => {
									if (!navigator.clipboard?.writeText) return;
									void navigator.clipboard.writeText(priceOverridePreview.text).then(
										() => {
											setPriceOverrideJsonCopied(true);
											window.setTimeout(() => setPriceOverrideJsonCopied(false), 1500);
										},
										() => {}
									);
								}}
								className="text-xs font-medium text-blue-600 hover:text-blue-800"
							>
								{priceOverrideJsonCopied ? tCommon('copied') : tCommon('copy')}
							</button>
						) : null}
					</div>
					<textarea
						readOnly
						rows={Math.min(16, 6 + formData.schedule_windows.length * 6)}
						value={priceOverridePreview.text}
						className={`w-full resize-y rounded-md border bg-white px-2 py-1.5 font-mono text-xs leading-relaxed ${
							priceOverridePreview.ok ? 'border-gray-200 text-gray-800' : 'border-red-200 text-red-700'
						}`}
						spellCheck={false}
						aria-label={t('viewPriceOverrideJson')}
					/>
				</div>
			) : null}
			<div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
				<RouteBillingFactors
					formData={formData}
					windows={editorScheduleWindows}
					locked={catalogScheduleLocked}
					timezone={businessTimezone}
					onChange={onFormChange}
					renderPrices={
						catalogScheduleLocked &&
						selectedModel &&
						!selectedModelIsImage &&
						!selectedModelIsAudio &&
						catalogStandardTierRows.length > 0
							? (i) => (
									<details>
										<summary className="cursor-pointer py-1 text-xs font-medium text-blue-600 hover:text-blue-800">
											{t('editor.effectivePrices')}
										</summary>
										<p className="mb-2 text-xs leading-5 text-slate-500">{t('editor.pricesAtCurrentDate')}</p>
										<ScheduleWindowEffectivePrices
											billingCurrency={billingCurrency}
											catalogFactor={catalogScheduleWindows[i]?.factor ?? 1}
											chargedFactorText={editorScheduleWindows[i]?.charged_factor ?? ''}
											meteredFactorText={editorScheduleWindows[i]?.metered_factor ?? ''}
											providerFactorText={
												editorScheduleWindows[i]?.provider_factor ?? formData.provider_factor
											}
											providerValidity={
												independentProviderWindows(formData, editorScheduleWindows)[i]?.provider_validity
											}
											model={selectedModel}
										/>
									</details>
							  )
							: undefined
					}
				/>
				<RouteEditorSection
					className="lg:sticky lg:top-0"
					title={t('standardCatalog')}
					action={<PricingInfoHint kind="catalog" />}
					description={
						selectedModelIsAudio
							? t('standardCatalogHintAudio')
							: selectedModelIsImage
							? t('standardCatalogHintImage')
							: t('standardCatalogHint')
					}
				>
					<div className="flex min-h-0 flex-1 flex-col">
						{selectedModelIsAudio ? (
							catalogAudioPricingDisplay ? (
								catalogAudioPricingDisplay.mode === 'token' ? (
									<ul className="divide-y divide-gray-100 text-sm tabular-nums">
										<li className="flex items-baseline justify-between gap-3 px-3 py-2">
											<span className="text-xs text-gray-500">{tModels('audioInputPricePerM')}</span>
											<span className="font-medium text-gray-900">
												{catalogAudioPricingDisplay.inputPrice}
												<span className="ml-1 text-[11px] font-normal text-gray-400">
													{catalogAudioPricingDisplay.unit}
												</span>
											</span>
										</li>
										<li className="flex items-baseline justify-between gap-3 px-3 py-2">
											<span className="text-xs text-gray-500">{tModels('audioOutputPricePerM')}</span>
											<span className="font-medium text-gray-900">
												{catalogAudioPricingDisplay.outputPrice}
												<span className="ml-1 text-[11px] font-normal text-gray-400">
													{catalogAudioPricingDisplay.unit}
												</span>
											</span>
										</li>
									</ul>
								) : catalogAudioPricingDisplay.mode === 'per_character' ? (
									<ul className="divide-y divide-gray-100 text-sm tabular-nums">
										<li className="flex items-baseline justify-between gap-3 px-3 py-2">
											<span className="text-xs text-gray-500">{t('audioPricePerCharacter')}</span>
											<span className="font-medium text-gray-900">
												{catalogAudioPricingDisplay.pricePerCharacter}
												<span className="ml-1 text-[11px] font-normal text-gray-400">
													{catalogAudioPricingDisplay.unit}
												</span>
											</span>
										</li>
										<li className="flex items-baseline justify-between gap-3 px-3 py-2">
											<span className="text-xs text-gray-500">{t('audioMinimumCharacters')}</span>
											<span className="font-medium text-gray-900">
												{catalogAudioPricingDisplay.minimumCharacters}
											</span>
										</li>
									</ul>
								) : (
									<ul className="divide-y divide-gray-100 text-sm tabular-nums">
										<li className="flex items-baseline justify-between gap-3 px-3 py-2">
											<span className="text-xs text-gray-500">{t('audioPricePerSecond')}</span>
											<span className="font-medium text-gray-900">
												{catalogAudioPricingDisplay.pricePerSecond}
												<span className="ml-1 text-[11px] font-normal text-gray-400">
													{catalogAudioPricingDisplay.unit}
												</span>
											</span>
										</li>
										<li className="flex items-baseline justify-between gap-3 px-3 py-2">
											<span className="text-xs text-gray-500">{t('audioMinimumSeconds')}</span>
											<span className="font-medium text-gray-900">
												{catalogAudioPricingDisplay.minimumSeconds}
											</span>
										</li>
									</ul>
								)
							) : (
								<p className="text-sm text-gray-500">
									{formData.model_id ? t('noCatalogAudioPricing') : t('selectModelForTiers')}
								</p>
							)
						) : selectedModelIsImage ? (
							<ReadOnlyImagePricing
								compact
								tokenRatesLayout="grid"
								display={catalogImagePricingDisplay}
								emptyLabel={formData.model_id ? t('noCatalogImagePricing') : t('selectModelForTiers')}
								tokenRatesTitle={t('imageTokenRates')}
							/>
						) : (
							<RouteCatalogPricingTable
								periods={[
									{ window: null, rows: catalogStandardTierRows, active: catalogNowWindowKey === null },
									...catalogScheduleWindows.map((window) => ({
										window,
										rows: selectedModel
											? getUserChargedCatalogTierRows(selectedModel, window.factor, billingCurrency)
											: [],
										active: catalogNowWindowKey === scheduleWindowKey(window),
									})),
								]}
								billingCurrency={billingCurrency}
								emptyLabel={formData.model_id ? t('noCatalogPricing') : t('selectModelForTiers')}
							/>
						)}
						{catalogScheduleLocked && (selectedModelIsAudio || selectedModelIsImage) ? (
							<div className="mt-3 border-t border-slate-200 pt-3">
								<RouteCatalogPricingTable
									showPrices={false}
									periods={[
										{ window: null, rows: [], active: catalogNowWindowKey === null },
										...catalogScheduleWindows.map((window) => ({
											window,
											rows: [],
											active: catalogNowWindowKey === scheduleWindowKey(window),
										})),
									]}
									billingCurrency={billingCurrency}
									emptyLabel={t('noCatalogPricing')}
								/>
							</div>
						) : null}
					</div>
				</RouteEditorSection>
			</div>
		</section>
	);
}
