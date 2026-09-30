'use client';

import { ArrowDownIcon } from '@heroicons/react/24/outline';
import { useTranslations, useLocale } from 'next-intl';
import { liveProviderPickerLabel, sortProvidersByKindThenName } from '@/lib/provider-kind';
import { UPSTREAM_PROTOCOLS, type UpstreamProtocol } from '@/lib/upstream-protocol';
import {
	adapterOptionMappingSuffix,
	alignRouteScheduleWindowsToCatalog,
	applyAdapterOptionToForm,
	catalogScheduleWindowsFromModel,
	compatibleAdaptersForRoute,
	listAdapterOptionsForModel,
	requestOperationsForModel,
	resolveAdapterOptionKey,
	upstreamOperationsForProviderModel,
} from '../route-utils';
import type { RouteModalProps } from './route-modal-types';

type Props = Pick<
	RouteModalProps,
	| 'editingRoute'
	| 'duplicateSourceRouteId'
	| 'formData'
	| 'models'
	| 'providers'
	| 'selectedModel'
	| 'selectedProvider'
	| 'selectedModelIsImage'
	| 'selectedModelIsAudio'
	| 'allowedProtocolsForProvider'
	| 'onFormChange'
>;

export function RouteMappingFields({
	editingRoute,
	duplicateSourceRouteId,
	formData,
	models,
	providers,
	selectedModel,
	selectedProvider,
	selectedModelIsImage,
	selectedModelIsAudio,
	allowedProtocolsForProvider,
	onFormChange,
}: Props) {
	const t = useTranslations('routes.modal');
	const tKind = useTranslations('providers.kind');
	const locale = useLocale();
	const adapterLabel = (adapter: string) =>
		t.has(`adapterNames.${adapter}`) ? t(`adapterNames.${adapter}`) : adapter;
	// Image models keep the public request protocol as OpenAI; upstream may be openai or dashscope.
	const lockOpenaiProtocol = selectedModelIsImage;
	const requestProtocols = UPSTREAM_PROTOCOLS.filter(
		(protocol) => requestOperationsForModel(selectedModel, protocol, formData.provider_model_name).length > 0
	);
	const requestOperations = requestOperationsForModel(
		selectedModel,
		formData.request_protocol,
		formData.provider_model_name
	);
	const upstreamOperations = upstreamOperationsForProviderModel(
		selectedProvider,
		selectedModel,
		formData.upstream_protocol,
		formData.provider_model_name
	);
	const adapterOptions = listAdapterOptionsForModel(
		selectedModel,
		selectedProvider,
		formData.provider_model_name
	);
	const selectedAdapterOptionKey = resolveAdapterOptionKey(formData);
	const selectedAdapterOption = adapterOptions.find(
		(option) => option.descriptor.optionKey === selectedAdapterOptionKey
	);
	const visibleAdapterOptions = selectedProvider
		? adapterOptions.filter(
				(option) => option.available || option.descriptor.optionKey === selectedAdapterOptionKey
		  )
		: [];
	const compatibleAdapters = compatibleAdaptersForRoute(formData);
	const showCurrentAdapter =
		Boolean(editingRoute) &&
		!selectedAdapterOption &&
		!compatibleAdapters.includes(formData.adapter) &&
		Boolean(formData.adapter);
	const lockTopology = Boolean(selectedAdapterOption) && !showCurrentAdapter;
	const selectableProviders = sortProvidersByKindThenName(
		providers.filter(
			(provider) =>
				(Boolean(editingRoute || duplicateSourceRouteId) && provider.id === formData.provider_id) ||
				UPSTREAM_PROTOCOLS.some(
					(protocol) =>
						upstreamOperationsForProviderModel(
							provider,
							selectedModel,
							protocol,
							formData.provider_model_name
						).length > 0
				)
		),
		locale,
		tKind('custom')
	);
	const showCurrentUpstreamOperation =
		Boolean(editingRoute) &&
		!upstreamOperations.includes(formData.upstream_operation) &&
		Boolean(formData.upstream_operation);

	return (
		<section>
			<h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
				{t('basicMapping')}
			</h3>
			<div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-start lg:gap-x-5">
				<div className="flex h-full min-w-0 flex-col rounded-lg border border-blue-200 bg-blue-50/40 p-4">
					<p className="mb-2.5 text-xs font-semibold text-blue-700">{t('clientColumn')}</p>
					<div className="space-y-3">
						<div>
							<label
								htmlFor="route-field-modelRequired"
								className="mb-1 block text-sm font-medium text-gray-700"
							>
								{t('modelRequired')}
							</label>
							<select
								id="route-field-modelRequired"
								value={formData.model_id}
								onChange={(e) => {
									const nextModelId = e.target.value;
									const nextModel = models.find((m) => m.id === nextModelId);
									const nextRequestProtocols = UPSTREAM_PROTOCOLS.filter(
										(protocol) =>
											requestOperationsForModel(nextModel, protocol, formData.provider_model_name).length > 0
									);
									const requestProtocol = nextRequestProtocols.includes(formData.request_protocol)
										? formData.request_protocol
										: nextRequestProtocols[0] ?? formData.request_protocol;
									const nextRequestOperations = requestOperationsForModel(
										nextModel,
										requestProtocol,
										formData.provider_model_name
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
														formData.provider_model_name
													).length > 0
										  )
										: [];
									const upstreamProtocol = nextUpstreamProtocols.includes(formData.upstream_protocol)
										? formData.upstream_protocol
										: nextUpstreamProtocols[0] ?? requestProtocol;
									const nextUpstreamOperations = upstreamOperationsForProviderModel(
										selectedProvider,
										nextModel,
										upstreamProtocol,
										formData.provider_model_name
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
						<p className="break-all font-mono text-xs text-gray-500" title={t('modelId')}>
							{formData.model_id || '—'}
						</p>
						{lockTopology ? (
							<div className="space-y-2 border-t border-gray-200/70 pt-3">
								<p className="text-[11px] text-gray-500">{t('editor.adapterManaged')}</p>
								<dl className="space-y-1.5 text-xs">
									<div className="flex items-baseline justify-between gap-3">
										<dt className="shrink-0 text-gray-500">{t('requestProtocol')}</dt>
										<dd className="font-mono text-gray-800">{formData.request_protocol}</dd>
									</div>
									<div className="flex items-baseline justify-between gap-3">
										<dt className="shrink-0 text-gray-500">{t('requestOperation')}</dt>
										<dd className="break-all text-right font-mono text-gray-800">
											{formData.request_operation === 'models.generate'
												? t('operationModelsGenerate')
												: formData.request_operation}
										</dd>
									</div>
								</dl>
							</div>
						) : (
							<>
								<div>
									<label
										htmlFor="route-field-requestProtocol"
										className="mb-1 block text-sm font-medium text-gray-700"
									>
										{t('requestProtocol')}
									</label>
									<select
										id="route-field-requestProtocol"
										value={formData.request_protocol}
										onChange={(e) => {
											const requestProtocol = e.target.value as UpstreamProtocol;
											const requestOperation =
												requestOperationsForModel(
													selectedModel,
													requestProtocol,
													formData.provider_model_name
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
									<label
										htmlFor="route-field-requestOperation"
										className="mb-1 block text-sm font-medium text-gray-700"
									>
										{t('requestOperation')}
									</label>
									<select
										id="route-field-requestOperation"
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
							</>
						)}
					</div>
				</div>

				<div className="flex min-w-0 flex-col justify-center gap-3 lg:w-[15rem]">
					<div className="flex items-center justify-center py-1" aria-hidden>
						<ArrowDownIcon className="h-8 w-8 text-blue-500 lg:hidden" />
						<span className="hidden w-full items-center lg:flex">
							<span className="h-[3px] min-w-0 flex-1 rounded-full bg-blue-400" />
							<span className="h-0 w-0 shrink-0 border-y-[7px] border-l-[12px] border-y-transparent border-l-blue-500" />
						</span>
					</div>
					<p className="text-center text-xs font-semibold text-blue-600">{t('routeColumn')}</p>
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
						<label htmlFor="route-field-adapter" className="mb-1 block text-sm font-medium text-gray-700">
							{t('adapter')}
						</label>
						<select
							id="route-field-adapter"
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
							{selectedProvider ? t('editor.adapterHint') : t('protocolHintSelectProvider')}
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
				</div>

				<div className="flex h-full min-w-0 flex-col rounded-lg border border-violet-200 bg-violet-50/40 p-4">
					<p className="mb-2.5 text-xs font-semibold text-violet-700">{t('upstreamColumn')}</p>
					<div className="space-y-3">
						<div>
							<label
								htmlFor="route-field-providerRequired"
								className="mb-1 block text-sm font-medium text-gray-700"
							>
								{t('providerRequired')}
							</label>
							<select
								id="route-field-providerRequired"
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
															formData.provider_model_name
														).length > 0
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
										formData.provider_model_name
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
										{liveProviderPickerLabel(p, locale, tKind('custom'), p.id)}
									</option>
								))}
							</select>
						</div>
						<div>
							<label
								htmlFor="route-field-providerModelName"
								className="mb-1 block text-sm font-medium text-gray-700"
							>
								{t('providerModelName')}
							</label>
							<input
								id="route-field-providerModelName"
								type="text"
								value={formData.provider_model_name}
								onChange={(e) => {
									const providerModelName = e.target.value;
									const nextRequestOperations = requestOperationsForModel(
										selectedModel,
										formData.request_protocol,
										providerModelName
									);
									const nextUpstreamOperations = upstreamOperationsForProviderModel(
										selectedProvider,
										selectedModel,
										formData.upstream_protocol,
										providerModelName
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
						{lockTopology ? (
							<div className="space-y-2 border-t border-gray-200/70 pt-3">
								<p className="text-[11px] text-gray-500">{t('editor.adapterManaged')}</p>
								<dl className="space-y-1.5 text-xs">
									<div className="flex items-baseline justify-between gap-3">
										<dt className="shrink-0 text-gray-500">{t('upstreamProtocol')}</dt>
										<dd className="font-mono text-gray-800">{formData.upstream_protocol}</dd>
									</div>
									<div className="flex items-baseline justify-between gap-3">
										<dt className="shrink-0 text-gray-500">{t('upstreamOperation')}</dt>
										<dd className="break-all text-right font-mono text-gray-800">
											{formData.upstream_operation === 'models.generate'
												? t('operationModelsGenerate')
												: formData.upstream_operation}
										</dd>
									</div>
								</dl>
							</div>
						) : (
							<>
								<div>
									<label
										htmlFor="route-field-upstreamProtocol"
										className="mb-1 block text-sm font-medium text-gray-700"
									>
										{t('upstreamProtocol')}
									</label>
									<select
										id="route-field-upstreamProtocol"
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
														formData.provider_model_name
													)[0] ?? formData.upstream_operation,
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
									<label
										htmlFor="route-field-upstreamOperation"
										className="mb-1 block text-sm font-medium text-gray-700"
									>
										{t('upstreamOperation')}
									</label>
									<select
										id="route-field-upstreamOperation"
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
										{selectedProvider
											? t('upstreamOperationHintConfigured')
											: t('protocolHintSelectProvider')}
									</p>
								</div>
							</>
						)}
					</div>
				</div>
			</div>{' '}
		</section>
	);
}
