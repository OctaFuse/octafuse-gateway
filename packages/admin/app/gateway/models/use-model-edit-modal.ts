'use client';

import { useCallback, useState } from 'react';
import {
	isAudioModel,
	isImageGenerationModel,
	parseModelModalitiesJson,
} from '@octafuse/core/db/model-modalities';
import {
	createDefaultAudioPricingDraft,
	createDefaultAudioTokenPricingDraft,
	createDefaultImagePerImageDraft,
	createDefaultImageTokenTierRow,
	createDefaultNewModelTierRow,
	draftRowsHaveImageTokenPrices,
	draftRowsLookLikeImageOnly,
	profileJsonToAudioDraftState,
	profileJsonToDraftState,
	type AudioPricingDraftState,
	type ImageBillingModeDraft,
	type ImagePerImageDraft,
	type ImagePricingDraftState,
	type PricingTierDraftRow,
} from '@/lib/pricing-tiers-draft';
import { normalizeModelVendorInput } from '@/lib/model-vendor';
import { useBillingCurrency } from '@/lib/use-billing-currency';
import { deleteModel, fetchModelDetail, saveModel } from './model-api';
import { formatMetadataForEditor } from './model-utils';
import {
	EMPTY_AUDIO_MODEL_FORM,
	EMPTY_IMAGE_MODEL_FORM,
	EMPTY_MODEL_FORM,
	type ModelFormData,
	type ModelFormKind,
	type ModelListItem,
} from './types';

type Options = {
	/** 保存 / 删除成功后回调（例如刷新 Routes / Models 列表） */
	onChanged?: () => void | Promise<void>;
};

function createInitialImagePricingDraft(mode: ImageBillingModeDraft = 'token'): ImagePricingDraftState {
	if (mode === 'per_image') {
		return {
			mode: 'per_image',
			tiers: [],
			perImage: createDefaultImagePerImageDraft(),
		};
	}
	return {
		mode: 'token',
		tiers: [createDefaultImageTokenTierRow()],
		perImage: createDefaultImagePerImageDraft(),
	};
}

/**
 * ModelModal 编辑态：可在 Models 页与 Routes 页复用（Routes 就地弹窗改 Tag 等）。
 */
