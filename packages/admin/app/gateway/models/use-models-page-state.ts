'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { parseModelModalitiesJson } from '@octafuse/core/db/model-modalities';
import { resolveModelKind } from '@octafuse/core/db/model-kind';
import { modelLifecycleMatchesFilter } from '@/lib/model-lifecycle';
import {
	createDefaultAudioCharacterPricingDraft,
	createDefaultAudioPricingDraft,
	createDefaultAudioTokenPricingDraft,
	createDefaultImagePerImageDraft,
	createDefaultEmbeddingTierRow,
	createDefaultImageTokenTierRow,
	createDefaultNewModelTierRow,
	draftRowsHaveImageTokenPrices,
	draftRowsLookLikeImageOnly,
	profileJsonToAudioDraftState,
	profileJsonToCatalogScheduleDraft,
	profileJsonToDraftState,
	type AudioPricingDraftState,
	type CatalogScheduleFormWindow,
	type ImageBillingModeDraft,
	type ImagePerImageDraft,
	type ImagePricingDraftState,
	type PricingTierDraftRow,
} from '@/lib/pricing-tiers-draft';
import { getModelVendorLabel, normalizeModelVendorInput } from '@/lib/model-vendor';
import { useFeedback } from '@/components/feedback';
import { emptyModelKindCounts } from '@/lib/invoke-kind';
import type { ModelSyncReport } from '@/lib/model-sync-diff';
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
import { modelFormForDuplicate } from './model-duplicate';
import {
	formatMetadataForEditor,
	groupModelsByVendor,
	parseVendorFilterParam,
} from './model-utils';
import {
	ALL_VENDORS_KEY,
	DEFAULT_KIND_FILTER,
	DEFAULT_IMPORT_LIFECYCLE_FILTER,
	DEFAULT_MODEL_LIFECYCLE_FILTER,
	DEFAULT_MODEL_LIST_KIND_FILTER,
	EMPTY_ASR_MODEL_FORM,
	EMPTY_TTS_MODEL_FORM,
	EMPTY_EMBEDDING_MODEL_FORM,
	EMPTY_IMAGE_MODEL_FORM,
	EMPTY_MODEL_FORM,
	parseModelLifecycleFilterParam,
	parseModelListKindFilterParam,
	type ModelFormData,
	type ModelFormKind,
	type ModelKindFilter,
	type ModelLifecycleFilter,
	type ModelListKindFilter,
	type ModelListItem,
	type PresetCatalogRow,
} from './types';

