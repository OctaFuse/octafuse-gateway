/**
 * 管理后台 `models` + `model_tags`：列表/详情（含路由计数）、创建、部分更新、级联删除、静态目录导入。
 */
import type { GatewayRepositories } from '@octafuse/core';
import { normalizeModelStickyConfigInput } from '@octafuse/core/db/model-sticky-config';
import {
	coerceModelInputModalitiesInput,
	coerceModelOutputModalitiesInput,
	coerceModelReleasedAtInput,
	isImageGenerationModel,
} from '@octafuse/core/db/model-modalities';
import {
	BILLING_CURRENCY_KEY,
	tryParseGatewaySupportedBillingCurrencyInput,
	type GatewaySupportedBillingCurrency,
} from '@octafuse/core/lib/billing-currency';
import { getGatewayCurrencySymbol } from '@/lib/format-gateway-currency';
import { listStaticModelPresets, pickPresetPricingRawForBillingCurrency } from '@/lib/model-preset';
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

function applyModelMutationCoercion(rest: Record<string, unknown>): Record<string, unknown> {
	const out = { ...rest };
	if ('input_modalities' in out && out.input_modalities !== undefined) {
		out.input_modalities = coerceModelInputModalitiesInput(out.input_modalities);
	}
	if ('output_modalities' in out && out.output_modalities !== undefined) {
		out.output_modalities = coerceModelOutputModalitiesInput(out.output_modalities);
	}
	if ('released_at' in out && out.released_at !== undefined) {
		out.released_at = coerceModelReleasedAtInput(out.released_at);
	}
	return out;
}

function formatPriceForPreview(value: unknown): string | null {
	if (typeof value !== 'number' || !Number.isFinite(value)) return null;
	return Number.isInteger(value) ? String(value) : String(value);
}

type CatalogPricingPreview = {
	label: string | null;
	detail: string | null;
};

function buildTokenPricingPreview(
	rawPricing: Record<string, unknown>,
	billing: GatewaySupportedBillingCurrency
): CatalogPricingPreview | null {
	const tiers = rawPricing.tiers;
	if (!Array.isArray(tiers) || tiers.length === 0) return null;

	const sym = getGatewayCurrencySymbol(billing);
	const unit = `${sym}/M`;
	const money = (n: string | null) => (n == null ? '—' : `${sym}${n}`);

	const lines: string[] = [];
	let firstIn: string | null = null;
	let firstOut: string | null = null;
	let firstImageIn: string | null = null;
	let firstImageOut: string | null = null;
	for (let i = 0; i < tiers.length; i++) {
		const tier = tiers[i];
		if (!tier || typeof tier !== 'object' || Array.isArray(tier)) continue;
		const tierObj = tier as Record<string, unknown>;
		const inPrice = formatPriceForPreview(tierObj.input_price);
		const outPrice = formatPriceForPreview(tierObj.output_price);
		const imageIn = formatPriceForPreview(tierObj.image_input_price);
		const imageOut = formatPriceForPreview(tierObj.image_output_price);
		if (firstIn == null && inPrice != null) firstIn = inPrice;
		if (firstOut == null && outPrice != null) firstOut = outPrice;
		if (firstImageIn == null && imageIn != null) firstImageIn = imageIn;
		if (firstImageOut == null && imageOut != null) firstImageOut = imageOut;
		const cacheReadPrice = formatPriceForPreview(tierObj.cache_read_price);
		const cacheWritePrice = formatPriceForPreview(tierObj.cache_write_price);
		const imageInCache = formatPriceForPreview(tierObj.image_input_cache_price);
		const upto = tierObj.upto;
		const rangeLabel =
			typeof upto === 'number' && Number.isFinite(upto) ? `<=${upto}` : 'all tokens';
		const parts = [
			`text-in ${inPrice ?? '—'}`,
			`text-out ${outPrice ?? '—'}`,
			`cache-read ${cacheReadPrice ?? '—'}`,
		];
		if (cacheWritePrice != null) {
			parts.push(`cache-write ${cacheWritePrice}`);
		}
		if (imageIn != null || imageOut != null) {
			parts.push(`img-in ${imageIn ?? '—'}`);
			if (imageInCache != null) {
				parts.push(`img-in-cache ${imageInCache}`);
			}
			parts.push(`img-out ${imageOut ?? '—'}`);
		}
		lines.push(`Tier ${i + 1} (${rangeLabel}): ${parts.join(' · ')} (${unit})`);
	}
	if (lines.length === 0) return null;
	const hasImageToken = firstImageOut != null || firstImageIn != null;
	const label = hasImageToken
		? `${money(firstIn)} / ${money(firstImageIn)} / ${money(firstImageOut)} /M`
		: firstIn != null || firstOut != null
			? `${money(firstIn)} / ${money(firstOut)} /M`
			: `${tiers.length} tier(s)`;
	return { label, detail: lines.join('\n') };
}

