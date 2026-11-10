'use client';

import './providers-workspace.css';

import { AdminPageTitle } from '@/components/admin-page-title';

/**
 * 上游供应商：CRUD、各协议 base URL 与单键 API Key；对应 Worker `/admin/providers`。
 * 已配置实例支持卡片与列表切换；`?q=` / `?filter=` 持久化筛选（`useSearchParams` + Suspense）。
 */
import { Suspense, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useCatalogView } from '../components/use-catalog-view';
import { ArrowDownTrayIcon, PlusIcon } from '@heroicons/react/24/outline';
import {
	PROVIDER_LIST_COLUMNS,
	ProviderCard,
} from './components/provider-card';
import { ProviderImportModal } from './components/provider-import-modal';
import { ProviderModal } from './components/provider-modal';
import { ProviderSyncCheckButton } from './components/provider-sync-check-button';
import { ProviderSyncBanner } from './components/provider-sync-banner';
import { ProviderSyncModal } from './components/provider-sync-modal';
import { ProviderToolbar } from './components/provider-toolbar';
import {
	PROVIDER_SYNC_ORPHANS_KEY,
	useProviderSync,
} from './use-provider-sync';
import { useProvidersPageState } from './use-providers-page-state';

function ProvidersContent() {
	const t = useTranslations('providers');
	const tCommon = useTranslations('common');
	const state = useProvidersPageState();
	const [initialTab, setInitialTab] = useState<'basic' | 'endpoints' | 'routes'>('basic');
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
	const officialUpdateKindCount = new Set(
		officialUpdateProviders.map((p) => p.kind)
	).size;
	const orphanCount = state.providers.filter((p) => p.kind_orphaned).length;

	const hasQueryOrFilter =
		Boolean(state.providerSearch.trim()) ||
		state.selectedFilter !== 'all' ||
		state.selectedProtocol !== 'all';

	return (
		<div className="providers-design-workspace min-h-full min-w-0 overflow-x-hidden bg-gray-50 p-4 pb-6 sm:p-6 lg:p-8">
			<div className="mb-6 flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<AdminPageTitle>
						{t('title')}
					</AdminPageTitle>
					<p className="mt-1 text-sm text-gray-500">{t('overviewSubtitle')}</p>
				</div>
				<div className="flex flex-wrap items-start gap-2">
					<ProviderSyncCheckButton
						checking={sync.loading || sync.checking}
						onCheck={() => sync.openSync()}
					/>
					<button
						type="button"
						onClick={state.openImportModal}
						className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-100"
					>
						<ArrowDownTrayIcon className="h-4 w-4" aria-hidden />
						{tCommon('import')}
					</button>
					<button
						type="button"
						onClick={() => {
							setInitialTab('basic');
							state.handleCreate();
						}}
						className="inline-flex h-9 items-center justify-center gap-2 rounded-lg admin-primary px-4 text-xs font-medium text-white"
					>
						<PlusIcon className="h-4 w-4" aria-hidden />
						{t('addCard.title')}
					</button>
				</div>
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
				selectedProtocol={state.selectedProtocol}
				onProtocolChange={state.setSelectedProtocol}
				filterCounts={state.filterCounts}
				filteredCount={state.filteredProviders.length}
				totalCount={state.providers.length}
				onSearchChange={state.setProviderSearch}
				onFilterChange={state.setSelectedFilter}
			/>

			<div
				className={
					view === 'list'
						? 'provider-list-canvas overflow-hidden rounded-2xl'
						: 'provider-card-canvas admin-catalog-grid'
				}
			>
				{view === 'list' && (
					<div
						className={`provider-list-heading hidden gap-4 px-4 py-3 text-xs font-medium text-slate-500 xl:grid ${PROVIDER_LIST_COLUMNS}`}
						aria-hidden
					>
						<span>{t('list.provider')}</span>
						<span>{t('list.protocols')}</span>
						<span>{t('list.keyAndQuota')}</span>
						<span>{t('list.routes')}</span>
					</div>
				)}
				<div
					className={view === 'list' ? 'provider-list-items' : 'contents'}
					role={view === 'list' ? 'list' : undefined}
					aria-label={view === 'list' ? t('title') : undefined}
				>
					{state.filteredProviders.map((provider) => (
						<ProviderCard
							key={provider.id}
							view={view}
							provider={provider}
							copiedId={state.copiedId}
							statusTogglingId={state.statusTogglingId}
							onEdit={(provider) => {
								setInitialTab('basic');
								state.handleEdit(provider);
							}}
							onViewEndpoints={(provider) => {
								setInitialTab('endpoints');
								state.handleEdit(provider);
							}}
							onViewRoutes={(provider) => {
								setInitialTab('routes');
								state.handleEdit(provider);
							}}
							onToggleStatus={state.handleToggleStatus}
							onCopyApiKey={state.handleCopyApiKey}
							onReviewOfficialUpdate={() =>
								sync.openSync(
									provider.kind_orphaned
										? PROVIDER_SYNC_ORPHANS_KEY
										: provider.kind
								)
							}
						/>
					))}
					{view === 'list' && state.filteredProviders.length === 0 ? (
						<div
							role="listitem"
							className="p-8 text-center text-sm text-slate-500"
						>
							<p>{hasQueryOrFilter ? t('emptySearch') : t('empty')}</p>
							{hasQueryOrFilter ? (
								<p className="mt-1 text-xs text-slate-400">
									{t('emptyFilterHint')}
								</p>
							) : null}
						</div>
					) : null}
				</div>
			</div>
			{view === 'cards' && state.filteredProviders.length === 0 ? (
				<p className="mt-4 text-center text-sm text-gray-500">
					{hasQueryOrFilter ? t('emptySearch') : t('empty')}
					{hasQueryOrFilter && (
						<span className="mt-1 block text-xs text-gray-400">
							{t('emptyFilterHint')}
						</span>
					)}
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
				initialTab={initialTab}
				editingProvider={state.editingProvider}
				duplicateSourceId={state.duplicateSourceId}
				formData={state.formData}
				saveError={state.saveError}
				isSaving={state.isSaving}
				isApiKeyLoading={state.isApiKeyLoading}
				isDeleting={state.isDeleting}
				onClose={state.closeProviderModal}
				onFormChange={state.handleFormChange}
				onSave={state.handleSave}
				onDelete={state.handleDelete}
				onDuplicate={state.handleDuplicate}
				onRoutesChanged={state.refreshProviders}
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
