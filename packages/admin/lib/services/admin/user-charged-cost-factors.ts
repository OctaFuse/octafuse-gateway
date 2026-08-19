/**
 * Admin 写入 `users.charged_cost_factors`：形状校验 + 目录模型 ID 存在性。
 */
import type { GatewayRepositories } from '@octafuse/core';
import {
	normalizeUserChargedCostFactorsInput,
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
	for (const id of Object.keys(factors)) {
		const model = await repos.modelRouting.getModelById(id);
		if (!model) unknown.push(id);
	}
	if (unknown.length > 0) {
		throw badRequest(`unknown model id(s) in charged_cost_factors: ${unknown.join(', ')}`);
	}
}
