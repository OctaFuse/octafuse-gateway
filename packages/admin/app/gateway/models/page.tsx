'use client';

/**
 * 模型目录：CRUD、标签、定价字段；数据来自 `/api/admin/models`。
 * 页面筛选条 Kind（All | LLM | Image | Audio）+ Vendor；下方紧凑卡片网格（与 Providers 同密度）；`?kind=` / `?vendor=` 持久化（`useSearchParams` + Suspense）。
 * `?edit=<model_id>` 可从 Routes 等入口深链直接打开编辑弹窗（消费后从 URL 清除）。
 */
import { Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { useModelsPageState } from './use-models-page-state';
import { ModelAddCard } from './components/model-add-card';
import { ModelCard } from './components/model-card';
import { ModelFilterSidebar } from './components/model-filter-sidebar';
import { ModelImportModal } from './components/model-import-modal';
import { ModelModal } from './components/model-modal';

function ModelsContent() {
	const t = useTranslations('models');
	const tBrand = useTranslations('brand');
	const tCommon = useTranslations('common');
	const state = useModelsPageState();

	if (state.isLoading) {
		return (
			<div className="flex h-full min-h-full items-center justify-center bg-gray-100/90">
				<div className="text-gray-600">{tCommon('loading')}</div>
			</div>
		);
	}

	const createTitle = state.isAllVendors
		? t('createTitleAll')
		: t('createTitleVendor', { vendor: state.activeVendorTitle });

	return (
		<div className="min-h-full min-w-0 overflow-x-hidden bg-gray-100/90 p-4 pb-6 sm:p-6 lg:p-8">
			<div className="mb-5 sm:mb-6">
				<h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">{t('title')}</h1>
				<p className="mt-1 text-sm text-gray-500">
					{t('subtitle', { product: tBrand('product') })}
				</p>
			</div>

			<ModelFilterSidebar
				modelCount={state.models.length}
				hasActiveFilter={state.hasActiveFilter}
				isAllVendors={state.isAllVendors}
				selectedVendor={state.selectedVendor}
				modelsByVendor={state.modelsByVendor}
				selectedKind={state.selectedKind}
				kindCounts={state.kindCounts}
				onSelectVendor={state.setSelectedVendor}
				onSelectKind={state.setSelectedKind}
				onClearFilter={state.clearFilters}
			/>

			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
				<ModelAddCard
					importSubmitting={state.importSubmitting}
					createTitle={createTitle}
					onImport={state.openImportCatalogModal}
					onCreate={() => {
						state.handleCreate(
							state.isAllVendors ? undefined : state.activeVendorKey,
							state.selectedKind === 'image'
								? 'image'
								: state.selectedKind === 'audio'
									? 'audio'
									: 'llm'
						);
					}}
				/>
				{state.selectedVendorItems.map((model) => (
					<ModelCard
						key={model.id}
						model={model}
						billingCurrency={state.billingCurrency}
						onEdit={state.handleEdit}
					/>
				))}
			</div>
			{state.selectedVendorItems.length === 0 && state.hasActiveFilter ? (
				<p className="mt-4 text-center text-sm text-gray-500">
					{t('empty')}
					<span className="mt-1 block text-xs text-gray-400">{t('emptyHint')}</span>
				</p>
			) : null}

			<ModelModal
				open={state.showModal}
				editingModel={state.editingModel}
				formData={state.formData}
				formKind={state.formKind}
				pricingTierRows={state.pricingTierRows}
				imageBillingMode={state.imageBillingMode}
				onImageBillingModeChange={state.setImageBillingMode}
				imagePerImageDraft={state.imagePerImageDraft}
				onImagePerImageDraftChange={state.setImagePerImageDraft}
				audioPricingDraft={state.audioPricingDraft}
				onAudioPricingDraftChange={state.setAudioPricingDraft}
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
				<div className="flex h-full min-h-full items-center justify-center bg-gray-100/90">
					<div className="text-gray-600">{tCommon('loading')}</div>
				</div>
			}
		>
			<ModelsContent />
		</Suspense>
	);
}
