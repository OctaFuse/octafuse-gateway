/**
 * 对外模型列表：`GET /v1/models` / `GET /catalog/models` 共用的只读视图。
 */
import {
	buildDisplayDiscountsByRouteGroup,
	getBusinessTimezone,
	mergeDerivedDiscountTags,
	type DisplayDiscountGroup,
	type GatewayRepositories,
	type ModelRouteJoinRow,
	type ModelRow,
} from '@octafuse/core';
import { parseTags } from '../lib/model-list-parse';

export type PublicModelListContext = {
	models: ModelRow[];
	routesByModel: Map<string, ModelRouteJoinRow[]>;
	timezone: string;
};

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

export async function loadPublicModelListContext(repos: GatewayRepositories): Promise<PublicModelListContext> {
	const [models, routes, timezone] = await Promise.all([
		repos.modelRouting.listModelsWithActiveRoutes(),
		repos.routes.listModelRoutesWithJoins({}),
		getBusinessTimezone(repos),
	]);
	return {
		models,
		routesByModel: groupActiveRoutesByModel(routes),
		timezone,
	};
}

export function buildModelDisplayDiscounts(options: {
	model: ModelRow;
	routes: readonly ModelRouteJoinRow[];
	timezone: string;
	allowedRouteGroups?: readonly string[] | null;
}): Record<string, DisplayDiscountGroup> {
	return buildDisplayDiscountsByRouteGroup({
		routes: options.routes,
		pricingProfileJson: options.model.pricing_profile,
		timezone: options.timezone,
		allowedRouteGroups: options.allowedRouteGroups,
	});
}

export function tagsWithDerivedDiscounts(
	model: ModelRow,
	discounts: Record<string, DisplayDiscountGroup>
): string[] {
	return mergeDerivedDiscountTags(parseTags(model.tags), discounts);
}
