'use client';

/**
 * 模型目录：CRUD、标签、定价字段；数据来自 `/api/admin/models`。
 * 左侧 Kind（LLM | Image，无 All）+ Vendor；右侧当前筛选模型卡片；`?kind=` / `?vendor=` 持久化（`useSearchParams` + Suspense）。
 * `?edit=<model_id>` 可从 Routes 等入口深链直接打开编辑弹窗（消费后从 URL 清除）。
 */
import { Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { useModelsPageState } from './use-models-page-state';
import { ModelCard } from './components/model-card';
import { ModelCatalogToolbar } from './components/model-catalog-toolbar';
import { ModelFilterSidebar } from './components/model-filter-sidebar';
import { ModelImportModal } from './components/model-import-modal';
import { ModelMetadataPreviewModal } from './components/model-metadata-preview-modal';
import { ModelModal } from './components/model-modal';

function ModelsContent() {
	const t = useTranslations('models');
	const tBrand = useTranslations('brand');
	const tCommon = useTranslations('common');
	const state = useModelsPageState();

	if (state.isLoading) {
		return (
			<div className="flex items-center justify-center h-full">
				<div className="text-gray-600">{tCommon('loading')}</div>
			</div>
		);
	}

	const createTitle = state.isAllVendors
		? t('createTitleAll')
		: t('createTitleVendor', { vendor: state.activeVendorTitle });

	return (
		<div className="min-w-0 overflow-x-hidden bg-gray-100/90 p-4 pb-6 sm:p-6 lg:p-8">
			<div className="mb-5 sm:mb-6">
				<h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">{t('title')}</h1>
				<p className="mt-1 text-sm text-gray-500">
					{t('subtitle', { product: tBrand('product') })}
				</p>
			</div>

			<div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white/70 shadow-sm ring-1 ring-black/[0.02]">
				<div className="flex min-w-0 flex-col lg:flex-row lg:items-start">
					<ModelFilterSidebar
						modelCount={state.models.length}
						hasActiveFilter={state.hasActiveFilter}
						selectedVendorItemsCount={state.selectedVendorItems.length}
						isAllVendors={state.isAllVendors}
						selectedVendor={state.selectedVendor}
						modelsByVendor={state.modelsByVendor}
						selectedKind={state.selectedKind}
						kindCounts={state.kindCounts}
						onSelectVendor={state.setSelectedVendor}
						onSelectKind={state.setSelectedKind}
						onClearFilter={state.clearFilters}
					/>

					<section className="min-w-0 flex-1 bg-slate-100/70">
						<ModelCatalogToolbar
							activeVendorTitle={state.activeVendorTitle}
							selectedCount={state.selectedVendorItems.length}
							hasModels={state.models.length > 0}
							importSubmitting={state.importSubmitting}
							onImport={state.openImportCatalogModal}
							onCreate={() =>
								state.handleCreate(
									state.isAllVendors ? undefined : state.activeVendorKey,
									state.selectedKind === 'image' ? 'image' : 'llm'
								)
							}
							createTitle={createTitle}
						/>

						<div className="bg-slate-100/70 p-4 sm:p-6">
							{state.models.length === 0 ? (
								<div className="rounded-xl border border-dashed border-gray-300 bg-white/80 py-16 text-center text-gray-500 shadow-sm">
									<p className="text-sm font-medium text-gray-600">{t('empty')}</p>
									<p className="mt-1 text-xs text-gray-500">{t('emptyHint')}</p>
								</div>
							) : (
								<div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
									{state.selectedVendorItems.map((model) => (
										<ModelCard
											key={model.id}
											model={model}
											billingCurrency={state.billingCurrency}
											onEdit={state.handleEdit}
											onViewMetadata={state.openMetadataPreview}
										/>
									))}
								</div>
							)}
						</div>
					</section>
				</div>
			</div>

			<ModelModal
				open={state.showModal}
				editingModel={state.editingModel}
				formData={state.formData}
				pricingTierRows={state.pricingTierRows}
				imageBillingMode={state.imageBillingMode}
				onImageBillingModeChange={state.setImageBillingMode}
				imagePerImageDraft={state.imagePerImageDraft}
				onImagePerImageDraftChange={state.setImagePerImageDraft}
				tagInput={state.tagInput}
				saveError={state.saveError}
				isSaving={state.isSaving}
				isDeleting={state.isDeleting}
				billingCurrency={state.billingCurrency}
				onClose={state.closeModal}
				onFormChange={state.setFormData}
				onPricingTierRowsChange={state.setPricingTierRows}
				onTagInputChange={state.setTagInput}
				onAddTag={state.handleAddTag}
				onRemoveTag={state.handleRemoveTag}
				onToggleModality={state.toggleFormModality}
				onKindChange={state.applyFormKind}
				onSave={state.handleSave}
				onDelete={state.handleDelete}
			/>

			{state.metadataPreview && (
				<ModelMetadataPreviewModal
					preview={state.metadataPreview}
					onClose={() => state.setMetadataPreview(null)}
				/>
			)}

			<ModelImportModal
				open={state.showImportCatalogModal}
				catalogRows={state.importCatalogRows}
				filteredCatalogRows={state.filteredImportCatalogRows}
				catalogSearch={state.importCatalogSearch}
				catalogKind={state.importCatalogKind}
				kindCounts={state.importCatalogKindCounts}
				catalogLoading={state.importCatalogLoading}
				catalogError={state.importCatalogError}
				selected={state.importSelected}
				selectedCount={state.importSelectedCount}
				importableCount={state.importableCatalogCount}
				submitting={state.importSubmitting}
				billingCurrency={state.billingCurrency}
				existingModelIds={state.existingModelIds}
				onClose={() => state.setShowImportCatalogModal(false)}
				onCatalogSearchChange={state.setImportCatalogSearch}
				onCatalogKindChange={state.setImportCatalogKind}
				onSelectAll={state.selectAllImportPresets}
				onClearSelection={state.clearImportPresetSelection}
				onReload={() => void state.loadImportCatalog()}
				onTogglePreset={state.toggleImportPreset}
				onImport={() => void state.runImportSelectedPresets()}
			/>
		</div>
	);
}

export default function GatewayModelsPage() {
	const tCommon = useTranslations('common');

	return (
		<Suspense
			fallback={
				<div className="flex items-center justify-center h-full">
					<div className="text-gray-600">{tCommon('loading')}</div>
				</div>
			}
		>
			<ModelsContent />
		</Suspense>
	);
}
