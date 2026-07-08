/**
 * Provider key 调度计划：把 protocol 已过滤的 routes + 各 provider 的 key 池编排为本次请求的尝试序列。
 *
 * 排序规则（priority 硬序 + 层内余量）：
 * 1. 按 `model_routes.priority` 层从高到低；**同层多个 provider 的 key 合并为一个池**。
 * 2. 层内按 `provider_api_keys.priority` 批次从高到低。
 * 3. 批次内按限流余量（`getProviderKeyHeadroom`）降序；余量差 <10% 视为并列，并列按 weight 加权随机打散。
 * 4. 熔断中（429 无头 5s→60s 梯度 / 显式 Retry-After）/ 限流中的 key 跳过，但记录最早恢复时间（供全不可用时返回 429 + Retry-After）。
 * 5. 粘性绑定的 key 若可用则提到首位；若仅因网关限流暂不可用且预计恢复 ≤ 短等待阈值，给出等待建议。
 */
import type { ActiveProviderApiKeyRow } from '@octafuse/core';
import type { RouteResult } from './model-router';
import { getProviderKeyCircuitRemainingMs } from './provider-key-circuit-breaker';
import { checkProviderKeyAvailability, getProviderKeyHeadroom } from './provider-key-rate-limiter';
import type { StickyBinding } from './sticky-key-binding';

/** 一次上游尝试：某条路由 + 该 provider 的某把 key。 */
export type KeyAttempt = {
	route: RouteResult;
	key: ActiveProviderApiKeyRow;
};

export type KeyAttemptPlan = {
	/** 依次尝试的候选（已排除熔断/限流中的 key） */
	attempts: KeyAttempt[];
	/** 被跳过的 key 中最早恢复等待 ms；无被跳过者为 null */
	earliestRetryAfterMs: number | null;
	/** 因 provider key 熔断被跳过的 key 数量 */
	skippedByCircuit: number;
	/** 因网关 key 限流被跳过的 key 数量 */
	skippedByRateLimiter: number;
	/**
	 * 粘性绑定 key 因网关限流被跳过、且预计恢复 ≤ shortWaitMs 时的等待建议；
	 * dispatch 层等待后应重新构建计划。
	 */
	stickyWait: { waitMs: number } | null;
};

/** 同批次内余量差小于该值视为并列（并列时按 weight 加权随机）。 */
const HEADROOM_TIE_EPSILON = 0.1;

