/** 管理后台 `providers` CRUD：`endpoints` JSON 校验与持久化。 */
import type { GatewayRepositories } from '@octafuse/core';
import {
	serializeProviderEndpoints,
	validateAndNormalizeProviderEndpoints,
	type ProviderEndpointsMap,
} from '@octafuse/core/provider-endpoints';
import {
	listStaticProviderImportPresets,
} from '@/lib/provider-import-preset';
import { badRequest, conflict, notFound } from './errors';
import type {
	AdminCreatedIdOutput,
	AdminProviderMutationInput,
	AdminProviderRow,
	AdminProvidersImportOutput,
} from './types';

function resolveEndpointsFromMutation(body: AdminProviderMutationInput): string | null {
	if (body.endpoints === undefined || body.endpoints === null) {
		return null;
	}
	let map: ProviderEndpointsMap;
	try {
		map = validateAndNormalizeProviderEndpoints(body.endpoints);
	} catch (e) {
		throw badRequest(e instanceof Error ? e.message : 'Invalid endpoints');
	}
	return serializeProviderEndpoints(map);
}

/** 供应商列表（含 key 池摘要，仅 BFF/管理端使用）。 */
export async function listProvidersService(repos: GatewayRepositories): Promise<AdminProviderRow[]> {
	const providers = (await repos.providers.listProviders()) as AdminProviderRow[];
	const enriched: AdminProviderRow[] = [];
	for (const provider of providers) {
		const keys = await repos.providerKeys.listProviderKeys(provider.id);
		enriched.push({
			...provider,
			active_key_count: keys.filter((k) => k.status === 'active').length,
			has_pending_key: keys.some((k) => k.is_pending_import),
		});
	}
	return enriched;
}

/**
 * 创建供应商；可指定 `id`，冲突抛 `conflict`；协议 endpoints 均可为空，路由会按所选协议校验可用性。
 */
export async function createProviderService(repos: GatewayRepositories, body: AdminProviderMutationInput): Promise<AdminCreatedIdOutput> {
	const customId = String(body.id ?? '').trim();
	const name = String(body.name ?? '');
	const apiKey = String(body.api_key ?? '').trim();
	if (!name) {
		throw badRequest('name is required');
	}

	const endpointsJson = resolveEndpointsFromMutation(body);

	const id = customId || crypto.randomUUID();
	if (customId && (await repos.providers.providerIdExists(id))) {
		throw conflict('Provider ID already exists');
	}

	await repos.providers.insertProvider({
		id,
		name,
		endpoints: endpointsJson,
		description: body.description,
	});

	if (apiKey) {
		await repos.providerKeys.createProviderKey({
			id: `pkey_${id}`,
			providerId: id,
			label: 'default',
			apiKey,
			status: 'active',
			weight: 1,
			priority: 0,
		});
	}

	return { id };
}

/** 单条供应商；不存在抛 `notFound`。 */
export async function getProviderService(repos: GatewayRepositories, id: string): Promise<AdminProviderRow> {
	const provider = await repos.providers.getProviderRowById(id);
	if (!provider) throw notFound('Provider not found');
	return provider as AdminProviderRow;
}

/**
 * PATCH 供应商；写 `endpoints`（权威）。
 */
export async function updateProviderService(repos: GatewayRepositories, id: string, body: AdminProviderMutationInput): Promise<void> {
	const patch = { ...body } as Record<string, unknown>;
	delete patch.api_key;

	if ('endpoints' in patch) {
		patch.endpoints = resolveEndpointsFromMutation(body);
	}

	const changes = await repos.providers.updateProviderByPatch(id, patch);
	if (Object.keys(patch).some((k) => k !== 'id' && patch[k] !== undefined) && changes === 0) {
		throw notFound('Provider not found');
	}
}

/** 删除供应商；不存在抛 `notFound`。 */
export async function deleteProviderService(repos: GatewayRepositories, id: string): Promise<void> {
	const changes = await repos.providers.deleteProviderById(id);
	if (!changes) throw notFound('Provider not found');
}

/** 在 `providers.name` UNIQUE 约束下为模板导入生成唯一显示名。 */
function suggestUniqueProviderImportName(baseName: string, existingNameLower: Set<string>): string {
	const trimmed = baseName.trim();
	if (!existingNameLower.has(trimmed.toLowerCase())) {
		return trimmed;
	}
	for (let n = 2; n < 1000; n++) {
		const candidate = `${trimmed} (${n})`;
		if (!existingNameLower.has(candidate.toLowerCase())) {
			return candidate;
		}
	}
	throw badRequest(`Unable to allocate unique provider name for: ${trimmed}`);
}

/**
 * 从 `lib/provider-import-presets.json` 按 **catalog 键**（数组下标字符串）导入 Provider：
 * 每次导入均新增一行（自动生成 provider id）；同名模板可重复导入，显示名自动追加 `(2)` 等后缀。
 * 导入后不含 API Key，须在 Admin Edit Provider 中手动添加。
 */
export async function importProvidersFromStaticPresetsService(
	repos: GatewayRepositories,
	input: { ids: string[] }
): Promise<AdminProvidersImportOutput> {
	const uniqueIds = [...new Set((input.ids ?? []).map((x) => String(x).trim()).filter((x) => x.length > 0))];
	if (uniqueIds.length === 0) {
		throw badRequest('ids must be a non-empty array of preset catalog keys');
	}

	const presetByKey = new Map(listStaticProviderImportPresets().map((p) => [p.catalog_key, p]));

	let created = 0;
	const failed: Array<{ id: string; message: string }> = [];

	const existingProviders = await listProvidersService(repos);
	const existingNameLower = new Set(existingProviders.map((p) => p.name.trim().toLowerCase()));

	for (const catalogKey of uniqueIds) {
		const preset = presetByKey.get(catalogKey);
		try {
			if (!preset) {
				throw badRequest(`Unknown static preset catalog key: ${catalogKey}`);
			}

			const baseName = String(preset.name ?? '').trim();
			if (!baseName) {
				throw badRequest(`Static preset catalog key "${catalogKey}": missing name`);
			}

			const name = suggestUniqueProviderImportName(baseName, existingNameLower);

			await createProviderService(repos, {
				name,
				endpoints: preset.endpoints,
				description: preset.description ?? null,
			});

			existingNameLower.add(name.toLowerCase());
			created++;
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			failed.push({ id: catalogKey, message });
		}
	}

	return {
		created,
		updated: 0,
		skipped_existing: [],
		failed,
	};
}
