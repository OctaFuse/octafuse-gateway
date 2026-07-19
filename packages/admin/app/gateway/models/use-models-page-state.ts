'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import {
	isImageGenerationModel,
	parseModelModalitiesJson,
} from '@octafuse/core/db/model-modalities';
import {
	createDefaultImageTokenTierRow,
	createDefaultNewModelTierRow,
	draftRowsHaveImageTokenPrices,
	draftRowsLookLikeImageOnly,
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
	DEFAULT_KIND_FILTER,
	EMPTY_IMAGE_MODEL_FORM,
	EMPTY_MODEL_FORM,
	parseKindFilterParam,
	type MetadataPreviewState,
	type ModelFormData,
	type ModelFormKind,
	type ModelKindFilter,
	type ModelListItem,
	type PresetCatalogRow,
} from './types';

export function useModelsPageState() {
	const tCatalog = useTranslations('models.catalog');
	const searchParams = useSearchParams();
	const [models, setModels] = useState<ModelListItem[]>([]);
	const [selectedVendor, setSelectedVendor] = useState(ALL_VENDORS_KEY);
	const [selectedKind, setSelectedKind] = useState<ModelKindFilter>(DEFAULT_KIND_FILTER);
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
	const [importCatalogKind, setImportCatalogKind] = useState<ModelKindFilter>(DEFAULT_KIND_FILTER);
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

	const importCatalogKindCounts = useMemo(() => {
		let llm = 0;
		let image = 0;
		for (const row of importCatalogRows) {
			if (row.kind === 'image') image += 1;
			else llm += 1;
		}
		return { llm, image };
	}, [importCatalogRows]);

	const filteredImportCatalogRows = useMemo(() => {
		const query = importCatalogSearch.trim().toLowerCase();
		return importCatalogRows.filter((row) => {
			if (row.kind !== importCatalogKind) return false;
			if (!query) return true;
			const id = row.id.toLowerCase();
			const name = (row.display_name ?? '').toLowerCase();
			return id.includes(query) || name.includes(query);
		});
	}, [importCatalogSearch, importCatalogKind, importCatalogRows]);

	const kindFilteredModels = useMemo(() => {
		if (selectedKind === 'image') {
			return models.filter((m) => isImageGenerationModel(m));
		}
		return models.filter((m) => !isImageGenerationModel(m));
	}, [models, selectedKind]);

	const modelsByVendor = useMemo(
		() => groupModelsByVendor(kindFilteredModels),
		[kindFilteredModels]
	);

	const vendorKeys = useMemo(() => modelsByVendor.map(([key]) => key), [modelsByVendor]);

	const kindCounts = useMemo(() => {
		let llm = 0;
		let image = 0;
		for (const m of models) {
			if (isImageGenerationModel(m)) image += 1;
			else llm += 1;
		}
		return { llm, image };
	}, [models]);

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
		const kindParam = searchParams.get('kind');
		if (kindParam !== null) {
			setSelectedKind(parseKindFilterParam(kindParam));
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
		params.set('kind', selectedKind);
		return params;
	}, [selectedVendor, selectedKind]);

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
		setImportCatalogKind(selectedKind);
		setImportSelected({});
		void loadImportCatalog();
	}, [loadImportCatalog, selectedKind]);

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
		const outputMods = parseModelModalitiesJson(model.output_modalities) ?? ['text'];
		const imageModel = isImageGenerationModel({
			output_modalities: outputMods,
			pricing_profile: model.pricing_profile,
		});
		setFormData({
			id: model.id,
			display_name: model.display_name || '',
			vendor: normalizeModelVendorInput(model.vendor),
			context_window: imageModel ? '' : model.context_window?.toString() || '',
			max_tokens: imageModel ? '' : model.max_tokens?.toString() || '4096',
			input_modalities: parseModelModalitiesJson(model.input_modalities) ?? ['text'],
			output_modalities: outputMods,
			released_at: model.released_at ?? '',
			tags: listTags,
			description: model.description ?? '',
			metadata: formatMetadataForEditor(model.metadata),
		});
		setPricingTierRows(profileJsonToDraftRows(model.pricing_profile));
	}, []);

	const handleCreate = useCallback(
		(presetVendorKey?: string, kind: ModelFormKind = 'llm') => {
			setEditingModel(null);
			const vendor =
				presetVendorKey !== undefined ? presetVendorKey : EMPTY_MODEL_FORM.vendor;
			if (kind === 'image') {
				setFormData({
					...EMPTY_IMAGE_MODEL_FORM,
					vendor,
				});
				setPricingTierRows([createDefaultImageTokenTierRow()]);
			} else {
				setFormData({
					...EMPTY_MODEL_FORM,
					vendor,
				});
				setPricingTierRows([createDefaultNewModelTierRow()]);
			}
			setShowModal(true);
			setSaveError('');
		},
		[]
	);

	/** 切换 Kind：同步 modalities / token 字段，并在无对应单价时写入默认档。 */
	const applyFormKind = useCallback((kind: ModelFormKind) => {
		if (kind === 'image') {
			setFormData((prev) => ({
				...prev,
				input_modalities: prev.input_modalities.includes('image')
					? prev.input_modalities
					: [...prev.input_modalities, 'image'],
				output_modalities: prev.output_modalities.includes('image')
					? prev.output_modalities
					: ['image'],
				context_window: '',
				max_tokens: '',
			}));
			setPricingTierRows((rows) =>
				draftRowsHaveImageTokenPrices(rows) ? rows : [createDefaultImageTokenTierRow()]
			);
			return;
		}
		setFormData((prev) => {
			const withoutImage = prev.output_modalities.filter((m) => m !== 'image');
			return {
				...prev,
				output_modalities: withoutImage.length > 0 ? withoutImage : ['text'],
				max_tokens: prev.max_tokens.trim() !== '' ? prev.max_tokens : '8192',
			};
		});
		setPricingTierRows((rows) =>
			draftRowsLookLikeImageOnly(rows) ? [createDefaultNewModelTierRow()] : rows
		);
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
				const nextList = next.length > 0 ? next : [modality];
				if (kind === 'output_modalities' && nextList.includes('image')) {
					// 已有 LLM 默认档时也要换成 Image token 默认（此前仅 rows.length===0 才换）
					setPricingTierRows((rows) =>
						draftRowsHaveImageTokenPrices(rows)
							? rows
							: [createDefaultImageTokenTierRow()]
					);
					return {
						...prev,
						[kind]: nextList,
						context_window: '',
						max_tokens: '',
					};
				}
				if (
					kind === 'output_modalities' &&
					!nextList.includes('image') &&
					prev.output_modalities.includes('image')
				) {
					setPricingTierRows((rows) =>
						draftRowsLookLikeImageOnly(rows) ? [createDefaultNewModelTierRow()] : rows
					);
					return {
						...prev,
						[kind]: nextList,
						max_tokens: prev.max_tokens.trim() !== '' ? prev.max_tokens : '8192',
					};
				}
				return { ...prev, [kind]: nextList };
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

	const clearFilters = useCallback(() => {
		setSelectedVendor(ALL_VENDORS_KEY);
	}, []);

	const isAllVendors = selectedVendor === ALL_VENDORS_KEY;
	const activeVendorKey = isAllVendors ? (vendorKeys[0] ?? 'other') : selectedVendor || vendorKeys[0] || 'other';
	const activeVendorTitle = isAllVendors ? tCatalog('allVendors') : getModelVendorLabel(activeVendorKey);
	const hasVendorFilter = !isAllVendors;
	const hasActiveFilter = hasVendorFilter;

	return {
		isLoading,
		models,
		selectedVendor,
		setSelectedVendor,
		selectedKind,
		setSelectedKind,
		kindCounts,
		selectedVendorItems,
		modelsByVendor,
		isAllVendors,
		activeVendorKey,
		activeVendorTitle,
		hasVendorFilter,
		hasActiveFilter,
		clearFilters,
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
		importCatalogKind,
		setImportCatalogKind,
		importCatalogKindCounts,
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
		applyFormKind,
		handleEdit,
		handleDelete,
		handleAddTag,
		handleRemoveTag,
		toggleFormModality,
		handleSave,
		closeModal,
	};
}
