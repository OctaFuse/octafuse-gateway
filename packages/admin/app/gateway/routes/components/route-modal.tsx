'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
	ArrowDownIcon,
	BeakerIcon,
	ChevronDownIcon,
	ClipboardDocumentIcon,
	CodeBracketIcon,
	DocumentDuplicateIcon,
	PlusIcon,
	TrashIcon,
} from '@heroicons/react/24/outline';
import { useTranslations } from 'next-intl';
import { ReadOnlyImagePricing } from '@/components/read-only-image-pricing';
import { ReadOnlyPricingTiersTable } from '@/components/read-only-pricing-tiers-table';
import { type CatalogAudioPricingDisplay } from '@/lib/audio-transcriptions';
import {
	getUserChargedCatalogTierRows,
	type CatalogImagePricingDisplay,
	type CatalogPricingTierDisplayRow,
} from '@/lib/pricing-ui';
import type { GatewayModel, GatewayProvider } from '@/lib/types';
import { UPSTREAM_PROTOCOLS, type UpstreamProtocol } from '@/lib/upstream-protocol';
import {
	adapterOptionMappingSuffix,
	alignRouteScheduleWindowsToCatalog,
	applyAdapterOptionToForm,
	catalogScheduleWindowsFromModel,
	compatibleAdaptersForRoute,
	formatRoutePriceOverridePreview,
	listAdapterOptionsForModel,
	requestOperationsForModel,
	resolveAdapterOptionKey,
	upstreamOperationsForProviderModel,
} from '../route-utils';
import type { RouteFormData, RouteListRow } from '../types';
import { DailyScheduleEditor } from '@/components/daily-schedule-editor';
import {
	formatIsoWeekdaysHint,
	resolveDailyScheduleFactor,
	scheduleWindowKey,
} from '@octafuse/core/db/pricing-schedule';
import { RoutePricePanel } from './route-price-panel';
import { ScheduleWindowEffectivePrices } from './schedule-window-effective-prices';

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
	catalogAudioPricingDisplay: CatalogAudioPricingDisplay | null;
	selectedModelIsImage: boolean;
	selectedModelIsAudio: boolean;
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
		selectedModel,
		selectedProvider,
		catalogStandardTierRows,
		catalogImagePricingDisplay,
		catalogAudioPricingDisplay,
		selectedModelIsImage,
		selectedModelIsAudio,
		allowedProtocolsForProvider,
		businessTimezone,
		onClose,
		onFormChange,
		onSave,
		onDelete,
		onDuplicate,
	} = props;

	const t = useTranslations('routes.modal');
	const tModels = useTranslations('models.modal');
	const tCommon = useTranslations('common');
	const adapterLabel = (adapter: string) =>
		t.has(`adapterNames.${adapter}`) ? t(`adapterNames.${adapter}`) : adapter;
	const hasCustomParams = formData.custom_params_json.trim().length > 0;
	const customParamsSessionKey = `${open ? '1' : '0'}:${editingRoute?.id ?? ''}:${duplicateSourceRouteId ?? ''}`;
	const [customParamsSession, setCustomParamsSession] = useState(customParamsSessionKey);
	const [customParamsOpen, setCustomParamsOpen] = useState(() => open && hasCustomParams);
	const [priceOverrideJsonOpen, setPriceOverrideJsonOpen] = useState(false);
	const [priceOverrideJsonCopied, setPriceOverrideJsonCopied] = useState(false);
	if (customParamsSession !== customParamsSessionKey) {
		setCustomParamsSession(customParamsSessionKey);
		setCustomParamsOpen(open && hasCustomParams);
		setPriceOverrideJsonOpen(false);
		setPriceOverrideJsonCopied(false);
	}
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
	const catalogNowWindowKey = catalogNowSchedule.window
		? scheduleWindowKey(catalogNowSchedule.window)
		: null;

	// Image models keep the public request protocol as OpenAI; upstream may be openai or dashscope.
	const lockOpenaiProtocol = selectedModelIsImage;
	const requestProtocols = UPSTREAM_PROTOCOLS.filter(
		(protocol) => requestOperationsForModel(selectedModel, protocol, formData.provider_model_name).length > 0,
	);
	const requestOperations = requestOperationsForModel(
		selectedModel,
		formData.request_protocol,
		formData.provider_model_name,
	);
	const upstreamOperations = upstreamOperationsForProviderModel(
		selectedProvider,
		selectedModel,
		formData.upstream_protocol,
		formData.provider_model_name,
	);
	const adapterOptions = listAdapterOptionsForModel(
		selectedModel,
		selectedProvider,
		formData.provider_model_name,
	);
	const selectedAdapterOptionKey = resolveAdapterOptionKey(formData);
	const selectedAdapterOption = adapterOptions.find((option) => option.descriptor.optionKey === selectedAdapterOptionKey);
	const visibleAdapterOptions = selectedProvider
		? adapterOptions.filter(
				(option) => option.available || option.descriptor.optionKey === selectedAdapterOptionKey,
			)
		: [];
	const compatibleAdapters = compatibleAdaptersForRoute(formData);
	const showCurrentAdapter =
		Boolean(editingRoute) &&
		!selectedAdapterOption &&
		!compatibleAdapters.includes(formData.adapter) &&
		Boolean(formData.adapter);
	const lockTopology = Boolean(selectedAdapterOption) && !showCurrentAdapter;
	const selectableProviders = providers.filter(
		(provider) =>
			(Boolean(editingRoute || duplicateSourceRouteId) && provider.id === formData.provider_id) ||
			UPSTREAM_PROTOCOLS.some(
				(protocol) =>
					upstreamOperationsForProviderModel(
						provider,
						selectedModel,
						protocol,
						formData.provider_model_name,
					).length > 0,
			),
	);
	const showCurrentUpstreamOperation =
		Boolean(editingRoute) &&
		!upstreamOperations.includes(formData.upstream_operation) &&
		Boolean(formData.upstream_operation);
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
							<p className="mt-1 text-xs text-gray-500">{t('prefilledFrom', { id: duplicateSourceRouteId })}</p>
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
						<section>
							<h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
								{t('basicMapping')}
							</h3>
							<div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-stretch lg:gap-x-10">
								<div className="flex h-full min-w-0 flex-col rounded-lg border border-blue-300 bg-blue-50 p-3 shadow-sm ring-1 ring-blue-100/80 border-l-4 border-l-blue-500">
									<p className="mb-2.5 text-[10px] font-semibold uppercase tracking-wider text-blue-700">
										{t('clientColumn')}
									</p>
									<div className="space-y-3">
										<div>
											<label className="mb-1 block text-sm font-medium text-gray-700">{t('modelRequired')}</label>
											<select
												value={formData.model_id}
												onChange={(e) => {
													const nextModelId = e.target.value;
													const nextModel = models.find((m) => m.id === nextModelId);
													const nextRequestProtocols = UPSTREAM_PROTOCOLS.filter(
														(protocol) =>
															requestOperationsForModel(nextModel, protocol, formData.provider_model_name).length > 0,
													);
													const requestProtocol = nextRequestProtocols.includes(formData.request_protocol)
														? formData.request_protocol
														: nextRequestProtocols[0] ?? formData.request_protocol;
													const nextRequestOperations = requestOperationsForModel(
														nextModel,
														requestProtocol,
														formData.provider_model_name,
													);
													const requestOperation = nextRequestOperations.includes(formData.request_operation)
														? formData.request_operation
														: nextRequestOperations[0] ?? formData.request_operation;
													const nextUpstreamProtocols = selectedProvider
														? UPSTREAM_PROTOCOLS.filter(
																(protocol) =>
																			upstreamOperationsForProviderModel(
																				selectedProvider,
																				nextModel,
																				protocol,
																				formData.provider_model_name,
																			).length > 0,
																  )
														: [];
													const upstreamProtocol = nextUpstreamProtocols.includes(formData.upstream_protocol)
														? formData.upstream_protocol
														: nextUpstreamProtocols[0] ?? requestProtocol;
													const nextUpstreamOperations = upstreamOperationsForProviderModel(
														selectedProvider,
														nextModel,
														upstreamProtocol,
														formData.provider_model_name,
													);
													const upstreamOperation = nextUpstreamOperations.includes(formData.upstream_operation)
														? formData.upstream_operation
														: nextUpstreamOperations[0] ?? requestOperation;
													onFormChange({
														...formData,
														model_id: nextModelId,
														request_protocol: requestProtocol,
														request_operation: requestOperation,
														upstream_protocol: upstreamProtocol,
														upstream_operation: upstreamOperation,
														schedule_windows: alignRouteScheduleWindowsToCatalog(
															catalogScheduleWindowsFromModel(nextModel),
															[]
														),
													});
												}}
												className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
												required
											>
												<option value="">{t('selectModel')}</option>
												{models.map((m) => (
													<option key={m.id} value={m.id}>
														{m.display_name || m.id}
													</option>
												))}
											</select>
										</div>
										<div>
											<label className="mb-1 block text-sm font-medium text-gray-700">{t('modelId')}</label>
											<input
												type="text"
												value={formData.model_id}
												readOnly
												className="w-full cursor-default rounded-md border border-gray-300 bg-gray-100 px-3 py-2 font-mono text-sm text-gray-700"
											/>
										</div>
										<div>
											<label className="mb-1 block text-sm font-medium text-gray-700">{t('requestProtocol')}</label>
											<select
												value={formData.request_protocol}
												onChange={(e) => {
													const requestProtocol = e.target.value as UpstreamProtocol;
													const requestOperation =
														requestOperationsForModel(
															selectedModel,
															requestProtocol,
															formData.provider_model_name,
														)[0] ?? formData.request_operation;
													onFormChange({
														...formData,
														request_protocol: requestProtocol,
														request_operation: requestOperation,
													});
												}}
												disabled={lockOpenaiProtocol || lockTopology}
												className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:bg-gray-100"
											>
												{requestProtocols.map((p) => (
													<option key={p} value={p}>
														{p}
													</option>
												))}
											</select>
										</div>
										<div>
											<label className="mb-1 block text-sm font-medium text-gray-700">{t('requestOperation')}</label>
											<select
												value={formData.request_operation}
												onChange={(e) =>
													onFormChange({
														...formData,
														request_operation: e.target.value,
													})
												}
												disabled={lockTopology}
												className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:bg-gray-100"
											>
												{requestOperations.map((operation) => (
													<option key={operation} value={operation}>
														{operation === 'models.generate' ? t('operationModelsGenerate') : operation}
													</option>
												))}
												{formData.request_operation === '*' ? <option value="*">*</option> : null}
											</select>
											{selectedModelIsAudio ? (
												<p className="mt-1 text-[11px] text-gray-500">{t('audioPublicOperationHint')}</p>
											) : null}
										</div>
									</div>
								</div>

								<div
									className={`flex min-w-0 flex-col items-stretch gap-2 lg:w-[16rem] ${
										customParamsOpen ? 'h-full' : 'justify-center'
									}`}
								>
									<div className="flex items-center justify-center py-1" aria-hidden>
										<ArrowDownIcon className="h-8 w-8 text-blue-500 lg:hidden" />
										<span className="hidden w-full items-center lg:flex">
											<span className="h-[3px] min-w-0 flex-1 rounded-full bg-blue-400" />
											<span className="h-0 w-0 shrink-0 border-y-[7px] border-l-[12px] border-y-transparent border-l-blue-500" />
										</span>
									</div>
									<p className="text-center text-[10px] font-semibold uppercase tracking-wider text-blue-600">
										{t('routeColumn')}
									</p>
									<div>
										<label className="mb-1 block text-sm font-medium text-gray-700" title={t('routeGroupHint')}>
											{t('routeGroup')}
										</label>
										<input
											type="text"
											value={formData.route_group}
											onChange={(e) => onFormChange({ ...formData, route_group: e.target.value })}
											className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
											placeholder={t('routeGroupPlaceholder')}
											title={t('routeGroupHint')}
										/>
									</div>
									<div className="grid grid-cols-2 gap-2">
										<div>
											<label className="mb-1 block text-sm font-medium text-gray-700" title={t('priorityHint')}>
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
												className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm tabular-nums focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
											/>
										</div>
										<div>
											<label className="mb-1 block text-sm font-medium text-gray-700" title={t('weightHint')}>
												{t('weight')}
											</label>
											<input
												type="number"
												min={1}
												value={formData.weight}
												onChange={(e) =>
													onFormChange({
														...formData,
														weight: Math.max(1, parseInt(e.target.value, 10) || 1),
													})
												}
												title={t('weightHint')}
												className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm tabular-nums focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
											/>
										</div>
									</div>
									<div>
										<label className="mb-1 block text-sm font-medium text-gray-700">{t('adapter')}</label>
										<select
											value={selectedAdapterOptionKey ?? formData.adapter}
											onChange={(e) => onFormChange(applyAdapterOptionToForm(formData, e.target.value))}
											title={formData.adapter}
											disabled={!selectedProvider}
											className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
										>
											{!selectedProvider ? (
												<option value={formData.adapter}>{t('protocolHintSelectProvider')}</option>
											) : visibleAdapterOptions.length === 0 ? (
												<option value={formData.adapter}>{t('noCompatibleAdapter')}</option>
											) : null}
											{visibleAdapterOptions.map((option) => (
												<option
													key={option.descriptor.optionKey}
													value={option.descriptor.optionKey}
													title={option.descriptor.id}
													disabled={!option.available && option.descriptor.optionKey !== selectedAdapterOptionKey}
												>
													{adapterLabel(option.descriptor.id)}
													{adapterOptionMappingSuffix(option.descriptor)}
													{!option.available ? ` · ${t('adapterUnavailable')}` : ''}
												</option>
											))}
											{showCurrentAdapter ? (
												<option value={formData.adapter} title={formData.adapter}>
													{adapterLabel(formData.adapter)} · {t('currentLegacyValue')}
												</option>
											) : null}
										</select>
										<p className="mt-1 text-[11px] text-gray-500">
											{selectedProvider ? t('adapterFirstHint') : t('protocolHintSelectProvider')}
										</p>
										{selectedAdapterOption && selectedAdapterOption.missingCapabilities.length > 0 ? (
											<p className="mt-1 text-[11px] text-amber-700">
												{t('adapterMissingCapabilities', {
													capabilities: selectedAdapterOption.missingCapabilities.join(', '),
												})}
											</p>
										) : null}
										{selectedAdapterOption?.descriptor.lossyFeatures?.length ? (
											<p className="mt-1 text-[11px] text-amber-700">
												{t('adapterLossyFeatures', {
													features: selectedAdapterOption.descriptor.lossyFeatures.join(', '),
												})}
											</p>
										) : null}
									</div>
									<div className={customParamsOpen ? 'flex min-h-0 flex-1 flex-col' : undefined}>
										<button
											type="button"
											onClick={() => setCustomParamsOpen((prev) => !prev)}
											id="route-custom-params-toggle"
											aria-controls="route-custom-params"
											aria-expanded={customParamsOpen}
											className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 ${
												customParamsOpen
													? 'relative z-10 border-amber-400 bg-amber-50 text-amber-900'
													: 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
											}`}
										>
											<span>{t('customParams')}</span>
											<span className="flex shrink-0 items-center gap-1.5">
												{hasCustomParams ? (
													<span
														className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
															customParamsOpen ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'
														}`}
													>
														JSON
													</span>
												) : null}
												<ChevronDownIcon
													className={`h-4 w-4 transition-transform ${
														customParamsOpen ? 'text-amber-600' : '-rotate-90 text-gray-400'
													}`}
													aria-hidden
												/>
											</span>
										</button>
										{customParamsOpen ? (
											<span
												className="mx-auto hidden w-[3px] min-h-3 flex-1 bg-amber-400 lg:block"
												aria-hidden
											/>
										) : null}
									</div>
								</div>

								<div className="flex h-full min-w-0 flex-col rounded-lg border border-violet-300 bg-violet-50 p-3 shadow-sm ring-1 ring-violet-100/80 border-l-4 border-l-violet-500">
									<p className="mb-2.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700">
										{t('upstreamColumn')}
									</p>
									<div className="space-y-3">
										<div>
											<label className="mb-1 block text-sm font-medium text-gray-700">{t('providerRequired')}</label>
											<select
												value={formData.provider_id}
												onChange={(e) => {
													const nextId = e.target.value;
													const nextProvider = providers.find((p) => p.id === nextId);
													const allowed =
														nextProvider != null
															? UPSTREAM_PROTOCOLS.filter(
																	(proto) =>
																		upstreamOperationsForProviderModel(
																			nextProvider,
																			selectedModel,
																			proto,
																			formData.provider_model_name,
																		).length > 0,
															  )
															: [];
													let nextProto = formData.upstream_protocol;
													if (allowed.length > 0 && !allowed.includes(nextProto)) {
														nextProto = allowed[0]!;
													}
													const supportedOperations = upstreamOperationsForProviderModel(
														nextProvider,
														selectedModel,
														nextProto,
														formData.provider_model_name,
													);
													const nextOperation = supportedOperations.includes(formData.upstream_operation)
														? formData.upstream_operation
														: supportedOperations[0] ?? formData.upstream_operation;
													onFormChange({
														...formData,
														provider_id: nextId,
														upstream_protocol: nextProto,
														upstream_operation: nextOperation,
													});
												}}
												className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
												required
											>
												<option value="">{t('selectProvider')}</option>
												{selectableProviders.map((p) => (
													<option key={p.id} value={p.id}>
														{p.name || p.id}
													</option>
												))}
											</select>
										</div>
										<div>
											<label className="mb-1 block text-sm font-medium text-gray-700">{t('providerModelName')}</label>
											<input
												type="text"
												value={formData.provider_model_name}
												onChange={(e) => {
													const providerModelName = e.target.value;
													const nextRequestOperations = requestOperationsForModel(
														selectedModel,
														formData.request_protocol,
														providerModelName,
													);
													const nextUpstreamOperations = upstreamOperationsForProviderModel(
														selectedProvider,
														selectedModel,
														formData.upstream_protocol,
														providerModelName,
													);
													// 模型名决定 DashScope ASR 生命周期，输入后同步纠正 surface 与 target。
													onFormChange({
														...formData,
														provider_model_name: providerModelName,
														request_operation: nextRequestOperations.includes(formData.request_operation)
															? formData.request_operation
															: nextRequestOperations[0] ?? formData.request_operation,
														upstream_operation: nextUpstreamOperations.includes(formData.upstream_operation)
															? formData.upstream_operation
															: nextUpstreamOperations[0] ?? formData.upstream_operation,
													});
												}}
												className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
												placeholder={t('providerModelPlaceholder')}
												required
											/>
										</div>
										<div>
											<label className="mb-1 block text-sm font-medium text-gray-700">{t('upstreamProtocol')}</label>
											<select
												value={formData.upstream_protocol}
												onChange={(e) => {
													const upstreamProtocol = e.target.value as UpstreamProtocol;
													onFormChange({
														...formData,
														upstream_protocol: upstreamProtocol,
														upstream_operation:
															upstreamOperationsForProviderModel(
																selectedProvider,
																selectedModel,
																upstreamProtocol,
																formData.provider_model_name,
															)[0] ??
															formData.upstream_operation,
													});
												}}
												disabled={!selectedProvider || lockTopology}
												title={selectedProvider ? t('protocolHintConfigured') : t('protocolHintSelectProvider')}
												className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-600"
											>
												{allowedProtocolsForProvider.map((p) => (
													<option key={p} value={p}>
														{p}
													</option>
												))}
											</select>
										</div>
										<div>
											<label className="mb-1 block text-sm font-medium text-gray-700">{t('upstreamOperation')}</label>
											<select
												value={formData.upstream_operation}
												onChange={(e) =>
													onFormChange({
														...formData,
														upstream_operation: e.target.value,
													})
												}
												disabled={!selectedProvider || upstreamOperations.length === 0 || lockTopology}
												className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-600"
											>
												{upstreamOperations.map((operation) => (
													<option key={operation} value={operation}>
														{operation === 'models.generate' ? t('operationModelsGenerate') : operation}
													</option>
												))}
												{showCurrentUpstreamOperation ? (
													<option value={formData.upstream_operation}>
														{formData.upstream_operation} · {t('currentLegacyValue')}
													</option>
												) : null}
											</select>
											<p className="mt-1 text-[11px] text-gray-500">
												{selectedProvider ? t('upstreamOperationHintConfigured') : t('protocolHintSelectProvider')}
											</p>
										</div>
									</div>
								</div>
							</div>
							{customParamsOpen ? (
								<div>
									<div
										className="hidden lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-x-10"
										aria-hidden
									>
										<div />
										<div className="flex justify-center lg:w-[16rem]">
											<span className="h-3 w-[3px] bg-amber-400" />
										</div>
										<div />
									</div>
									<div
										id="route-custom-params"
										className="rounded-lg border border-amber-300 bg-amber-50/70 p-3"
									>
										<div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
											<h4 className="text-sm font-medium text-amber-900">{t('customParams')}</h4>
											<p className="text-[11px] text-amber-800/80">{t('requestDefaultsHint')}</p>
										</div>
										<textarea
											rows={5}
											value={formData.custom_params_json}
											onChange={(e) =>
												onFormChange({
													...formData,
													custom_params_json: e.target.value,
												})
											}
											className="min-h-[120px] w-full resize-y rounded-md border border-amber-200 bg-white px-3 py-2 font-mono text-xs leading-relaxed focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
											placeholder={t('customParamsPlaceholder')}
											spellCheck={false}
										/>
									</div>
								</div>
							) : null}
						</section>

						<section className="pt-4">
							<div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-stretch">
								<div className="flex min-h-0 min-w-0 flex-col">
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
									<RoutePricePanel variant="neutral" fillHeight>
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
													<span className="font-medium text-gray-900">{catalogAudioPricingDisplay.minimumSeconds}</span>
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
									<div className="mt-3 border-t border-gray-200/90 pt-3">
										<div className="mb-1.5 min-w-0">
											<h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-700">
												{t('catalogOfficialSchedule')}
											</h4>
											<p className="mt-0.5 text-[11px] text-gray-500">
												{t('catalogScheduleLockedHint')}
											</p>
										</div>
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
																<p className={`font-mono tabular-nums ${active ? 'text-amber-950' : 'text-gray-800'}`}>
																	{w.start}–{w.end}
																	<span className={`ml-1.5 font-sans text-[10px] ${active ? 'text-amber-800/80' : 'text-gray-500'}`}>
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
																<span className={`font-mono text-xs tabular-nums ${active ? 'text-amber-950' : 'text-gray-800'}`}>
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
									</div>
								) : null}
									</div>
									</RoutePricePanel>
								</div>

								<div className="flex min-h-0 min-w-0 flex-col">
									<div className="mb-1 flex items-center justify-between gap-2">
										<h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
											{t('pricingSection')}
										</h3>
										<button
											type="button"
											onClick={() => setPriceOverrideJsonOpen((openJson) => !openJson)}
											aria-expanded={priceOverrideJsonOpen}
											aria-controls="route-price-override-json"
											title={
												priceOverrideJsonOpen ? t('hidePriceOverrideJson') : t('viewPriceOverrideJson')
											}
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
																() => {},
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
													priceOverridePreview.ok
														? 'border-gray-200 text-gray-800'
														: 'border-red-200 text-red-700'
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
															className="w-12 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[11px] font-mono tabular-nums focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
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
															className="w-12 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[11px] font-mono tabular-nums focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
															placeholder="1"
														/>
													</div>
												}
											/>
										</div>
										<RoutePricePanel
											variant="neutral"
											title={t('dailySchedule')}
											subtitle={t('pricingFormulaHint')}
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
												emptyLabel={t('scheduleEmpty')}
												startLabel={t('scheduleStart')}
												endLabel={t('scheduleEnd')}
												chargedFactorLabel={t('scheduleChargedFactor')}
												meteredFactorLabel={t('scheduleMeteredFactor')}
												removeLabel={tCommon('delete')}
												renderWindowExtra={
													catalogScheduleLocked &&
													selectedModel &&
													!selectedModelIsImage &&
													!selectedModelIsAudio &&
													catalogStandardTierRows.length > 0
														? (i) => (
																<ScheduleWindowEffectivePrices
																	billingCurrency={billingCurrency}
																	catalogFactor={catalogScheduleWindows[i]?.factor ?? 1}
																	chargedFactorText={editorScheduleWindows[i]?.charged_factor ?? ''}
																	meteredFactorText={editorScheduleWindows[i]?.metered_factor ?? ''}
																	model={selectedModel}
																/>
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
							</div>
						</section>
					</div>
				</div>

				<div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-gray-50/50 px-5 py-4">
					<div className="flex flex-wrap items-center gap-2">
						{editingRoute && (
							<>
								<button
									type="button"
									onClick={onDelete}
									disabled={isSaving || isDeleting}
									className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
								>
									<TrashIcon className="h-4 w-4" aria-hidden />
									{isDeleting ? tCommon('deleting') : t('deleteRoute')}
								</button>
								<Link
									href={`/gateway/playground?routeId=${encodeURIComponent(editingRoute.id)}`}
									className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
								>
									<BeakerIcon className="h-4 w-4" aria-hidden />
									{t('testInPlayground')}
								</Link>
							</>
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
