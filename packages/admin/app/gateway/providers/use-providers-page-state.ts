'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
	deleteProvider,
	deleteProviderKey,
	fetchImportCatalog,
	fetchProviderKeyPlaintext,
	fetchProvidersList,
	importProviderPresets,
	loadProviderKeyRows,
	saveProvider,
	saveProviderKey,
	toggleProviderKeyStatus,
} from './provider-api';
import {
	limitConfigToFormFields,
	PROVIDER_KEY_LABEL_MAX_LENGTH,
	suggestDuplicateProviderId,
} from './provider-utils';
import type {
	EditingProviderKeyState,
	GatewayProvider,
	ProviderFormData,
	ProviderImportCatalogRow,
	ProviderKeyFormData,
	ProviderKeyRow,
} from './types';
import { EMPTY_KEY_EDIT_FORM, EMPTY_PROVIDER_FORM } from './types';

export function useProvidersPageState() {
	const [providers, setProviders] = useState<GatewayProvider[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [providerSearch, setProviderSearch] = useState('');
	const [showModal, setShowModal] = useState(false);
	const [editingProvider, setEditingProvider] = useState<GatewayProvider | null>(null);
	const [duplicateSourceId, setDuplicateSourceId] = useState<string | null>(null);
	const [formData, setFormData] = useState<ProviderFormData>(EMPTY_PROVIDER_FORM);
	const [saveError, setSaveError] = useState('');
	const [isSaving, setIsSaving] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);
	const [copiedId, setCopiedId] = useState<string | null>(null);
	const [showImportModal, setShowImportModal] = useState(false);
	const [importCatalogRows, setImportCatalogRows] = useState<ProviderImportCatalogRow[]>([]);
	const [importCatalogSearch, setImportCatalogSearch] = useState('');
	const [importCatalogLoading, setImportCatalogLoading] = useState(false);
	const [importCatalogError, setImportCatalogError] = useState('');
	const [importSelected, setImportSelected] = useState<Record<string, boolean>>({});
	const [importSubmitting, setImportSubmitting] = useState(false);
	const [expandedProviderIds, setExpandedProviderIds] = useState<Set<string>>(() => new Set());
	const [providerKeyPreviewById, setProviderKeyPreviewById] = useState<Record<string, ProviderKeyRow[]>>({});
	const [keyPreviewLoadingId, setKeyPreviewLoadingId] = useState<string | null>(null);
	const [keyPreviewErrorById, setKeyPreviewErrorById] = useState<Record<string, string>>({});
	const [isExpandingProviderKeys, setIsExpandingProviderKeys] = useState(false);
	const [providerKeyTogglingId, setProviderKeyTogglingId] = useState<string | null>(null);
	const [editingProviderKey, setEditingProviderKey] = useState<EditingProviderKeyState | null>(null);
	const [addingProviderKeyFor, setAddingProviderKeyFor] = useState<GatewayProvider | null>(null);
	const [keyEditForm, setKeyEditForm] = useState<ProviderKeyFormData>(EMPTY_KEY_EDIT_FORM);
	const [keyEditSaving, setKeyEditSaving] = useState(false);
	const [keyEditDeleting, setKeyEditDeleting] = useState(false);
	const [keyEditError, setKeyEditError] = useState('');

	const existingProviderIds = useMemo(() => new Set(providers.map((p) => p.id)), [providers]);
	const pendingKeyCount = useMemo(() => providers.filter((p) => p.has_pending_key).length, [providers]);
	const filteredProviders = useMemo(() => {
		const query = providerSearch.trim().toLowerCase();
		if (!query) return providers;
		return providers.filter((provider) => provider.name.toLowerCase().includes(query));
	}, [providerSearch, providers]);
	const providerOverview = useMemo(() => {
		const protocols = filteredProviders.reduce(
			(acc, provider) => {
				if (provider.base_url_openai?.trim()) acc.openai++;
				if (provider.base_url_anthropic?.trim()) acc.anthropic++;
				if (provider.base_url_gemini?.trim()) acc.gemini++;
				return acc;
			},
			{ openai: 0, anthropic: 0, gemini: 0 }
		);
		return {
			total: filteredProviders.length,
			activeKeys: filteredProviders.reduce((sum, provider) => sum + (provider.active_key_count ?? 0), 0),
			withoutKeys: filteredProviders.filter((provider) => (provider.active_key_count ?? 0) === 0).length,
			protocols,
		};
	}, [filteredProviders]);
	const importSelectedCount = useMemo(
		() => Object.values(importSelected).filter(Boolean).length,
		[importSelected]
	);
	const filteredImportCatalogRows = useMemo(() => {
		const query = importCatalogSearch.trim().toLowerCase();
		if (!query) return importCatalogRows;
		return importCatalogRows.filter((row) => row.name.toLowerCase().includes(query));
	}, [importCatalogSearch, importCatalogRows]);

	const refreshProviders = useCallback(async () => {
		try {
			const rows = await fetchProvidersList();
			setProviders(rows);
		} catch (error) {
			console.error('Fetch providers error:', error);
		} finally {
			setIsLoading(false);
		}
	}, []);

	const refreshProviderKeyPreview = useCallback(async (providerId: string) => {
		const rows = await loadProviderKeyRows(providerId);
		setProviderKeyPreviewById((prev) => ({ ...prev, [providerId]: rows }));
		return rows;
	}, []);

	useEffect(() => {
		void refreshProviders();
	}, [refreshProviders]);

	const copyToClipboard = useCallback(async (text: string, feedbackId: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopiedId(feedbackId);
			setTimeout(() => setCopiedId(null), 2000);
		} catch (error) {
			console.error('Copy failed:', error);
		}
	}, []);

	const handleToggleProviderKeyPreview = useCallback(
		async (providerId: string) => {
			if (expandedProviderIds.has(providerId)) {
				setExpandedProviderIds((prev) => {
					const next = new Set(prev);
					next.delete(providerId);
					return next;
				});
				return;
			}
			setExpandedProviderIds((prev) => new Set(prev).add(providerId));
			if (providerKeyPreviewById[providerId]) return;

			setKeyPreviewLoadingId(providerId);
			setKeyPreviewErrorById((prev) => {
				const next = { ...prev };
				delete next[providerId];
				return next;
			});
			try {
				await refreshProviderKeyPreview(providerId);
			} catch (error) {
				console.error('Fetch provider key preview error:', error);
				setKeyPreviewErrorById((prev) => ({
					...prev,
					[providerId]: error instanceof Error ? error.message : 'Failed to load keys',
				}));
			} finally {
				setKeyPreviewLoadingId((current) => (current === providerId ? null : current));
			}
		},
		[expandedProviderIds, providerKeyPreviewById, refreshProviderKeyPreview]
	);

	const handleExpandVisibleProviderKeys = useCallback(async () => {
		const providerIds = filteredProviders.map((provider) => provider.id);
		if (providerIds.length === 0) return;

		const missingProviderIds = providerIds.filter((providerId) => !providerKeyPreviewById[providerId]);
		if (missingProviderIds.length === 0) {
			setExpandedProviderIds((prev) => {
				const next = new Set(prev);
				for (const providerId of providerIds) next.add(providerId);
				return next;
			});
			return;
		}

		setIsExpandingProviderKeys(true);
		try {
			const results = await Promise.all(
				missingProviderIds.map(async (providerId) => {
					try {
						const rows = await loadProviderKeyRows(providerId);
						return { providerId, rows, error: null as string | null };
					} catch (error) {
						console.error('Fetch provider key preview error:', error);
						return {
							providerId,
							rows: [] as ProviderKeyRow[],
							error: error instanceof Error ? error.message : 'Failed to load keys',
						};
					}
				})
			);
			setProviderKeyPreviewById((prev) => {
				const next = { ...prev };
				for (const result of results) {
					if (!result.error) next[result.providerId] = result.rows;
				}
				return next;
			});
			setKeyPreviewErrorById((prev) => {
				const next = { ...prev };
				for (const result of results) {
					if (result.error) next[result.providerId] = result.error;
					else delete next[result.providerId];
				}
				return next;
			});
			setExpandedProviderIds((prev) => {
				const next = new Set(prev);
				for (const providerId of providerIds) next.add(providerId);
				return next;
			});
		} finally {
			setIsExpandingProviderKeys(false);
		}
	}, [filteredProviders, providerKeyPreviewById]);

	const handleCollapseVisibleProviderKeys = useCallback(() => {
		const providerIds = new Set(filteredProviders.map((provider) => provider.id));
		setExpandedProviderIds((prev) => {
			const next = new Set(prev);
			for (const providerId of providerIds) next.delete(providerId);
			return next;
		});
	}, [filteredProviders]);

	const handleCopyProviderKey = useCallback(
		async (key: ProviderKeyRow) => {
			const providerId = key.provider_id || editingProvider?.id;
			if (!providerId) return;
			try {
				const apiKey = await fetchProviderKeyPlaintext(providerId, key.id);
				await navigator.clipboard.writeText(apiKey);
				setCopiedId(`provider-key:${key.id}`);
				setTimeout(() => setCopiedId(null), 2000);
			} catch (error) {
				console.error('Copy provider key error:', error);
				alert(error instanceof Error ? error.message : 'Failed to copy API key');
			}
		},
		[editingProvider?.id]
	);

	const handleToggleProviderKeyStatus = useCallback(
		async (key: ProviderKeyRow, providerIdOverride?: string) => {
			const providerId = providerIdOverride || editingProvider?.id || key.provider_id;
			if (!providerId) return;
			const nextStatus = key.status === 'active' ? 'disabled' : 'active';
			setProviderKeyTogglingId(key.id);
			try {
				const result = await toggleProviderKeyStatus(providerId, key.id, nextStatus);
				if (result.success) {
					await refreshProviderKeyPreview(providerId);
					void refreshProviders();
				} else {
					alert(result.message);
				}
			} catch (error) {
				console.error('Toggle provider key error:', error);
				alert('Update failed');
			} finally {
				setProviderKeyTogglingId(null);
			}
		},
		[editingProvider?.id, refreshProviderKeyPreview, refreshProviders]
	);

	const openProviderKeyEditor = useCallback((providerId: string, key: ProviderKeyRow) => {
		const limits = limitConfigToFormFields(key.limit_config);
		setAddingProviderKeyFor(null);
		setEditingProviderKey({ providerId, key });
		setKeyEditForm({
			label: key.label,
			api_key: '',
			status: key.status,
			weight: String(key.weight),
			priority: String(key.priority),
			rpm: limits.rpm,
			tpm: limits.tpm,
			max_concurrency: limits.max_concurrency,
		});
		setKeyEditError('');
	}, []);

	const openProviderKeyCreator = useCallback((provider: GatewayProvider) => {
		setEditingProviderKey(null);
		setAddingProviderKeyFor(provider);
		setKeyEditForm({
			...EMPTY_KEY_EDIT_FORM,
			label: 'default',
			status: 'active',
		});
		setKeyEditError('');
	}, []);

	const closeProviderKeyEditor = useCallback(() => {
		if (keyEditSaving || keyEditDeleting) return;
		setEditingProviderKey(null);
		setAddingProviderKeyFor(null);
		setKeyEditForm(EMPTY_KEY_EDIT_FORM);
		setKeyEditError('');
	}, [keyEditDeleting, keyEditSaving]);

	const handleSaveProviderKeyEdit = useCallback(async () => {
		const providerId = editingProviderKey?.providerId ?? addingProviderKeyFor?.id;
		if (!providerId) return;
		const label = keyEditForm.label.trim();
		if (!label) {
			setKeyEditError('Label is required');
			return;
		}
		if (label.length > PROVIDER_KEY_LABEL_MAX_LENGTH) {
			setKeyEditError(`Label must be at most ${PROVIDER_KEY_LABEL_MAX_LENGTH} characters`);
			return;
		}
		const apiKey = keyEditForm.api_key.trim();
		if (addingProviderKeyFor && !apiKey) {
			setKeyEditError('API key is required');
			return;
		}
		setKeyEditSaving(true);
		setKeyEditError('');
		try {
			const result = await saveProviderKey(providerId, keyEditForm, editingProviderKey?.key.id ?? null);
			if (result.success) {
				await refreshProviderKeyPreview(providerId);
				setExpandedProviderIds((prev) => new Set(prev).add(providerId));
				void refreshProviders();
				setEditingProviderKey(null);
				setAddingProviderKeyFor(null);
				setKeyEditForm(EMPTY_KEY_EDIT_FORM);
			} else {
				setKeyEditError(result.message);
			}
		} catch (error) {
			console.error('Save provider key error:', error);
			setKeyEditError(editingProviderKey ? 'Failed to update key' : 'Failed to create key');
		} finally {
			setKeyEditSaving(false);
		}
	}, [
		addingProviderKeyFor,
		editingProviderKey,
		keyEditForm,
		refreshProviderKeyPreview,
		refreshProviders,
	]);

	const handleDeleteProviderKeyFromEditor = useCallback(async () => {
		if (!editingProviderKey) return;
		if (
			!confirm(
				`Delete key "${editingProviderKey.key.label}" (${editingProviderKey.key.masked_api_key})? This cannot be undone.`
			)
		) {
			return;
		}
		setKeyEditDeleting(true);
		setKeyEditError('');
		try {
			const result = await deleteProviderKey(editingProviderKey.providerId, editingProviderKey.key.id);
			if (result.success) {
				await refreshProviderKeyPreview(editingProviderKey.providerId);
				void refreshProviders();
				setEditingProviderKey(null);
				setKeyEditForm(EMPTY_KEY_EDIT_FORM);
			} else {
				setKeyEditError(result.message);
			}
		} catch (error) {
			console.error('Delete provider key error:', error);
			setKeyEditError('Delete failed');
		} finally {
			setKeyEditDeleting(false);
		}
	}, [editingProviderKey, refreshProviderKeyPreview, refreshProviders]);

	const handleCreate = useCallback(() => {
		setEditingProvider(null);
		setDuplicateSourceId(null);
		setFormData({ ...EMPTY_PROVIDER_FORM, id: '' });
		setShowModal(true);
		setSaveError('');
	}, []);

	const handleEdit = useCallback((provider: GatewayProvider) => {
		setEditingProvider(provider);
		setDuplicateSourceId(null);
		setFormData({
			id: provider.id,
			name: provider.name,
			base_url_openai: provider.base_url_openai ?? '',
			base_url_anthropic: provider.base_url_anthropic ?? '',
			base_url_gemini: provider.base_url_gemini ?? '',
			description: provider.description ?? '',
		});
		setShowModal(true);
		setSaveError('');
	}, []);

	const handleDuplicate = useCallback(
		(provider: GatewayProvider) => {
			setEditingProvider(null);
			setDuplicateSourceId(provider.id);
			setFormData({
				id: suggestDuplicateProviderId(provider.id, existingProviderIds),
				name: `${provider.name} (copy)`,
				base_url_openai: provider.base_url_openai ?? '',
				base_url_anthropic: provider.base_url_anthropic ?? '',
				base_url_gemini: provider.base_url_gemini ?? '',
				description: provider.description ?? '',
			});
			setShowModal(true);
			setSaveError('');
		},
		[existingProviderIds]
	);

	const handleDelete = useCallback(
		async (id: string) => {
			if (!confirm('Are you sure you want to delete this provider?')) return;

			setIsDeleting(true);
			try {
				const result = await deleteProvider(id);
				if (result.success) {
					setShowModal(false);
					setEditingProvider(null);
					void refreshProviders();
				} else {
					alert(result.message);
				}
			} catch (error) {
				console.error('Delete error:', error);
				alert('Delete failed');
			} finally {
				setIsDeleting(false);
			}
		},
		[refreshProviders]
	);

	const loadImportCatalog = useCallback(async () => {
		setImportCatalogLoading(true);
		setImportCatalogError('');
		try {
			const rows = await fetchImportCatalog();
			setImportCatalogRows(rows);
			setImportSelected({});
		} catch (error) {
			console.error('Load provider import catalog error:', error);
			setImportCatalogError(error instanceof Error ? error.message : 'Failed to load catalog');
			setImportCatalogRows([]);
		} finally {
			setImportCatalogLoading(false);
		}
	}, []);

	const openImportModal = useCallback(() => {
		setShowImportModal(true);
		setImportCatalogError('');
		setImportCatalogSearch('');
		setImportSelected({});
		void loadImportCatalog();
	}, [loadImportCatalog]);

	const toggleImportPreset = useCallback((id: string) => {
		setImportSelected((prev) => ({ ...prev, [id]: !prev[id] }));
	}, []);

	const selectAllImportPresets = useCallback(() => {
		setImportSelected((prev) => {
			const next = { ...prev };
			for (const row of filteredImportCatalogRows) {
				next[row.id] = true;
			}
			return next;
		});
	}, [filteredImportCatalogRows]);

	const clearImportPresetSelection = useCallback(() => {
		setImportSelected({});
	}, []);

	const runImportSelectedPresets = useCallback(async () => {
		const ids = Object.entries(importSelected)
			.filter(([, v]) => v)
			.map(([k]) => k);
		if (ids.length === 0) {
			alert('Select at least one template.');
			return;
		}
		setImportSubmitting(true);
		try {
			const result = await importProviderPresets(ids);
			if (result.success) {
				const { created, failed } = result.data;
				const failLines =
					failed.length > 0
						? `\nFailed:\n${failed.map((f) => `  ${f.id}: ${f.message}`).join('\n')}`
						: '';
				alert(`Import finished.\nCreated: ${created}${failLines}`);
				setShowImportModal(false);
				void refreshProviders();
			} else {
				alert(result.message);
			}
		} catch (error) {
			console.error('Import providers error:', error);
			alert('Import failed');
		} finally {
			setImportSubmitting(false);
		}
	}, [importSelected, refreshProviders]);

	const handleSave = useCallback(async () => {
		setSaveError('');
		setIsSaving(true);
		try {
			const result = await saveProvider(formData, editingProvider?.id ?? null);
			if (result.success) {
				setShowModal(false);
				void refreshProviders();
			} else {
				setSaveError(result.message);
			}
		} catch (error) {
			console.error('Save error:', error);
			setSaveError('Save failed, please try again');
		} finally {
			setIsSaving(false);
		}
	}, [editingProvider?.id, formData, refreshProviders]);

	const closeProviderModal = useCallback(() => {
		if (isSaving || isDeleting) return;
		setShowModal(false);
	}, [isDeleting, isSaving]);

	return {
		isLoading,
		providers,
		providerSearch,
		setProviderSearch,
		filteredProviders,
		pendingKeyCount,
		providerOverview,
		copiedId,
		expandedProviderIds,
		providerKeyPreviewById,
		keyPreviewLoadingId,
		keyPreviewErrorById,
		isExpandingProviderKeys,
		providerKeyTogglingId,
		showModal,
		editingProvider,
		duplicateSourceId,
		formData,
		setFormData,
		saveError,
		isSaving,
		isDeleting,
		showImportModal,
		setShowImportModal,
		importCatalogRows,
		importCatalogSearch,
		setImportCatalogSearch,
		filteredImportCatalogRows,
		importCatalogLoading,
		importCatalogError,
		importSelected,
		importSelectedCount,
		importSubmitting,
		editingProviderKey,
		addingProviderKeyFor,
		keyEditForm,
		setKeyEditForm,
		keyEditSaving,
		keyEditDeleting,
		keyEditError,
		handleCreate,
		handleEdit,
		handleDuplicate,
		handleDelete,
		handleSave,
		closeProviderModal,
		openImportModal,
		toggleImportPreset,
		selectAllImportPresets,
		clearImportPresetSelection,
		runImportSelectedPresets,
		copyToClipboard,
		handleToggleProviderKeyPreview,
		handleExpandVisibleProviderKeys,
		handleCollapseVisibleProviderKeys,
		handleCopyProviderKey,
		handleToggleProviderKeyStatus,
		openProviderKeyEditor,
		openProviderKeyCreator,
		closeProviderKeyEditor,
		handleSaveProviderKeyEdit,
		handleDeleteProviderKeyFromEditor,
	};
}
