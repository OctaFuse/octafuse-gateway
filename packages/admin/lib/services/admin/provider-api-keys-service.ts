/** 管理后台 `provider_api_keys` CRUD。 */
import type { GatewayRepositories } from '@octafuse/core';
import type { ProviderApiKeyAdminRow, ActiveProviderApiKeyRow } from '@octafuse/core';
import { badRequest, conflict, notFound } from './errors';
import type { AdminCreatedIdOutput, AdminProviderKeyMutationInput } from './types';

export async function listProviderKeysService(
	repos: GatewayRepositories,
	providerId: string
): Promise<ProviderApiKeyAdminRow[]> {
	const provider = await repos.providers.getProviderRowById(providerId);
	if (!provider) throw notFound('Provider not found');
	return repos.providerKeys.listProviderKeys(providerId);
}

export async function createProviderKeyService(
	repos: GatewayRepositories,
	providerId: string,
	body: AdminProviderKeyMutationInput
): Promise<AdminCreatedIdOutput> {
	const provider = await repos.providers.getProviderRowById(providerId);
	if (!provider) throw notFound('Provider not found');

	const label = String(body.label ?? '').trim();
	const apiKey = String(body.api_key ?? '').trim();
	if (!label || !apiKey) {
		throw badRequest('label and api_key are required');
	}

	const id = crypto.randomUUID();
	await repos.providerKeys.createProviderKey({
		id,
		providerId,
		label,
		apiKey,
		status: body.status === 'disabled' ? 'disabled' : 'active',
		weight: typeof body.weight === 'number' ? body.weight : Number(body.weight ?? 1) || 1,
		priority: typeof body.priority === 'number' ? body.priority : Number(body.priority ?? 0) || 0,
	});

	return { id };
}

export async function updateProviderKeyService(
	repos: GatewayRepositories,
	providerId: string,
	keyId: string,
	body: AdminProviderKeyMutationInput
): Promise<void> {
	const existing = await repos.providerKeys.getProviderKeyById(keyId);
	if (!existing || existing.provider_id !== providerId) {
		throw notFound('Provider key not found');
	}

	const patch: Record<string, unknown> = {};
	if (body.label !== undefined) {
		const label = String(body.label).trim();
		if (!label) throw badRequest('label cannot be empty');
		patch.label = label;
	}
	if (body.api_key !== undefined) {
		const apiKey = String(body.api_key).trim();
		if (!apiKey) throw badRequest('api_key cannot be empty');
		patch.apiKey = apiKey;
	}
	if (body.status !== undefined) {
		if (body.status !== 'active' && body.status !== 'disabled') {
			throw badRequest('status must be active or disabled');
		}
		if (body.status === 'disabled') {
			const activeCount = await repos.providerKeys.countActiveProviderKeys(providerId);
			if (existing.status === 'active' && activeCount <= 1) {
				throw badRequest('Cannot disable the last active provider key');
			}
		}
		patch.status = body.status;
	}
	if (body.weight !== undefined) {
		patch.weight = typeof body.weight === 'number' ? body.weight : Number(body.weight);
	}
	if (body.priority !== undefined) {
		patch.priority = typeof body.priority === 'number' ? body.priority : Number(body.priority);
	}

	const changes = await repos.providerKeys.updateProviderKeyByPatch(keyId, patch);
	if (Object.keys(patch).length > 0 && changes === 0) {
		throw notFound('Provider key not found');
	}
}

export async function deleteProviderKeyService(
	repos: GatewayRepositories,
	providerId: string,
	keyId: string
): Promise<void> {
	const existing = await repos.providerKeys.getProviderKeyById(keyId);
	if (!existing || existing.provider_id !== providerId) {
		throw notFound('Provider key not found');
	}

	const activeCount = await repos.providerKeys.countActiveProviderKeys(providerId);
	if (existing.status === 'active' && activeCount <= 1) {
		throw conflict('Cannot delete the last active provider key');
	}

	const changes = await repos.providerKeys.deleteProviderKeyById(keyId);
	if (!changes) throw notFound('Provider key not found');
}

/** Playground 可选指定 key；未指定则取 active pool 中 priority 最高的一把。 */
export async function resolvePlaygroundProviderKey(
	repos: GatewayRepositories,
	providerId: string,
	providerKeyId?: string | null
): Promise<{ id: string; label: string; api_key: string }> {
	if (providerKeyId) {
		const row = await repos.providerKeys.getProviderKeyById(providerKeyId);
		if (!row || row.provider_id !== providerId) {
			throw notFound('Provider key not found');
		}
		if (row.status !== 'active') {
			throw badRequest('Provider key is not active');
		}
		const keys = await repos.providerKeys.getActiveProviderKeys(providerId);
		const match = keys.find((k: ActiveProviderApiKeyRow) => k.id === providerKeyId);
		if (!match) throw notFound('Provider key not found');
		return { id: match.id, label: match.label, api_key: match.api_key };
	}

	const keys = await repos.providerKeys.getActiveProviderKeys(providerId);
	if (keys.length === 0) {
		throw badRequest('No active provider keys configured');
	}
	const first = keys[0]!;
	return { id: first.id, label: first.label, api_key: first.api_key };
}
