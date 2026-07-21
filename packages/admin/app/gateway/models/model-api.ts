import { isImageGenerationModel } from '@octafuse/core/db/model-modalities';
import { readApiJson } from '@/lib/api-json';
import { normalizeModelVendorInput } from '@/lib/model-vendor';
import { serializeDraftRowsToProfileJson, serializeImagePricingDraft, type ImagePricingDraftState, type PricingTierDraftRow } from '@/lib/pricing-tiers-draft';
import { parseMetadataForSave } from './model-utils';
import type { ModelFormData, ModelImportResult, ModelListItem, PresetCatalogRow } from './types';

export async function fetchModelsList(): Promise<ModelListItem[]> {
	const response = await fetch('/api/admin/models');
	const data = await readApiJson<ModelListItem[]>(response);
	if (data.success && data.data) return data.data;
	throw new Error(data.message || 'Failed to load models');
}

export async function fetchModelDetail(id: string): Promise<ModelListItem> {
	const response = await fetch(`/api/admin/models/${encodeURIComponent(id)}`);
	const data = await readApiJson<ModelListItem>(response);
	if (data.success && data.data) return data.data;
	throw new Error(data.message || 'Failed to load model');
}

export async function saveModel(
	formData: ModelFormData,
	pricingTierRows: PricingTierDraftRow[],
	editingModelId: string | null,
	imagePricingDraft?: ImagePricingDraftState | null
): Promise<{ success: true } | { success: false; message: string }> {
	const isImage = isImageGenerationModel({
		output_modalities: formData.output_modalities,
	});
	const tierJson =
		isImage && imagePricingDraft
			? serializeImagePricingDraft(imagePricingDraft)
			: serializeDraftRowsToProfileJson(pricingTierRows);
	if (!tierJson.ok) {
		return { success: false, message: tierJson.error };
	}
	const metaParsed = parseMetadataForSave(formData.metadata);
	if (!metaParsed.ok) {
		return { success: false, message: metaParsed.error };
	}

	const isImageResolved = isImageGenerationModel({
		output_modalities: formData.output_modalities,
		pricing_profile: tierJson.json,
	});
	const parsedMax = formData.max_tokens.trim() ? parseInt(formData.max_tokens, 10) : NaN;
	const payload = {
		...formData,
		tags: formData.tags,
		vendor: normalizeModelVendorInput(formData.vendor),
		// Image models: chat context / max_tokens are N/A — always clear on save
		context_window: isImageResolved
			? null
			: formData.context_window
				? parseInt(formData.context_window, 10)
				: null,
		max_tokens: isImageResolved ? null : Number.isFinite(parsedMax) ? parsedMax : 4096,
		input_modalities: formData.input_modalities,
		output_modalities: formData.output_modalities,
		released_at: formData.released_at.trim() || null,
		pricing_profile: tierJson.json,
		metadata: metaParsed.value,
	};

	let response: Response;
	if (editingModelId) {
		const { id: _unusedModelId, ...patchBody } = payload;
		void _unusedModelId;
		response = await fetch(`/api/admin/models/${encodeURIComponent(editingModelId)}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(patchBody),
		});
	} else {
		response = await fetch('/api/admin/models', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		});
	}

	const data = await readApiJson(response);
	if (data.success) return { success: true };
	return { success: false, message: data.message || 'Save failed' };
}

export async function deleteModel(
	id: string
): Promise<{ success: true } | { success: false; message: string }> {
	const response = await fetch(`/api/admin/models/${encodeURIComponent(id)}`, { method: 'DELETE' });
	const data = await readApiJson(response);
	if (data.success) return { success: true };
	return { success: false, message: data.message || 'Delete failed' };
}

export async function fetchImportCatalog(): Promise<PresetCatalogRow[]> {
	const response = await fetch('/api/admin/models/import/catalog');
	const data = await readApiJson<PresetCatalogRow[]>(response);
	if (data.success && Array.isArray(data.data)) return data.data;
	throw new Error(data.message || 'Failed to load catalog');
}

export async function importModelPresets(
	ids: string[]
): Promise<{ success: true; data: ModelImportResult } | { success: false; message: string }> {
	const response = await fetch('/api/admin/models/import', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ ids }),
	});
	const data = await readApiJson<ModelImportResult>(response);
	if (data.success && data.data) return { success: true, data: data.data };
	return { success: false, message: data.message || 'Import failed' };
}