function buildPerImagePricingPreview(
	rawPricing: Record<string, unknown>,
	billing: GatewaySupportedBillingCurrency
): CatalogPricingPreview | null {
	const mode = rawPricing.image_billing_mode;
	const image = rawPricing.image;
	const imageObj =
		image && typeof image === 'object' && !Array.isArray(image)
			? (image as Record<string, unknown>)
			: null;
	const defaultPrice = imageObj ? formatPriceForPreview(imageObj.default) : null;
	if (mode !== 'per_image' && defaultPrice == null) {
		return null;
	}
	if (defaultPrice == null) {
		return null;
	}
	const sym = getGatewayCurrencySymbol(billing);
	const unit = `${sym}/image`;
	return {
		label: `${sym}${defaultPrice} ${unit}`,
		detail: `Per-image output default: ${sym}${defaultPrice} ${unit}`,
	};
}

/** 按 `BILLING_CURRENCY` 选用的目录价分支：Image token / per_image / LLM 档位摘要。 */
function buildCatalogPricingPreview(
	rawPricing: unknown,
	_kind: 'llm' | 'image',
	billing: GatewaySupportedBillingCurrency
): CatalogPricingPreview {
	if (!rawPricing || typeof rawPricing !== 'object' || Array.isArray(rawPricing)) {
		return { label: null, detail: null };
	}
	const obj = rawPricing as Record<string, unknown>;
	return (
		buildPerImagePricingPreview(obj, billing) ??
		buildTokenPricingPreview(obj, billing) ?? {
			label: null,
			detail: null,
		}
	);
}

/** 全部模型列表，`tags` 从 JSON 字符串解析为数组。 */
export async function listModelsService(repos: GatewayRepositories): Promise<AdminModelRow[]> {
	const rows = await repos.models.listModelsWithRouteCounts();
	return rows.map((m) => ({ ...m, tags: parseTagsJson(m.tags as string | null) })) as AdminModelRow[];
}

/**
 * 创建模型并写入标签。
 * LLM：`max_tokens` 缺省 8192；文生图（`output` 含 image）：`context_window` / `max_tokens` 可为 null。
 * @throws `badRequest` 缺 id
 */
