/**
 * 管理后台 `models` + `model_tags`：列表/详情（含路由计数）、创建、部分更新、级联删除、静态目录导入。
 */
import type { GatewayRepositories } from '@octafuse/core';
import {
	BILLING_CURRENCY_KEY,
	tryParseGatewaySupportedBillingCurrencyInput,
	type GatewaySupportedBillingCurrency,
} from '@octafuse/core/lib/billing-currency';
import {
	listStaticModelPresets,
	pickPresetPricingRawForBillingCurrency,
} from '@/lib/model-preset';
import { badRequest, notFound } from './errors';
import { coerceModelPricingProfileInput } from './pricing-input';
import { normalizeModelVendorInput, parseTagsJson } from './shared';
import type {
	AdminCreatedIdOutput,
	AdminModelMutationInput,
	AdminModelRow,
	AdminModelsImportOutput,
	AdminStaticModelPresetCatalogItem,
} from './types';

function formatPriceForPreview(value: unknown): string | null {
	if (typeof value !== 'number' || !Number.isFinite(value)) return null;
	return Number.isInteger(value) ? String(value) : String(value);
}

function buildUsdPricingPreviewText(rawUsdPricing: unknown): string | null {
	if (!rawUsdPricing || typeof rawUsdPricing !== 'object' || Array.isArray(rawUsdPricing)) return null;
	const tiers = (rawUsdPricing as Record<string, unknown>).tiers;
	if (!Array.isArray(tiers) || tiers.length === 0) return null;

	const lines: string[] = [];
	for (let i = 0; i < tiers.length; i++) {
		const tier = tiers[i];
		if (!tier || typeof tier !== 'object' || Array.isArray(tier)) continue;
		const tierObj = tier as Record<string, unknown>;
		const inPrice = formatPriceForPreview(tierObj.input_price);
		const outPrice = formatPriceForPreview(tierObj.output_price);
		const cacheReadPrice = formatPriceForPreview(tierObj.cache_read_price);
		const cacheWritePrice = formatPriceForPreview(tierObj.cache_write_price);
		const upto = tierObj.upto;
		const rangeLabel =
			typeof upto === 'number' && Number.isFinite(upto) ? `<=${upto}` : 'all tokens';
		const parts = [
			`input ${inPrice ?? '—'}`,
			`output ${outPrice ?? '—'}`,
			`cache-read ${cacheReadPrice ?? '—'}`,
		];
		if (cacheWritePrice != null) {
			parts.push(`cache-write ${cacheWritePrice}`);
		}
		lines.push(`Tier ${i + 1} (${rangeLabel}): ${parts.join(' · ')}`);
	}
	if (lines.length === 0) return null;
	return lines.join('\n');
}

/** 全部模型列表，`tags` 从 JSON 字符串解析为数组。 */
export async function listModelsService(repos: GatewayRepositories): Promise<AdminModelRow[]> {
	const rows = await repos.models.listModelsWithRouteCounts();
	return rows.map((m) => ({ ...m, tags: parseTagsJson(m.tags as string | null) })) as AdminModelRow[];
}

/**
 * 创建模型并写入标签；`max_tokens` 默认 8192。
 * @throws `badRequest` 缺 id
 */
export async function createModelService(repos: GatewayRepositories, body: AdminModelMutationInput): Promise<AdminCreatedIdOutput> {
	const id = String(body.id ?? '');
	if (!id) throw badRequest('Model ID is required');

	const maxTokens = body.max_tokens ?? 8192;
	const pricingProfile =
		body.pricing_profile !== undefined ? coerceModelPricingProfileInput(body.pricing_profile) : null;
	if (!pricingProfile) {
		throw badRequest('pricing_profile is required when creating a model');
	}
	await repos.models.insertModel({
		id,
		displayName: body.display_name,
		vendor: normalizeModelVendorInput(body.vendor),
		contextWindow: body.context_window,
		maxTokens,
		pricingProfile,
		supportsImages: body.supports_images,
		description: body.description,
		metadata: body.metadata,
	});

	const tags = Array.isArray(body.tags) ? body.tags : [];
	await repos.models.replaceModelTags(
		id,
		tags.map((t) => String(t))
	);

	return { id };
}

/** 模型详情 + 路由计数 + 解析后的 tags。 */
export async function getModelService(repos: GatewayRepositories, id: string): Promise<AdminModelRow> {
	const model = await repos.models.getModelDetailWithRouteCounts(id);
	if (!model) throw notFound('Model not found');
	return { ...model, tags: parseTagsJson(model.tags as string | null) } as AdminModelRow;
}

/**
 * PATCH 模型列 + 可选全量替换 `tags`；vendor 会经 `normalizeModelVendorInput`。
 * @throws `notFound` 无此行或更新 0 行且提交了非 id 字段
 */