export function useModelEditModal(options?: Options) {
	const onChanged = options?.onChanged;
	const { currency: billingCurrency } = useBillingCurrency();
	const [showModal, setShowModal] = useState(false);
	const [editingModel, setEditingModel] = useState<ModelListItem | null>(null);
	const [formData, setFormData] = useState<ModelFormData>(EMPTY_MODEL_FORM);
	const [formKind, setFormKind] = useState<ModelFormKind>('llm');
	const [pricingTierRows, setPricingTierRows] = useState<PricingTierDraftRow[]>([]);
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

	const applyImagePricingDraft = useCallback((draft: ImagePricingDraftState) => {
		setImageBillingMode(draft.mode);
		setPricingTierRows(draft.tiers);
		setImagePerImageDraft(draft.perImage);
	}, []);

	const fillFormFromModel = useCallback(
		(model: ModelListItem) => {
			const listTags = Array.isArray(model.tags) ? model.tags : [];
			const outputMods = parseModelModalitiesJson(model.output_modalities) ?? ['text'];
			const imageModel = isImageGenerationModel({
				output_modalities: outputMods,
				pricing_profile: model.pricing_profile,
			});
			const audioModel = isAudioModel({
				pricing_profile: model.pricing_profile,
			});
			const kind: ModelFormKind = audioModel ? 'audio' : imageModel ? 'image' : 'llm';
			setFormKind(kind);
			setFormData({
				id: model.id,
				display_name: model.display_name || '',
				vendor: normalizeModelVendorInput(model.vendor),
				context_window: imageModel || audioModel ? '' : model.context_window?.toString() || '',
				max_tokens: imageModel || audioModel ? '' : model.max_tokens?.toString() || '4096',
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
		},
		[applyImagePricingDraft]
	);

	const handleCreate = useCallback(
		(presetVendorKey?: string, kind: ModelFormKind = 'llm') => {
			setEditingModel(null);
			setFormKind(kind);
			const vendor = presetVendorKey !== undefined ? presetVendorKey : EMPTY_MODEL_FORM.vendor;
			if (kind === 'image') {
				setFormData({
					...EMPTY_IMAGE_MODEL_FORM,
					vendor,
				});
				applyImagePricingDraft(createInitialImagePricingDraft('token'));
			} else if (kind === 'audio') {
				setFormData({
					...EMPTY_AUDIO_MODEL_FORM,
					vendor,
				});
				setAudioPricingDraft(createDefaultAudioPricingDraft());
				setPricingTierRows([]);
			} else {
				setFormData({
					...EMPTY_MODEL_FORM,
					vendor,
				});
				setPricingTierRows([createDefaultNewModelTierRow()]);
				setImageBillingMode('token');
				setImagePerImageDraft(createDefaultImagePerImageDraft());
			}
			setShowModal(true);
			setSaveError('');
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
						draftRowsHaveImageTokenPrices(rows)
							? rows
							: [createDefaultImageTokenTierRow()]
					);
				}
				return mode;
			});
			return;
		}
		if (kind === 'audio') {
			setFormData((prev) => ({
				...prev,
				input_modalities: prev.input_modalities.includes('audio')
					? prev.input_modalities.filter((m) => m !== 'image')
					: ['audio'],
				output_modalities: ['text'],
				context_window: '',
				max_tokens: '',
			}));
			setAudioPricingDraft((prev) => {
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
		setFormData((prev) => {
			const withoutImage = prev.output_modalities.filter((m) => m !== 'image');
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

	/** Routes 等场景：仅有 model id 时拉取详情并打开弹窗。 */
	const openEditById = useCallback(
		async (modelId: string) => {
			setSaveError('');
			try {
				const fullModel = await fetchModelDetail(modelId);
				setEditingModel(fullModel);
				fillFormFromModel(fullModel);
				setShowModal(true);
			} catch (error) {
				console.error('Fetch model details error:', error);
				alert('Failed to load model');
			}
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
					await onChanged?.();
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
		[onChanged]
	);

	const handleAddTag = useCallback(() => {
		const next = tagInput.trim();
		if (next && !formData.tags.includes(next)) {
			setFormData({ ...formData, tags: [...formData.tags, next] });
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
					setFormKind('image');
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
					setFormKind((fk) => (fk === 'image' ? 'llm' : fk));
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
			const isImage =
				formKind === 'image' ||
				isImageGenerationModel({ output_modalities: formData.output_modalities });
			const isAudio = formKind === 'audio';
			const imageDraft: ImagePricingDraftState | null =
				isImage && !isAudio
					? {
							mode: imageBillingMode,
							tiers: pricingTierRows,
							perImage: imagePerImageDraft,
						}
					: null;
			const audioDraft: AudioPricingDraftState | null = isAudio ? audioPricingDraft : null;
			const result = await saveModel(
				formData,
				pricingTierRows,
				editingModel?.id ?? null,
				imageDraft,
				audioDraft
			);
			if (result.success) {
				setShowModal(false);
				await onChanged?.();
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
		editingModel?.id,
		formData,
		formKind,
		imageBillingMode,
		imagePerImageDraft,
		onChanged,
		pricingTierRows,
	]);

	const closeModal = useCallback(() => {
		if (isSaving || isDeleting) return;
		setShowModal(false);
	}, [isDeleting, isSaving]);

	return {
		billingCurrency,
		showModal,
		editingModel,
		formData,
		setFormData,
		formKind,
		pricingTierRows,
		setPricingTierRows,
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
		handleCreate,
		applyFormKind,
		handleEdit,
		openEditById,
		handleDelete,
		handleAddTag,
		handleRemoveTag,
		toggleFormModality,
		handleSave,
		closeModal,
	};
}
