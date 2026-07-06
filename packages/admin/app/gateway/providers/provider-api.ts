import { readApiJson } from '@/lib/api-json';
import type { GatewayProvider } from '@/lib/types';
import { buildLimitConfigJson } from './provider-utils';
import type {
	ProviderFormData,
	ProviderImportCatalogRow,
	ProviderImportResult,
	ProviderKeyFormData,
	ProviderKeyRow,
} from './types';

export async function fetchProvidersList(): Promise<GatewayProvider[]> {
	const response = await fetch('/api/admin/providers');
	const data = await readApiJson<GatewayProvider[]>(response);
	if (data.success && data.data) {
		return [...data.data].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
	}
	throw new Error(data.message || 'Failed to load providers');
}

export async function loadProviderKeyRows(providerId: string): Promise<ProviderKeyRow[]> {
	const response = await fetch(`/api/admin/providers/${encodeURIComponent(providerId)}/keys`);
	const data = await readApiJson<ProviderKeyRow[]>(response);
	if (data.success && data.data) {
		return data.data;
	}
	throw new Error(data.message || 'Failed to load keys');
}

export async function saveProvider(
	formData: ProviderFormData,
	editingProviderId: string | null
): Promise<{ success: true } | { success: false; message: string }> {
	const payload: Record<string, unknown> = {
		...formData,
		base_url_openai: formData.base_url_openai.trim() || null,
		base_url_anthropic: formData.base_url_anthropic.trim() || null,
		base_url_gemini: formData.base_url_gemini.trim() || null,
	};

	let response: Response;
	if (editingProviderId) {
		const patchBody = { ...payload };
		delete patchBody.id;
		response = await fetch(`/api/admin/providers/${encodeURIComponent(editingProviderId)}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(patchBody),
		});
	} else {
		if (formData.id.trim()) {
			payload.id = formData.id.trim();
		}
		response = await fetch('/api/admin/providers', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		});
	}

	const data = await readApiJson(response);
	if (data.success) return { success: true };
	return { success: false, message: data.message || 'Save failed' };
}

export async function deleteProvider(
	id: string
): Promise<{ success: true } | { success: false; message: string }> {
	const response = await fetch(`/api/admin/providers/${encodeURIComponent(id)}`, { method: 'DELETE' });
	const data = await readApiJson(response);
	if (data.success) return { success: true };
	return { success: false, message: data.message || 'Delete failed' };
}

export async function fetchImportCatalog(): Promise<ProviderImportCatalogRow[]> {
	const response = await fetch('/api/admin/providers/import/catalog');
	const data = await readApiJson<ProviderImportCatalogRow[]>(response);
	if (data.success && data.data) return data.data;
	throw new Error(data.message || 'Failed to load catalog');
}

export async function importProviderPresets(
	ids: string[]
): Promise<{ success: true; data: ProviderImportResult } | { success: false; message: string }> {
	const response = await fetch('/api/admin/providers/import', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ ids }),
	});
	const data = await readApiJson<ProviderImportResult>(response);
	if (data.success && data.data) return { success: true, data: data.data };
	return { success: false, message: data.message || 'Import failed' };
}

export async function fetchProviderKeyPlaintext(
	providerId: string,
	keyId: string
): Promise<string> {
	const response = await fetch(
		`/api/admin/providers/${encodeURIComponent(providerId)}/keys/${encodeURIComponent(keyId)}`
	);
	const data = await readApiJson<{ api_key: string }>(response);
	if (data.success && data.data?.api_key) return data.data.api_key;
	throw new Error(data.message || 'Failed to copy API key');
}

export async function toggleProviderKeyStatus(
	providerId: string,
	keyId: string,
	nextStatus: 'active' | 'disabled'
): Promise<{ success: true } | { success: false; message: string }> {
	const response = await fetch(
		`/api/admin/providers/${encodeURIComponent(providerId)}/keys/${encodeURIComponent(keyId)}`,
		{
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ status: nextStatus }),
		}
	);
	const data = await readApiJson(response);
	if (data.success) return { success: true };
	return { success: false, message: data.message || 'Update failed' };
}

export async function saveProviderKey(
	providerId: string,
	form: ProviderKeyFormData,
	editingKeyId: string | null
): Promise<{ success: true } | { success: false; message: string }> {
	const label = form.label.trim();
	const apiKey = form.api_key.trim();
	const body: Record<string, unknown> = {
		label,
		status: form.status === 'disabled' ? 'disabled' : 'active',
		weight: Number(form.weight) || 1,
		priority: Number(form.priority) || 0,
		limit_config: buildLimitConfigJson(form),
	};
	if (apiKey) body.api_key = apiKey;

	const response = editingKeyId
		? await fetch(
				`/api/admin/providers/${encodeURIComponent(providerId)}/keys/${encodeURIComponent(editingKeyId)}`,
				{
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body),
				}
			)
		: await fetch(`/api/admin/providers/${encodeURIComponent(providerId)}/keys`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});

	const data = await readApiJson(response);
	if (data.success) return { success: true };
	return {
		success: false,
		message: data.message || (editingKeyId ? 'Failed to update key' : 'Failed to create key'),
	};
}

export async function deleteProviderKey(
	providerId: string,
	keyId: string
): Promise<{ success: true } | { success: false; message: string }> {
	const response = await fetch(
		`/api/admin/providers/${encodeURIComponent(providerId)}/keys/${encodeURIComponent(keyId)}`,
		{ method: 'DELETE' }
	);
	const data = await readApiJson(response);
	if (data.success) return { success: true };
	return { success: false, message: data.message || 'Delete failed' };
}
