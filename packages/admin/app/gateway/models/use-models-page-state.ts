'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { parseModelModalitiesJson } from '@octafuse/core/db/model-modalities';
import {
	createDefaultNewModelTierRow,
	profileJsonToDraftRows,
	type PricingTierDraftRow,
} from '@/lib/pricing-tiers-draft';
import { getModelVendorLabel, normalizeModelVendorInput } from '@/lib/model-vendor';
import { useBillingCurrency } from '@/lib/use-billing-currency';
import { useReplaceListPageQuery } from '@/lib/use-replace-list-query';
import {
	deleteModel,
	fetchImportCatalog,
	fetchModelDetail,
	fetchModelsList,
	importModelPresets,
	saveModel,
} from './model-api';
import {
	buildMetadataSummary,
	formatMetadataForEditor,
	groupModelsByVendor,
	parseVendorFilterParam,
} from './model-utils';
import {
	ALL_VENDORS_KEY,
	EMPTY_MODEL_FORM,
	type MetadataPreviewState,
	type ModelFormData,
	type ModelListItem,
	type PresetCatalogRow,
} from './types';

export function useModelsPageState() {
	const tCatalog = useTranslations('models.catalog');
	const searchParams = useSearchParams();
	const [models, setModels] = useState<ModelListItem[]>([]);
	const [selectedVendor, setSelectedVendor] = useState(ALL_VENDORS_KEY);
	const [isLoading, setIsLoading] = useState(true);
	const [showModal, setShowModal] = useState(false);
	const [editingModel, setEditingModel] = useState<ModelListItem | null>(null);
	const [formData, setFormData] = useState<ModelFormData>(EMPTY_MODEL_FORM);
	const [pricingTierRows, setPricingTierRows] = useState<PricingTierDraftRow[]>([]);
	const [tagInput, setTagInput] = useState('');
	const [saveError, setSaveError] = useState('');
	const [isSaving, setIsSaving] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);
	const [showImportCatalogModal, setShowImportCatalogModal] = useState(false);
	const [importCatalogRows, setImportCatalogRows] = useState<PresetCatalogRow[]>([]);
	const [importCatalogLoading, setImportCatalogLoading] = useState(false);
	const [importCatalogError, setImportCatalogError] = useState('');
	const [importSelected, setImportSelected] = useState<Record<string, boolean>>({});
	const [importCatalogSearch, setImportCatalogSearch] = useState('');
	const [importSubmitting, setImportSubmitting] = useState(false);
	const [metadataPreview, setMetadataPreview] = useState<MetadataPreviewState | null>(null);
	const { currency: billingCurrency } = useBillingCurrency();

	const openMetadataPreview = useCallback((model: ModelListItem) => {
		const summary = buildMetadataSummary(model.metadata);
		if (summary.kind === 'empty') return;
		setMetadataPreview({ model, summary });
	}, []);

	const importSelectedCount = useMemo(
		() => Object.values(importSelected).filter(Boolean).length,
		[importSelected]
	);

	const existingModelIds = useMemo(() => new Set(models.map((m) => m.id)), [models]);

	const importableCatalogCount = useMemo(
		() => importCatalogRows.filter((r) => !existingModelIds.has(r.id)).length,
		[importCatalogRows, existingModelIds]
	);

	const filteredImportCatalogRows = useMemo(() => {
		const query = importCatalogSearch.trim().toLowerCase();
		if (!query) return importCatalogRows;
		return importCatalogRows.filter((row) => {
			const id = row.id.toLowerCase();
			const name = (row.display_name ?? '').toLowerCase();
			return id.includes(query) || name.includes(query);
		});
	}, [importCatalogSearch, importCatalogRows]);

	const modelsByVendor = useMemo(() => groupModelsByVendor(models), [models]);

	const vendorKeys = useMemo(() => modelsByVendor.map(([key]) => key), [modelsByVendor]);

	const selectedVendorItems = useMemo(() => {
		if (selectedVendor === ALL_VENDORS_KEY) {
			return modelsByVendor.flatMap(([, items]) => items);
		}
		const entry = modelsByVendor.find(([key]) => key === selectedVendor);
		return entry?.[1] ?? [];
	}, [modelsByVendor, selectedVendor]);

	useEffect(() => {
		const vendorParam = searchParams.get('vendor');
		if (vendorParam !== null) {
			setSelectedVendor(parseVendorFilterParam(vendorParam));
		}
	}, [searchParams]);

	useEffect(() => {
		if (modelsByVendor.length === 0) return;
		setSelectedVendor((prev) => {
			if (prev === ALL_VENDORS_KEY) return ALL_VENDORS_KEY;
			if (prev && vendorKeys.includes(prev)) return prev;
			const fromUrl = searchParams.get('vendor');
			if (fromUrl !== null) {
				const parsed = parseVendorFilterParam(fromUrl);
				if (parsed === ALL_VENDORS_KEY) return ALL_VENDORS_KEY;
				if (vendorKeys.includes(parsed)) return parsed;
			}
			return ALL_VENDORS_KEY;
		});
	}, [modelsByVendor, vendorKeys, searchParams]);

	useReplaceListPageQuery(() => {
		const params = new URLSearchParams();
		if (selectedVendor) params.set('vendor', selectedVendor);
		return params;
	}, [selectedVendor]);

	const refreshModels = useCallback(async () => {
		try {
			setIsLoading(true);
			const rows = await fetchModelsList();
			setModels(rows);
		} catch (error) {
			console.error('Fetch models error:', error);
		} finally {
			setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		void refreshModels();
	}, [refreshModels]);

	useEffect(() => {
		if (!showImportCatalogModal || importCatalogRows.length === 0) return;
		setImportSelected((prev) => {
			let changed = false;
			const next = { ...prev };
			for (const k of Object.keys(next)) {
				if (!next[k]) continue;
				if (existingModelIds.has(k)) {
					delete next[k];
					changed = true;
				}
			}
			return changed ? next : prev;
		});
	}, [showImportCatalogModal, importCatalogRows, existingModelIds]);

	const loadImportCatalog = useCallback(async () => {
		setImportCatalogLoading(true);
		setImportCatalogError('');
		try {
			const rows = await fetchImportCatalog();
			setImportCatalogRows(rows);
			setImportSelected({});
		} catch (e) {
			console.error('Load import catalog error:', e);
			setImportCatalogError(e instanceof Error ? e.message : 'Failed to load catalog');
			setImportCatalogRows([]);
		} finally {
			setImportCatalogLoading(false);
		}
	}, []);

	const openImportCatalogModal = useCallback(() => {
		setShowImportCatalogModal(true);
		setImportCatalogError('');
		setImportCatalogSearch('');
		setImportSelected({});
		void loadImportCatalog();
	}, [loadImportCatalog]);

	const toggleImportPreset = useCallback(
		(id: string) => {
			if (existingModelIds.has(id)) return;
			setImportSelected((prev) => ({ ...prev, [id]: !prev[id] }));
		},
		[existingModelIds]
	);

	const selectAllImportPresets = useCallback(() => {
		setImportSelected((prev) => {
			const next = { ...prev };
			for (const row of filteredImportCatalogRows) {
				if (!existingModelIds.has(row.id)) {
					next[row.id] = true;
				}
			}
			return next;
		});
	}, [filteredImportCatalogRows, existingModelIds]);

	const clearImportPresetSelection = useCallback(() => {
		setImportSelected({});
	}, []);

	const runImportSelectedPresets = useCallback(async () => {
		const ids = importCatalogRows
			.filter((r) => importSelected[r.id] && !existingModelIds.has(r.id))
			.map((r) => r.id);
		if (ids.length === 0) {
			alert('Select at least one preset that is not already in the gateway.');
			return;
		}
		if (
			!confirm(
				`Import ${ids.length} new model(s)? Prices use the catalog’s ${billingCurrency} branch (USD/CNY tiers). Existing model IDs are never overwritten.`
			)
		) {
			return;
		}
		setImportSubmitting(true);
		try {
			const result = await importModelPresets(ids);
			if (result.success) {
				const { created, failed, billing_currency_used, skipped_existing } = result.data;
				const skipN = skipped_existing?.length ?? 0;
				const failLines =
					failed.length > 0
						? `\n\nFailed (${failed.length}):\n${failed.map((f) => `${f.id}: ${f.message}`).join('\n')}`
						: '';
				const skipLines =
					skipN > 0
						? `\nSkipped (already in gateway): ${skipN}${skipN <= 5 ? ` — ${skipped_existing!.join(', ')}` : ''}`
						: '';
				alert(
					`Import finished (billing: ${billing_currency_used}).\nCreated: ${created}${skipLines}${failLines}`
				);
				setShowImportCatalogModal(false);
				await refreshModels();
			} else {
				alert(result.message || 'Import failed');
			}
		} catch (e) {
			console.error('Import models error:', e);
			alert('Import failed');
		} finally {
			setImportSubmitting(false);
		}
	}, [billingCurrency, existingModelIds, importCatalogRows, importSelected, refreshModels]);

	const fillFormFromModel = useCallback((model: ModelListItem) => {
		const listTags = Array.isArray(model.tags) ? model.tags : [];
		setFormData({
			id: model.id,
			display_name: model.display_name || '',
			vendor: normalizeModelVendorInput(model.vendor),
			context_window: model.context_window?.toString() || '',
			max_tokens: model.max_tokens?.toString() || '4096',
			input_modalities: parseModelModalitiesJson(model.input_modalities) ?? ['text'],
			output_modalities: parseModelModalitiesJson(model.output_modalities) ?? ['text'],
			released_at: model.released_at ?? '',
			tags: listTags,
			description: model.description ?? '',
			metadata: formatMetadataForEditor(model.metadata),
		});
		setPricingTierRows(profileJsonToDraftRows(model.pricing_profile));
	}, []);

	const handleCreate = useCallback((presetVendorKey?: string) => {
		setEditingModel(null);
		setFormData({
			...EMPTY_MODEL_FORM,
			vendor: presetVendorKey !== undefined ? presetVendorKey : EMPTY_MODEL_FORM.vendor,
		});
		setPricingTierRows([createDefaultNewModelTierRow()]);
		setShowModal(true);
		setSaveError('');
	}, []);

	const handleEdit = useCallback(
		async (model: ModelListItem) => {
			setEditingModel(model);
			fillFormFromModel(model);
			try {
				const fullModel = await fetchModelDetail(model.id);
				fillFormFromModel(fullModel);
			} catch (error) {
				console.error('Fetch model details error:', error);
			}
			setShowModal(true);
			setSaveError('');
		},
		[fillFormFromModel]
	);

	const handleDelete = useCallback(
		async (id: string) => {
			if (
				!confirm(
					'Are you sure you want to delete this model? This will also delete all associated routes.'
				)
			) {
				return;
			}

			setIsDeleting(true);
			try {
				const result = await deleteModel(id);
				if (result.success) {
					setShowModal(false);
					setEditingModel(null);
					void refreshModels();
				} else {
					alert(result.message || 'Delete failed');
				}
			} catch (error) {
				console.error('Delete error:', error);
				alert('Delete failed');
			} finally {
				setIsDeleting(false);
			}
		},
		[refreshModels]
	);

	const handleAddTag = useCallback(() => {
		const t = tagInput.trim();
		if (t && !formData.tags.includes(t)) {
			setFormData({ ...formData, tags: [...formData.tags, t] });
			setTagInput('');
		}
	}, [formData, tagInput]);

	const handleRemoveTag = useCallback((tag: string) => {
		setFormData((prev) => ({ ...prev, tags: prev.tags.filter((x) => x !== tag) }));
	}, []);

	const toggleFormModality = useCallback(
		(kind: 'input_modalities' | 'output_modalities', modality: string) => {
			setFormData((prev) => {
				const current = prev[kind];
				const next = current.includes(modality)
					? current.filter((m) => m !== modality)
					: [...current, modality];
				return { ...prev, [kind]: next.length > 0 ? next : [modality] };
			});
		},
		[]
	);

	const handleSave = useCallback(async () => {
		setSaveError('');
		setIsSaving(true);
		try {
			const result = await saveModel(formData, pricingTierRows, editingModel?.id ?? null);
			if (result.success) {
				setShowModal(false);
				void refreshModels();
			} else {
				setSaveError(result.message);
			}
		} catch (error) {
			console.error('Save error:', error);
			setSaveError('Save failed, please try again');
		} finally {
			setIsSaving(false);
		}
	}, [editingModel?.id, formData, pricingTierRows, refreshModels]);

	const closeModal = useCallback(() => {
		if (isSaving || isDeleting) return;
		setShowModal(false);
	}, [isDeleting, isSaving]);

	const isAllVendors = selectedVendor === ALL_VENDORS_KEY;
	const activeVendorKey = isAllVendors ? (vendorKeys[0] ?? 'other') : selectedVendor || vendorKeys[0] || 'other';
	const activeVendorTitle = isAllVendors ? tCatalog('allVendors') : getModelVendorLabel(activeVendorKey);
	const hasVendorFilter = !isAllVendors;

	return {
		isLoading,
		models,
		selectedVendor,
		setSelectedVendor,
		selectedVendorItems,
		modelsByVendor,
		isAllVendors,
		activeVendorKey,
		activeVendorTitle,
		hasVendorFilter,
		billingCurrency,
		showModal,
		editingModel,
		formData,
		setFormData,
		pricingTierRows,
		setPricingTierRows,
		tagInput,
		setTagInput,
		saveError,
		isSaving,
		isDeleting,
		showImportCatalogModal,
		setShowImportCatalogModal,
		importCatalogRows,
		importCatalogSearch,
		setImportCatalogSearch,
		filteredImportCatalogRows,
		importCatalogLoading,
		importCatalogError,
		importSelected,
		importSelectedCount,
		importableCatalogCount,
		importSubmitting,
		existingModelIds,
		metadataPreview,
		setMetadataPreview,
		openMetadataPreview,
		openImportCatalogModal,
		loadImportCatalog,
		toggleImportPreset,
		selectAllImportPresets,
		clearImportPresetSelection,
		runImportSelectedPresets,
		handleCreate,
		handleEdit,
		handleDelete,
		handleAddTag,
		handleRemoveTag,
		toggleFormModality,
		handleSave,
		closeModal,
	};
}
