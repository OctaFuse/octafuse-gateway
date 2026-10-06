/**
 * Admin 只读：按已保存的 `charged_cost_factors` 组装与 `GET /v1/models` 相同的列表折扣。
 * 不调用 Proxy，不使用用户 API Key，不计入 RPM。
 */
import {
	buildModelDisplayDiscounts,
	getBusinessTimezone,
	getUserChargedCostFactorMode,
	isAudioModel,
	isImageGenerationModel,
	isTextLlmModel,
	lookupUserChargedCostFactor,
	parseModelModalitiesJson,
	parsePricingProfile,
	parseUserChargedCostFactors,
	type DisplayDiscountGroup,
	type GatewayRepositories,
	type ModelRouteJoinRow,
	type ModelRow,
	type ParsedPricingProfile,
	type UserChargedCostFactorMode,
} from '@octafuse/core';
import { notFound } from './errors';
import { resolveAdminUserId } from './users-service';

/** 与 Proxy `GET /v1/models` 省略 `route_groups` 时一致。 */
export const USER_MODELS_PREVIEW_DEFAULT_ROUTE_GROUPS = ['default', 'free'] as const;

/** 单次预览上限，避免把整个目录一次性灌进用户详情。 */
export const USER_MODELS_PREVIEW_LIMIT = 40;

export type UserModelsPreviewKind = 'llm' | 'image' | 'audio' | 'all';

export type UserModelsPreviewQuery = {
	routeGroupsRaw?: string;
	kindRaw?: string;
	modelRaw?: string;
};

export type UserModelsPreviewItem = {
	id: string;
	object: 'model';
	owned_by: 'octafuse';
	model_info: {
		display_name: string | null;
		vendor: string;
		tags: string[];
		route_groups: string[];
		discounts: Record<string, DisplayDiscountGroup>;
		context_window: number | null;
		max_tokens: number | null;
		pricing_profile: ParsedPricingProfile | null;
		input_price: number | null;
		output_price: number | null;
		description: string | null;
		input_modalities: string[] | null;
		output_modalities: string[] | null;
		released_at: string | null;
		metadata?: Record<string, unknown>;
	};
};

export type UserModelsPreview = {
	/** 与 `GET /v1/models` 相同的列表信封。 */
	object: 'list';
	data: UserModelsPreviewItem[];
	preview: {
		user_charged_factor_mode: UserChargedCostFactorMode;
		route_groups: string[];
		kind: UserModelsPreviewKind;
		model: string | null;
		truncated: boolean;
		limit: number;
	};
};

/** 省略或无法识别时按文本模型，与 `GET /v1/models` 一致。 */
export function parseUserModelsPreviewKind(raw: string | undefined): UserModelsPreviewKind {
	const value = raw?.trim().toLowerCase();
	if (value === 'image' || value === 'audio' || value === 'all' || value === 'llm') return value;
	return 'llm';
}

/** 省略时为 `default,free`。 */
export function parseUserModelsPreviewRouteGroups(raw: string | undefined): string[] {
	if (raw == null || raw.trim() === '') return [...USER_MODELS_PREVIEW_DEFAULT_ROUTE_GROUPS];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const part of raw.split(',')) {
		const group = part.trim().toLowerCase();
		if (group === '' || seen.has(group)) continue;
		seen.add(group);
		out.push(group);
	}
	return out.length > 0 ? out : [...USER_MODELS_PREVIEW_DEFAULT_ROUTE_GROUPS];
}

function parseTags(tagsJson: string | null | undefined): string[] {
	if (!tagsJson) return [];
	try {
		const arr = JSON.parse(tagsJson) as unknown;
		return Array.isArray(arr) ? arr.filter((item): item is string => typeof item === 'string') : [];
	} catch {
		return [];
	}
}

function parseRouteGroupList(json: string | null | undefined): string[] {
	if (!json) return [];
	try {
		const arr = JSON.parse(json) as unknown;
		if (!Array.isArray(arr)) return [];
		const seen = new Set<string>();
		const out: string[] = [];
		for (const item of arr) {
			if (typeof item !== 'string' || item === '' || seen.has(item)) continue;
			seen.add(item);
			out.push(item);
		}
		return out;
	} catch {
		return [];
	}
}

function parseMetadata(metadataJson: string | null | undefined): Record<string, unknown> | undefined {
	if (!metadataJson) return undefined;
	try {
		const obj = JSON.parse(metadataJson) as unknown;
		return obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, unknown>) : undefined;
	} catch {
		return undefined;
	}
}

function headlinePrices(profile: ParsedPricingProfile | null): { input_price: number | null; output_price: number | null } {
	if (!profile || profile.tiers.length === 0) return { input_price: null, output_price: null };
	let best = profile.tiers[0]!;
	for (const tier of profile.tiers) {
		if (tier.input_price < best.input_price) best = tier;
	}
	return { input_price: best.input_price, output_price: best.output_price };
}

