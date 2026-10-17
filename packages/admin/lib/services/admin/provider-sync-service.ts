/**
 * Provider 与官方模板同步：生成差异报告、按选中的字段应用官方值。
 *
 * 只写 `description` / `endpoints`；永不触碰 `api_key`、`status`、`name`、`kind`。
 * 应用时服务端重新计算差异，不信任前端展示过的内容。
 */
import type { GatewayRepositories } from '@octafuse/core';
import {
	getStaticProviderPresetByKind,
	listProviderKindChoices,
	providerImportStoredFields,
	suggestStaticProviderKindByEndpoints,
	resolveStoredProviderPresentation,
	type StaticProviderImportPresetRow,
} from '@/lib/provider-import-preset';
import { CUSTOM_PROVIDER_KIND } from '@/lib/provider-kind';
import {
	buildProviderSyncPatch,
	diffProviderAgainstPreset,
	type ProviderSyncApplyBody,
	type ProviderSyncApplyOutput,
	type ProviderSyncKindGroup,
	type ProviderSyncOrphanEntry,
	type ProviderSyncReport,
} from '@/lib/provider-sync-diff';
import { badRequest } from './errors';
import { listProvidersService, updateProviderService } from './providers-service';

/** 介绍按当前界面语言取目录摘要，端点仍按模板原文比对。 */
function presetForSync(preset: StaticProviderImportPresetRow, locale: string | null | undefined) {
	return {
		description: providerImportStoredFields(preset, locale).description,
		endpoints: preset.endpoints,
	};
}

/** 差异报告：按模板类型分组，另列出 kind 已失效的 provider。 */
export async function getProviderSyncReportService(
	repos: GatewayRepositories,
	locale?: string | null
): Promise<ProviderSyncReport> {
	const providers = await listProvidersService(repos);
	const groupsByKind = new Map<string, ProviderSyncKindGroup>();
	const orphans: ProviderSyncOrphanEntry[] = [];
	let providersWithDiff = 0;

	for (const provider of providers) {
		const kind = String(provider.kind ?? '').trim();
		if (!kind || kind === CUSTOM_PROVIDER_KIND) continue;

		const preset = getStaticProviderPresetByKind(kind);
		if (!preset) {
			orphans.push({
				provider_id: provider.id,
				provider_name: provider.name,
				kind,
				routes_count: Number(provider.routes_count ?? 0),
				suggested_kind: suggestStaticProviderKindByEndpoints(provider.endpoints),
			});
			continue;
		}

		const fields = diffProviderAgainstPreset(provider, presetForSync(preset, locale));
		if (fields.length === 0) continue;
		providersWithDiff += 1;

		let group = groupsByKind.get(kind);
		if (!group) {
			const presentation = resolveStoredProviderPresentation({ kind });
			group = {
				kind,
				label_en: presentation.kindLabels?.en ?? kind,
				label_zh: presentation.kindLabels?.zh ?? kind,
				vendor_key: presentation.vendorKey,
				icon_key: presentation.iconKey,
				providers: [],
			};
			groupsByKind.set(kind, group);
		}
		group.providers.push({
			provider_id: provider.id,
			provider_name: provider.name,
			status: provider.status === 'disabled' ? 'disabled' : 'active',
			routes_count: Number(provider.routes_count ?? 0),
			active_routes_count: Number(provider.active_routes_count ?? 0),
			fields,
		});
	}

	const groups = [...groupsByKind.values()].sort((a, b) => a.label_en.localeCompare(b.label_en));
	for (const group of groups) {
		group.providers.sort((a, b) => a.provider_name.localeCompare(b.provider_name));
	}

	return {
		groups,
		orphans,
		kind_choices: listProviderKindChoices().map((choice) => ({
			kind: choice.kind,
			label_en: choice.labels.en,
			label_zh: choice.labels.zh,
			vendor_key: choice.vendorKey,
			icon_key: choice.iconKey,
		})),
		providers_with_diff: providersWithDiff,
	};
}

/** 把选中的官方值写入各 provider；单个失败不影响其余。 */
export async function applyProviderSyncService(
	repos: GatewayRepositories,
	body: ProviderSyncApplyBody
): Promise<ProviderSyncApplyOutput> {
	const items = Array.isArray(body?.items) ? body.items : [];
	if (items.length === 0) {
		throw badRequest('items must be a non-empty array');
	}

	let updated = 0;
	let skipped = 0;
	const failed: ProviderSyncApplyOutput['failed'] = [];
	const seen = new Set<string>();

	for (const item of items) {
		const providerId = String(item?.provider_id ?? '').trim();
		const fields = Array.isArray(item?.fields) ? item.fields.map((f) => String(f)) : [];
		if (!providerId || fields.length === 0 || seen.has(providerId)) {
			skipped += 1;
			continue;
		}
		seen.add(providerId);

		try {
			const row = await repos.providers.getProviderRowById(providerId);
			if (!row) {
				failed.push({ provider_id: providerId, message: 'Provider not found' });
				continue;
			}
			const preset = getStaticProviderPresetByKind(String((row as { kind?: unknown }).kind ?? ''));
			if (!preset) {
				skipped += 1;
				continue;
			}
			const patch = buildProviderSyncPatch(
				row as { description?: string | null; endpoints?: string | null },
				presetForSync(preset, body.locale),
				fields
			);
			if (Object.keys(patch).length === 0) {
				skipped += 1;
				continue;
			}
			await updateProviderService(repos, providerId, patch);
			updated += 1;
		} catch (error) {
			failed.push({
				provider_id: providerId,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return { updated, skipped, failed };
}