function weightedRandomOrder(attempts: KeyAttempt[]): KeyAttempt[] {
	if (attempts.length <= 1) return [...attempts];
	const pool = [...attempts];
	const ordered: KeyAttempt[] = [];
	while (pool.length > 0) {
		const totalWeight = pool.reduce((sum, a) => sum + Math.max(1, a.key.weight), 0);
		let pick = Math.random() * totalWeight;
		let idx = 0;
		for (let i = 0; i < pool.length; i++) {
			pick -= Math.max(1, pool[i]!.key.weight);
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

/** 批次内排序：余量降序；余量接近（<10%）的相邻段内按 weight 加权随机。 */
function orderBatchByHeadroom(batch: KeyAttempt[], now: number): KeyAttempt[] {
	if (batch.length <= 1) return [...batch];
	const withHeadroom = batch.map((attempt) => ({
		attempt,
		headroom: getProviderKeyHeadroom(attempt.key, now),
	}));
	withHeadroom.sort((a, b) => b.headroom - a.headroom);

	const ordered: KeyAttempt[] = [];
	let groupStart = 0;
	while (groupStart < withHeadroom.length) {
		const leader = withHeadroom[groupStart]!.headroom;
		let groupEnd = groupStart + 1;
		while (groupEnd < withHeadroom.length && leader - withHeadroom[groupEnd]!.headroom < HEADROOM_TIE_EPSILON) {
			groupEnd += 1;
		}
		ordered.push(...weightedRandomOrder(withHeadroom.slice(groupStart, groupEnd).map((x) => x.attempt)));
		groupStart = groupEnd;
	}
	return ordered;
}

function groupAttemptsByKeyPriorityDesc(attempts: KeyAttempt[]): KeyAttempt[][] {
	const groups = new Map<number, KeyAttempt[]>();
	for (const attempt of attempts) {
		const bucket = groups.get(attempt.key.priority) ?? [];
		bucket.push(attempt);
		groups.set(attempt.key.priority, bucket);
	}
	return [...groups.entries()].sort((a, b) => b[0] - a[0]).map(([, group]) => group);
}

function groupRoutesByPriorityDesc(routes: RouteResult[]): RouteResult[][] {
	const groups = new Map<number, RouteResult[]>();
	for (const route of routes) {
		const bucket = groups.get(route.routePriority) ?? [];
		bucket.push(route);
		groups.set(route.routePriority, bucket);
	}
	return [...groups.entries()].sort((a, b) => b[0] - a[0]).map(([, group]) => group);
}

/**
 * 构建本次请求的 key 尝试计划。
 * @param routes 已按协议过滤的路由（含 `routePriority`）
 * @param keysByProvider 各 providerId 的 active key 池（批量预取）
 * @param sticky 粘性绑定与短等待阈值（无粘性时 null）
 */
export function buildKeyAttemptPlan(
	routes: RouteResult[],
	keysByProvider: Map<string, ActiveProviderApiKeyRow[]>,
	sticky: { binding: StickyBinding; shortWaitMs: number } | null = null,
	now = Date.now()
): KeyAttemptPlan {
	const attempts: KeyAttempt[] = [];
	let earliestRetryAfterMs: number | null = null;
	let skippedByCircuit = 0;
	let skippedByRateLimiter = 0;
	let stickyWait: { waitMs: number } | null = null;
	let stickyAttempt: KeyAttempt | null = null;

	const trackRetryAfter = (ms: number): void => {
		if (earliestRetryAfterMs == null || ms < earliestRetryAfterMs) {
			earliestRetryAfterMs = ms;
		}
	};

	for (const tier of groupRoutesByPriorityDesc(routes)) {
		const tierAttempts: KeyAttempt[] = [];
		for (const route of tier) {
			const keys = keysByProvider.get(route.providerId) ?? [];
			for (const key of keys) {
				tierAttempts.push({ route, key });
			}
		}

		for (const batch of groupAttemptsByKeyPriorityDesc(tierAttempts)) {
			const eligible: KeyAttempt[] = [];
			for (const attempt of batch) {
				const isStickyKey =
					sticky != null &&
					attempt.route.providerId === sticky.binding.providerId &&
					attempt.key.id === sticky.binding.keyId;

				const circuitRemainingMs = getProviderKeyCircuitRemainingMs(attempt.key.id, now);
				if (circuitRemainingMs > 0) {
					skippedByCircuit += 1;
					trackRetryAfter(circuitRemainingMs);
					continue;
				}
				const availability = checkProviderKeyAvailability(attempt.key, now);
				if (!availability.available) {
					skippedByRateLimiter += 1;
					trackRetryAfter(availability.retryAfterMs);
					if (isStickyKey && stickyWait == null && availability.retryAfterMs <= sticky.shortWaitMs) {
						stickyWait = { waitMs: availability.retryAfterMs };
					}
					continue;
				}
				if (isStickyKey) {
					stickyAttempt = attempt;
					continue; // 单独置顶，不参与批内排序
				}
				eligible.push(attempt);
			}
			attempts.push(...orderBatchByHeadroom(eligible, now));
		}
	}

	if (stickyAttempt) {
		attempts.unshift(stickyAttempt);
		stickyWait = null; // 绑定 key 可用时无需等待
	}

	return { attempts, earliestRetryAfterMs, skippedByCircuit, skippedByRateLimiter, stickyWait };
}

/** 测试用：重导出运行时状态清理（旧测试兼容入口已移除，请分别使用各服务的 reset）。 */
export { resetProviderKeyCircuitStateForTests } from './provider-key-circuit-breaker';
export { resetProviderKeyRateLimiterStateForTests } from './provider-key-rate-limiter';
