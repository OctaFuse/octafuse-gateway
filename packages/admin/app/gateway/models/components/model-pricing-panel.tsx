'use client';

import { FinancialInput } from '@/components/financial-value';

import { PlusIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { InfoHintPopover } from '@/components/InfoHintPopover';
import { DailyScheduleEditor } from '@/components/daily-schedule-editor';
import { PricingTiersEditor } from '@/components/pricing-tiers-editor';
import { formatPerCharacterUnit, formatPerSecondUnit } from '@/lib/format-gateway-currency';
import { switchAudioPricingDraftMode } from '@/lib/pricing-tiers-draft';
import type { ModelModalProps } from './model-modal';

type Props = Pick<
	ModelModalProps,
	| 'formKind'
	| 'pricingTierRows'
	| 'onPricingTierRowsChange'
	| 'billingCurrency'
	| 'imageBillingMode'
	| 'onImageBillingModeChange'
	| 'imagePerImageDraft'
	| 'onImagePerImageDraftChange'
	| 'audioPricingDraft'
	| 'onAudioPricingDraftChange'
	| 'catalogScheduleWindows'
	| 'onCatalogScheduleWindowsChange'
>;

export function ModelPricingPanel({
	formKind,
	pricingTierRows,
	onPricingTierRowsChange,
	billingCurrency,
	imageBillingMode,
	onImageBillingModeChange,
	imagePerImageDraft,
	onImagePerImageDraftChange,
	audioPricingDraft,
	onAudioPricingDraftChange,
	catalogScheduleWindows = [],
	onCatalogScheduleWindowsChange,
}: Props) {
	const t = useTranslations('models.modal');
	const tCommon = useTranslations('common');
	const tRoutes = useTranslations('routes.modal');
	const tPricingHelp = useTranslations('pricing.help');
	const isImageModel = formKind === 'image';
	const isEmbeddingModel = formKind === 'embedding';
	const isAudioModel = formKind === 'asr' || formKind === 'tts';
	const audioCapability = formKind === 'tts' ? 'speech' : 'transcription';
	const columnLabels = {
		upto: t('pricingColumns.upto'),
		input: t('pricingColumns.input'),
		output: t('pricingColumns.output'),
		cacheRead: t('pricingColumns.cacheRead'),
		cacheWrite: t('pricingColumns.cacheWrite'),
	};
	return (
		<div className="divide-y divide-gray-100">
			<div className="min-w-0 pb-6">
				{isAudioModel && audioPricingDraft && onAudioPricingDraftChange ? (
					<div className="space-y-3">
						<div className="space-y-1.5">
							<p className="text-xs font-medium text-gray-600">{t('audioBillingMode')}</p>
							<div
								className="inline-flex rounded-md border border-gray-200 bg-gray-50 p-0.5"
								role="group"
								aria-label={t('audioBillingMode')}
							>
								{(audioCapability === 'speech'
									? [
											{
												id: 'per_character' as const,
												label: t('audioBillingModePerCharacter'),
											},
											{
												id: 'token' as const,
												label: t('audioBillingModeToken'),
											},
									  ]
									: [
											{
												id: 'per_second' as const,
												label: t('audioBillingModePerSecond'),
											},
											{
												id: 'token' as const,
												label: t('audioBillingModeToken'),
											},
									  ]
								).map((opt) => {
									const active = audioPricingDraft.mode === opt.id;
									return (
										<button
											key={opt.id}
											aria-pressed={active}
											type="button"
											onClick={() =>
												onAudioPricingDraftChange(
													switchAudioPricingDraftMode(audioPricingDraft, opt.id)
												)
											}
											className={
												active
													? 'rounded px-3 py-1.5 text-sm font-medium bg-white text-gray-900 shadow-sm'
													: 'rounded px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900'
											}
										>
											{opt.label}
										</button>
									);
								})}
							</div>
						</div>
						{audioPricingDraft.mode === 'token' ? (
							<PricingTiersEditor
								title={t('audioPricing')}
								columnLabels={columnLabels}
								hintDisplay="popover"
								rows={audioPricingDraft.tiers}
								onChange={(tiers) => onAudioPricingDraftChange({ ...audioPricingDraft, tiers })}
								billingCurrencyCode={billingCurrency}
								minRows={1}
							/>
						) : audioPricingDraft.mode === 'per_character' ? (
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<div>
									<label className="mb-1 block text-xs font-medium text-gray-600">
										{t('audioPricePerCharacter')}
										<span className="ml-1 font-normal text-gray-400">
											({formatPerCharacterUnit(billingCurrency)})
										</span>
									</label>
									<FinancialInput
										currency={billingCurrency}
										aria-label={t('audioPricePerCharacter')}
										type="number"
										step="any"
										min="0"
										required
										aria-invalid={
											!audioPricingDraft.price_per_character.trim() ||
											!Number.isFinite(Number(audioPricingDraft.price_per_character)) ||
											Number(audioPricingDraft.price_per_character) < 0
										}
										value={audioPricingDraft.price_per_character}
										onChange={(e) =>
											onAudioPricingDraftChange({
												...audioPricingDraft,
												mode: 'per_character',
												price_per_character: e.target.value,
											})
										}
									/>
								</div>
								<div>
									<label className="mb-1 block text-xs font-medium text-gray-600">
										{t('audioMinimumCharacters')}
									</label>
									<input
										type="number"
										step="1"
										min="0"
										aria-label={t('audioMinimumCharacters')}
										value={audioPricingDraft.minimum_characters}
										onChange={(e) =>
											onAudioPricingDraftChange({
												...audioPricingDraft,
												mode: 'per_character',
												minimum_characters: e.target.value,
											})
										}
										className="h-10 w-full rounded-lg border border-gray-200 px-3 font-mono text-base tabular-nums focus:outline-none focus:ring-2 focus:ring-gray-500/10"
									/>
								</div>
							</div>
						) : (
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<div>
									<label className="mb-1 block text-xs font-medium text-gray-600">
										{t('audioPricePerSecond')}
										<span className="ml-1 font-normal text-gray-400">
											({formatPerSecondUnit(billingCurrency)})
										</span>
									</label>
									<FinancialInput
										currency={billingCurrency}
										aria-label={t('audioPricePerSecond')}
										type="number"
										step="any"
										min="0"
										required
										aria-invalid={
											!audioPricingDraft.price_per_second.trim() ||
											!Number.isFinite(Number(audioPricingDraft.price_per_second)) ||
											Number(audioPricingDraft.price_per_second) < 0
										}
										value={audioPricingDraft.price_per_second}
										onChange={(e) =>
											onAudioPricingDraftChange({
												...audioPricingDraft,
												mode: 'per_second',
												price_per_second: e.target.value,
											})
										}
									/>
								</div>
								<div>
									<label className="mb-1 block text-xs font-medium text-gray-600">
										{t('audioMinimumSeconds')}
									</label>
									<input
										type="number"
										step="any"
										min="0"
										aria-label={t('audioMinimumSeconds')}
										value={audioPricingDraft.minimum_seconds}
										onChange={(e) =>
											onAudioPricingDraftChange({
												...audioPricingDraft,
												mode: 'per_second',
												minimum_seconds: e.target.value,
											})
										}
										className="h-10 w-full rounded-lg border border-gray-200 px-3 font-mono text-base tabular-nums focus:outline-none focus:ring-2 focus:ring-gray-500/10"
									/>
								</div>
							</div>
						)}
					</div>
				) : isImageModel ? (
					<PricingTiersEditor
						columnLabels={columnLabels}
						hintDisplay="popover"
						title={t('imagePricing')}
						rows={pricingTierRows}
						onChange={onPricingTierRowsChange}
						billingCurrencyCode={billingCurrency}
						minRows={0}
						variant="image"
						imageBillingMode={imageBillingMode}
						onImageBillingModeChange={onImageBillingModeChange}
						perImageDraft={imagePerImageDraft}
						onPerImageDraftChange={onImagePerImageDraftChange}
					/>
				) : isEmbeddingModel ? (
					<PricingTiersEditor
						columnLabels={columnLabels}
						hintDisplay="popover"
						title={t('embeddingPricing')}
						rows={pricingTierRows}
						onChange={onPricingTierRowsChange}
						billingCurrencyCode={billingCurrency}
						minRows={0}
						variant="embedding"
					/>
				) : (
					<PricingTiersEditor
						columnLabels={columnLabels}
						hintDisplay="popover"
						title={t('standardPricing')}
						rows={pricingTierRows}
						onChange={onPricingTierRowsChange}
						billingCurrencyCode={billingCurrency}
						minRows={0}
					/>
				)}
			</div>
			{onCatalogScheduleWindowsChange ? (
				<section className="min-w-0 pt-6">
					<div className="min-w-0">
						<div className="mb-3">
							<div className="flex items-start justify-between gap-2">
								<h4 className="flex items-center gap-2 text-sm font-medium text-gray-800">
									{t('catalogSchedule')}
									<span className="text-xs font-normal text-gray-500">
										{catalogScheduleWindows.length
											? t('scheduleWindowCount', { count: catalogScheduleWindows.length })
											: t('optionalSetting')}
									</span>
									<InfoHintPopover
										label={t('catalogSchedule')}
										openOnHover
										openOnFocus
										portal
										align="start"
									>
										<p className="whitespace-pre-line leading-6">{tPricingHelp('catalog.body')}</p>
										<p className="mt-3 leading-6">{t('catalogScheduleHint')}</p>
									</InfoHintPopover>
								</h4>
								<button
									type="button"
									onClick={() =>
										onCatalogScheduleWindowsChange([
											...catalogScheduleWindows,
											{ start: '00:00', end: '08:00', factor: '1', days: [] },
										])
									}
									className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
									aria-label={t('addCatalogScheduleWindow')}
								>
									<PlusIcon className="h-3.5 w-3.5" aria-hidden />
									{t('addCatalogScheduleWindow')}
								</button>
							</div>
						</div>
						<DailyScheduleEditor
							variant="single"
							comfortable
							layout="inline"
							windows={catalogScheduleWindows}
							onChange={onCatalogScheduleWindowsChange}
							emptyLabel={t('catalogScheduleEmpty')}
							startLabel={tRoutes('scheduleStart')}
							endLabel={tRoutes('scheduleEnd')}
							factorLabel={t('catalogScheduleFactor')}
							removeLabel={tCommon('delete')}
							dayLabels={{
								days: tRoutes('scheduleDays'),
								everyday: tRoutes('scheduleEveryday'),
								weekdays: tRoutes('scheduleWeekdays'),
								weekend: tRoutes('scheduleWeekend'),
								weekdayShort: [
									tRoutes('weekdayMon'),
									tRoutes('weekdayTue'),
									tRoutes('weekdayWed'),
									tRoutes('weekdayThu'),
									tRoutes('weekdayFri'),
									tRoutes('weekdaySat'),
									tRoutes('weekdaySun'),
								],
							}}
						/>
					</div>
				</section>
			) : null}
		</div>
	);
}
