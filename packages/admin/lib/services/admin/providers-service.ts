/** 管理后台 `providers` CRUD：单键 `api_key` + `status`，`endpoints` JSON 校验与持久化。 */
import type { GatewayRepositories } from '@octafuse/core';
import {
	serializeProviderEndpoints,
	validateAndNormalizeProviderEndpoints,
	type ProviderEndpointsMap,
} from '@octafuse/core/provider-endpoints';
import {
	isPendingProviderImportApiKey,
	maskProviderApiKeyForAdmin,
	PROVIDER_IMPORT_PENDING_API_KEY,
} from '@octafuse/core/db/provider-key-utils';
import {
	isKnownProviderKind,
	resolveStoredProviderPresentation,
	listStaticProviderImportPresets,
} from '@/lib/provider-import-preset';
import { providerNameKindKey, suggestUniqueProviderImportName } from '@/lib/provider-kind';
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

function normalizeProviderStatus(raw: unknown): 'active' | 'disabled' {
	if (raw === 'disabled') return 'disabled';
	if (raw === 'active' || raw === undefined || raw === null || raw === '') return 'active';
	throw badRequest('status must be active or disabled');
}

function normalizeProviderKind(raw: unknown, required: boolean): string {
	if (raw === undefined || raw === null || String(raw).trim() === '') {
		if (required) throw badRequest('kind is required');
		return '';
	}
	const kind = String(raw).trim();
	if (!isKnownProviderKind(kind)) {
		throw badRequest('kind must be a known provider template name or __custom__');
	}
	return kind;
}

function isProviderNameKindConflict(error: unknown): boolean {
	const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
	return (
		message.includes('uk_providers_name_kind') ||
		message.includes('unique constraint failed: providers.name') ||
		(message.includes('duplicate') && message.includes('uk_providers_name_kind')) ||
		(message.includes('unique') && message.includes('providers') && message.includes('kind'))
	);
}

async function writeProvider(write: () => Promise<void>): Promise<void> {
	try {
		await write();
	} catch (error) {
		if (isProviderNameKindConflict(error)) {
			throw conflict('A provider with this name and type already exists');
		}
		throw error;
	}
}

/** 列表/详情脱敏：明文 `api_key` → masked；图标按已保存的 kind 解析。 */
function enrichProviderRow(provider: AdminProviderRow): AdminProviderRow {
	const plaintext = typeof provider.api_key === 'string' ? provider.api_key : '';
	const presentation = resolveStoredProviderPresentation(provider);
	return {
		...provider,
		kind: String(provider.kind ?? ''),
		kind_labels: presentation.kindLabels ?? undefined,
		vendor_key: presentation.vendorKey,
		icon_key: presentation.iconKey,
		catalog_links: presentation.catalogLinks ?? undefined,
		api_key: maskProviderApiKeyForAdmin(plaintext),
		status: provider.status === 'disabled' ? 'disabled' : 'active',
		has_pending_key: isPendingProviderImportApiKey(plaintext),
		routes_count: Number(provider.routes_count ?? 0),
		active_routes_count: Number(provider.active_routes_count ?? 0),
	};
}

/** 供应商列表（脱敏 api_key）。 */
export async function listProvidersService(repos: GatewayRepositories): Promise<AdminProviderRow[]> {
	const providers = (await repos.providers.listProviders()) as AdminProviderRow[];
	return providers.map(enrichProviderRow);
}

/**
 * 创建供应商；可指定 `id`，冲突抛 `conflict`；`api_key` 必填；协议 endpoints 均可为空。
 */
export async function createProviderService(
	repos: GatewayRepositories,
	body: AdminProviderMutationInput
): Promise<AdminCreatedIdOutput> {
	const customId = String(body.id ?? '').trim();
	const name = String(body.name ?? '');
	const apiKey = String(body.api_key ?? '').trim();
	if (!name) {
		throw badRequest('name is required');
	}
	if (!apiKey) {
		throw badRequest('api_key is required');
	}

	const endpointsJson = resolveEndpointsFromMutation(body);
	const status = normalizeProviderStatus(body.status);
	const kind = normalizeProviderKind(body.kind, true);

	const id = customId || crypto.randomUUID();
	if (customId && (await repos.providers.providerIdExists(id))) {
		throw conflict('Provider ID already exists');
	}

	await writeProvider(() =>
		repos.providers.insertProvider({
			id,
			name,
			kind,
			endpoints: endpointsJson,
			description: body.description,
			apiKey,
			status,
		})
	);

	return { id };
}

