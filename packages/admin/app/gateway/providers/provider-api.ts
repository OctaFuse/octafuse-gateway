import type { ProviderQuotaSnapshot } from '@octafuse/core/provider-quota';
import { readApiJson } from '@/lib/api-json';
import { sortProvidersByKindThenName } from '@/lib/provider-kind';
import type { GatewayProvider } from '@/lib/types';
import type { RouteListRow } from '../routes/types';
import { deleteRoute } from '../routes/route-api';
import { formDataToEndpointsMap } from './provider-utils';
import type {
	ProviderSyncApplyBody,
	ProviderSyncApplyOutput,
	ProviderSyncReport,
} from '@/lib/provider-sync-diff';
import type { ProviderFormData, ProviderImportCatalogRow, ProviderImportResult } from './types';

export async function fetchProvidersList(): Promise<GatewayProvider[]> {
	const response = await fetch('/api/admin/providers');
	const data = await readApiJson<GatewayProvider[]>(response);
	if (data.success && data.data) {
		return sortProvidersByKindThenName(data.data, 'en', 'Custom');
	}
	throw new Error(data.message || 'Failed to load providers');
}

export async function saveProvider(
	formData: ProviderFormData,
	editingProviderId: string | null,
	{ updateApiKey = true }: { updateApiKey?: boolean } = {}
): Promise<{ success: true } | { success: false; message: string }> {
	const payload: Record<string, unknown> = {
		name: formData.name,
		kind: formData.kind,
		note: formData.note,
		endpoints: formDataToEndpointsMap(formData),
		status: formData.status === 'disabled' ? 'disabled' : 'active',
	};

	const apiKey = formData.api_key.trim();
	if (updateApiKey) {
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
	ids: string[],
	locale: string
): Promise<{ success: true; data: ProviderImportResult } | { success: false; message: string }> {
	const response = await fetch('/api/admin/providers/import', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ ids, locale }),
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
	if (data.success && typeof data.data?.api_key === 'string') return data.data.api_key;
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

export async function fetchProviderQuota(
	providerId: string,
): Promise<{ success: true; data: ProviderQuotaSnapshot } | { success: false; message: string }> {
	const response = await fetch(`/api/admin/providers/${encodeURIComponent(providerId)}/quota`);
	const data = await readApiJson<ProviderQuotaSnapshot>(response);
	if (data.success && data.data) return { success: true, data: data.data };
	return { success: false, message: data.message || 'Failed to query provider quota' };
}

export async function fetchProviderSyncReport(): Promise<ProviderSyncReport> {
	const response = await fetch('/api/admin/providers/sync/diff');
	const data = await readApiJson<ProviderSyncReport>(response);
	if (data.success && data.data) return data.data;
	throw new Error(data.message || 'Failed to load provider sync diff');
}

export async function applyProviderSync(
	body: ProviderSyncApplyBody
): Promise<{ success: true; data: ProviderSyncApplyOutput } | { success: false; message: string }> {
	const response = await fetch('/api/admin/providers/sync/apply', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	const data = await readApiJson<ProviderSyncApplyOutput>(response);
	if (data.success && data.data) return { success: true, data: data.data };
	return { success: false, message: data.message || 'Sync failed' };
}

/** 模板改名后把旧 kind 迁移到新模板名；只改 `kind`。 */
export async function migrateProviderKind(
	providerId: string,
	kind: string
): Promise<{ success: true } | { success: false; message: string }> {
	const response = await fetch(`/api/admin/providers/${encodeURIComponent(providerId)}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ kind }),
	});
	const data = await readApiJson(response);
	if (data.success) return { success: true };
	return { success: false, message: data.message || 'Update failed' };
}

/** Load only the routes belonging to this provider; never treat a failed request as an empty list. */
export async function fetchProviderRoutes(providerId: string, signal?: AbortSignal): Promise<RouteListRow[]> {
	const query = new URLSearchParams({ provider_id: providerId });
	const response = await fetch(`/api/admin/routes?${query}`, { signal });
	const data = await readApiJson<RouteListRow[]>(response);
	if (data.success && data.data) return data.data;
	throw new Error(data.message || 'Failed to load routes');
}

/** Delete only selected routes owned by the current provider, preserving per-route failures. */
export async function deleteProviderRoutes(providerId: string, routes: RouteListRow[], ids: string[]) {
	const selected = new Set(ids);
	const targets = new Map(routes.filter((route) => route.provider_id === providerId && selected.has(route.id)).map((route) => [route.id, route]));
	const deletedIds: string[] = [];
	const failures: Array<{ route: RouteListRow; message: string }> = [];
	// Sequential requests avoid a burst of concurrent database writes for large selections.
	for (const route of targets.values()) {
		try {
			const result = await deleteRoute(route.id);
			if (result.success) deletedIds.push(route.id);
			else failures.push({ route, message: result.message });
		} catch (cause) {
			failures.push({ route, message: cause instanceof Error ? cause.message : '' });
		}
	}
	return { deletedIds, failures };
}
