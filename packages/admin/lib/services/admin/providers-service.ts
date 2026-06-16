/** 管理后台 `providers` CRUD：多协议 base URL、密钥与说明的校验与持久化。 */
import type { GatewayRepositories } from '@octafuse/core';
import {
	listStaticProviderImportPresets,
} from '@/lib/provider-import-preset';
import { badRequest, conflict, notFound } from './errors';
import { nullIfEmpty } from './shared';
import type {
	AdminCreatedIdOutput,
	AdminProviderMutationInput,
	AdminProviderRow,
	AdminProvidersImportOutput,
} from './types';

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
 * 创建供应商；可指定 `id`，冲突抛 `conflict`；协议 base URL 均可为空，路由会按所选协议校验可用性。
 */
export async function createProviderService(repos: GatewayRepositories, body: AdminProviderMutationInput): Promise<AdminCreatedIdOutput> {
	const customId = String(body.id ?? '').trim();
	const name = String(body.name ?? '');
	const baseUrlOpenai = nullIfEmpty(body.base_url_openai as string | null | undefined);
	const apiKey = String(body.api_key ?? '').trim();
	if (!name) {
		throw badRequest('name is required');
	}

	const id = customId || crypto.randomUUID();
	if (customId && (await repos.providers.providerIdExists(id))) {
		throw conflict('Provider ID already exists');
	}

	await repos.providers.insertProvider({
		id,
		name,
		baseUrlOpenai,
		baseUrlAnthropic: nullIfEmpty(body.base_url_anthropic as string | null | undefined),
		baseUrlGemini: nullIfEmpty(body.base_url_gemini as string | null | undefined),
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
 * PATCH 供应商；空白协议 base URL 会规范化为 null。
 */
export async function updateProviderService(repos: GatewayRepositories, id: string, body: AdminProviderMutationInput): Promise<void> {
	const patch = { ...body } as Record<string, unknown>;
	if ('base_url_openai' in patch) {
		patch.base_url_openai = nullIfEmpty(patch.base_url_openai as string | null | undefined);
	}
	if ('base_url_anthropic' in patch) {
		patch.base_url_anthropic = nullIfEmpty(patch.base_url_anthropic as string | null | undefined);
	}
	if ('base_url_gemini' in patch) {
		patch.base_url_gemini = nullIfEmpty(patch.base_url_gemini as string | null | undefined);
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

/**
 * 从 `lib/provider-import-presets.json` 按 **指定模板 id** 导入 Provider：
 * **已存在同 id 的不导入、不覆盖**（记入 `skipped_existing`）；**同名**（忽略大小写）冲突记入 `failed`。
 * 导入后不含 API Key，须在 Admin Edit Provider 中手动添加。
 */
export async function importProvidersFromStaticPresetsService(
	repos: GatewayRepositories,
	input: { ids: string[] }
): Promise<AdminProvidersImportOutput> {
	const uniqueIds = [...new Set((input.ids ?? []).map((x) => String(x).trim()).filter((x) => x.length > 0))];
	if (uniqueIds.length === 0) {
		throw badRequest('ids must be a non-empty array of preset provider ids');
	}

	const presetById = new Map(listStaticProviderImportPresets().map((p) => [String(p.id).trim(), p]));

	let created = 0;
	const skipped_existing: string[] = [];
	const failed: Array<{ id: string; message: string }> = [];

	const existingProviders = await listProvidersService(repos);
	const existingIds = new Set(existingProviders.map((p) => p.id));
	const existingNameLower = new Set(existingProviders.map((p) => p.name.trim().toLowerCase()));

	for (const id of uniqueIds) {
		const preset = presetById.get(id);
		try {
			if (!preset) {
				throw badRequest(`Unknown static preset id: ${id}`);
			}

			if (existingIds.has(id)) {
				skipped_existing.push(id);
				continue;
			}

			const name = String(preset.name ?? '').trim();
			if (!name) {
				throw badRequest(`Static preset "${id}": missing name`);
			}

			const nameKey = name.toLowerCase();
			if (existingNameLower.has(nameKey)) {
				throw badRequest(`Provider name already exists: ${name}`);
			}

			await createProviderService(repos, {
				id,
				name,
				base_url_openai: preset.base_url_openai,
				base_url_anthropic: preset.base_url_anthropic,
				base_url_gemini: preset.base_url_gemini,
				description: preset.description ?? null,
			});

			existingIds.add(id);
			existingNameLower.add(nameKey);
			created++;
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			failed.push({ id, message });
		}
	}

	return {
		created,
		updated: 0,
		skipped_existing,
		failed,
	};
}
