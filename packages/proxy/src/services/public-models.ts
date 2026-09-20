/**
 * 对外模型列表：`GET /v1/models` / `GET /catalog/models` 共用的只读视图。
 *
 * `loadPublicModelListContext` 只缓存「模型 + active 路由 + timezone」；
 * 用户 `charged_cost_factors` 不进缓存，由 `/v1/models` 在请求时再叠。
 */
import {
	buildModelDisplayDiscounts as buildCoreModelDisplayDiscounts,
	getBusinessTimezone,
	mergeDerivedDiscountTags,
	type DisplayDiscountGroup,
	type GatewayRepositories,
	type ModelRouteJoinRow,
	type ModelRow,
	type UserChargedCostFactorMode,
} from '@octafuse/core';
import { parseTags } from '../lib/model-list-parse';

export type PublicModelListContext = {
	models: ModelRow[];
	routesByModel: Map<string, ModelRouteJoinRow[]>;
	timezone: string;
};

/** Cloudflare isolate 本地短 TTL；Admin 写模型/路由无跨进程失效钩子。 */
export const PUBLIC_MODEL_LIST_CONTEXT_CACHE_TTL_MS = 45_000;

type CacheEntry = {
	value: PublicModelListContext;
	expiresAt: number;
};

let cache: CacheEntry | null = null;
let inflight: Promise<PublicModelListContext> | null = null;

export function resetPublicModelListContextCacheForTests(): void {
	cache = null;
	inflight = null;
}

export function groupActiveRoutesByModel(routes: ModelRouteJoinRow[]): Map<string, ModelRouteJoinRow[]> {
	const map = new Map<string, ModelRouteJoinRow[]>();
	for (const row of routes) {
		if (row.status !== 'active') continue;
		const list = map.get(row.model_id);
		if (list) {
			list.push(row);
		} else {
			map.set(row.model_id, [row]);
		}
	}
	return map;
}

/**
 * 对外枚举可调用模型（至少一条 active 路由）；供 `GET /v1/models`。
 */
export async function listPublicModelsWithRoutes(repos: GatewayRepositories): Promise<ModelRow[]> {
	return repos.modelRouting.listModelsWithActiveRoutes();
}

async function fetchPublicModelListContext(repos: GatewayRepositories): Promise<PublicModelListContext> {
	const [models, routes, timezone] = await Promise.all([
		repos.modelRouting.listModelsWithActiveRoutes(),
		repos.routes.listModelRoutesWithJoins({ status: 'active' }),
		getBusinessTimezone(repos),
	]);
	return {
		models,
		routesByModel: groupActiveRoutesByModel(routes),
		timezone,
	};
}

export async function loadPublicModelListContext(repos: GatewayRepositories): Promise<PublicModelListContext> {
	const now = Date.now();
	if (cache && cache.expiresAt > now) {
		return cache.value;
	}
	if (!inflight) {
		inflight = fetchPublicModelListContext(repos)
			.then((value) => {
				cache = { value, expiresAt: Date.now() + PUBLIC_MODEL_LIST_CONTEXT_CACHE_TTL_MS };
				return value;
			})
			.finally(() => {
				inflight = null;
			});
	}
	return inflight;
}

export function buildModelDisplayDiscounts(options: {
	model: ModelRow;
	routes: readonly ModelRouteJoinRow[];
	timezone: string;
	allowedRouteGroups?: readonly string[] | null;
	userChargedFactor?: number | null;
	userChargedFactorMode?: UserChargedCostFactorMode;
}): Record<string, DisplayDiscountGroup> {
	return buildCoreModelDisplayDiscounts({
		pricingProfileJson: options.model.pricing_profile,
		routes: options.routes,
		timezone: options.timezone,
		allowedRouteGroups: options.allowedRouteGroups,
		userChargedFactor: options.userChargedFactor,
		userChargedFactorMode: options.userChargedFactorMode,
	});
}

export function tagsWithDerivedDiscounts(
	model: ModelRow,
	discounts: Record<string, DisplayDiscountGroup>
): string[] {
	return mergeDerivedDiscountTags(parseTags(model.tags), discounts);
}
