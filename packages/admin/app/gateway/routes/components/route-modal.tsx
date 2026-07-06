'use client';

import { DocumentDuplicateIcon, TrashIcon } from '@heroicons/react/24/outline';
import { PricingTiersEditor } from '@/components/pricing-tiers-editor';
import { ReadOnlyPricingTiersTable } from '@/components/read-only-pricing-tiers-table';
import type { CatalogPricingTierDisplayRow } from '@/lib/pricing-ui';
import type { GatewayModel, GatewayProvider } from '@/lib/types';
import {
	UPSTREAM_PROTOCOLS,
	providerSupportsUpstreamProtocol,
	type UpstreamProtocol,
} from '@/lib/upstream-protocol';
import {
	recomputeChargedTiersFromChargedFactor,
	recomputeOverrideTiersFromProviderFactor,
} from '../route-utils';
import type { RouteFormData, RouteListRow } from '../types';
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
	allowedProtocolsForProvider: UpstreamProtocol[];
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
		allowedProtocolsForProvider,
		onClose,
		onFormChange,
		onSave,
		onDelete,
		onDuplicate,
	} = props;

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
							{editingRoute ? 'Edit Route' : 'New Route'}
						</h2>
						{!editingRoute && duplicateSourceRouteId && (
							<p className="mt-1 text-xs text-gray-500">
								Pre-filled from route{' '}
								<code className="rounded border border-gray-200 bg-gray-50 px-1 py-0.5 font-mono text-[11px]">
									{duplicateSourceRouteId}
								</code>
								. Review fields before saving.
							</p>
						)}
					</div>
					<button
						type="button"
						onClick={onClose}
						className="rounded-md p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
						disabled={isSaving || isDeleting}
						aria-label="Close"
					>
						<span className="block text-xl leading-none" aria-hidden>
							×
						</span>
					</button>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
					{saveError && (
						<div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
							{saveError}
						</div>
					)}

					<div className="space-y-5">
						<section className="rounded-lg border border-gray-200 bg-gray-50/80 p-4">
							<h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
								Basic mapping & routing
							</h3>
							<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
								<div>
									<label className="mb-1 block text-sm font-medium text-gray-700">Model *</label>
									<select
										value={formData.model_id}
										onChange={(e) => {
											const nextModelId = e.target.value;
											const model = models.find((m) => m.id === nextModelId);
											let charged = formData.charged_override_tiers;
											let metered = formData.metered_override_tiers;
											let pf = formData.provider_factor;
											if (model) {
												if (charged.length === 0) {
													const rc = recomputeChargedTiersFromChargedFactor(
														formData.charged_factor,
														model
													);
													if (rc.ok) charged = rc.tiers;
												}
												if (metered.length === 0) {
													const pfText = pf.trim() === '' ? '1' : pf;
													const rm = recomputeOverrideTiersFromProviderFactor(pfText, model);
													if (rm.ok) {
														metered = rm.tiers;
														if (pf.trim() === '') pf = '1';
													}
												}
											}
											onFormChange({
												...formData,
												model_id: nextModelId,
												charged_override_tiers: charged,
												metered_override_tiers: metered,
												provider_factor: pf,
											});
										}}
										className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
										required
									>
										<option value="">Select a model</option>
										{models.map((m) => (
											<option key={m.id} value={m.id}>
												{m.display_name ? `${m.display_name} (${m.id})` : m.id}
											</option>
										))}
									</select>
								</div>
								<div>
									<label className="mb-1 block text-sm font-medium text-gray-700">Provider *</label>
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
										<option value="">Select a provider</option>
										{providers.map((p) => (
											<option key={p.id} value={p.id}>
												{p.name ? `${p.name} (${p.id})` : p.id}
											</option>
										))}
									</select>
								</div>
								<div>
									<label className="mb-1 block text-sm font-medium text-gray-700">
										Upstream protocol
									</label>
									<select
										value={
											allowedProtocolsForProvider.includes(formData.upstream_protocol)
												? formData.upstream_protocol
												: (allowedProtocolsForProvider[0] ?? formData.upstream_protocol)
										}
										onChange={(e) =>
											onFormChange({
												...formData,
												upstream_protocol: e.target.value as UpstreamProtocol,
											})
										}
										disabled={!selectedProvider || allowedProtocolsForProvider.length === 0}
										className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500"
									>
										{allowedProtocolsForProvider.length === 0 ? (
											<option value="">—</option>
										) : (
											allowedProtocolsForProvider.map((p) => (
												<option key={p} value={p}>
													{p}
												</option>
											))
										)}
									</select>
									<p className="mt-1.5 text-xs text-gray-500">
										{selectedProvider
											? 'Only protocols with a configured base URL on this provider.'
											: 'Select a provider first.'}
									</p>
								</div>
								<div>
									<label className="mb-1 block text-sm font-medium text-gray-700">
										Provider model name *
									</label>
									<input
										type="text"
										value={formData.provider_model_name}
										onChange={(e) =>
											onFormChange({ ...formData, provider_model_name: e.target.value })
										}
										className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
										placeholder="e.g. gpt-4o-2024-11-20"
										required
									/>
								</div>
								<div>
									<label className="mb-1 block text-sm font-medium text-gray-700">Route group</label>
									<input
										type="text"
										value={formData.route_group}
										onChange={(e) => onFormChange({ ...formData, route_group: e.target.value })}
										className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
										placeholder="default"
									/>
									<p className="mt-1 text-xs text-gray-500">
										Routing pool for client{' '}
										<code className="rounded bg-gray-100 px-1 text-[11px]">modelId:group</code>. Omit{' '}
										<code className="rounded bg-gray-100 px-1 text-[11px]">:group</code> →{' '}
										<span className="font-medium">default</span> only. No active routes → 400.
									</p>
								</div>
								<div>
									<label className="mb-1 block text-sm font-medium text-gray-700">Priority</label>
									<input
										type="number"
										value={formData.priority}
										onChange={(e) =>
											onFormChange({
												...formData,
												priority: parseInt(e.target.value, 10) || 0,
											})
										}
										className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
									/>
									<p className="mt-1 text-xs text-gray-500">
										Higher = tried first within the same protocol group.
									</p>
								</div>
							</div>
						</section>

						<div className="space-y-5">
							<RoutePricePanel
								variant="neutral"
								title="Standard (catalog)"
								subtitle="Catalog baseline from the model’s pricing_profile. Read-only; use it as reference when editing charged or metered overrides."
							>
								<div className="min-h-0 flex-1">
									<ReadOnlyPricingTiersTable
										rows={catalogStandardTierRows}
										emptyLabel={
											selectedModel
												? 'This model has no catalog pricing_profile.'
												: 'Select a model to load catalog tiers.'
										}
										tableTitle="Read-only: catalog standard rates"
										billingCurrencyCode={billingCurrency}
									/>
								</div>
							</RoutePricePanel>

							<div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-stretch">
								<div className="flex h-full min-h-0 min-w-0 flex-col">
									<RoutePricePanel
										fillHeight
										variant="charged"
										title="Charged cost"
										subtitle="Required: saved as price_override.charged and drives charged_cost. Charged factor multiplies Standard (catalog) into rows—default 1 copies catalog tiers; edit tiers after scaling. charged_factor is stored in price_override JSON."
									>
										<PricingTiersEditor
											rows={formData.charged_override_tiers}
											onChange={(rows) =>
												onFormChange({ ...formData, charged_override_tiers: rows })
											}
											billingCurrencyCode={billingCurrency}
											minRows={0}
											toolbarStart={
												<div className="flex items-center gap-1.5 border-r border-gray-200 pr-3">
													<label
														htmlFor="user-cost-charged-factor"
														className="whitespace-nowrap text-[11px] font-medium text-gray-600"
													>
														Charged factor
													</label>
													<input
														id="user-cost-charged-factor"
														type="text"
														inputMode="decimal"
														value={formData.charged_factor}
														title="Multiplies Standard (catalog) into charged tiers when the selected model has pricing_profile. Default 1 copies catalog at 1×."
														onChange={(e) => {
															const next = e.target.value;
															const model = models.find((m) => m.id === formData.model_id);
															const r = recomputeChargedTiersFromChargedFactor(next, model);
															if (r.ok) {
																onFormChange({
																	...formData,
																	charged_factor: next,
																	charged_override_tiers: r.tiers,
																});
															} else {
																onFormChange({ ...formData, charged_factor: next });
															}
														}}
														className="w-[4.25rem] rounded-md border border-gray-300 bg-white px-2 py-1 text-xs tabular-nums focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
														placeholder="1"
													/>
												</div>
											}
										/>
									</RoutePricePanel>
								</div>

								<div className="flex h-full min-h-0 min-w-0 flex-col">
									<RoutePricePanel
										fillHeight
										variant="metered"
										title="Metered cost"
										subtitle="Required: saved as price_override.metered and drives metered_cost. Provider factor multiplies Standard (catalog) into rows—default 1 copies catalog tiers; edit tiers after scaling. metered_factor is written to price_override on save (same numeric value)."
									>
										<PricingTiersEditor
											rows={formData.metered_override_tiers}
											onChange={(rows) =>
												onFormChange({ ...formData, metered_override_tiers: rows })
											}
											billingCurrencyCode={billingCurrency}
											minRows={0}
											toolbarStart={
												<div className="flex items-center gap-1.5 border-r border-gray-200 pr-3">
													<label
														htmlFor="gateway-route-provider-factor"
														className="whitespace-nowrap text-[11px] font-medium text-gray-600"
													>
														Provider factor
													</label>
													<input
														id="gateway-route-provider-factor"
														type="text"
														inputMode="decimal"
														value={formData.provider_factor}
														title="Multiplies Standard (catalog) into metered tiers when the selected model has pricing_profile. Default 1 copies catalog at 1×."
														onChange={(e) => {
															const nextFactor = e.target.value;
															const model = models.find((m) => m.id === formData.model_id);
															const r = recomputeOverrideTiersFromProviderFactor(
																nextFactor,
																model
															);
															if (r.ok) {
																onFormChange({
																	...formData,
																	provider_factor: nextFactor,
																	metered_override_tiers: r.tiers,
																});
															} else {
																onFormChange({ ...formData, provider_factor: nextFactor });
															}
														}}
														className="w-[3.5rem] rounded-md border border-gray-300 bg-white px-1.5 py-1 text-xs tabular-nums focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
														placeholder="1"
													/>
												</div>
											}
										/>
									</RoutePricePanel>
								</div>
							</div>
						</div>

						<section className="rounded-lg border border-gray-200 bg-white p-4">
							<h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
								Request defaults (JSON)
							</h3>
							<p className="mb-3 text-xs text-gray-600">
								Route-level{' '}
								<code className="rounded bg-gray-100 px-1 py-0.5 font-mono">custom_params</code> is
								deep-merged into the upstream request body; explicit client fields win. Put both
								standard fields (e.g.{' '}
								<code className="rounded bg-gray-100 px-1 py-0.5 font-mono">temperature</code>) and
								vendor-specific keys (e.g.{' '}
								<code className="rounded bg-gray-100 px-1 py-0.5 font-mono">eca_thinking_config</code>)
								here.
							</p>
							<div className="flex min-h-0 flex-col">
								<label className="mb-1.5 text-sm font-medium text-gray-700">Custom params</label>
								<textarea
									rows={8}
									value={formData.custom_params_json}
									onChange={(e) =>
										onFormChange({ ...formData, custom_params_json: e.target.value })
									}
									className="min-h-[160px] w-full flex-1 resize-y rounded-md border border-gray-300 px-3 py-2 font-mono text-xs leading-relaxed focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
									placeholder='{"temperature":0.7,"provider_options":{"foo":"bar"}}'
									spellCheck={false}
								/>
							</div>
						</section>

						<section className="rounded-lg border border-gray-200 bg-white p-4">
							<h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
								Summary
							</h3>
							<div className="grid grid-cols-1 gap-2 text-xs text-gray-600 md:grid-cols-2">
								<p>
									<span className="font-medium text-gray-700">Route:</span>{' '}
									<span className="font-mono">{formData.model_id || '—'}</span> →{' '}
									<span className="font-mono">{formData.provider_id || '—'}</span> /{' '}
									<span className="font-mono">{formData.provider_model_name || '—'}</span>
								</p>
								<p>
									<span className="font-medium text-gray-700">Routing:</span>{' '}
									<span className="font-mono">{formData.upstream_protocol}</span> · group{' '}
									<span className="font-mono">{formData.route_group.trim() || 'default'}</span> ·
									priority <span className="font-mono">{formData.priority}</span> · status{' '}
									<span className="font-mono">{editingRoute ? editingRoute.status : 'inactive'}</span>
									{!editingRoute && <span className="text-gray-500"> (enable from list)</span>}
								</p>
								<p>
									<span className="font-medium text-gray-700">User billing:</span>{' '}
									<span className="font-mono">
										Routes must persist <span className="whitespace-nowrap">price_override.charged</span>{' '}
										tiers; charged_cost uses that profile. Charged factor scales Standard into the
										editor; <span className="whitespace-nowrap">charged_factor</span> is stored in{' '}
										<span className="whitespace-nowrap">price_override</span> JSON.
									</span>
								</p>
								<p>
									<span className="font-medium text-gray-700">Metered cost:</span>{' '}
									<span className="font-mono">
										Routes must persist <span className="whitespace-nowrap">price_override.metered</span>{' '}
										tiers; metered_cost uses that profile.
									</span>
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
								{isDeleting ? 'Deleting...' : 'Delete route'}
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
							Cancel
						</button>
						{editingRoute && (
							<button
								type="button"
								onClick={onDuplicate}
								disabled={isSaving || isDeleting}
								className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
							>
								<DocumentDuplicateIcon className="h-4 w-4" aria-hidden />
								Duplicate
							</button>
						)}
						<button
							type="button"
							onClick={onSave}
							disabled={isSaving || isDeleting}
							className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{isSaving ? 'Saving...' : 'Save'}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
