'use client';

/**
 * 模型目录：CRUD、标签、定价字段；数据来自 `/api/admin/models`。
 * 页面筛选条 Kind（All | LLM | Image | ASR | TTS | Embedding）+ Lifecycle（All | Active | Retired）+ Vendor；下方支持卡片与列表切换；`?kind=` / `?vendor=` / `?lifecycle=` 持久化（`useSearchParams` + Suspense）。
 * `?edit=<model_id>` 可从 Routes 等入口深链直接打开编辑弹窗（消费后从 URL 清除）。
 */
import { Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { useModelsPageState } from './use-models-page-state';
import { ModelAddCard } from './components/model-add-card';
import { useCatalogView } from '../components/use-catalog-view';
import { MODEL_LIST_COLUMNS, ModelCard } from './components/model-card';
import { ModelFilterSidebar } from './components/model-filter-sidebar';
import { ModelImportModal } from './components/model-import-modal';
import { ModelModal } from './components/model-modal';
import { ModelSyncBanner } from './components/model-sync-banner';
import { ModelSyncCheckButton } from './components/model-sync-check-button';
import { ModelSyncModal } from './components/model-sync-modal';
import { useModelSync } from './use-model-sync';
import { normalizeModelVendorInput } from '@/lib/model-vendor';

function ModelsContent() {
	const t = useTranslations('models');
	const tBrand = useTranslations('brand');
	const tCommon = useTranslations('common');
	const state = useModelsPageState();
	const [view, setView] = useCatalogView('octafuse.admin.models.view');
	const sync = useModelSync({
		onChanged: state.reloadModelsQuietly,
		onReport: state.setOfficialReport,
	});

	if (state.isLoading) {
		return (
			<div className="flex h-full min-h-full items-center justify-center bg-gray-100/90">
				<div className="text-gray-600">{tCommon('loading')}</div>
			</div>
		);
	}

	const officialUpdateCount = state.officialReport?.models_with_diff ?? 0;
	const officialUpdateVendorCount = state.officialReport?.groups.length ?? 0;

	const createTitle = state.isAllVendors
		? t('createTitleAll')
		: t('createTitleVendor', { vendor: state.activeVendorTitle });

	const addModelCard = (
		<ModelAddCard
			compact={view === 'list'}
			importSubmitting={state.importSubmitting}
			createTitle={createTitle}
			onImport={state.openImportCatalogModal}
			onCreate={() => {
				state.handleCreate(
					state.isAllVendors ? undefined : state.activeVendorKey,
					state.selectedKind === 'all' ? 'llm' : state.selectedKind
				);
			}}
		/>
	);

	return (
		<div className="min-h-full min-w-0 overflow-x-hidden bg-gray-100/90 p-4 pb-6 sm:p-6 lg:p-8">
			<div className="mb-5 flex flex-wrap items-start justify-between gap-3 sm:mb-6">
				<div className="min-w-0">
					<h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">{t('title')}</h1>
					<p className="mt-1 text-sm text-gray-500">
						{t('subtitle', { product: tBrand('product') })}
					</p>
				</div>
				<ModelSyncCheckButton
					checking={sync.checking}
					lastCheckedAt={sync.lastCheckedAt}
					hasUpdates={officialUpdateCount > 0}
					onCheck={() => void sync.check()}
				/>
			</div>

			<ModelSyncBanner
				updateCount={officialUpdateCount}
				vendorCount={officialUpdateVendorCount}
				onOpen={() => sync.openSync()}
			/>

			<ModelFilterSidebar
				view={view}
				onViewChange={setView}
				filteredCount={state.selectedVendorItems.length}
				modelCount={state.models.length}
				hasActiveFilter={state.hasActiveFilter}
				isAllVendors={state.isAllVendors}
				selectedVendor={state.selectedVendor}
				modelsByVendor={state.modelsByVendor}
				selectedKind={state.selectedKind}
				kindCounts={state.kindCounts}
				kindAllCount={state.lifecycleFilteredCount}
				selectedLifecycle={state.selectedLifecycle}
				lifecycleCounts={state.lifecycleCounts}
				onSelectLifecycle={state.setSelectedLifecycle}
				onSelectVendor={state.setSelectedVendor}
				onSelectKind={state.setSelectedKind}
				onClearFilter={state.clearFilters}
			/>

			{view === 'list' ? addModelCard : null}
			<div className={view === 'list' ? 'overflow-hidden rounded-xl border border-slate-200 bg-white' : 'admin-catalog-grid'}>
				{view === 'cards' ? addModelCard : (
					<div className={`hidden gap-4 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-medium text-slate-500 xl:grid ${MODEL_LIST_COLUMNS}`} aria-hidden>
						<span>{t('list.model')}</span>
						<span>{t('list.kindAndSpecs')}</span>
						<span>{t('list.pricing')}</span>
						<span>{t('list.routes')}</span>
						<span>{t('list.tags')}</span>
						<span />
					</div>
				)}
				<div className={view === 'list' ? 'divide-y divide-slate-200' : 'contents'} role={view === 'list' ? 'list' : undefined} aria-label={view === 'list' ? t('title') : undefined}>
					{state.selectedVendorItems.map((model) => (
						<ModelCard
							key={model.id}
							view={view}
							model={model}
							billingCurrency={state.billingCurrency}
							onEdit={state.handleEdit}
							onReviewOfficialUpdate={(m) => sync.openSync(normalizeModelVendorInput(m.vendor))}
						/>
					))}
					{view === 'list' && state.selectedVendorItems.length === 0 ? (
						<div role="listitem" className="p-8 text-center text-sm text-slate-500">
							<p>{t('empty')}</p>
							<p className="mt-1 text-xs text-slate-400">{t('emptyHint')}</p>
						</div>
					) : null}
				</div>
			</div>
			{view === 'cards' && state.selectedVendorItems.length === 0 && state.hasActiveFilter ? (
				<p className="mt-4 text-center text-sm text-gray-500">
					{t('empty')}
					<span className="mt-1 block text-xs text-gray-400">{t('emptyHint')}</span>
				</p>
			) : null}

			<ModelSyncModal sync={sync} />

			<ModelModal
				open={state.showModal}
				editingModel={state.editingModel}
				duplicateSourceModelId={state.duplicateSourceModelId}
				formData={state.formData}
				formKind={state.formKind}
				pricingTierRows={state.pricingTierRows}
				catalogScheduleWindows={state.catalogScheduleWindows}
				onCatalogScheduleWindowsChange={state.setCatalogScheduleWindows}
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
				onDuplicate={state.handleDuplicate}
			/>

			<ModelImportModal
				open={state.showImportCatalogModal}
				catalogRows={state.importCatalogRows}
				filteredCatalogRows={state.filteredImportCatalogRows}
				catalogSearch={state.importCatalogSearch}
				catalogKind={state.importCatalogKind}
				kindCounts={state.importCatalogKindCounts}
				catalogLifecycle={state.importCatalogLifecycle}
				lifecycleCounts={state.importCatalogLifecycleCounts}
				onCatalogLifecycleChange={state.setImportCatalogLifecycle}
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
