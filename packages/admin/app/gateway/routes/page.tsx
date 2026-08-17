'use client';

/**
 * 模型路由：`model_routes` CRUD、协议与 route_group、URL 查询参数驱动列表筛选（`useSearchParams` + Suspense）。
 * 模型卡片标题 / 铅笔图标可就地打开 ModelModal（改 Tag 等），无需跳转 Models 页。
 */
import { Suspense, useCallback, useMemo, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { ModelModal } from '../models/components/model-modal';
import { useRoutesPageState } from './use-routes-page-state';
import { RouteFilterSidebar } from './components/route-filter-sidebar';
import { RouteModal } from './components/route-modal';
import { ProviderStickyDialog } from './components/provider-sticky-dialog';
import { RoutePolicyDialog } from './components/route-policy-dialog';
import { RouteVendorGroup } from './components/route-vendor-group';
import { RouteWorkspaceHeader } from './components/route-workspace-header';
import { RouteSurfaceCatalog, UnroutedModelsPanel } from './components/route-surface-catalog';
import { buildRouteSurfaceCatalog } from './route-utils';
import {
	readStickyRefreshInterval,
	subscribeStickyRefreshInterval,
} from './sticky-refresh-preference';
import { StickySummaryProvider, useStickyRefreshControls } from './sticky-summary-store';
import { parseRouteWorkspaceView, type RouteWorkspaceView } from './types';

const FLOW_DENSITY_STORAGE_KEY = 'octafuse.admin.routes.flowDensity';
const FLOW_DENSITY_EVENT = 'octafuse-admin-routes-flow-density';

function readStoredWorkspaceView(): RouteWorkspaceView {
	if (typeof window === 'undefined') return 'byModel';
	try {
		return parseRouteWorkspaceView(window.localStorage.getItem(FLOW_DENSITY_STORAGE_KEY));
	} catch {
		return 'byModel';
	}
}

function subscribeFlowDensity(onStoreChange: () => void) {
	window.addEventListener('storage', onStoreChange);
	window.addEventListener(FLOW_DENSITY_EVENT, onStoreChange);
	return () => {
		window.removeEventListener('storage', onStoreChange);
		window.removeEventListener(FLOW_DENSITY_EVENT, onStoreChange);
	};
}

function RoutesContent() {
	const t = useTranslations('routes');
	const tCommon = useTranslations('common');
	const state = useRoutesPageState();
	const { invalidate } = useStickyRefreshControls();
	const workspaceView = useSyncExternalStore(
		subscribeFlowDensity,
		readStoredWorkspaceView,
		() => 'byModel' as const
	);
	const stickyRefreshIntervalMs = useSyncExternalStore(
		subscribeStickyRefreshInterval,
		readStickyRefreshInterval,
		() => 'off' as const
	);
	const saveProviderSticky = state.handleSaveProviderSticky;
	const stickyDialogPoolId = state.stickyDialog?.poolId;

	const handleWorkspaceViewChange = useCallback((view: RouteWorkspaceView) => {
		try {
			window.localStorage.setItem(FLOW_DENSITY_STORAGE_KEY, view);
		} catch {
			// Ignore quota / private-mode failures; preference is best-effort.
		}
		window.dispatchEvent(new Event(FLOW_DENSITY_EVENT));
	}, []);

	const handleSaveProviderSticky = useCallback(async () => {
		const poolId = stickyDialogPoolId;
		await saveProviderSticky();
		if (poolId) void invalidate(poolId);
	}, [invalidate, saveProviderSticky, stickyDialogPoolId]);

	const byModelLayout = useMemo(() => {
		const unrouted = buildRouteSurfaceCatalog(state.routeCards).unrouted;
		const unroutedIds = new Set(unrouted.map((card) => card.model_id));
		const vendorGroups = state.routeCardVendorGroups
			.map((group) => ({
				...group,
				cards: group.cards.filter((card) => !unroutedIds.has(card.model_id)),
			}))
			.filter((group) => group.cards.length > 0);
		return { vendorGroups, unrouted };
	}, [state.routeCardVendorGroups, state.routeCards]);

	if (state.isLoading) {
		return (
			<div className="flex min-h-full items-center justify-center bg-gray-100/90">
				<div className="text-gray-600">{tCommon('loading')}</div>
			</div>
		);
	}

	return (
		<div className="min-h-full min-w-0 overflow-x-hidden bg-gray-100/90 p-4 pb-6 sm:p-6 lg:p-8">
			<div className="mb-5 sm:mb-6">
				<h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">{t('title')}</h1>
				<p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p>
			</div>

			<RouteFilterSidebar
				visibleModelCount={state.visibleModelCount}
				visibleRouteCount={state.visibleRouteCount}
				hasActiveFilters={state.hasActiveFilters}
				filterStatus={state.filterStatus}
				filterKind={state.filterKind}
				filterRouteGroup={state.filterRouteGroup}
				filterVendor={state.filterVendor}
				filterProviderId={state.filterProviderId}
				statusCounts={state.statusCounts}
				kindCounts={state.kindCounts}
				routesCount={state.routes.length}
				routeGroupFilterOptions={state.routeGroupFilterOptions}
				routeGroupCounts={state.routeGroupCounts}
				vendorFilterOptions={state.vendorFilterOptions}
				providers={state.providers}
				providerRouteCounts={state.providerRouteCounts}
				onFilterStatusChange={state.setFilterStatus}
				onFilterKindChange={state.setFilterKind}
				onFilterRouteGroupChange={state.setFilterRouteGroup}
				onFilterVendorChange={state.setFilterVendor}
				onFilterProviderIdChange={state.setFilterProviderId}
				onClearAllFilters={state.clearAllFilters}
			/>

			<section className="min-w-0">
				<RouteWorkspaceHeader
					activeFilterSummary={state.activeFilterSummary}
					view={workspaceView}
					onViewChange={handleWorkspaceViewChange}
					stickyRefreshIntervalMs={stickyRefreshIntervalMs}
				/>
				<UnroutedModelsPanel
					cards={byModelLayout.unrouted}
					onEditModel={(modelId) => void state.modelEdit.openEditById(modelId)}
					onCreate={state.handleCreate}
				/>

				<div className="pt-4 sm:pt-6">
					{state.routesByModel.length === 0 ? (
						<div className="rounded-xl border border-dashed border-gray-300 bg-white/80 py-16 text-center text-gray-500 shadow-sm">
							<p className="text-sm font-medium text-gray-600">{t('empty')}</p>
							{state.hasActiveFilters ? (
								<p className="mt-1 text-xs text-gray-500">
									{t('emptyFilteredPrefix')}{' '}
									<button
										type="button"
										onClick={state.clearAllFilters}
										className="font-medium text-blue-600 hover:text-blue-800 focus:outline-none focus-visible:underline"
									>
										{tCommon('clearAllFilters')}
									</button>
								</p>
							) : null}
						</div>
					) : workspaceView === 'overview' ? (
						<RouteSurfaceCatalog
							cards={state.routeCards}
							modelMeta={state.modelMeta}
							providerMeta={state.providerMeta}
							globalRouteStrategy={state.globalRouteStrategy}
							copiedModelId={state.copiedModelId}
							togglingId={state.togglingId}
							onCopyModelId={state.copyModelId}
							onCreate={state.handleCreate}
							onEdit={state.handleEdit}
							onEditModel={(modelId) =>
								void state.modelEdit.openEditById(modelId)
							}
							onToggleStatus={state.handleToggleStatus}
							onOpenStrategyDialog={state.handleOpenStrategyDialog}
							onOpenProviderStickyDialog={state.handleOpenProviderStickyDialog}
						/>
					) : (
						<div className="space-y-6">
							<div className={state.filterVendor ? '' : 'space-y-8'}>
								{byModelLayout.vendorGroups.map(
									({ vendor, cards, showHeader }, vendorGroupIdx) => (
										<RouteVendorGroup
											key={vendor}
											vendor={vendor}
											cards={cards}
											showHeader={showHeader}
											vendorGroupIdx={vendorGroupIdx}
											modelMeta={state.modelMeta}
											providerMeta={state.providerMeta}
											globalRouteStrategy={state.globalRouteStrategy}
											density="topology"
											copiedModelId={state.copiedModelId}
											togglingId={state.togglingId}
											onCopyModelId={state.copyModelId}
											onCreate={state.handleCreate}
											onEdit={state.handleEdit}
											onEditModel={(modelId) =>
												void state.modelEdit.openEditById(modelId)
											}
											onToggleStatus={state.handleToggleStatus}
											onOpenStrategyDialog={state.handleOpenStrategyDialog}
											onOpenProviderStickyDialog={state.handleOpenProviderStickyDialog}
										/>
									)
								)}
							</div>
						</div>
					)}
				</div>
			</section>

			<RouteModal
				open={state.showModal}
				editingRoute={state.editingRoute}
				duplicateSourceRouteId={state.duplicateSourceRouteId}
				formData={state.formData}
				saveError={state.saveError}
				isSaving={state.isSaving}
				isDeleting={state.isDeleting}
				billingCurrency={state.billingCurrency}
				models={state.models}
				providers={state.providers}
				selectedModel={state.selectedModel}
				selectedProvider={state.selectedProvider}
				catalogStandardTierRows={state.catalogStandardTierRows}
				catalogImagePricingDisplay={state.catalogImagePricingDisplay}
				catalogAudioPricingDisplay={state.catalogAudioPricingDisplay}
				selectedModelIsImage={state.selectedModelIsImage}
				selectedModelIsAudio={state.selectedModelIsAudio}
				allowedProtocolsForProvider={state.allowedProtocolsForProvider}
				businessTimezone={state.businessTimezone}
				onClose={state.closeRouteModal}
				onFormChange={state.setFormData}
				onSave={state.handleSave}
				onDelete={() => state.editingRoute && void state.handleDelete(state.editingRoute.id)}
				onDuplicate={() => state.editingRoute && state.handleDuplicate(state.editingRoute)}
			/>

			<ModelModal
				open={state.modelEdit.showModal}
				editingModel={state.modelEdit.editingModel}
				formData={state.modelEdit.formData}
				formKind={state.modelEdit.formKind}
				pricingTierRows={state.modelEdit.pricingTierRows}
				imageBillingMode={state.modelEdit.imageBillingMode}
				onImageBillingModeChange={state.modelEdit.setImageBillingMode}
				imagePerImageDraft={state.modelEdit.imagePerImageDraft}
				onImagePerImageDraftChange={state.modelEdit.setImagePerImageDraft}
				audioPricingDraft={state.modelEdit.audioPricingDraft}
				onAudioPricingDraftChange={state.modelEdit.setAudioPricingDraft}
				tagInput={state.modelEdit.tagInput}
				saveError={state.modelEdit.saveError}
				isSaving={state.modelEdit.isSaving}
				isDeleting={state.modelEdit.isDeleting}
				billingCurrency={state.modelEdit.billingCurrency}
				onClose={state.modelEdit.closeModal}
				onFormChange={state.modelEdit.setFormData}
				onPricingTierRowsChange={state.modelEdit.setPricingTierRows}
				onTagInputChange={state.modelEdit.setTagInput}
				onAddTag={state.modelEdit.handleAddTag}
				onRemoveTag={state.modelEdit.handleRemoveTag}
				onToggleModality={state.modelEdit.toggleFormModality}
				onKindChange={state.modelEdit.applyFormKind}
				onSave={() => void state.modelEdit.handleSave()}
				onDelete={(id) => void state.modelEdit.handleDelete(id)}
			/>

			{state.strategyDialog && (
				<RoutePolicyDialog
					dialog={state.strategyDialog}
					form={state.strategyForm}
					error={state.strategyError}
					saving={state.strategySaving}
					onClose={state.closeStrategyDialog}
					onFormChange={state.setStrategyForm}
					onSave={() => void state.handleSaveStrategy()}
				/>
			)}

			{state.stickyDialog && (
				<ProviderStickyDialog
					dialog={state.stickyDialog}
					form={state.stickyForm}
					error={state.stickyError}
					saving={state.stickySaving}
					onClose={state.closeStickyDialog}
					onFormChange={state.setStickyForm}
					onSave={() => void handleSaveProviderSticky()}
				/>
			)}
		</div>
	);
}

function RoutesPageWithStickyStore() {
	const stickyRefreshIntervalMs = useSyncExternalStore(
		subscribeStickyRefreshInterval,
		readStickyRefreshInterval,
		() => 'off' as const
	);

	return (
		<StickySummaryProvider intervalMs={stickyRefreshIntervalMs}>
			<RoutesContent />
		</StickySummaryProvider>
	);
}

export default function GatewayRoutesPage() {
	const tCommon = useTranslations('common');

	return (
		<Suspense
			fallback={
				<div className="flex min-h-full items-center justify-center bg-gray-100/90">
					<div className="text-gray-600">{tCommon('loading')}</div>
				</div>
			}
		>
			<RoutesPageWithStickyStore />
		</Suspense>
	);
}