/** 单条供应商（脱敏）；不存在抛 `notFound`。 */
export async function getProviderService(repos: GatewayRepositories, id: string): Promise<AdminProviderRow> {
	const provider = await repos.providers.getProviderRowById(id);
	if (!provider) throw notFound('Provider not found');
	return enrichProviderRow(provider as AdminProviderRow);
}

/** 揭示供应商明文 API Key。 */
export async function revealProviderApiKeyService(
	repos: GatewayRepositories,
	providerId: string
): Promise<{ api_key: string }> {
	const provider = await repos.providers.getProviderRowById(providerId);
	if (!provider) throw notFound('Provider not found');
	const row = await repos.providers.getProviderApiKeyPlaintext(providerId);
	if (!row) throw notFound('Provider not found');
	return { api_key: row.api_key };
}

/**
 * PATCH 供应商；`api_key` 空串/未传 = 不改；写 `endpoints`（权威）。
 */
export async function updateProviderService(
	repos: GatewayRepositories,
	id: string,
	body: AdminProviderMutationInput
): Promise<void> {
	const existing = await repos.providers.getProviderRowById(id);
	if (!existing) throw notFound('Provider not found');

	const patch: Record<string, unknown> = {};

	if (body.name !== undefined) {
		const name = String(body.name ?? '').trim();
		if (!name) throw badRequest('name cannot be empty');
		patch.name = name;
	}
	if (body.kind !== undefined) {
		patch.kind = normalizeProviderKind(body.kind, false);
	}
	if (body.description !== undefined) {
		patch.description = body.description;
	}
	if ('endpoints' in body) {
		patch.endpoints = resolveEndpointsFromMutation(body);
	}
	if (body.status !== undefined) {
		patch.status = normalizeProviderStatus(body.status);
	}
	if (body.api_key !== undefined) {
		const apiKey = String(body.api_key ?? '').trim();
		if (apiKey) {
			patch.api_key = apiKey;
		}
	}

	if (Object.keys(patch).length === 0) return;

	await writeProvider(async () => {
		const updated = await repos.providers.updateProviderByPatch(id, patch);
		if (updated === 0) {
			throw notFound('Provider not found');
		}
	});
}

/**
 * 删除供应商；不存在抛 `notFound`。
 * `model_routes.provider_id` 无 ON DELETE CASCADE，若仍有路由引用则抛 `conflict`（避免 D1/PG 外键失败变 500）。
 */
export async function deleteProviderService(repos: GatewayRepositories, id: string): Promise<void> {
	const referencingRoutes = await repos.routes.listModelRoutesWithJoins({ providerId: id });
	if (referencingRoutes.length > 0) {
		throw conflict(
			`Cannot delete provider: ${referencingRoutes.length} model route(s) still reference it. Delete or reassign those routes first.`
		);
	}

	const changes = await repos.providers.deleteProviderById(id);
	if (!changes) throw notFound('Provider not found');
}

/**
 * 从 `lib/provider-import-presets.json` 按 **catalog 键**导入 Provider：
 * 写入占位 `PROVIDER_IMPORT_PENDING_API_KEY`，须在 Admin 中替换为真实密钥。
 * `kind` 写成模板英文名；同一类型下同名才追加 `(2)` 后缀。
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
	const existingNameKindKeys = new Set(
		existingProviders.map((provider) => providerNameKindKey(provider.name, String(provider.kind ?? '')))
	);

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

			let name: string;
			try {
				name = suggestUniqueProviderImportName(baseName, baseName, existingNameKindKeys);
			} catch (error) {
				throw badRequest(error instanceof Error ? error.message : 'Unable to allocate unique provider name');
			}

			await createProviderService(repos, {
				name,
				kind: baseName,
				endpoints: preset.endpoints,
				description: preset.description ?? null,
				api_key: PROVIDER_IMPORT_PENDING_API_KEY,
				status: 'active',
			});

			existingNameKindKeys.add(providerNameKindKey(name, baseName));
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
