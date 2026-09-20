/**
 * 全局用户计费倍率合成模式：`system_config.USER_CHARGED_COST_FACTOR_MODE`。
 * 进程内缓存 30s；非法值回退 {@link DEFAULT_USER_CHARGED_COST_FACTOR_MODE}。
 */

import type { GatewayRepositories } from '../storage/repositories-types';

export const USER_CHARGED_COST_FACTOR_MODE_KEY = 'USER_CHARGED_COST_FACTOR_MODE';
export const USER_CHARGED_COST_FACTOR_MODE_CACHE_TTL_MS = 30_000;

export const USER_CHARGED_COST_FACTOR_MODES = ['multiply', 'min'] as const;
export type UserChargedCostFactorMode = (typeof USER_CHARGED_COST_FACTOR_MODES)[number];
export const DEFAULT_USER_CHARGED_COST_FACTOR_MODE: UserChargedCostFactorMode = 'multiply';

type CacheEntry = {
	value: UserChargedCostFactorMode;
	expiresAt: number;
};

let cache: CacheEntry | null = null;

export function resetUserChargedCostFactorModeCacheForTests(): void {
	cache = null;
}

export function isUserChargedCostFactorMode(value: string): value is UserChargedCostFactorMode {
	return (USER_CHARGED_COST_FACTOR_MODES as readonly string[]).includes(value);
}

export function normalizeUserChargedCostFactorMode(
	raw: string | null | undefined
): UserChargedCostFactorMode {
	const s = (raw ?? '').trim().toLowerCase();
	return isUserChargedCostFactorMode(s) ? s : DEFAULT_USER_CHARGED_COST_FACTOR_MODE;
}

/**
 * 读取全局用户计费倍率合成模式（带进程内存缓存）。
 */
export async function getUserChargedCostFactorMode(
	repos: GatewayRepositories
): Promise<UserChargedCostFactorMode> {
	const now = Date.now();
	if (cache && cache.expiresAt > now) {
		return cache.value;
	}
	const raw = await repos.systemConfig.getConfig(USER_CHARGED_COST_FACTOR_MODE_KEY);
	const value = normalizeUserChargedCostFactorMode(raw);
	cache = { value, expiresAt: now + USER_CHARGED_COST_FACTOR_MODE_CACHE_TTL_MS };
	return value;
}
