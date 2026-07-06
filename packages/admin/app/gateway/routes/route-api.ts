import { readApiJson } from '@/lib/api-json';
import type { GatewayModel, GatewayProvider } from '@/lib/types';
import { buildRouteSavePayload } from './route-utils';
import type { RouteFormData, RouteListRow, RoutesPageData } from './types';

export async function fetchRoutesPageData(): Promise<RoutesPageData> {
	const [routesRes, modelsRes, providersRes] = await Promise.all([
		fetch('/api/admin/routes'),
		fetch('/api/admin/models'),
		fetch('/api/admin/providers'),
	]);
	const routesData = await readApiJson<RouteListRow[]>(routesRes);
	const modelsData = await readApiJson<GatewayModel[]>(modelsRes);
	const providersData = await readApiJson<GatewayProvider[]>(providersRes);

	return {
		routes: routesData.success ? routesData.data || [] : [],
		models: modelsData.success ? modelsData.data || [] : [],
		providers: providersData.success
			? [...(providersData.data || [])].sort((a, b) =>
					a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
				)
			: [],
	};
}

export async function saveRoute(
	formData: RouteFormData,
	editingRoute: RouteListRow | null
): Promise<{ success: true } | { success: false; message: string }> {
	try {
		const payload = buildRouteSavePayload(formData, editingRoute);
		let response: Response;
		if (editingRoute) {
			response = await fetch(`/api/admin/routes/${encodeURIComponent(editingRoute.id)}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});
		} else {
			response = await fetch('/api/admin/routes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});
		}
		const data = await readApiJson(response);
		if (data.success) return { success: true };
		return { success: false, message: data.message || 'Save failed' };
	} catch (error) {
		return {
			success: false,
			message: error instanceof Error ? error.message : 'Save failed, please try again',
		};
	}
}

export async function deleteRoute(
	id: string
): Promise<{ success: true } | { success: false; message: string }> {
	const response = await fetch(`/api/admin/routes/${encodeURIComponent(id)}`, { method: 'DELETE' });
	const data = await readApiJson(response);
	if (data.success) return { success: true };
	return { success: false, message: data.message || 'Delete failed' };
}

export async function toggleRouteStatus(
	id: string,
	status: 'active' | 'inactive'
): Promise<{ success: true } | { success: false; message: string }> {
	const response = await fetch(`/api/admin/routes/${encodeURIComponent(id)}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ status }),
	});
	const data = await readApiJson(response);
	if (data.success) return { success: true };
	return { success: false, message: data.message || 'Update failed' };
}

export async function patchModelStickyConfig(
	modelId: string,
	stickyConfig: string | null
): Promise<{ success: true } | { success: false; message: string }> {
	const response = await fetch(`/api/admin/models/${encodeURIComponent(modelId)}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ sticky_config: stickyConfig }),
	});
	const data = await readApiJson(response);
	if (data.success) return { success: true };
	return { success: false, message: data.message || 'Save failed, please try again' };
}
