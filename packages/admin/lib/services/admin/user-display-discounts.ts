/**
 * Admin 只读：按用户叠 charged_cost_factors 后的前台 discounts，供下游 overlay。
 * 不计入用户 API Key RPM；不含模型 CRUD 字段。
 */
import {
	buildModelDisplayDiscounts,
	getBusinessTimezone,
	getUserChargedCostFactorMode,
	lookupUserChargedCostFactor,
	parseUserChargedCostFactors,
	type DisplayDiscountGroup,
	type GatewayRepositories,
	type ModelRouteJoinRow,
} from '@octafuse/core';
import { notFound } from './errors';
import { resolveAdminUserId } from './users-service';

export type AdminUserDisplayDiscountRow = {
	id: string;
	discounts: Record<string, DisplayDiscountGroup>;
};

function groupActiveRoutesByModel(routes: ModelRouteJoinRow[]): Map<string, ModelRouteJoinRow[]> {
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

/** Catalog-style `route_groups` CSV：空 / 缺省 → 全部 active group。 */
export function parseDisplayDiscountRouteGroupsQuery(raw: string | undefined): string[] | null {
	if (raw == null || raw.trim() === '') {
		return null;
	}
	const seen = new Set<string>();
	const out: string[] = [];
	for (const part of raw.split(',')) {
		const g = part.trim().toLowerCase();
		if (g === '' || seen.has(g)) continue;
		seen.add(g);
		out.push(g);
	}
	return out.length > 0 ? out : null;
}

export async function getAdminUserDisplayDiscounts(
	repos: GatewayRepositories,
	rawUserId: string,
	options?: { routeGroups?: string[] | null }
): Promise<AdminUserDisplayDiscountRow[]> {
	const userId = await resolveAdminUserId(repos, rawUserId);
	const user = await repos.users.getById(userId);
	if (!user) {
		throw notFound('User not found');
	}
	const factors = parseUserChargedCostFactors(user.charged_cost_factors);
	if (!factors) {
		return [];
	}

	const [models, routes, timezone, mode] = await Promise.all([
		repos.modelRouting.listModelsWithActiveRoutes(),
		// 前台折扣只看 active 路由；用户倍率在下方按请求叠加。
		repos.routes.listModelRoutesWithJoins({ status: 'active' }),
		getBusinessTimezone(repos),
		getUserChargedCostFactorMode(repos),
	]);
	const routesByModel = groupActiveRoutesByModel(routes);
	const allowedRouteGroups = options?.routeGroups ?? null;
	const data: AdminUserDisplayDiscountRow[] = [];

	for (const model of models) {
		const userFactor = lookupUserChargedCostFactor(factors, model.id);
		if (userFactor == null) continue;
		const discounts = buildModelDisplayDiscounts({
			pricingProfileJson: model.pricing_profile,
			routes: routesByModel.get(model.id) ?? [],
			timezone,
			allowedRouteGroups,
			userChargedFactor: userFactor,
			userChargedFactorMode: mode,
		});
		if (Object.keys(discounts).length === 0) continue;
		data.push({ id: model.id, discounts });
	}
	return data;
}