export function useModelsPageState() {
	const tCatalog = useTranslations('models.catalog');
	const tImport = useTranslations('models.import');
	const tModal = useTranslations('models.modal');
	const tCommon = useTranslations('common');
	const { notify, confirm } = useFeedback();
	const searchParams = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();
	const editDeepLinkHandledRef = useRef<string | null>(null);
	const editLoadGenRef = useRef(0);
	const [rawModels, setModels] = useState<ModelListItem[]>([]);
	/** 管理员手动「检查官方更新」的结果；null = 还没检查过。 */
	const [officialReport, setOfficialReport] = useState<ModelSyncReport | null>(null);
	// 差异只在手动检查后才有；把结果合并到卡片，供更新图标使用。
	const models = useMemo(() => {
		if (!officialReport) return rawModels;
		const counts = new Map<string, number>();
		for (const group of officialReport.groups) {
			for (const entry of group.models) counts.set(entry.model_id, entry.fields.length);
		}
		return rawModels.map((model) => ({ ...model, official_update_count: counts.get(model.id) ?? 0 }));
	}, [rawModels, officialReport]);

	const [selectedVendor, setSelectedVendor] = useState(ALL_VENDORS_KEY);
	const [selectedKind, setSelectedKind] = useState<ModelListKindFilter>(DEFAULT_MODEL_LIST_KIND_FILTER);
	const [selectedLifecycle, setSelectedLifecycle] = useState<ModelLifecycleFilter>(
		DEFAULT_MODEL_LIFECYCLE_FILTER
	);
	const [isLoading, setIsLoading] = useState(true);
	const [showModal, setShowModal] = useState(false);
	const [editingModel, setEditingModel] = useState<ModelListItem | null>(null);
	const [duplicateSourceModelId, setDuplicateSourceModelId] = useState<string | null>(null);
	const [formData, setFormData] = useState<ModelFormData>(EMPTY_MODEL_FORM);
	const [formKind, setFormKind] = useState<ModelFormKind>('llm');
	const [pricingTierRows, setPricingTierRows] = useState<PricingTierDraftRow[]>([]);
	const [catalogScheduleWindows, setCatalogScheduleWindows] = useState<CatalogScheduleFormWindow[]>(
		[]
	);
	const [imageBillingMode, setImageBillingMode] = useState<ImageBillingModeDraft>('token');
	const [imagePerImageDraft, setImagePerImageDraft] = useState<ImagePerImageDraft>(
		createDefaultImagePerImageDraft()
	);
	const [audioPricingDraft, setAudioPricingDraft] = useState<AudioPricingDraftState>(
		createDefaultAudioPricingDraft()
	);
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
	const [importCatalogLifecycle, setImportCatalogLifecycle] = useState<ModelLifecycleFilter>(
		DEFAULT_IMPORT_LIFECYCLE_FILTER
	);
	const [importSubmitting, setImportSubmitting] = useState(false);
	const { currency: billingCurrency } = useBillingCurrency();

	const importSelectedCount = useMemo(
		() => Object.values(importSelected).filter(Boolean).length,
		[importSelected]
	);

	const existingModelIds = useMemo(() => new Set(models.map((m) => m.id)), [models]);

	const importableCatalogCount = useMemo(
		() => importCatalogRows.filter((r) => !existingModelIds.has(r.id)).length,
		[importCatalogRows, existingModelIds]
	);

	const lifecycleScopedImportRows = useMemo(
		() => importCatalogRows.filter((row) => modelLifecycleMatchesFilter(row.retired, importCatalogLifecycle)),
		[importCatalogRows, importCatalogLifecycle]
	);

	const importCatalogLifecycleCounts = useMemo(() => {
		const counts = { all: importCatalogRows.length, active: 0, retired: 0 };
		for (const row of importCatalogRows) {
			counts[modelLifecycleMatchesFilter(row.retired, 'retired') ? 'retired' : 'active'] += 1;
		}
		return counts;
	}, [importCatalogRows]);

	const importCatalogKindCounts = useMemo(() => {
		const counts = emptyModelKindCounts();
		for (const row of lifecycleScopedImportRows) counts[row.kind] += 1;
		return counts;
	}, [lifecycleScopedImportRows]);

	const filteredImportCatalogRows = useMemo(() => {
		const query = importCatalogSearch.trim().toLowerCase();
		return lifecycleScopedImportRows.filter((row) => {
			if (row.kind !== importCatalogKind) return false;
			if (!query) return true;
			const id = row.id.toLowerCase();
			const name = (row.display_name ?? '').toLowerCase();
			const vendor = row.vendor.toLowerCase();
			const description = [
				row.description ?? '',
				row.i18n?.en ?? '',
				row.i18n?.zh ?? '',
			]
				.join(' ')
				.toLowerCase();
			return id.includes(query) || name.includes(query) || vendor.includes(query) || description.includes(query);
		});
	}, [importCatalogSearch, importCatalogKind, lifecycleScopedImportRows]);

	const lifecycleFilteredModels = useMemo(
		() => models.filter((m) => modelLifecycleMatchesFilter(m.retired_at, selectedLifecycle)),
		[models, selectedLifecycle]
	);

	const lifecycleCounts = useMemo(() => {
		const counts = { active: 0, retired: 0 };
		for (const m of models) {
			counts[modelLifecycleMatchesFilter(m.retired_at, 'retired') ? 'retired' : 'active'] += 1;
		}
		return counts;
	}, [models]);

	const kindFilteredModels = useMemo(() => {
		if (selectedKind === 'all') return lifecycleFilteredModels;
		return lifecycleFilteredModels.filter((m) => resolveModelKind(m) === selectedKind);
	}, [lifecycleFilteredModels, selectedKind]);

	const modelsByVendor = useMemo(
		() => groupModelsByVendor(kindFilteredModels),
		[kindFilteredModels]
	);

	const vendorKeys = useMemo(() => modelsByVendor.map(([key]) => key), [modelsByVendor]);

	const kindCounts = useMemo(() => {
		const counts = emptyModelKindCounts();
		for (const m of lifecycleFilteredModels) counts[resolveModelKind(m)] += 1;
		return counts;
	}, [lifecycleFilteredModels]);

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
			setSelectedKind(parseModelListKindFilterParam(kindParam));
		}
		const lifecycleParam = searchParams.get('lifecycle');
		if (lifecycleParam !== null) {
			setSelectedLifecycle(parseModelLifecycleFilterParam(lifecycleParam));
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
		if (selectedLifecycle !== DEFAULT_MODEL_LIFECYCLE_FILTER) params.set('lifecycle', selectedLifecycle);
		return params;
	}, [selectedVendor, selectedKind, selectedLifecycle]);

	/** 不切换整页 loading 的静默刷新（同步面板应用后用，避免面板被卸载）。 */
	const reloadModelsQuietly = useCallback(async () => {
		try {
			setModels(await fetchModelsList());
		} catch (error) {
			console.error('Fetch models error:', error);
		}
	}, []);

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
		setImportCatalogLifecycle(DEFAULT_IMPORT_LIFECYCLE_FILTER);
		// 导入表格按单一类型显示对应计费列；模型目录选“全部”时从 LLM 目录开始。
		setImportCatalogKind(selectedKind === 'all' ? DEFAULT_KIND_FILTER : selectedKind);
		setImportSelected({});
		void loadImportCatalog();
	}, [loadImportCatalog, selectedKind]);

	const unpricedImportIds = useMemo(
		() => new Set(importCatalogRows.filter((r) => !r.pricing_available).map((r) => r.id)),
		[importCatalogRows]
	);

	const toggleImportPreset = useCallback(
		(id: string) => {
			if (existingModelIds.has(id) || unpricedImportIds.has(id)) return;
			setImportSelected((prev) => ({ ...prev, [id]: !prev[id] }));
		},
		[existingModelIds, unpricedImportIds]
	);

	const selectAllImportPresets = useCallback(() => {
		setImportSelected((prev) => {
			const next = { ...prev };
			for (const row of filteredImportCatalogRows) {
				if (!existingModelIds.has(row.id) && row.pricing_available) {
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
			.filter((r) => importSelected[r.id] && !existingModelIds.has(r.id) && r.pricing_available)
			.map((r) => r.id);
		if (ids.length === 0) {
			notify('error', tImport('selectNone'));
			return;
		}
		setImportSubmitting(true);
		try {
			const result = await importModelPresets(ids);
			if (result.success) {
				const { created, failed, skipped_existing } = result.data;
				const skipN = skipped_existing?.length ?? 0;
				const failN = failed.length;
				const detail = [
					failN > 0 ? failed.map((f) => `${f.id}: ${f.message}`).join('\n') : '',
					skipN > 0 && skipN <= 5 ? skipped_existing!.join(', ') : '',
				]
					.filter(Boolean)
					.join('\n');
				const message =
					failN > 0
						? tImport('finishedWithFail', { created, failed: failN })
						: skipN > 0
							? tImport('finishedWithSkip', { created, skipped: skipN })
							: tImport('finished', { created });
				notify(failN > 0 ? 'error' : 'success', message, detail || undefined);
				setShowImportCatalogModal(false);
				await refreshModels();
			} else {
				notify('error', result.message || tImport('failed'));
			}
		} catch (e) {
			console.error('Import models error:', e);
			notify('error', tImport('failed'));
		} finally {
			setImportSubmitting(false);
		}
	}, [existingModelIds, importCatalogRows, importSelected, notify, refreshModels, tImport]);

	const applyImagePricingDraft = useCallback((draft: ImagePricingDraftState) => {
		setImageBillingMode(draft.mode);
		setPricingTierRows(draft.tiers);
		setImagePerImageDraft(draft.perImage);
	}, []);

	const fillFormFromModel = useCallback(
		(model: ModelListItem) => {
			const listTags = Array.isArray(model.tags) ? model.tags : [];
			const outputMods = parseModelModalitiesJson(model.output_modalities) ?? ['text'];
			const kind: ModelFormKind = resolveModelKind({
				input_modalities: model.input_modalities,
				output_modalities: model.output_modalities,
				pricing_profile: model.pricing_profile,
			});
			const imageModel = kind === 'image';
			const audioModel = kind === 'asr' || kind === 'tts';
			const embeddingModel = kind === 'embedding';
			setFormKind(kind);
			setFormData({
				id: model.id,
				display_name: model.display_name || '',
				vendor: normalizeModelVendorInput(model.vendor),
				context_window: imageModel || audioModel ? '' : model.context_window?.toString() || '',
				max_tokens: imageModel || audioModel || embeddingModel ? '' : model.max_tokens?.toString() || '4096',
				input_modalities: parseModelModalitiesJson(model.input_modalities) ?? ['text'],
				output_modalities: outputMods,
				released_at: model.released_at ?? '',
				tags: listTags,
				description: model.description ?? '',
				metadata: formatMetadataForEditor(model.metadata),
			});
			if (audioModel) {
				setAudioPricingDraft(profileJsonToAudioDraftState(model.pricing_profile));
				setPricingTierRows([]);
			} else {
				applyImagePricingDraft(profileJsonToDraftState(model.pricing_profile));
			}
			setCatalogScheduleWindows(profileJsonToCatalogScheduleDraft(model.pricing_profile));
		},
		[applyImagePricingDraft]
	);

	const handleImageBillingModeChange = useCallback((mode: ImageBillingModeDraft) => {
		setImageBillingMode(mode);
		if (mode === 'per_image') {
			setPricingTierRows([]);
			return;
		}
		setPricingTierRows((rows) =>
			draftRowsHaveImageTokenPrices(rows) ? rows : [createDefaultImageTokenTierRow()]
		);
	}, []);

	const handleCreate = useCallback(
		(presetVendorKey?: string, kind: ModelFormKind = 'llm') => {
			editLoadGenRef.current += 1;
			setEditingModel(null);
			setDuplicateSourceModelId(null);
			setFormKind(kind);
			const vendor =
				presetVendorKey !== undefined ? presetVendorKey : EMPTY_MODEL_FORM.vendor;
			if (kind === 'image') {
				setFormData({
					...EMPTY_IMAGE_MODEL_FORM,
					vendor,
				});
				applyImagePricingDraft({
					mode: 'token',
					tiers: [createDefaultImageTokenTierRow()],
					perImage: createDefaultImagePerImageDraft(),
				});
			} else if (kind === 'embedding') {
				setFormData({
					...EMPTY_EMBEDDING_MODEL_FORM,
					vendor,
				});
				setPricingTierRows([createDefaultEmbeddingTierRow()]);
			} else if (kind === 'asr' || kind === 'tts') {
				setFormData({
					...(kind === 'tts' ? EMPTY_TTS_MODEL_FORM : EMPTY_ASR_MODEL_FORM),
					vendor,
				});
				setAudioPricingDraft(
					kind === 'tts' ? createDefaultAudioCharacterPricingDraft() : createDefaultAudioPricingDraft()
				);
				setPricingTierRows([]);
			} else {
				setFormData({
					...EMPTY_MODEL_FORM,
					vendor,
				});
				setPricingTierRows([createDefaultNewModelTierRow()]);
			}
			setCatalogScheduleWindows([]);
			setShowModal(true);
			setSaveError('');
		},
		[applyImagePricingDraft]
	);

	/** 切换 Kind：同步 modalities / token 字段，并在无对应单价时写入默认档。 */
	const applyFormKind = useCallback((kind: ModelFormKind) => {
		setFormKind(kind);
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
			setImageBillingMode((mode) => {
				if (mode === 'per_image') {
					setPricingTierRows([]);
				} else {
					setPricingTierRows((rows) =>
						draftRowsHaveImageTokenPrices(rows) ? rows : [createDefaultImageTokenTierRow()]
					);
				}
				return mode;
			});
			return;
		}
		if (kind === 'embedding') {
			setFormData((prev) => ({
				...prev,
				input_modalities: ['text'],
				output_modalities: ['embedding'],
				max_tokens: '',
			}));
			setPricingTierRows((rows) =>
				rows.length === 0 || draftRowsLookLikeImageOnly(rows) ? [createDefaultEmbeddingTierRow()] : rows
			);
			return;
		}
		if (kind === 'asr') {
			// ASR：输入 audio、输出 text；计费按秒或 token。
			setFormData((prev) => ({
				...prev,
				input_modalities: ['audio'],
				output_modalities: ['text'],
				context_window: '',
				max_tokens: '',
			}));
			setAudioPricingDraft((prev) => {
				if (prev.mode === 'per_character') return createDefaultAudioPricingDraft();
				if (prev.mode === 'token') {
					const hasTier = prev.tiers.some(
						(r) => r.input_price.trim() !== '' || r.output_price.trim() !== ''
					);
					return hasTier ? prev : createDefaultAudioTokenPricingDraft();
				}
				return prev.price_per_second.trim() !== '' ? prev : createDefaultAudioPricingDraft();
			});
			setPricingTierRows([]);
			return;
		}
		if (kind === 'tts') {
			// TTS：输入 text、输出 audio；只支持按字符计费。
			setFormData((prev) => ({
				...prev,
				input_modalities: ['text'],
				output_modalities: ['audio'],
				context_window: '',
				max_tokens: '',
			}));
			setAudioPricingDraft((prev) =>
				prev.mode === 'per_character' && prev.price_per_character.trim() !== ''
					? prev
					: createDefaultAudioCharacterPricingDraft()
			);
			setPricingTierRows([]);
			return;
		}
		setFormData((prev) => {
			const withoutImage = prev.output_modalities.filter((m) => m !== 'image' && m !== 'embedding');
			const input = prev.input_modalities.includes('text')
				? prev.input_modalities
				: ['text', ...prev.input_modalities.filter((m) => m !== 'audio')];
			return {
				...prev,
				input_modalities: input.length > 0 ? input : ['text'],
				output_modalities: withoutImage.length > 0 ? withoutImage : ['text'],
				max_tokens: prev.max_tokens.trim() !== '' ? prev.max_tokens : '8192',
			};
		});
		setPricingTierRows((rows) =>
			rows.length === 0 || draftRowsLookLikeImageOnly(rows)
				? [createDefaultNewModelTierRow()]
				: rows
		);
	}, []);

	const handleEdit = useCallback(
		async (model: ModelListItem) => {
			const loadGen = ++editLoadGenRef.current;
			setDuplicateSourceModelId(null);
			setEditingModel(model);
			fillFormFromModel(model);
			try {
				const fullModel = await fetchModelDetail(model.id);
				if (editLoadGenRef.current !== loadGen) return;
				setEditingModel(fullModel);
				fillFormFromModel(fullModel);
			} catch (error) {
				if (editLoadGenRef.current !== loadGen) return;
				console.error('Fetch model details error:', error);
			}
			if (editLoadGenRef.current !== loadGen) return;
			setShowModal(true);
			setSaveError('');
		},
		[fillFormFromModel]
	);

	const handleDuplicate = useCallback(() => {
		if (!editingModel) return;
		editLoadGenRef.current += 1;
		const sourceId = editingModel.id;
		setDuplicateSourceModelId(sourceId);
		setEditingModel(null);
		setFormData((current) =>
			modelFormForDuplicate(current, (name) => tModal('copyDisplayName', { name }))
		);
		setPricingTierRows((rows) => structuredClone(rows));
		setCatalogScheduleWindows((windows) => structuredClone(windows));
		setImagePerImageDraft((draft) => structuredClone(draft));
		setAudioPricingDraft((draft) => structuredClone(draft));
		setTagInput('');
		setSaveError('');
	}, [editingModel, tModal]);

	/** Routes 等入口可通过 `?edit=<model_id>` 直接打开编辑弹窗。 */
	useEffect(() => {
		if (isLoading) return;
		const editId = searchParams.get('edit')?.trim() ?? '';
		if (!editId) {
			editDeepLinkHandledRef.current = null;
			return;
		}
		if (editDeepLinkHandledRef.current === editId) return;

		const clearEditParam = () => {
			const params = new URLSearchParams(searchParams.toString());
			if (!params.has('edit')) return;
			params.delete('edit');
			const qs = params.toString();
			router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
		};

		const model = models.find((m) => m.id === editId);
		editDeepLinkHandledRef.current = editId;
		if (!model) {
			console.warn(`Model deep-link edit id not found: ${editId}`);
			clearEditParam();
			return;
		}

		setSelectedKind(resolveModelKind(model));
		const vendor = normalizeModelVendorInput(model.vendor);
		if (vendor) setSelectedVendor(vendor);
		void handleEdit(model);
		clearEditParam();
	}, [handleEdit, isLoading, models, pathname, router, searchParams]);

	const handleDelete = useCallback(
		async (id: string) => {
			const ok = await confirm({
				title: tModal('deleteModel'),
				message: tModal('confirmDelete'),
				confirmLabel: tCommon('delete'),
				danger: true,
			});
			if (!ok) return;

			setIsDeleting(true);
			try {
				const result = await deleteModel(id);
				if (result.success) {
					setShowModal(false);
					setEditingModel(null);
					setDuplicateSourceModelId(null);
					void refreshModels();
				} else {
					notify('error', result.message || tCommon('failed'));
				}
			} catch (error) {
				console.error('Delete error:', error);
				notify('error', tCommon('failed'));
			} finally {
				setIsDeleting(false);
			}
		},
		[confirm, notify, refreshModels, tCommon, tModal]
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
				if (kind === 'output_modalities' && modality === 'embedding') {
					// Embedding 与其它输出模态互斥
					return prev.output_modalities.includes('embedding')
						? { ...prev, output_modalities: ['text'] }
						: { ...prev, output_modalities: ['embedding'], max_tokens: '' };
				}
				const current =
					kind === 'output_modalities' ? prev[kind].filter((m) => m !== 'embedding') : prev[kind];
				const next = current.includes(modality)
					? current.filter((m) => m !== modality)
					: [...current, modality];
				const nextList = next.length > 0 ? next : [modality];
				if (kind === 'output_modalities' && nextList.includes('image')) {
					setImageBillingMode((mode) => {
						if (mode === 'per_image') {
							setPricingTierRows([]);
						} else {
							setPricingTierRows((rows) =>
								draftRowsHaveImageTokenPrices(rows)
									? rows
									: [createDefaultImageTokenTierRow()]
							);
						}
						return mode;
					});
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
			const isImage = formKind === 'image';
			const isAudio = formKind === 'asr' || formKind === 'tts';
			const imageDraft =
				isImage && !isAudio
					? {
							mode: imageBillingMode,
							tiers: pricingTierRows,
							perImage: imagePerImageDraft,
						}
					: null;
			const audioDraft = isAudio ? audioPricingDraft : null;
			const result = await saveModel(
				formData,
				pricingTierRows,
				editingModel?.id ?? null,
				imageDraft,
				audioDraft,
				catalogScheduleWindows
			);
			if (result.success) {
				setShowModal(false);
				setEditingModel(null);
				setDuplicateSourceModelId(null);
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
	}, [
		audioPricingDraft,
		catalogScheduleWindows,
		editingModel,
		formData,
		formKind,
		imageBillingMode,
		imagePerImageDraft,
		pricingTierRows,
		refreshModels,
	]);

	const closeModal = useCallback(() => {
		if (isSaving || isDeleting) return;
		setShowModal(false);
	}, [isDeleting, isSaving]);

	const clearFilters = useCallback(() => {
		setSelectedVendor(ALL_VENDORS_KEY);
		setSelectedKind(DEFAULT_MODEL_LIST_KIND_FILTER);
		setSelectedLifecycle(DEFAULT_MODEL_LIFECYCLE_FILTER);
	}, []);

	const isAllVendors = selectedVendor === ALL_VENDORS_KEY;
	const activeVendorKey = isAllVendors ? (vendorKeys[0] ?? 'other') : selectedVendor || vendorKeys[0] || 'other';
	const activeVendorTitle = isAllVendors ? tCatalog('allVendors') : getModelVendorLabel(activeVendorKey);
	const hasVendorFilter = !isAllVendors;
	const hasActiveFilter =
		hasVendorFilter ||
		selectedKind !== DEFAULT_MODEL_LIST_KIND_FILTER ||
		selectedLifecycle !== DEFAULT_MODEL_LIFECYCLE_FILTER;

	return {
		isLoading,
		models,
		selectedVendor,
		setSelectedVendor,
		selectedKind,
		setSelectedKind,
		selectedLifecycle,
		setSelectedLifecycle,
		lifecycleCounts,
		lifecycleFilteredCount: lifecycleFilteredModels.length,
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
		duplicateSourceModelId,
		formData,
		setFormData,
		formKind,
		pricingTierRows,
		setPricingTierRows,
		catalogScheduleWindows,
		setCatalogScheduleWindows,
		imageBillingMode,
		setImageBillingMode: handleImageBillingModeChange,
		imagePerImageDraft,
		setImagePerImageDraft,
		audioPricingDraft,
		setAudioPricingDraft,
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
		importCatalogLifecycle,
		setImportCatalogLifecycle,
		importCatalogLifecycleCounts,
		filteredImportCatalogRows,
		importCatalogLoading,
		importCatalogError,
		importSelected,
		importSelectedCount,
		importableCatalogCount,
		importSubmitting,
		existingModelIds,
		openImportCatalogModal,
		loadImportCatalog,
		toggleImportPreset,
		selectAllImportPresets,
		clearImportPresetSelection,
		runImportSelectedPresets,
		handleCreate,
		applyFormKind,
		handleEdit,
		handleDuplicate,
		handleDelete,
		handleAddTag,
		handleRemoveTag,
		toggleFormModality,
		handleSave,
		closeModal,
		refreshModels,
		reloadModelsQuietly,
		officialReport,
		setOfficialReport,
	};
}