function matchesKind(model: ModelRow, kind: UserModelsPreviewKind): boolean {
	const fields = {
		output_modalities: model.output_modalities,
		input_modalities: model.input_modalities,
		pricing_profile: model.pricing_profile,
	};
	if (kind === 'all') return true;
	if (kind === 'image') return isImageGenerationModel(fields);
	if (kind === 'audio') return isAudioModel(fields);
	return isTextLlmModel(fields);
}

function routeGroupsForModel(model: ModelRow, routes: readonly ModelRouteJoinRow[]): string[] {
	const fromColumn = parseRouteGroupList(model.route_groups);
	if (fromColumn.length > 0) return fromColumn;
	const seen = new Set<string>();
	const out: string[] = [];
	for (const route of routes) {
		if (route.status !== 'active') continue;
		const group = route.route_group?.trim();
		if (!group || seen.has(group)) continue;
		seen.add(group);
		out.push(group);
	}
	return out;
}

function filterGroups(groups: string[], allowed: readonly string[]): string[] {
	const allow = new Set(allowed.map((group) => group.toLowerCase()));
	return groups.filter((group) => allow.has(group.toLowerCase()));
}

export async function getAdminUserModelsPreview(
	repos: GatewayRepositories,
	rawUserId: string,
	query: UserModelsPreviewQuery = {}
): Promise<UserModelsPreview> {
	const userId = await resolveAdminUserId(repos, rawUserId);
	const user = await repos.users.getById(userId);
	if (!user) throw notFound('User not found');

	const kind = parseUserModelsPreviewKind(query.kindRaw);
	const allowedRouteGroups = parseUserModelsPreviewRouteGroups(query.routeGroupsRaw);
	const modelQuery = query.modelRaw?.trim().toLowerCase() || null;
	const factors = parseUserChargedCostFactors(user.charged_cost_factors);

	const [models, routes, timezone, mode] = await Promise.all([
		repos.modelRouting.listModelsWithActiveRoutes(),
		repos.routes.listModelRoutesWithJoins({ status: 'active' }),
		getBusinessTimezone(repos),
		getUserChargedCostFactorMode(repos),
	]);
	const routesByModel = new Map<string, ModelRouteJoinRow[]>();
	for (const route of routes) {
		if (route.status !== 'active') continue;
		const list = routesByModel.get(route.model_id);
		if (list) list.push(route);
		else routesByModel.set(route.model_id, [route]);
	}

	const matched: UserModelsPreviewItem[] = [];
	let truncated = false;
	for (const model of models) {
		if (!matchesKind(model, kind)) continue;
		if (modelQuery && !`${model.id} ${model.display_name ?? ''}`.toLowerCase().includes(modelQuery)) continue;
		const modelRoutes = routesByModel.get(model.id) ?? [];
		const routeGroups = filterGroups(routeGroupsForModel(model, modelRoutes), allowedRouteGroups);
		if (routeGroups.length === 0) continue;
		if (matched.length >= USER_MODELS_PREVIEW_LIMIT) {
			truncated = true;
			break;
		}
		const pricingProfile = parsePricingProfile(model.pricing_profile ?? undefined);
		const prices = headlinePrices(pricingProfile);
		const metadata = parseMetadata(model.metadata);
		matched.push({
			id: model.id,
			object: 'model',
			owned_by: 'octafuse',
			model_info: {
				display_name: model.display_name,
				vendor: model.vendor?.trim() ? model.vendor : 'other',
				tags: parseTags(model.tags),
				route_groups: routeGroups,
				discounts: buildModelDisplayDiscounts({
					pricingProfileJson: model.pricing_profile,
					routes: modelRoutes,
					timezone,
					allowedRouteGroups: routeGroups,
					resolveUserChargedFactor: factors
						? (group) => lookupUserChargedCostFactor(factors, model.id, group)
						: undefined,
					userChargedFactorMode: mode,
				}),
				context_window: model.context_window,
				max_tokens: model.max_tokens,
				pricing_profile: pricingProfile,
				input_price: prices.input_price,
				output_price: prices.output_price,
				description: model.description,
				input_modalities: parseModelModalitiesJson(model.input_modalities),
				output_modalities: parseModelModalitiesJson(model.output_modalities),
				released_at: model.released_at ?? null,
				...(metadata ? { metadata } : {}),
			},
		});
	}

	return {
		object: 'list',
		data: matched,
		preview: {
			user_charged_factor_mode: mode,
			route_groups: allowedRouteGroups,
			kind,
			model: modelQuery,
			truncated,
			limit: USER_MODELS_PREVIEW_LIMIT,
		},
	};
}
