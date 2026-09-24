import { readApiJson } from '@/lib/api-json';
import type { GatewayProvider } from '@/lib/types';
import { formDataToEndpointsMap } from './provider-utils';
import type { ProviderFormData, ProviderImportCatalogRow, ProviderImportResult } from './types';

export async function fetchProvidersList(): Promise<GatewayProvider[]> {
	const response = await fetch('/api/admin/providers');
	const data = await readApiJson<GatewayProvider[]>(response);
	if (data.success && data.data) {
		return [...data.data].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
	}
	throw new Error(data.message || 'Failed to load providers');
}

export async function saveProvider(
	formData: ProviderFormData,
	editingProviderId: string | null
): Promise<{ success: true } | { success: false; message: string }> {
	const payload: Record<string, unknown> = {
		name: formData.name,
		kind: formData.kind,
		description: formData.description,
		endpoints: formDataToEndpointsMap(formData),
		status: formData.status === 'disabled' ? 'disabled' : 'active',
	};

	const apiKey = formData.api_key.trim();
	if (apiKey) {
		payload.api_key = apiKey;
	}

	let response: Response;
	if (editingProviderId) {
		response = await fetch(`/api/admin/providers/${encodeURIComponent(editingProviderId)}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		});
	} else {
		if (!apiKey) {
			return { success: false, message: 'api_key is required' };
		}
		payload.api_key = apiKey;
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

export async function fetchProviderApiKeyPlaintext(providerId: string): Promise<string> {
	const response = await fetch(
		`/api/admin/providers/${encodeURIComponent(providerId)}/api-key`
	);
	const data = await readApiJson<{ api_key: string }>(response);
	if (data.success && data.data?.api_key) return data.data.api_key;
	throw new Error(data.message || 'Failed to reveal API key');
}

export async function toggleProviderStatus(
	providerId: string,
	nextStatus: 'active' | 'disabled'
): Promise<{ success: true } | { success: false; message: string }> {
	const response = await fetch(`/api/admin/providers/${encodeURIComponent(providerId)}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ status: nextStatus }),
	});
	const data = await readApiJson(response);
	if (data.success) return { success: true };
	return { success: false, message: data.message || 'Update failed' };
}
