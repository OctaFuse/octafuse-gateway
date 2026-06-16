/**
 * Provider key pool 调度：weighted-random 顺序 + 单实例内存 cooldown。
 */
import type { ActiveProviderApiKeyRow } from '@octafuse/core';

const KEY_COOLDOWN_MS = 60_000;
const keyCooldownUntil = new Map<string, number>();

export function markProviderKeyCooldown(keyId: string, cooldownMs = KEY_COOLDOWN_MS): void {
	keyCooldownUntil.set(keyId, Date.now() + cooldownMs);
}

function isKeyEligible(keyId: string, now: number): boolean {
	return (keyCooldownUntil.get(keyId) ?? 0) <= now;
}

function weightedRandomOrder(keys: ActiveProviderApiKeyRow[]): ActiveProviderApiKeyRow[] {
	if (keys.length <= 1) return [...keys];
	const pool = [...keys];
	const ordered: ActiveProviderApiKeyRow[] = [];
	while (pool.length > 0) {
		const totalWeight = pool.reduce((sum, k) => sum + Math.max(1, k.weight), 0);
		let pick = Math.random() * totalWeight;
		let idx = 0;
		for (let i = 0; i < pool.length; i++) {
			pick -= Math.max(1, pool[i]!.weight);
			if (pick <= 0) {
				idx = i;
				break;
			}
		}
		ordered.push(pool[idx]!);
		pool.splice(idx, 1);
	}
	return ordered;
}

/**
 * 返回本次请求应依次尝试的 active keys（weighted-random；跳过 cooldown 中的 key）。
 * 若全部被 cooldown，则回退为全部 active keys 的 priority 顺序。
 */
export function selectProviderKeysForAttempt(keys: ActiveProviderApiKeyRow[]): ActiveProviderApiKeyRow[] {
	if (keys.length === 0) return [];
	const now = Date.now();
	const eligible = keys.filter((k) => isKeyEligible(k.id, now));
	const base = eligible.length > 0 ? eligible : keys;
	return weightedRandomOrder(base);
}

/** 测试用：清空 cooldown 状态。 */
export function resetProviderKeyCooldownStateForTests(): void {
	keyCooldownUntil.clear();
}
