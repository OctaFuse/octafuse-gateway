'use client';

/**
 * 模型路由：`model_routes` CRUD、协议与 route_group、URL 查询参数驱动列表筛选（`useSearchParams` + Suspense）。
 * 模型卡片标题 / 铅笔图标可就地打开 ModelModal（改 Tag 等），无需跳转 Models 页。
 */
import { Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { ModelModal } from '../models/components/model-modal';
import { useRoutesPageState } from './use-routes-page-state';
import { RouteFilterSidebar } from './components/route-filter-sidebar';
import { RouteModal } from './components/route-modal';
import { RouteStickyDialog } from './components/route-sticky-dialog';
import { RouteVendorGroup } from './components/route-vendor-group';
import { RouteWorkspaceHeader } from './components/route-workspace-header';

function RoutesContent() {
	const t = useTranslations('routes');
	const tCommon = useTranslations('common');
	const state = useRoutesPageState();

	if (state.isLoading) {
		return (
			<div className="flex items-center justify-center h-full">
				<div className="text-gray-600">{tCommon('loading')}</div>
			</div>
		);
	}

	return (
		<div className="min-w-0 overflow-x-hidden bg-gray-100/90 p-4 pb-6 sm:p-6 lg:p-8">
			<div className="mb-5 sm:mb-6">
				<h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">{t('title')}</h1>
				<p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p>
			</div>

			<div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white/70 shadow-sm ring-1 ring-black/[0.02]">
				<div className="flex min-w-0 flex-col lg:flex-row lg:items-start">
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

					<section className="min-w-0 flex-1 bg-slate-100/70">
						<RouteWorkspaceHeader
							activeFilterSummary={state.activeFilterSummary}
							onCreate={() => state.handleCreate()}
						/>

						<div className="bg-slate-100/70 p-4 sm:p-6">
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
							) : (
								<div className={state.filterVendor ? '' : 'space-y-8'}>
									{state.routeCardVendorGroups.map(({ vendor, cards, showHeader }, vendorGroupIdx) => (
										<RouteVendorGroup
											key={vendor}
											vendor={vendor}
											cards={cards}
											showHeader={showHeader}
											vendorGroupIdx={vendorGroupIdx}
											modelMeta={state.modelMeta}
											copiedModelId={state.copiedModelId}
											togglingId={state.togglingId}
											onCopyModelId={state.copyModelId}
											onCreate={state.handleCreate}
											onEdit={state.handleEdit}
											onEditModel={(modelId) => void state.modelEdit.openEditById(modelId)}
											onToggleStatus={state.handleToggleStatus}
											onOpenStickyDialog={state.handleOpenStickyDialog}
										/>
									))}
								</div>
							)}
						</div>
					</section>
				</div>
			</div>

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
				selectedModelIsImage={state.selectedModelIsImage}
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
				pricingTierRows={state.modelEdit.pricingTierRows}
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

			{state.stickyDialog && (
				<RouteStickyDialog
					dialog={state.stickyDialog}
					form={state.stickyForm}
					error={state.stickyError}
					saving={state.stickySaving}
					onClose={state.closeStickyDialog}
					onFormChange={state.setStickyForm}
					onSave={() => void state.handleSaveSticky()}
				/>
			)}
		</div>
	);
}

export default function GatewayRoutesPage() {
	const tCommon = useTranslations('common');

	return (
		<Suspense
			fallback={
				<div className="flex items-center justify-center h-full">
					<div className="text-gray-600">{tCommon('loading')}</div>
				</div>
			}
		>
			<RoutesContent />
		</Suspense>
	);
}
