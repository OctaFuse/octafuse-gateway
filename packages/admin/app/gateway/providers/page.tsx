'use client';

/**
 * 上游供应商：CRUD、各协议 base URL 与单键 API Key；对应 Worker `/admin/providers`。
 * 已配置实例支持卡片与列表切换；`?q=` / `?filter=` 持久化筛选（`useSearchParams` + Suspense）。
 */
import { Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { useCatalogView } from '../components/use-catalog-view';
import { ProviderAddCard } from './components/provider-add-card';
import { PROVIDER_LIST_COLUMNS, ProviderCard } from './components/provider-card';
import { ProviderImportModal } from './components/provider-import-modal';
import { ProviderModal } from './components/provider-modal';
import { ProviderSyncCheckButton } from './components/provider-sync-check-button';
import { ProviderSyncBanner } from './components/provider-sync-banner';
import { ProviderSyncModal } from './components/provider-sync-modal';
import { ProviderToolbar } from './components/provider-toolbar';
import { PROVIDER_SYNC_ORPHANS_KEY, useProviderSync } from './use-provider-sync';
import { useProvidersPageState } from './use-providers-page-state';

function ProvidersContent() {
	const t = useTranslations('providers');
	const tBrand = useTranslations('brand');
	const tCommon = useTranslations('common');
	const state = useProvidersPageState();
	const [view, setView] = useCatalogView('octafuse.admin.providers.view');
	const sync = useProviderSync({
		onChanged: state.refreshProviders,
		onReport: state.setOfficialReport,
	});

	if (state.isLoading) {
		return (
			<div className="flex h-full items-center justify-center">
				<div className="text-gray-600">{tCommon('loading')}</div>
			</div>
		);
	}

	const officialUpdateProviders = state.providers.filter(
		(p) => Number(p.official_update_count ?? 0) > 0
	);
	const officialUpdateCount = officialUpdateProviders.length;
	const officialUpdateKindCount = new Set(officialUpdateProviders.map((p) => p.kind)).size;
	const orphanCount = state.providers.filter((p) => p.kind_orphaned).length;

	const hasQueryOrFilter =
		Boolean(state.providerSearch.trim()) || state.selectedFilter !== 'all';

	return (
		<div className="min-h-full min-w-0 overflow-x-hidden bg-gray-100/90 p-4 pb-6 sm:p-6 lg:p-8">
			<div className="mb-5 flex flex-wrap items-start justify-between gap-3 sm:mb-6">
				<div className="min-w-0">
					<h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">{t('title')}</h1>
					<p className="mt-1 text-sm text-gray-500">
						{t('subtitle', { product: tBrand('product') })}
					</p>
					<p className="mt-1 text-xs text-gray-400">{t('importHint')}</p>
				</div>
				<ProviderSyncCheckButton
					checking={sync.checking}
					lastCheckedAt={sync.lastCheckedAt}
					hasUpdates={officialUpdateCount > 0 || orphanCount > 0}
					onCheck={() => void sync.check()}
				/>
			</div>

			<ProviderSyncBanner
				updateCount={officialUpdateCount}
				kindCount={officialUpdateKindCount}
				orphanCount={orphanCount}
				onOpen={() => sync.openSync()}
				onShowOnly={() => state.setSelectedFilter('outdated')}
			/>

			<ProviderToolbar
				view={view}
				onViewChange={setView}
				providerSearch={state.providerSearch}
				selectedFilter={state.selectedFilter}
				filterCounts={state.filterCounts}
				filteredCount={state.filteredProviders.length}
				totalCount={state.providers.length}
				onSearchChange={state.setProviderSearch}
				onFilterChange={state.setSelectedFilter}
			/>

			{view === 'list' ? (
				<ProviderAddCard compact onImport={state.openImportModal} onCreate={state.handleCreate} />
			) : null}
			<div className={view === 'list' ? 'overflow-hidden rounded-xl border border-slate-200 bg-white' : 'admin-catalog-grid'}>
				{view === 'cards' ? (
					<ProviderAddCard onImport={state.openImportModal} onCreate={state.handleCreate} />
				) : (
					<div className={`hidden gap-4 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-medium text-slate-500 xl:grid ${PROVIDER_LIST_COLUMNS}`} aria-hidden>
						<span>{t('list.provider')}</span>
						<span>{t('list.protocols')}</span>
						<span>{t('list.keyAndQuota')}</span>
						<span>{t('list.routes')}</span>
						<span>{t('list.status')}</span>
					</div>
				)}
				<div className={view === 'list' ? 'divide-y divide-slate-200' : 'contents'} role={view === 'list' ? 'list' : undefined} aria-label={view === 'list' ? t('title') : undefined}>
					{state.filteredProviders.map((provider) => (
						<ProviderCard
							key={provider.id}
							view={view}
							provider={provider}
							copiedId={state.copiedId}
							statusTogglingId={state.statusTogglingId}
							onEdit={state.handleEdit}
							onToggleStatus={state.handleToggleStatus}
							onCopyApiKey={state.handleCopyApiKey}
							onReviewOfficialUpdate={() =>
								sync.openSync(provider.kind_orphaned ? PROVIDER_SYNC_ORPHANS_KEY : provider.kind)
							}
						/>
					))}
					{view === 'list' && state.filteredProviders.length === 0 ? (
						<div role="listitem" className="p-8 text-center text-sm text-slate-500">
							<p>{hasQueryOrFilter ? t('emptySearch') : t('empty')}</p>
							{hasQueryOrFilter ? <p className="mt-1 text-xs text-slate-400">{t('emptyFilterHint')}</p> : null}
						</div>
					) : null}
				</div>
			</div>
			{view === 'cards' && state.filteredProviders.length === 0 && hasQueryOrFilter ? (
				<p className="mt-4 text-center text-sm text-gray-500">
					{t('emptySearch')}
					<span className="mt-1 block text-xs text-gray-400">{t('emptyFilterHint')}</span>
				</p>
			) : null}

			<ProviderSyncModal sync={sync} />

			<ProviderImportModal
				open={state.showImportModal}
				catalogRows={state.importCatalogRows}
				filteredCatalogRows={state.filteredImportCatalogRows}
				catalogSearch={state.importCatalogSearch}
				catalogLoading={state.importCatalogLoading}
				catalogError={state.importCatalogError}
				selected={state.importSelected}
				selectedCount={state.importSelectedCount}
				submitting={state.importSubmitting}
				onClose={() => state.setShowImportModal(false)}
				onCatalogSearchChange={state.setImportCatalogSearch}
				onSelectAll={state.selectAllImportPresets}
				onClearSelection={state.clearImportPresetSelection}
				onTogglePreset={state.toggleImportPreset}
				onImport={state.runImportSelectedPresets}
			/>

			<ProviderModal
				open={state.showModal}
				editingProvider={state.editingProvider}
				duplicateSourceId={state.duplicateSourceId}
				formData={state.formData}
				saveError={state.saveError}
				isSaving={state.isSaving}
				isDeleting={state.isDeleting}
				onClose={state.closeProviderModal}
				onFormChange={state.setFormData}
				onSave={state.handleSave}
				onDelete={state.handleDelete}
				onDuplicate={state.handleDuplicate}
			/>
		</div>
	);
}

export default function GatewayProvidersPage() {
	const tCommon = useTranslations('common');

	return (
		<Suspense
			fallback={
				<div className="flex h-full items-center justify-center">
					<div className="text-gray-600">{tCommon('loading')}</div>
				</div>
			}
		>
			<ProvidersContent />
		</Suspense>
	);
}
