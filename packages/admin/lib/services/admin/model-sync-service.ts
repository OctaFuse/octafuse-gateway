/**
 * Model 与官方目录同步：生成差异报告、按选中的字段应用官方值。
 *
 * 只写目录维护的字段（见 `lib/model-sync-diff.ts`）；永不触碰 tags、metadata、route_policy 与路由。
 * 应用时服务端重新计算差异，不信任前端展示过的内容；价格字段仍走 `updateModelService`，
 * 因此目录时段变化时会照常对齐路由 price_override 的 schedule。
 */
import type { GatewayRepositories } from '@octafuse/core';
import { resolveModelKind } from '@octafuse/core/db/model-kind';
import {
	BILLING_CURRENCY_KEY,
	tryParseGatewaySupportedBillingCurrencyInput,
	type GatewaySupportedBillingCurrency,
} from '@octafuse/core/lib/billing-currency';
import {
	listStaticModelPresets,
	pickPresetPricingRawForBillingCurrency,
	type StaticModelPresetRow,
} from '@/lib/model-preset';
import { getModelVendorLabel, normalizeModelVendorInput } from '@/lib/model-vendor';
import {
	buildModelSyncPatch,
	diffModelAgainstPreset,
	type ModelSyncApplyBody,
	type ModelSyncApplyOutput,
	type ModelSyncPresetInput,
	type ModelSyncReport,
	type ModelSyncVendorGroup,
} from '@/lib/model-sync-diff';
import { badRequest } from './errors';
import { updateModelService } from './models-service';
import { coerceModelPricingProfileInput } from './pricing-input';

async function readBillingCurrency(repos: GatewayRepositories): Promise<GatewaySupportedBillingCurrency> {
	const raw = await repos.systemConfig.getConfig(BILLING_CURRENCY_KEY);
	return tryParseGatewaySupportedBillingCurrencyInput(raw ?? '') ?? 'USD';
}

/** 目录项 → 比对输入；`description` 与导入时写入的取值一致。 */
function presetToSyncInput(
	preset: StaticModelPresetRow,
	billing: GatewaySupportedBillingCurrency
): ModelSyncPresetInput {
	let pricing: string | null = null;
	try {
		pricing = coerceModelPricingProfileInput(pickPresetPricingRawForBillingCurrency(preset, billing));
	} catch {
		pricing = null;
	}
	return {
		display_name: preset.display_name ?? null,
		vendor: preset.vendor ?? null,
		context_window: preset.context_window ?? null,
		max_tokens: preset.max_tokens ?? null,
		description: preset.description ?? preset.i18n?.en ?? null,
		released: preset.released ?? null,
		input_modalities: preset.modalities?.input ?? null,
		output_modalities: preset.modalities?.output ?? null,
		pricing_profile: pricing,
	};
}

function presetMap(): Map<string, StaticModelPresetRow> {
	return new Map(
		listStaticModelPresets()
			.map((p) => [String(p.id ?? '').trim(), p] as const)
			.filter(([id]) => id.length > 0)
	);
}

/** 差异报告：按厂商分组，只含与目录同 id 且有差异的模型。 */
export async function getModelSyncReportService(repos: GatewayRepositories): Promise<ModelSyncReport> {
	const billing = await readBillingCurrency(repos);
	const presets = presetMap();
	const rows = await repos.models.listModelsWithRouteCounts();
	const groups = new Map<string, ModelSyncVendorGroup>();
	let modelsWithDiff = 0;

	for (const row of rows) {
		const preset = presets.get(row.id);
		if (!preset) continue;
		const fields = diffModelAgainstPreset(row, presetToSyncInput(preset, billing));
		if (fields.length === 0) continue;
		modelsWithDiff += 1;

		const vendor = normalizeModelVendorInput(row.vendor);
		let group = groups.get(vendor);
		if (!group) {
			group = { vendor, vendor_label: getModelVendorLabel(vendor), models: [] };
			groups.set(vendor, group);
		}
		group.models.push({
			model_id: row.id,
			display_name: row.display_name ?? null,
			kind: resolveModelKind(row),
			routes_count: Number(row.routes_count ?? 0),
			active_routes_count: Number(row.active_routes_count ?? 0),
			fields,
		});
	}

	const sorted = [...groups.values()].sort((a, b) => a.vendor_label.localeCompare(b.vendor_label));
	for (const group of sorted) {
		group.models.sort((a, b) => a.model_id.localeCompare(b.model_id));
	}
	return { billing_currency: billing, groups: sorted, models_with_diff: modelsWithDiff };
}

/** 把选中的官方值写入各模型；单个失败不影响其余。 */
export async function applyModelSyncService(
	repos: GatewayRepositories,
	body: ModelSyncApplyBody
): Promise<ModelSyncApplyOutput> {
	const items = Array.isArray(body?.items) ? body.items : [];
	if (items.length === 0) {
		throw badRequest('items must be a non-empty array');
	}

	const billing = await readBillingCurrency(repos);
	const presets = presetMap();
	let updated = 0;
	let skipped = 0;
	const failed: ModelSyncApplyOutput['failed'] = [];
	const seen = new Set<string>();

	for (const item of items) {
		const modelId = String(item?.model_id ?? '').trim();
		const fields = Array.isArray(item?.fields) ? item.fields.map((f) => String(f)) : [];
		if (!modelId || fields.length === 0 || seen.has(modelId)) {
			skipped += 1;
			continue;
		}
		seen.add(modelId);

		try {
			const row = await repos.models.getModelDetailWithRouteCounts(modelId);
			if (!row) {
				failed.push({ model_id: modelId, message: 'Model not found' });
				continue;
			}
			const preset = presets.get(modelId);
			if (!preset) {
				skipped += 1;
				continue;
			}
			const patch = buildModelSyncPatch(row, presetToSyncInput(preset, billing), fields);
			if (Object.keys(patch).length === 0) {
				skipped += 1;
				continue;
			}
			await updateModelService(repos, modelId, patch);
			updated += 1;
		} catch (error) {
			failed.push({
				model_id: modelId,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return { updated, skipped, failed };
}