export async function createModelService(repos: GatewayRepositories, body: AdminModelMutationInput): Promise<AdminCreatedIdOutput> {
	const id = String(body.id ?? '');
	if (!id) throw badRequest('Model ID is required');

	const pricingProfile =
		body.pricing_profile !== undefined ? coerceModelPricingProfileInput(body.pricing_profile) : null;
	if (!pricingProfile) {
		throw badRequest('pricing_profile is required when creating a model');
	}
	const inputModalities =
		body.input_modalities !== undefined ? coerceModelInputModalitiesInput(body.input_modalities) : null;
	const outputModalities =
		body.output_modalities !== undefined ? coerceModelOutputModalitiesInput(body.output_modalities) : null;
	const releasedAt = body.released_at !== undefined ? coerceModelReleasedAtInput(body.released_at) : null;
	const isImage = isImageGenerationModel({
		output_modalities: outputModalities,
		pricing_profile: pricingProfile,
	});
	const maxTokens = isImage
		? body.max_tokens == null
			? null
			: Number(body.max_tokens)
		: (body.max_tokens ?? 8192);
	const contextWindow = isImage
		? body.context_window == null
			? null
			: Number(body.context_window)
		: body.context_window;

	await repos.models.insertModel({
		id,
		displayName: body.display_name,
		vendor: normalizeModelVendorInput(body.vendor),
		contextWindow,
		maxTokens,
		pricingProfile,
		description: body.description,
		metadata: body.metadata,
		inputModalities,
		outputModalities,
		releasedAt,
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
	if ('sticky_config' in rest && rest.sticky_config !== undefined) {
		try {
			rest.sticky_config = normalizeModelStickyConfigInput(
				rest.sticky_config == null ? null : String(rest.sticky_config)
			);
		} catch (err) {
			throw badRequest(err instanceof Error ? err.message : 'Invalid sticky_config');
		}
	}
	const coerced = applyModelMutationCoercion(rest);
	const changes = await repos.models.updateModelByPatch(id, coerced);
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

/**
 * 列出内置静态预设（供导入前勾选）。
 * 价格预览按 `billing`（与导入写入同源的 USD/CNY 分支）；默认 USD 便于单测。
 */
export function listStaticModelPresetCatalogForAdmin(
	billing: GatewaySupportedBillingCurrency = 'USD'
): AdminStaticModelPresetCatalogItem[] {
	return listStaticModelPresets()
		.map((p) => {
			const id = String(p.id ?? '').trim();
			const pricingRaw = pickPresetPricingRawForBillingCurrency(p, billing);
			let tierCount = 0;
			if (pricingRaw && typeof pricingRaw === 'object' && !Array.isArray(pricingRaw)) {
				const tiers = (pricingRaw as Record<string, unknown>).tiers;
				if (Array.isArray(tiers)) {
					tierCount = tiers.length;
				}
			}
			const kind: AdminStaticModelPresetCatalogItem['kind'] = isImageGenerationModel({
				output_modalities: p.modalities?.output ?? null,
				pricing_profile:
					pricingRaw != null && typeof pricingRaw === 'object'
						? JSON.stringify(pricingRaw)
						: null,
			})
				? 'image'
				: 'llm';
			const pricing = buildCatalogPricingPreview(pricingRaw, kind, billing);
			return {
				id,
				display_name: (p.display_name != null ? String(p.display_name) : null) || null,
				vendor: normalizeModelVendorInput(p.vendor),
				kind,
				context_window: p.context_window ?? null,
				max_tokens: p.max_tokens ?? null,
				tier_count: tierCount,
				pricing_label: pricing.label,
				pricing_preview: pricing.detail,
			};
		})
		.filter((row) => row.id.length > 0);
}

/** 读取当前 `BILLING_CURRENCY` 后列出导入目录（价格预览与即将写入的分支一致）。 */
export async function listStaticModelPresetCatalogForAdminService(
	repos: GatewayRepositories
): Promise<{
	billing_currency: GatewaySupportedBillingCurrency;
	items: AdminStaticModelPresetCatalogItem[];
}> {
	const rawCurrency = await repos.systemConfig.getConfig(BILLING_CURRENCY_KEY);
	const billing: GatewaySupportedBillingCurrency =
		tryParseGatewaySupportedBillingCurrencyInput(rawCurrency ?? '') ?? 'USD';
	return {
		billing_currency: billing,
		items: listStaticModelPresetCatalogForAdmin(billing),
	};
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

			const presetIsImage = isImageGenerationModel({
				output_modalities: preset.modalities?.output ?? null,
				pricing_profile: pricingProfile,
			});
			const body: AdminModelMutationInput = {
				id,
				display_name: preset.display_name ?? null,
				vendor: normalizeModelVendorInput(preset.vendor),
				context_window: preset.context_window ?? null,
				// Preserve null for image presets; LLM presets still default in createModelService
				max_tokens: presetIsImage ? (preset.max_tokens ?? null) : (preset.max_tokens ?? 8192),
				pricing_profile: pricingProfile,
				tags: Array.isArray(preset.tags) ? preset.tags.map((t) => String(t)) : [],
				input_modalities: preset.modalities?.input ?? null,
				output_modalities: preset.modalities?.output ?? null,
				released_at: preset.released ?? null,
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
