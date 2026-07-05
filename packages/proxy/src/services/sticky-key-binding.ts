/**
 * 粘性 key 绑定：`userId + baseModelId + routeGroup + protocol` → `(providerId, keyId)`，空闲 TTL 过期。
 *
 * 目的：连续 chat 场景尽量命中同一 provider key 的上游 prompt cache（不同供应商账号缓存不共享）。
 * 配置为 opt-in（`models.sticky_config`，见 core `model-sticky-config.ts`）；
 * 状态为单实例进程内存，与限流/熔断一致。
 */

const MAX_ENTRIES = 50_000;

export type StickyBinding = {
	providerId: string;
	keyId: string;
};

type BindingEntry = StickyBinding & { expiresAt: number };

const bindingByKey = new Map<string, BindingEntry>();

function bindingKey(userId: string, baseModelId: string, routeGroup: string, protocol: string): string {
	return `${userId}\x1f${baseModelId}\x1f${routeGroup.trim().toLowerCase()}\x1f${protocol.trim().toLowerCase()}`;
}

function purgeExpired(now: number): void {
	for (const [key, entry] of bindingByKey) {
		if (entry.expiresAt <= now) {
			bindingByKey.delete(key);
		}
	}
}

/** 读取有效绑定；过期即删并返回 null。不刷新 TTL（成功后由 `setStickyBinding` 刷新）。 */
export function getStickyBinding(
	userId: string,
	baseModelId: string,
	routeGroup: string,
	protocol: string,
	now = Date.now()
): StickyBinding | null {
	const key = bindingKey(userId, baseModelId, routeGroup, protocol);
	const entry = bindingByKey.get(key);
	if (!entry) return null;
	if (entry.expiresAt <= now) {
		bindingByKey.delete(key);
		return null;
	}
	return { providerId: entry.providerId, keyId: entry.keyId };
}

/** 写入/刷新绑定（请求成功后调用，空闲 TTL 重新计时）。 */
export function setStickyBinding(
	userId: string,
	baseModelId: string,
	routeGroup: string,
	protocol: string,
	binding: StickyBinding,
	ttlSeconds: number,
	now = Date.now()
): void {
	if (bindingByKey.size >= MAX_ENTRIES) {
		purgeExpired(now);
		if (bindingByKey.size >= MAX_ENTRIES) return; // 容量兜底：放弃写入而非无限增长
	}
	bindingByKey.set(bindingKey(userId, baseModelId, routeGroup, protocol), {
		...binding,
		expiresAt: now + ttlSeconds * 1000,
	});
}

/** 测试用：清空绑定状态。 */
export function resetStickyBindingStateForTests(): void {
	bindingByKey.clear();
}
