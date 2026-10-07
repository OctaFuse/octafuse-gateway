'use client';

import { ArrowRightIcon, ComputerDesktopIcon, ServerIcon } from '@heroicons/react/24/outline';
import { editorInputClass, editorLabelClass, RouteEditorSection } from './route-editor-ui';
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
	const tFlow = useTranslations('routes.flow');
	const tKind = useTranslations('providers.kind');
	const locale = useLocale();
	const adapterLabel = (adapter: string) =>
		t.has(`adapterNames.${adapter}`) ? t(`adapterNames.${adapter}`) : adapter;
	const adapterDescription = (adapter: string) =>
		t.has(`adapterDescriptions.${adapter}`) ? t(`adapterDescriptions.${adapter}`) : null;
	const lossyFeatureLabel = (feature: string) =>
		t.has(`lossyFeatureNames.${feature}`) ? t(`lossyFeatureNames.${feature}`) : feature;
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
	const { options: adapterOptions, modelUnrecognized } = listAdapterOptionsForModel(
		selectedModel,
		selectedProvider,
		formData.provider_model_name
	);
	const selectedAdapterOptionKey = resolveAdapterOptionKey(formData);
	const selectedAdapterOption = adapterOptions.find(
		(option) => option.descriptor.optionKey === selectedAdapterOptionKey
	);
	const providerModelNamed = formData.provider_model_name.trim().length > 0;
	const visibleAdapterOptions = selectedProvider
		? adapterOptions.filter((option) => {
				const kept =
					option.available || option.descriptor.optionKey === selectedAdapterOptionKey;
				if (!kept) return false;
				if (!providerModelNamed || modelUnrecognized) return true;
				return (
					option.modelMatch !== 'mismatch' ||
					option.descriptor.optionKey === selectedAdapterOptionKey
				);
		  })
		: [];
	const compatibleAdapters = compatibleAdaptersForRoute(formData);
	const showCurrentAdapter =
		Boolean(editingRoute) &&
		!selectedAdapterOption &&
		!compatibleAdapters.includes(formData.adapter) &&
		Boolean(formData.adapter);
	const lockTopology = Boolean(selectedAdapterOption) && !showCurrentAdapter;
	const selectableProviders = sortProvidersByKindThenName(
		providers.filter((provider) => {
			const isCurrentBinding =
				Boolean(editingRoute || duplicateSourceRouteId) && provider.id === formData.provider_id;
			// 停用供应商接不到流量。新建时不列出；编辑或复制时只保留当前绑定，避免 select 对不上值。
			if (provider.status === 'disabled' && !isCurrentBinding) return false;
			return (
				isCurrentBinding ||
				UPSTREAM_PROTOCOLS.some(
					(protocol) =>
						upstreamOperationsForProviderModel(
							provider,
							selectedModel,
							protocol,
							formData.provider_model_name
						).length > 0
				)
			);
		}),
		locale,
		tKind('custom')
	);
	const showCurrentUpstreamOperation =
		Boolean(editingRoute) &&
		!upstreamOperations.includes(formData.upstream_operation) &&
		Boolean(formData.upstream_operation);

	return (
		<div className="space-y-4">
			<RouteEditorSection title={t('editor.mappingTitle')} description={t('editor.mappingDescription')}>
				<div className="relative grid gap-5 md:grid-cols-2 md:gap-12">
					<div className="min-w-0 space-y-4">
						<p className="flex items-center gap-2 text-xs font-semibold text-slate-700">
							<ComputerDesktopIcon className="h-4 w-4 text-slate-500" aria-hidden />
							{t('clientColumn')}
						</p>
						<div>
							<label htmlFor="route-field-modelRequired" className={editorLabelClass}>
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
								className={editorInputClass}
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
							<p className={editorLabelClass}>{t('modelId')}</p>
							<div className="flex h-10 items-center overflow-hidden rounded-lg bg-slate-50 px-3">
								<code className="truncate text-sm text-gray-500" title={formData.model_id}>
									{formData.model_id || '—'}
								</code>
							</div>
						</div>
						{lockTopology ? (
							<ProtocolSummary
								label={t('requestProtocol')}
								protocol={formData.request_protocol}
								operation={
									formData.request_operation === 'models.generate'
										? t('operationModelsGenerate')
										: formData.request_operation
								}
							/>
						) : (
							<div className="grid gap-4 sm:grid-cols-2">
								<div>
									<label htmlFor="route-field-requestProtocol" className={editorLabelClass}>
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
										className={editorInputClass}
									>
										{requestProtocols.map((p) => (
											<option key={p} value={p}>
												{p}
											</option>
										))}
									</select>
								</div>
								<div>
									<label htmlFor="route-field-requestOperation" className={editorLabelClass}>
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
										className={editorInputClass}
									>
										{requestOperations.map((operation) => (
											<option key={operation} value={operation}>
												{operation === 'models.generate' ? t('operationModelsGenerate') : operation}
											</option>
										))}
										{formData.request_operation === '*' ? <option value="*">*</option> : null}
									</select>
									{selectedModelIsAudio ? (
										<p className="mt-2 text-xs text-gray-500">{t('audioPublicOperationHint')}</p>
									) : null}
								</div>
							</div>
						)}
					</div>
					<span aria-hidden className="absolute bottom-0 left-1/2 top-0 hidden w-px bg-slate-200 md:block">
						<span className="absolute left-1/2 top-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center bg-white">
							<ArrowRightIcon className="h-3.5 w-3.5 text-gray-400" />
						</span>
					</span>
					<div className="min-w-0 space-y-4 border-t border-slate-200 pt-5 md:border-0 md:pt-0">
						<p className="flex items-center gap-2 text-xs font-semibold text-slate-700">
							<ServerIcon className="h-4 w-4 text-slate-500" aria-hidden />
							{t('upstreamColumn')}
						</p>
						<div>
							<label htmlFor="route-field-providerRequired" className={editorLabelClass}>
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
								className={editorInputClass}
								required
							>
								<option value="">{t('selectProvider')}</option>
								{selectableProviders.map((p) => (
									<option key={p.id} value={p.id}>
										{liveProviderPickerLabel(p, locale, tKind('custom'), p.id)}
										{p.status === 'disabled' ? ` · ${tFlow('providerDisabled')}` : ''}
									</option>
								))}
							</select>
						</div>
						<div>
							<label htmlFor="route-field-providerModelName" className={editorLabelClass}>
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
								className={editorInputClass}
								placeholder={t('providerModelPlaceholder')}
								required
							/>
						</div>
						{lockTopology ? (
							<ProtocolSummary
								label={t('upstreamProtocol')}
								protocol={formData.upstream_protocol}
								operation={
									formData.upstream_operation === 'models.generate'
										? t('operationModelsGenerate')
										: formData.upstream_operation
								}
							/>
						) : (
							<div className="grid gap-4 sm:grid-cols-2">
								<div>
									<label htmlFor="route-field-upstreamProtocol" className={editorLabelClass}>
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
										className={editorInputClass}
									>
										{allowedProtocolsForProvider.map((p) => (
											<option key={p} value={p}>
												{p}
											</option>
										))}
									</select>
								</div>
								<div>
									<label htmlFor="route-field-upstreamOperation" className={editorLabelClass}>
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
										className={editorInputClass}
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
									<p className="mt-2 text-xs text-gray-500">
										{selectedProvider
											? t('upstreamOperationHintConfigured')
											: t('protocolHintSelectProvider')}
									</p>
								</div>
							</div>
						)}
					</div>
				</div>
			</RouteEditorSection>
			<RouteEditorSection title={t('editor.routingTitle')}>
				<div className="grid items-start gap-4 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,0.55fr)_minmax(0,0.55fr)]">
					<div>
						<label htmlFor="route-field-adapter" className={editorLabelClass}>
							{t('adapter')}
						</label>
						<select
							id="route-field-adapter"
							value={selectedAdapterOptionKey ?? formData.adapter}
							onChange={(e) => onFormChange(applyAdapterOptionToForm(formData, e.target.value))}
							title={formData.adapter}
							disabled={!selectedProvider}
							className={editorInputClass}
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
						<p className="mt-2 text-xs text-gray-500">
							{!selectedProvider
								? t('protocolHintSelectProvider')
								: (adapterDescription(selectedAdapterOption?.descriptor.id ?? formData.adapter) ??
									t('editor.adapterHint'))}
						</p>
						{selectedProvider && modelUnrecognized ? (
							<p className="mt-2 text-xs text-amber-700">{t('adapterModelUnrecognized')}</p>
						) : null}
						{selectedProvider &&
						selectedAdapterOption &&
						selectedAdapterOption.missingCapabilities.length > 0 ? (
							<p className="mt-2 text-xs text-amber-700">
								{t('adapterMissingCapabilities', {
									capabilities: selectedAdapterOption.missingCapabilities.join(', '),
								})}
							</p>
						) : null}
						{selectedProvider && selectedAdapterOption?.descriptor.lossyFeatures?.length ? (
							<p className="mt-2 text-xs text-amber-700">
								{t('adapterLossyFeatures', {
									features: selectedAdapterOption.descriptor.lossyFeatures
										.map(lossyFeatureLabel)
										.join(', '),
								})}
							</p>
						) : null}
					</div>
					<div>
						<label htmlFor="route-field-group" className={editorLabelClass} title={t('routeGroupHint')}>
							{t('routeGroup')}
						</label>
						<input
							id="route-field-group"
							type="text"
							value={formData.route_group}
							onChange={(e) => onFormChange({ ...formData, route_group: e.target.value })}
							className={editorInputClass}
							placeholder={t('routeGroupPlaceholder')}
							title={t('routeGroupHint')}
						/>
					</div>
					<div className="grid grid-cols-2 gap-4 md:contents">
						<div>
							<label htmlFor="route-field-priority" className={editorLabelClass} title={t('priorityHint')}>
								{t('priority')}
							</label>
							<input
								id="route-field-priority"
								type="number"
								value={formData.priority}
								onChange={(e) =>
									onFormChange({
										...formData,
										priority: parseInt(e.target.value, 10) || 0,
									})
								}
								title={t('priorityHint')}
								className={editorInputClass}
							/>
						</div>
						<div>
							<label htmlFor="route-field-weight" className={editorLabelClass} title={t('weightHint')}>
								{t('weight')}
							</label>
							<input
								id="route-field-weight"
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
								className={editorInputClass}
							/>
						</div>
					</div>
				</div>
			</RouteEditorSection>
		</div>
	);
}

function ProtocolSummary({
	label,
	protocol,
	operation,
}: {
	label: string;
	protocol: string;
	operation: string;
}) {
	return (
		<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
			<span className="text-gray-400">{label}</span>
			<span className="font-medium text-gray-600">{protocol}</span>
			<span aria-hidden className="text-gray-300">
				/
			</span>
			<code className="break-all text-gray-600">{operation}</code>
		</div>
	);
}
