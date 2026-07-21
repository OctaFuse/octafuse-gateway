'use client';

import { DocumentDuplicateIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { ReadOnlyImagePricing } from '@/components/read-only-image-pricing';
import { ReadOnlyPricingTiersTable } from '@/components/read-only-pricing-tiers-table';
import { isImageRouteModel } from '@/lib/image-generations';
import type { CatalogImagePricingDisplay, CatalogPricingTierDisplayRow } from '@/lib/pricing-ui';
import type { GatewayModel, GatewayProvider } from '@/lib/types';
import {
	UPSTREAM_PROTOCOLS,
	providerSupportsUpstreamProtocol,
	type UpstreamProtocol,
} from '@/lib/upstream-protocol';
import type { RouteFormData, RouteListRow } from '../types';
import { DailyScheduleEditor } from './daily-schedule-editor';
import { RoutePricePanel } from './route-price-panel';

type Props = {
	open: boolean;
	editingRoute: RouteListRow | null;
	duplicateSourceRouteId: string | null;
	formData: RouteFormData;
	saveError: string;
	isSaving: boolean;
	isDeleting: boolean;
	billingCurrency: string;
	models: GatewayModel[];
	providers: GatewayProvider[];
	selectedModel: GatewayModel | undefined;
	selectedProvider: GatewayProvider | undefined;
	catalogStandardTierRows: CatalogPricingTierDisplayRow[];
	catalogImagePricingDisplay: CatalogImagePricingDisplay | null;
	selectedModelIsImage: boolean;
	allowedProtocolsForProvider: UpstreamProtocol[];
	businessTimezone: string;
	onClose: () => void;
	onFormChange: (form: RouteFormData) => void;
	onSave: () => void;
	onDelete: () => void;
	onDuplicate: () => void;
};

export function RouteModal(props: Props) {
	const {
		open,
		editingRoute,
		duplicateSourceRouteId,
		formData,
		saveError,
		isSaving,
		isDeleting,
		billingCurrency,
		models,
		providers,
		selectedProvider,
		catalogStandardTierRows,
		catalogImagePricingDisplay,
		selectedModelIsImage,
		allowedProtocolsForProvider,
		businessTimezone,
		onClose,
		onFormChange,
		onSave,
		onDelete,
		onDuplicate,
	} = props;

	const t = useTranslations('routes.modal');
	const tCommon = useTranslations('common');

	if (!open) return null;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget && !isSaving && !isDeleting) {
					onClose();
				}
			}}
		>
			<div
				className="flex max-h-[95vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-black/5"
				role="dialog"
				aria-modal="true"
				aria-labelledby="route-modal-title"
			>
				<div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-5 py-4">
					<div>
						<h2 id="route-modal-title" className="text-lg font-semibold text-gray-900">
							{editingRoute ? t('editTitle') : t('newTitle')}
						</h2>
						{!editingRoute && duplicateSourceRouteId && (
							<p className="mt-1 text-xs text-gray-500">
								{t('prefilledFrom', { id: duplicateSourceRouteId })}
							</p>
						)}
					</div>
					<button
						type="button"
						onClick={onClose}
						className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
						disabled={isSaving || isDeleting}
						aria-label={tCommon('close')}
					>
						<span className="block text-xl leading-none" aria-hidden>
							×
						</span>
					</button>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
					{saveError && (
						<div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
							{saveError}
						</div>
					)}

					<div className="space-y-4">
						<section className="rounded-lg border border-gray-200 bg-gray-50/80 p-3.5">
							<h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
								{t('basicMapping')}
							</h3>
							<div className="grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
								<div>
									<label className="mb-1 block text-sm font-medium text-gray-700">{t('modelRequired')}</label>
									<select
										value={formData.model_id}
										onChange={(e) => {
											const nextModelId = e.target.value;
											const nextModel = models.find((m) => m.id === nextModelId);
											onFormChange({
												...formData,
												model_id: nextModelId,
												...(nextModel && isImageRouteModel(nextModel)
													? { upstream_protocol: 'openai' as const }
													: {}),
											});
										}}
										className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
										required
									>
										<option value="">{t('selectModel')}</option>
										{models.map((m) => (
											<option key={m.id} value={m.id}>
												{m.display_name ? `${m.display_name} (${m.id})` : m.id}
											</option>
										))}
									</select>
								</div>
								<div>
									<label className="mb-1 block text-sm font-medium text-gray-700">{t('providerRequired')}</label>
									<select
										value={formData.provider_id}
										onChange={(e) => {
											const nextId = e.target.value;
											const nextProvider = providers.find((p) => p.id === nextId);
											const allowed =
												nextProvider != null
													? UPSTREAM_PROTOCOLS.filter((proto) =>
															providerSupportsUpstreamProtocol(proto, nextProvider)
														)
													: [];
											let nextProto = formData.upstream_protocol;
											if (allowed.length > 0 && !allowed.includes(nextProto)) {
												nextProto = allowed[0]!;
											}
											onFormChange({
												...formData,
												provider_id: nextId,
												upstream_protocol: nextProto,
											});
										}}
										className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
										required
									>
										<option value="">{t('selectProvider')}</option>
										{providers.map((p) => (
											<option key={p.id} value={p.id}>
												{p.name ? `${p.name} (${p.id})` : p.id}
											</option>
										))}
									</select>
								</div>
								<div>
									<label className="mb-1 block text-sm font-medium text-gray-700">
										{t('upstreamProtocol')}
									</label>
									<select
										value={formData.upstream_protocol}
										onChange={(e) =>
											onFormChange({
												...formData,
												upstream_protocol: e.target.value as UpstreamProtocol,
											})
										}
										disabled={selectedModelIsImage}
										title={
											selectedModelIsImage
												? t('protocolHintImageOpenaiOnly')
												: selectedProvider
													? t('protocolHintConfigured')
													: t('protocolHintSelectProvider')
										}
										className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-600"
									>
										{allowedProtocolsForProvider.map((p) => (
											<option key={p} value={p}>
												{p}
											</option>
										))}
									</select>
									{selectedModelIsImage ? (
										<p className="mt-1 text-[11px] text-amber-700">{t('protocolHintImageOpenaiOnly')}</p>
									) : null}
								</div>
								<div>
									<label className="mb-1 block text-sm font-medium text-gray-700">
										{t('providerModelName')}
									</label>
									<input
										type="text"
										value={formData.provider_model_name}
										onChange={(e) =>
											onFormChange({ ...formData, provider_model_name: e.target.value })
										}
										className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
										placeholder={t('providerModelPlaceholder')}
										required
									/>
								</div>
								<div>
									<label
										className="mb-1 block text-sm font-medium text-gray-700"
										title={t('routeGroupHint')}
									>
										{t('routeGroup')}
									</label>
									<input
										type="text"
										value={formData.route_group}
										onChange={(e) => onFormChange({ ...formData, route_group: e.target.value })}
										className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
										placeholder={t('routeGroupPlaceholder')}
										title={t('routeGroupHint')}
									/>
								</div>
								<div>
									<label
										className="mb-1 block text-sm font-medium text-gray-700"
										title={t('priorityHint')}
									>
										{t('priority')}
									</label>
									<input
										type="number"
										value={formData.priority}
										onChange={(e) =>
											onFormChange({
												...formData,
												priority: parseInt(e.target.value, 10) || 0,
											})
										}
										title={t('priorityHint')}
										className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
									/>
								</div>
							</div>
						</section>

						<div className="space-y-3">
							<RoutePricePanel
								variant="neutral"
								title={t('standardCatalog')}
								subtitle={
									selectedModelIsImage
										? t('standardCatalogHintImage')
										: t('standardCatalogHint')
								}
							>
								{selectedModelIsImage ? (
									<ReadOnlyImagePricing
										compact
										tokenRatesLayout="grid"
										display={catalogImagePricingDisplay}
										emptyLabel={
											formData.model_id
												? t('noCatalogImagePricing')
												: t('selectModelForTiers')
										}
										tokenRatesTitle={t('imageTokenRates')}
									/>
								) : (
									<ReadOnlyPricingTiersTable
										rows={catalogStandardTierRows}
										emptyLabel={
											formData.model_id
												? t('noCatalogPricing')
												: t('selectModelForTiers')
										}
										tableTitle={t('readOnlyCatalogRates')}
										billingCurrencyCode={billingCurrency}
									/>
								)}
							</RoutePricePanel>

							<p className="text-[11px] text-gray-500">
								{t('billingTimezoneHint', { timezone: businessTimezone })}
							</p>

							<div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-stretch">
								<div className="flex h-full min-h-0 min-w-0 flex-col">
									<RoutePricePanel
										fillHeight
										variant="charged"
										title={t('chargedCost')}
										subtitle={t('chargedCostHint')}
										headerEnd={
											<div className="flex flex-col items-end gap-1">
												<label
													htmlFor="user-cost-charged-factor"
													className="whitespace-nowrap text-[11px] font-medium text-gray-600"
												>
													{t('chargedFactor')}
												</label>
												<input
													id="user-cost-charged-factor"
													type="text"
													inputMode="decimal"
													value={formData.charged_factor}
													title={t('chargedFactorTitle')}
													onChange={(e) =>
														onFormChange({ ...formData, charged_factor: e.target.value })
													}
													className="w-[4.25rem] rounded-md border border-gray-300 bg-white px-2 py-1 text-xs tabular-nums focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
													placeholder="1"
												/>
											</div>
										}
									>
										<div>
											<p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
												{t('dailySchedule')}
											</p>
											<DailyScheduleEditor
												windows={formData.schedule_charged}
												onChange={(schedule_charged) =>
													onFormChange({ ...formData, schedule_charged })
												}
												addLabel={t('addScheduleWindow')}
												emptyLabel={t('scheduleEmpty')}
												startLabel={t('scheduleStart')}
												endLabel={t('scheduleEnd')}
												factorLabel={t('scheduleFactor')}
												removeLabel={tCommon('delete')}
											/>
										</div>
									</RoutePricePanel>
								</div>

								<div className="flex h-full min-h-0 min-w-0 flex-col">
									<RoutePricePanel
										fillHeight
										variant="metered"
										title={t('meteredCost')}
										subtitle={t('meteredCostHint')}
										headerEnd={
											<div className="flex flex-col items-end gap-1">
												<label
													htmlFor="gateway-route-metered-factor"
													className="whitespace-nowrap text-[11px] font-medium text-gray-600"
												>
													{t('meteredFactor')}
												</label>
												<input
													id="gateway-route-metered-factor"
													type="text"
													inputMode="decimal"
													value={formData.metered_factor}
													title={t('meteredFactorTitle')}
													onChange={(e) =>
														onFormChange({ ...formData, metered_factor: e.target.value })
													}
													className="w-[4.25rem] rounded-md border border-gray-300 bg-white px-2 py-1 text-xs tabular-nums focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
													placeholder="1"
												/>
											</div>
										}
									>
										<div>
											<p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
												{t('dailySchedule')}
											</p>
											<DailyScheduleEditor
												windows={formData.schedule_metered}
												onChange={(schedule_metered) =>
													onFormChange({ ...formData, schedule_metered })
												}
												addLabel={t('addScheduleWindow')}
												emptyLabel={t('scheduleEmpty')}
												startLabel={t('scheduleStart')}
												endLabel={t('scheduleEnd')}
												factorLabel={t('scheduleFactor')}
												removeLabel={tCommon('delete')}
											/>
										</div>
									</RoutePricePanel>
								</div>
							</div>
						</div>

						<section className="rounded-lg border border-gray-200 bg-white p-3.5">
							<div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
								<h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
									{t('requestDefaults')}
								</h3>
								<p className="text-[11px] text-gray-500">{t('requestDefaultsHint')}</p>
							</div>
							<label className="mb-1 block text-sm font-medium text-gray-700">{t('customParams')}</label>
							<textarea
								rows={4}
								value={formData.custom_params_json}
								onChange={(e) =>
									onFormChange({ ...formData, custom_params_json: e.target.value })
								}
								className="min-h-[96px] w-full resize-y rounded-md border border-gray-300 px-3 py-2 font-mono text-xs leading-relaxed focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
								placeholder={t('customParamsPlaceholder')}
								spellCheck={false}
							/>
						</section>

						<section className="rounded-lg border border-gray-200 bg-white p-4">
							<h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
								{t('summary')}
							</h3>
							<div className="grid grid-cols-1 gap-2 text-xs text-gray-600 md:grid-cols-2">
								<p>
									<span className="font-medium text-gray-700">{t('summaryRoute')}</span>{' '}
									<span className="font-mono">{formData.model_id || '—'}</span> →{' '}
									<span className="font-mono">{formData.provider_id || '—'}</span> /{' '}
									<span className="font-mono">{formData.provider_model_name || '—'}</span>
								</p>
								<p>
									<span className="font-medium text-gray-700">{t('summaryRouting')}</span>{' '}
									<span className="font-mono">{formData.upstream_protocol}</span> · {t('summaryGroup')}{' '}
									<span className="font-mono">{formData.route_group.trim() || 'default'}</span> ·{' '}
									{t('summaryPriority')}{' '}
									<span className="font-mono">{formData.priority}</span> · {t('summaryStatus')}{' '}
									<span className="font-mono">{editingRoute ? editingRoute.status : 'inactive'}</span>
									{!editingRoute && <span className="text-gray-500"> {t('summaryEnableFromList')}</span>}
								</p>
								<p>
									<span className="font-medium text-gray-700">{t('summaryUserBilling')}</span>{' '}
									<span className="font-mono">{t('summaryUserBillingDetail')}</span>
								</p>
								<p>
									<span className="font-medium text-gray-700">{t('summaryMeteredCost')}</span>{' '}
									<span className="font-mono">{t('summaryMeteredCostDetail')}</span>
								</p>
							</div>
						</section>
					</div>
				</div>

				<div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-gray-50/50 px-5 py-4">
					<div className="flex flex-wrap items-center gap-2">
						{editingRoute && (
							<button
								type="button"
								onClick={onDelete}
								disabled={isSaving || isDeleting}
								className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
							>
								<TrashIcon className="h-4 w-4" aria-hidden />
								{isDeleting ? tCommon('deleting') : t('deleteRoute')}
							</button>
						)}
					</div>
					<div className="ml-auto flex gap-2 sm:gap-3">
						<button
							type="button"
							onClick={onClose}
							className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
							disabled={isSaving || isDeleting}
						>
							{tCommon('cancel')}
						</button>
						{editingRoute && (
							<button
								type="button"
								onClick={onDuplicate}
								disabled={isSaving || isDeleting}
								className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
							>
								<DocumentDuplicateIcon className="h-4 w-4" aria-hidden />
								{tCommon('duplicate')}
							</button>
						)}
						<button
							type="button"
							onClick={onSave}
							disabled={isSaving || isDeleting}
							className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{isSaving ? tCommon('savingDots') : tCommon('save')}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
