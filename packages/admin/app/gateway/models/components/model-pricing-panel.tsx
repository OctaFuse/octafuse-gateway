'use client';

import { PlusIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { InfoHintPopover } from '@/components/InfoHintPopover';
import { DailyScheduleEditor } from '@/components/daily-schedule-editor';
import { PricingTiersEditor } from '@/components/pricing-tiers-editor';
import {
	formatPerMillionTokenUnit,
	formatPerCharacterUnit,
	formatPerSecondUnit,
} from '@/lib/format-gateway-currency';
import {
	createDefaultAudioCharacterPricingDraft,
	createDefaultAudioPricingDraft,
	createDefaultAudioTokenPricingDraft,
	type AudioBillingModeDraft,
} from '@/lib/pricing-tiers-draft';
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
	return (
		<div className="space-y-6">
			<div className="min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-white p-4 sm:p-5 [&_input]:h-10 [&_input]:text-sm">
				{isAudioModel && audioPricingDraft && onAudioPricingDraftChange ? (
					<div className="space-y-3">
						<p className="text-sm font-medium text-gray-800">
							{t('audioPricing')}
						</p>
						<div className="space-y-1.5">
							<p className="text-[11px] font-medium text-gray-600">
								{t('audioBillingMode')}
							</p>
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
											onClick={() => {
												if (audioPricingDraft.mode === opt.id) return;
												const nextMode: AudioBillingModeDraft = opt.id;
												if (nextMode === 'per_second') {
													onAudioPricingDraftChange({
														...createDefaultAudioPricingDraft(),
														price_per_second:
															audioPricingDraft.price_per_second.trim() !== ''
																? audioPricingDraft.price_per_second
																: createDefaultAudioPricingDraft()
																		.price_per_second,
														minimum_seconds:
															audioPricingDraft.minimum_seconds.trim() !== ''
																? audioPricingDraft.minimum_seconds
																: createDefaultAudioPricingDraft()
																		.minimum_seconds,
													});
													return;
												}
												if (nextMode === 'per_character') {
													onAudioPricingDraftChange({
														...createDefaultAudioCharacterPricingDraft(),
														price_per_character:
															audioPricingDraft.price_per_character.trim() !==
															''
																? audioPricingDraft.price_per_character
																: '',
														minimum_characters:
															audioPricingDraft.minimum_characters.trim() !== ''
																? audioPricingDraft.minimum_characters
																: '0',
													});
													return;
												}
												onAudioPricingDraftChange(
													audioPricingDraft.tiers.length > 0
														? {
																...audioPricingDraft,
																mode: 'token',
														  }
														: createDefaultAudioTokenPricingDraft()
												);
											}}
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
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<div>
									<label className="mb-1 block text-xs font-medium text-gray-600">
										{t('audioInputPricePerM')}
										<span className="ml-1 font-normal text-gray-400">
											({formatPerMillionTokenUnit(billingCurrency)})
										</span>
									</label>
									<input
										type="number"
										step="any"
										min="0"
										value={audioPricingDraft.tiers[0]?.input_price ?? ''}
										onChange={(e) => {
											const base =
												audioPricingDraft.tiers[0] ??
												createDefaultAudioTokenPricingDraft().tiers[0]!;
											onAudioPricingDraftChange({
												...audioPricingDraft,
												mode: 'token',
												tiers: [
													{
														...base,
														input_price: e.target.value,
													},
												],
											});
										}}
										className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
									/>
								</div>
								<div>
									<label className="mb-1 block text-xs font-medium text-gray-600">
										{t('audioOutputPricePerM')}
										<span className="ml-1 font-normal text-gray-400">
											({formatPerMillionTokenUnit(billingCurrency)})
										</span>
									</label>
									<input
										type="number"
										step="any"
										min="0"
										value={audioPricingDraft.tiers[0]?.output_price ?? ''}
										onChange={(e) => {
											const base =
												audioPricingDraft.tiers[0] ??
												createDefaultAudioTokenPricingDraft().tiers[0]!;
											onAudioPricingDraftChange({
												...audioPricingDraft,
												mode: 'token',
												tiers: [
													{
														...base,
														output_price: e.target.value,
													},
												],
											});
										}}
										className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
									/>
								</div>
							</div>
						) : audioPricingDraft.mode === 'per_character' ? (
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<div>
									<label className="mb-1 block text-xs font-medium text-gray-600">
										{t('audioPricePerCharacter')}
										<span className="ml-1 font-normal text-gray-400">
											({formatPerCharacterUnit(billingCurrency)})
										</span>
									</label>
									<input
										type="number"
										step="any"
										min="0"
										value={audioPricingDraft.price_per_character}
										onChange={(e) =>
											onAudioPricingDraftChange({
												...audioPricingDraft,
												mode: 'per_character',
												price_per_character: e.target.value,
											})
										}
										className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
										value={audioPricingDraft.minimum_characters}
										onChange={(e) =>
											onAudioPricingDraftChange({
												...audioPricingDraft,
												mode: 'per_character',
												minimum_characters: e.target.value,
											})
										}
										className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
									<input
										type="number"
										step="any"
										min="0"
										value={audioPricingDraft.price_per_second}
										onChange={(e) =>
											onAudioPricingDraftChange({
												...audioPricingDraft,
												mode: 'per_second',
												price_per_second: e.target.value,
											})
										}
										className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
										value={audioPricingDraft.minimum_seconds}
										onChange={(e) =>
											onAudioPricingDraftChange({
												...audioPricingDraft,
												mode: 'per_second',
												minimum_seconds: e.target.value,
											})
										}
										className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
									/>
								</div>
							</div>
						)}
					</div>
				) : isImageModel ? (
					<PricingTiersEditor
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
				<div className="min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
					<div className="mb-3">
						<div className="flex items-start justify-between gap-2">
							<h4 className="flex items-center gap-2 text-sm font-medium text-gray-800">
								{t('catalogSchedule')}
								<InfoHintPopover
									label={t('catalogSchedule')}
									openOnHover
									openOnFocus
									portal
									align="start"
								>
									<p className="whitespace-pre-line leading-6">
										{tPricingHelp('catalog.body')}
									</p>
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
			) : null}
		</div>
	);
}