export async function updateModelService(repos: GatewayRepositories, id: string, body: AdminModelMutationInput): Promise<void> {
	const { tags, ...restRaw } = body;
	const rest = { ...restRaw } as Record<string, unknown>;
	if ('vendor' in rest && rest.vendor !== undefined) {
		rest.vendor = normalizeModelVendorInput(rest.vendor);
	}
	if ('pricing_profile' in rest && rest.pricing_profile !== undefined) {
		rest.pricing_profile = coerceModelPricingProfileInput(rest.pricing_profile);
	}
	const changes = await repos.models.updateModelByPatch(id, rest);
	if (Object.keys(rest).some((k) => k !== 'id' && rest[k] !== undefined) && changes === 0) {
		throw notFound('Model not found');
	}
	if (tags !== undefined) {
		await repos.models.replaceModelTags(id, Array.isArray(tags) ? tags.map((t) => String(t)) : []);
	}
}

/** 级联删除模型及其路由、标签。 */
export async function deleteModelService(repos: GatewayRepositories, id: string): Promise<void> {
	const changes = await repos.models.deleteModelCascade(id);
	if (!changes) throw notFound('Model not found');
}

/** 列出内置静态预设（供导入前勾选）；不访问数据库。 */
export function listStaticModelPresetCatalogForAdmin(): AdminStaticModelPresetCatalogItem[] {
	return listStaticModelPresets()
		.map((p) => {
			const id = String(p.id ?? '').trim();
			const usd = p.pricing?.usd;
			let tierCountUsd = 0;
			if (usd && typeof usd === 'object' && !Array.isArray(usd)) {
				const tiers = (usd as Record<string, unknown>).tiers;
				if (Array.isArray(tiers)) {
					tierCountUsd = tiers.length;
				}
			}
			return {
				id,
				display_name: (p.display_name != null ? String(p.display_name) : null) || null,
				vendor: normalizeModelVendorInput(p.vendor),
				context_window: p.context_window ?? null,
				max_tokens: p.max_tokens ?? null,
				tier_count_usd: tierCountUsd,
				pricing_preview_usd: buildUsdPricingPreviewText(usd),
			};
		})
		.filter((row) => row.id.length > 0);
}

/**
 * 从 `lib/model-presets/*.json`（经 `listStaticModelPresets` 合并）按 **指定 id** 导入模型：按当前 `BILLING_CURRENCY`（仅 USD/CNY 合法；否则按 USD 分支取价）写入 `pricing_profile`；
 * **已存在同 id 的不导入、不覆盖**（记入 `skipped_existing`）。未知 id 或校验失败记入 `failed`。
 */
export async function importModelsFromStaticPresetsService(
	repos: GatewayRepositories,
	input: { ids: string[] }
): Promise<AdminModelsImportOutput> {
	const uniqueIds = [...new Set((input.ids ?? []).map((x) => String(x).trim()).filter((x) => x.length > 0))];
	if (uniqueIds.length === 0) {
		throw badRequest('ids must be a non-empty array of preset model ids');
	}

	const rawCurrency = await repos.systemConfig.getConfig(BILLING_CURRENCY_KEY);
	const billingUsed: GatewaySupportedBillingCurrency =
		tryParseGatewaySupportedBillingCurrencyInput(rawCurrency ?? '') ?? 'USD';

	const allPresets = listStaticModelPresets();
	const presetById = new Map(allPresets.map((p) => [String(p.id ?? '').trim(), p]));

	let created = 0;
	const skipped_existing: string[] = [];
	const failed: Array<{ id: string; message: string }> = [];

	for (const id of uniqueIds) {
		const preset = presetById.get(id);
		try {
			if (!preset) {
				throw badRequest(`Unknown static preset id: ${id}`);
			}

			const existing = await repos.models.getModelDetailWithRouteCounts(id);
			if (existing) {
				skipped_existing.push(id);
				continue;
			}

			const pricingRaw = pickPresetPricingRawForBillingCurrency(preset, billingUsed);
			const pricingProfile = coerceModelPricingProfileInput(pricingRaw);
			if (!pricingProfile) {
				throw badRequest(`Static preset "${id}": missing or invalid pricing for ${billingUsed}`);
			}

			const body: AdminModelMutationInput = {
				id,
				display_name: preset.display_name ?? null,
				vendor: normalizeModelVendorInput(preset.vendor),
				context_window: preset.context_window ?? null,
				max_tokens: preset.max_tokens ?? 8192,
				pricing_profile: pricingProfile,
			};

			await createModelService(repos, body);
			created++;
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			failed.push({ id, message });
		}
	}

	return {
		billing_currency_used: billingUsed,
		created,
		updated: 0,
		skipped_existing,
		failed,
	};
}
