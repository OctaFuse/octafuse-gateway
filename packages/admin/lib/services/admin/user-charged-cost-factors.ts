/**
 * Admin 写入 `users.charged_cost_factors`：形状校验、目录模型 ID，以及分组键必须是该模型已有路由的 route group。
 */
import type { GatewayRepositories } from '@octafuse/core';
import {
	normalizeUserChargedCostFactorsInput,
	USER_CHARGED_FACTOR_ANY_GROUP,
	type UserChargedCostFactors,
} from '@octafuse/core';
import { badRequest } from './errors';

export async function resolveAdminChargedCostFactorsInput(
	repos: GatewayRepositories,
	input: unknown
): Promise<string | null> {
	const parsed = normalizeUserChargedCostFactorsInput(input);
	if (!parsed.ok) {
		throw badRequest(parsed.message);
	}
	if (!parsed.value) {
		return null;
	}
	await assertKnownChargedCostFactorModels(repos, parsed.value);
	return parsed.json;
}

export async function assertKnownChargedCostFactorModels(
	repos: GatewayRepositories,
	factors: UserChargedCostFactors
): Promise<void> {
	const unknown: string[] = [];
	const unknownGroups: string[] = [];
	for (const [id, value] of Object.entries(factors)) {
		const model = await repos.modelRouting.getModelById(id);
		if (!model) {
			unknown.push(id);
			continue;
		}
		if (typeof value !== 'object' || value == null) continue;
		const routes = await repos.routes.listModelRoutesWithJoins({ modelId: id });
		const known = new Set(
			routes.map((row) => (row.route_group?.trim() || 'default').toLowerCase()).filter(Boolean)
		);
		for (const group of Object.keys(value)) {
			if (group === USER_CHARGED_FACTOR_ANY_GROUP) continue;
			if (!known.has(group)) unknownGroups.push(`${id}:${group}`);
		}
	}
	if (unknown.length > 0) {
		throw badRequest(`unknown model id(s) in charged_cost_factors: ${unknown.join(', ')}`);
	}
	if (unknownGroups.length > 0) {
		throw badRequest(`unknown route group(s) in charged_cost_factors: ${unknownGroups.join(', ')}`);
	}
}
