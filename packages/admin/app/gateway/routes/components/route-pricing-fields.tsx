'use client';

import { useMemo, useState } from 'react';
import { CodeBracketIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import {
	instantToZonedDatetimeLocalInput,
	zonedDatetimeLocalInputToInstant,
} from '@/lib/business-timezone-client';
import { ReadOnlyImagePricing } from '@/components/read-only-image-pricing';
import { ReadOnlyPricingTiersTable } from '@/components/read-only-pricing-tiers-table';
import { getUserChargedCatalogTierRows } from '@/lib/pricing-ui';
import { DailyScheduleEditor } from '@/components/daily-schedule-editor';
import {
	formatIsoWeekdaysHint,
	resolveDailyScheduleFactor,
	scheduleWindowKey,
} from '@octafuse/core/db/pricing-schedule';
import {
	alignRouteScheduleWindowsToCatalog,
	catalogScheduleWindowsFromModel,
	formatRoutePriceOverridePreview,
} from '../route-utils';
import { RoutePricePanel } from './route-price-panel';
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
		? alignRouteScheduleWindowsToCatalog(catalogScheduleWindows, formData.schedule_windows)
		: formData.schedule_windows;
	const catalogNowSchedule = useMemo(
		() => resolveDailyScheduleFactor(catalogScheduleWindows, new Date(), businessTimezone),
		[catalogScheduleWindows, businessTimezone]
	);
	const catalogNowWindowKey = catalogNowSchedule.window ? scheduleWindowKey(catalogNowSchedule.window) : null;

	return (
		<section>
			<div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.65fr)]">
				<div className="min-w-0">
					<div className="mb-1 flex items-center justify-between gap-2">
						<h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
							{t('pricingSection')}
						</h3>
						<button
							type="button"
							onClick={() => setPriceOverrideJsonOpen((openJson) => !openJson)}
							aria-expanded={priceOverrideJsonOpen}
							aria-controls="route-price-override-json"
							title={priceOverrideJsonOpen ? t('hidePriceOverrideJson') : t('viewPriceOverrideJson')}
							className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 ${
								priceOverrideJsonOpen
									? 'border-blue-300 bg-blue-50 text-blue-800'
									: 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
							}`}
						>
							<CodeBracketIcon className="h-3.5 w-3.5" aria-hidden />
							JSON
						</button>
					</div>
					<p className="mb-2.5 text-[11px] text-gray-500">
						{t('billingTimezoneHint', { timezone: businessTimezone })}
					</p>
					{priceOverrideJsonOpen ? (
						<div
							id="route-price-override-json"
							className="mb-3 space-y-1.5 rounded-md border border-dashed border-gray-300 bg-gray-50/90 p-2"
						>
							<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
								<code className="rounded bg-white px-1 py-0.5 text-[10px] font-semibold text-gray-600">
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
										className="text-[11px] font-medium text-blue-600 hover:text-blue-800"
									>
										{priceOverrideJsonCopied ? tCommon('copied') : tCommon('copy')}
									</button>
								) : null}
							</div>
							<textarea
								readOnly
								rows={Math.min(16, 6 + formData.schedule_windows.length * 6)}
								value={priceOverridePreview.text}
								className={`w-full resize-y rounded-md border bg-white px-2 py-1.5 font-mono text-[11px] leading-relaxed ${
									priceOverridePreview.ok ? 'border-gray-200 text-gray-800' : 'border-red-200 text-red-700'
								}`}
								spellCheck={false}
								aria-label={t('viewPriceOverrideJson')}
							/>
						</div>
					) : null}
					<div className="flex min-h-0 flex-1 flex-col gap-3">
						<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
							<RoutePricePanel
								variant="charged"
								title={t('chargedCost')}
								subtitle={t('chargedCostHint')}
								headerEnd={
									<div className="flex flex-col items-start gap-0.5">
										<label
											htmlFor="user-cost-charged-factor"
											className="whitespace-nowrap text-[11px] font-medium text-gray-600"
										>
											{t('factor')}
										</label>
										<input
											id="user-cost-charged-factor"
											type="text"
											inputMode="decimal"
											value={formData.charged_factor}
											title={t('chargedFactorTitle')}
											onChange={(e) =>
												onFormChange({
													...formData,
													charged_factor: e.target.value,
												})
											}
											className="w-20 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm font-mono tabular-nums focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
											placeholder="1"
										/>
									</div>
								}
							/>
							<RoutePricePanel
								variant="metered"
								title={t('meteredCost')}
								subtitle={t('meteredCostHint')}
								headerEnd={
									<div className="flex flex-col items-start gap-0.5">
										<label
											htmlFor="gateway-route-metered-factor"
											className="whitespace-nowrap text-[11px] font-medium text-gray-600"
										>
											{t('factor')}
										</label>
										<input
											id="gateway-route-metered-factor"
											type="text"
											inputMode="decimal"
											value={formData.metered_factor}
											title={t('meteredFactorTitle')}
											onChange={(e) =>
												onFormChange({
													...formData,
													metered_factor: e.target.value,
												})
											}
											className="w-20 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm font-mono tabular-nums focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
											placeholder="1"
										/>
									</div>
								}
							/>
						</div>
						<RoutePricePanel
							variant="provider"
							title={t('providerFactor')}
							subtitle={t('providerFactorHint', { timezone: businessTimezone })}
						>
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
								<div>
									<label
										htmlFor="gateway-route-provider-factor"
										className="mb-1 block text-[11px] font-medium text-gray-600"
									>
										{t('factor')}
									</label>
									<input
										id="gateway-route-provider-factor"
										type="text"
										inputMode="decimal"
										value={formData.provider_factor}
										title={t('providerFactorTitle')}
										onChange={(e) => onFormChange({ ...formData, provider_factor: e.target.value })}
										className="w-full rounded border border-gray-300 bg-white px-2 py-1 font-mono text-xs tabular-nums focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
										placeholder="1"
									/>
								</div>
								<div>
									<label
										htmlFor="gateway-route-provider-starts"
										className="mb-1 block text-[11px] font-medium text-gray-600"
									>
										{t('providerFactorStarts')}
									</label>
									<input
										id="gateway-route-provider-starts"
										type="datetime-local"
										value={zonedIsoInput(formData.provider_factor_starts_at, businessTimezone)}
										onChange={(e) =>
											onFormChange({
												...formData,
												provider_factor_starts_at: isoFromZonedInput(e.target.value, businessTimezone),
											})
										}
										className="w-full rounded border border-gray-300 bg-white px-2 py-1 font-mono text-xs focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
									/>
								</div>
								<div>
									<label
										htmlFor="gateway-route-provider-expires"
										className="mb-1 block text-[11px] font-medium text-gray-600"
									>
										{t('providerFactorExpires')}
									</label>
									<input
										id="gateway-route-provider-expires"
										type="datetime-local"
										value={zonedIsoInput(formData.provider_factor_expires_at, businessTimezone)}
										onChange={(e) =>
											onFormChange({
												...formData,
												provider_factor_expires_at: isoFromZonedInput(e.target.value, businessTimezone),
											})
										}
										className="w-full rounded border border-gray-300 bg-white px-2 py-1 font-mono text-xs focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
									/>
								</div>
							</div>
						</RoutePricePanel>
						<RoutePricePanel
							variant="neutral"
							title={t('dailySchedule')}
							subtitle={catalogScheduleLocked ? t('editor.scheduleInherited') : t('pricingFormulaHint')}
							headerEndBeside="subtitle"
							headerEnd={
								catalogScheduleLocked ? null : (
									<button
										type="button"
										onClick={() =>
											onFormChange({
												...formData,
												schedule_windows: [
													...formData.schedule_windows,
													{
														start: '00:00',
														end: '08:00',
														charged_factor: '1',
														metered_factor: '1',
														provider_factor: formData.provider_factor.trim() || '1',
														days: [],
													},
												],
											})
										}
										className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-dashed border-gray-400 bg-white text-gray-600 shadow-sm transition hover:border-gray-500 hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
										aria-label={t('addScheduleWindow')}
										title={t('addScheduleWindow')}
									>
										<PlusIcon className="h-3.5 w-3.5" aria-hidden />
									</button>
								)
							}
						>
							<DailyScheduleEditor
								windows={editorScheduleWindows}
								onChange={(schedule_windows) => onFormChange({ ...formData, schedule_windows })}
								lockWindows={catalogScheduleLocked}
								compactLockedWindows
								emptyLabel={t('scheduleEmpty')}
								startLabel={t('scheduleStart')}
								endLabel={t('scheduleEnd')}
								chargedFactorLabel={t('scheduleChargedFactor')}
								meteredFactorLabel={t('scheduleMeteredFactor')}
								providerFactorLabel={t('scheduleProviderFactor')}
								removeLabel={tCommon('delete')}
								renderWindowExtra={
									catalogScheduleLocked &&
									selectedModel &&
									!selectedModelIsImage &&
									!selectedModelIsAudio &&
									catalogStandardTierRows.length > 0
										? (i) => (
												<details className="group">
													<summary className="cursor-pointer py-1 text-[11px] font-medium text-blue-600 hover:text-blue-800">
														{t('editor.effectivePrices')}
													</summary>
													<ScheduleWindowEffectivePrices
														billingCurrency={billingCurrency}
														catalogFactor={catalogScheduleWindows[i]?.factor ?? 1}
														chargedFactorText={editorScheduleWindows[i]?.charged_factor ?? ''}
														meteredFactorText={editorScheduleWindows[i]?.metered_factor ?? ''}
														providerFactorText={
															editorScheduleWindows[i]?.provider_factor ?? formData.provider_factor
														}
														model={selectedModel}
													/>
												</details>
										  )
										: undefined
								}
								dayLabels={{
									days: t('scheduleDays'),
									everyday: t('scheduleEveryday'),
									weekdays: t('scheduleWeekdays'),
									weekend: t('scheduleWeekend'),
									weekdayShort: [
										t('weekdayMon'),
										t('weekdayTue'),
										t('weekdayWed'),
										t('weekdayThu'),
										t('weekdayFri'),
										t('weekdaySat'),
										t('weekdaySun'),
									],
								}}
							/>
						</RoutePricePanel>
					</div>
				</div>
				<div className="min-w-0 lg:sticky lg:top-0">
					<h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
						{t('standardCatalog')}
					</h3>
					<p className="mb-2.5 text-[11px] text-gray-500">
						{selectedModelIsAudio
							? t('standardCatalogHintAudio')
							: selectedModelIsImage
							? t('standardCatalogHintImage')
							: t('standardCatalogHint')}
					</p>
					<RoutePricePanel variant="neutral">
						<div className="flex min-h-0 flex-1 flex-col">
							{selectedModelIsAudio ? (
								catalogAudioPricingDisplay ? (
									catalogAudioPricingDisplay.mode === 'token' ? (
										<ul className="divide-y divide-gray-100 rounded-md border border-gray-200 text-sm tabular-nums">
											<li className="flex items-baseline justify-between gap-3 px-3 py-2">
												<span className="text-xs text-gray-500">{tModels('audioInputPricePerM')}</span>
												<span className="font-medium text-gray-900">
													{catalogAudioPricingDisplay.inputPrice}
													<span className="ml-1 text-[10px] font-normal text-gray-400">
														{catalogAudioPricingDisplay.unit}
													</span>
												</span>
											</li>
											<li className="flex items-baseline justify-between gap-3 px-3 py-2">
												<span className="text-xs text-gray-500">{tModels('audioOutputPricePerM')}</span>
												<span className="font-medium text-gray-900">
													{catalogAudioPricingDisplay.outputPrice}
													<span className="ml-1 text-[10px] font-normal text-gray-400">
														{catalogAudioPricingDisplay.unit}
													</span>
												</span>
											</li>
										</ul>
									) : catalogAudioPricingDisplay.mode === 'per_character' ? (
										<ul className="divide-y divide-gray-100 rounded-md border border-gray-200 text-sm tabular-nums">
											<li className="flex items-baseline justify-between gap-3 px-3 py-2">
												<span className="text-xs text-gray-500">{t('audioPricePerCharacter')}</span>
												<span className="font-medium text-gray-900">
													{catalogAudioPricingDisplay.pricePerCharacter}
													<span className="ml-1 text-[10px] font-normal text-gray-400">
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
										<ul className="divide-y divide-gray-100 rounded-md border border-gray-200 text-sm tabular-nums">
											<li className="flex items-baseline justify-between gap-3 px-3 py-2">
												<span className="text-xs text-gray-500">{t('audioPricePerSecond')}</span>
												<span className="font-medium text-gray-900">
													{catalogAudioPricingDisplay.pricePerSecond}
													<span className="ml-1 text-[10px] font-normal text-gray-400">
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
								<ReadOnlyPricingTiersTable
									fillHeight={!catalogScheduleLocked}
									rows={catalogStandardTierRows}
									emptyLabel={formData.model_id ? t('noCatalogPricing') : t('selectModelForTiers')}
									tableTitle={t('readOnlyCatalogRates')}
									billingCurrencyCode={billingCurrency}
								/>
							)}
							{catalogScheduleLocked ? (
								<details className="mt-3 border-t border-gray-200/90 pt-3">
									<summary className="cursor-pointer text-xs font-semibold text-gray-700">
										{t('catalogOfficialSchedule')} · {catalogScheduleWindows.length}
									</summary>
									<p className="my-2 text-[11px] text-gray-500">{t('editor.scheduleInherited')}</p>
									<ul className="space-y-2.5">
										{catalogScheduleWindows.map((w, i) => {
											const daysHint = formatIsoWeekdaysHint(w.days);
											const daysLabel =
												daysHint === 'Mon–Fri'
													? t('scheduleWeekdays')
													: daysHint === 'Sat–Sun'
													? t('scheduleWeekend')
													: daysHint ?? t('scheduleEveryday');
											const active = catalogNowWindowKey === scheduleWindowKey(w);
											const officialRows =
												selectedModel &&
												!selectedModelIsImage &&
												!selectedModelIsAudio &&
												catalogStandardTierRows.length > 0
													? getUserChargedCatalogTierRows(selectedModel, w.factor, billingCurrency)
													: [];
											return (
												<li
													key={`${w.start}-${w.end}-${i}`}
													className={
														active
															? 'space-y-1.5 rounded-md border border-amber-300 bg-amber-50/80 p-2 ring-1 ring-amber-200/80'
															: 'space-y-1.5 rounded-md border border-gray-200 bg-white p-2'
													}
												>
													<div className="flex items-center justify-between gap-3 text-[11px]">
														<div className="min-w-0">
															<p
																className={`font-mono tabular-nums ${
																	active ? 'text-amber-950' : 'text-gray-800'
																}`}
															>
																{w.start}–{w.end}
																<span
																	className={`ml-1.5 font-sans text-[10px] ${
																		active ? 'text-amber-800/80' : 'text-gray-500'
																	}`}
																>
																	{daysLabel}
																</span>
															</p>
														</div>
														<div className="flex shrink-0 items-center gap-2">
															{active ? (
																<span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
																	{t('catalogScheduleNow')}
																</span>
															) : null}
															<span
																className={`font-mono text-xs tabular-nums ${
																	active ? 'text-amber-950' : 'text-gray-800'
																}`}
															>
																×{w.factor}
															</span>
														</div>
													</div>
													{officialRows.length > 0 ? (
														<ReadOnlyPricingTiersTable
															dense
															hideUnitFooter
															rows={officialRows}
															emptyLabel={t('noCatalogPricing')}
															tableTitle={t('catalogWindowPricesHint')}
															billingCurrencyCode={billingCurrency}
														/>
													) : null}
												</li>
											);
										})}
									</ul>
								</details>
							) : null}
						</div>
					</RoutePricePanel>
				</div>
			</div>
		</section>
	);
}

function zonedIsoInput(iso: string, timeZone: string): string {
	if (!iso.trim()) {
		return '';
	}
	const instant = new Date(iso);
	if (Number.isNaN(instant.getTime())) {
		return '';
	}
	return instantToZonedDatetimeLocalInput(instant, timeZone);
}

function isoFromZonedInput(local: string, timeZone: string): string {
	if (!local.trim()) {
		return '';
	}
	return zonedDatetimeLocalInputToInstant(local, timeZone)?.toISOString() ?? '';
}
