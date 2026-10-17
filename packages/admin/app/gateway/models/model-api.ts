import { resolveModelKind } from '@octafuse/core/db/model-kind';
import { readApiJson } from '@/lib/api-json';
import { normalizeModelVendorInput } from '@/lib/model-vendor';
import {
	attachCatalogScheduleToProfileJson,
	serializeAudioPricingDraft,
	serializeCatalogScheduleDraft,
	serializeDraftRowsToProfileJson,
	serializeImagePricingDraft,
	type AudioPricingDraftState,
	type CatalogScheduleFormWindow,
	type ImagePricingDraftState,
	type PricingTierDraftRow,
} from '@/lib/pricing-tiers-draft';
import type { ModelSyncApplyBody, ModelSyncApplyOutput, ModelSyncReport } from '@/lib/model-sync-diff';
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
	imagePricingDraft?: ImagePricingDraftState | null,
	audioPricingDraft?: AudioPricingDraftState | null,
	catalogScheduleWindows?: CatalogScheduleFormWindow[]
): Promise<{ success: true } | { success: false; message: string }> {
	const isImage = resolveModelKind({ output_modalities: formData.output_modalities }) === 'image';
	const isAudio = !!audioPricingDraft;
	const tierJson = isAudio
		? serializeAudioPricingDraft(audioPricingDraft)
		: isImage && imagePricingDraft
			? serializeImagePricingDraft(imagePricingDraft)
			: serializeDraftRowsToProfileJson(pricingTierRows);
	if (!tierJson.ok) {
		return { success: false, message: tierJson.error };
	}
	const scheduleDraft = serializeCatalogScheduleDraft(catalogScheduleWindows ?? []);
	if (!scheduleDraft.ok) {
		return { success: false, message: scheduleDraft.error };
	}
	const withSchedule = attachCatalogScheduleToProfileJson(tierJson.json, scheduleDraft.windows);
	if (!withSchedule.ok) {
		return { success: false, message: withSchedule.error };
	}
	const metaParsed = parseMetadataForSave(formData.metadata);
	if (!metaParsed.ok) {
		return { success: false, message: metaParsed.error };
	}

	const resolvedKind = resolveModelKind({
		input_modalities: formData.input_modalities,
		output_modalities: formData.output_modalities,
		pricing_profile: withSchedule.json,
	});
	const isImageResolved = resolvedKind === 'image';
	const isAudioResolved = isAudio || resolvedKind === 'asr' || resolvedKind === 'tts';
	const isEmbeddingResolved = resolvedKind === 'embedding';
	const skipTokenLimits = isImageResolved || isAudioResolved;
	const parsedMax = formData.max_tokens.trim() ? parseInt(formData.max_tokens, 10) : NaN;
	const payload = {
		...formData,
		tags: formData.tags,
		vendor: normalizeModelVendorInput(formData.vendor),
		// Image / Audio：chat context / max_tokens 不适用 — 保存时始终清空；Embedding 保留 context_window（输入上限），清空 max_tokens
		context_window: skipTokenLimits
			? null
			: formData.context_window
				? parseInt(formData.context_window, 10)
				: null,
		max_tokens: skipTokenLimits || isEmbeddingResolved ? null : Number.isFinite(parsedMax) ? parsedMax : 4096,
		input_modalities: formData.input_modalities,
		output_modalities: formData.output_modalities,
		released_at: formData.released_at.trim() || null,
		pricing_profile: withSchedule.json,
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
	ids: string[],
	locale: string
): Promise<{ success: true; data: ModelImportResult } | { success: false; message: string }> {
	const response = await fetch('/api/admin/models/import', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ ids, locale }),
	});
	const data = await readApiJson<ModelImportResult>(response);
	if (data.success && data.data) return { success: true, data: data.data };
	return { success: false, message: data.message || 'Import failed' };
}

export async function fetchModelSyncReport(locale: string): Promise<ModelSyncReport> {
	const response = await fetch(`/api/admin/models/sync/diff?locale=${encodeURIComponent(locale)}`);
	const data = await readApiJson<ModelSyncReport>(response);
	if (data.success && data.data) return data.data;
	throw new Error(data.message || 'Failed to load model sync diff');
}

export async function applyModelSync(
	body: ModelSyncApplyBody
): Promise<{ success: true; data: ModelSyncApplyOutput } | { success: false; message: string }> {
	const response = await fetch('/api/admin/models/sync/apply', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	const data = await readApiJson<ModelSyncApplyOutput>(response);
	if (data.success && data.data) return { success: true, data: data.data };
	return { success: false, message: data.message || 'Sync failed' };
}
