/**
 * 管理后台 `model_routes` CRUD：校验上游协议与 provider 是否配置对应 base URL，并规范化 JSON 参数字段。
 */
import type { GatewayRepositories, UpstreamProtocol } from '@octafuse/core';
import {
	canonicalizeRequestOperation,
	isDashScopeRealtimeAsrModelOperationCompatible,
	isRouteAdapterCompatible,
	isRequestOperationForProtocol,
	normalizeRouteOperation,
	PASSTHROUGH_ROUTE_ADAPTER,
} from '@octafuse/core';
import { isImageGenerationModel } from '@octafuse/core/db/model-modalities';
import { normalizeUpstreamProtocol } from '@octafuse/core/upstream-protocol';
import { isRouteStrategyName } from '@octafuse/core/db/model-route-policy';
import { normalizeRoutePoolTierStrategiesInput } from '@octafuse/core/db/route-pool-tier-strategies';
import { buildAffinityKey, hashAffinityKey } from '@octafuse/core/db/route-affinity-key';
import { normalizeStickyRoutingInput } from '@octafuse/core/db/route-pool-sticky-types';
import { badRequest, notFound } from './errors';
import { coerceRoutePriceOverrideInput, assertRoutePriceOverrideFactors } from './pricing-input';
import { normalizeJsonObjectField, providerSupportsUpstreamProtocol } from './shared';
import { listAdminUsers, resolveAdminUserId } from './users-service';
import type {
	AdminCreatedIdOutput,
	AdminModelRouteMutationInput,
	AdminModelRouteRow,
} from './types';

/** Image models keep an OpenAI public entry; upstream may be OpenAI passthrough or DashScope conversion. */
async function assertImageModelUpstreamProtocol(
	repos: GatewayRepositories,
	modelId: string,
	proto: UpstreamProtocol
): Promise<void> {
	const model = await repos.models.getModelDetailWithRouteCounts(modelId);
	if (!model) return;
	if (
		isImageGenerationModel({
			output_modalities: model.output_modalities as string | null | undefined,
			pricing_profile: model.pricing_profile as string | null | undefined,
		}) &&
		proto !== 'openai' &&
		proto !== 'dashscope'
	) {
		throw badRequest(
			'Image-generation models require upstream_protocol=openai or dashscope (OpenAI Images passthrough or DashScope conversion).'
		);
	}
}

/** 跨协议路由必须命中 Core 中声明的精确 adapter 映射，不能靠协议名推断转换。 */
function assertRouteAdapterTopology(input: {
	adapter: string;
	requestProtocol: UpstreamProtocol;
	requestOperation: string;
	upstreamProtocol: UpstreamProtocol;
	upstreamOperation: string;
}): void {
	if (!isRouteAdapterCompatible(input)) {
		throw badRequest(
			`Adapter "${input.adapter}" does not support ${input.requestProtocol}.${input.requestOperation} -> ${input.upstreamProtocol}.${input.upstreamOperation}`
		);
	}
}

/** Fun-ASR/Qwen-Audio 与 Qwen3-ASR 的 WebSocket 生命周期不同，禁止保存可连接但必然失败的组合。 */
function assertDashScopeRealtimeAsrTopology(input: {
	upstreamProtocol: UpstreamProtocol;
	upstreamOperation: string;
	providerModelName: string;
}): void {
	if (
		input.upstreamProtocol === 'dashscope' &&
		!isDashScopeRealtimeAsrModelOperationCompatible(input.providerModelName, input.upstreamOperation)
	) {
		throw badRequest(
			`DashScope ASR model "${input.providerModelName}" is not compatible with upstream_operation "${input.upstreamOperation}"`,
		);
	}
}

/**
 * 路由列表；`model_id` / `provider_id` 来自查询串，可选。
 */
export async function listModelRoutesService(
	repos: GatewayRepositories,
	filters: { model_id?: string; provider_id?: string }
): Promise<AdminModelRouteRow[]> {
	return (await repos.routes.listModelRoutesWithJoins({
		modelId: filters.model_id,
		providerId: filters.provider_id,
	})) as unknown as AdminModelRouteRow[];
}

/**
 * 创建路由：校验必填字段、JSON 参数、协议与 provider base URL 是否匹配。
 * @throws `badRequest` 校验失败
 */
export async function createModelRouteService(
	repos: GatewayRepositories,
	body: AdminModelRouteMutationInput
): Promise<AdminCreatedIdOutput> {
	const modelId = String(body.model_id ?? '');
	const providerId = String(body.provider_id ?? '');
	const providerModelName = String(body.provider_model_name ?? '');
	if (!modelId || !providerId || !providerModelName) {
		throw badRequest('model_id, provider_id, and provider_model_name are required');
	}

	const customParamsNorm = normalizeJsonObjectField(body.custom_params, 'custom_params');
	if (!customParamsNorm.ok) throw badRequest(customParamsNorm.message);

	let proto: UpstreamProtocol;
	try {
		proto = normalizeUpstreamProtocol(String(body.upstream_protocol ?? 'openai'));
	} catch (e) {
		throw badRequest(e instanceof Error ? e.message : 'Invalid upstream_protocol');
	}

	const provider = await repos.providers.getProviderProtocolBases(providerId);
	if (!provider) throw badRequest('Provider not found');
	if (!providerSupportsUpstreamProtocol(proto, provider)) {
		throw badRequest(`Provider has no base URL for upstream protocol "${proto}".`);
	}
	await assertImageModelUpstreamProtocol(repos, modelId, proto);

	const routeGroup =
		typeof body.route_group === 'string' && body.route_group.trim() !== '' ? body.route_group.trim() : 'default';
	let requestProtocol: UpstreamProtocol;
	try {
		requestProtocol = normalizeUpstreamProtocol(
			String(body.request_protocol ?? body.upstream_protocol ?? 'openai')
		);
	} catch (e) {
		throw badRequest(e instanceof Error ? e.message : 'Invalid request_protocol');
	}
	const requestOperation = canonicalizeRequestOperation(
		requestProtocol,
		normalizeRouteOperation(body.request_operation)
	);
	if (!isRequestOperationForProtocol(requestProtocol, requestOperation)) {
		throw badRequest(
			`request_operation "${requestOperation}" is not valid for request_protocol "${requestProtocol}"`
		);
	}
	const upstreamOperation = canonicalizeRequestOperation(
		proto,
		normalizeRouteOperation(body.upstream_operation)
	);
	if (!isRequestOperationForProtocol(proto, upstreamOperation)) {
		throw badRequest(
			`upstream_operation "${upstreamOperation}" is not valid for upstream_protocol "${proto}"`
		);
	}
	assertDashScopeRealtimeAsrTopology({
		upstreamProtocol: proto,
		upstreamOperation,
		providerModelName,
	});
	const adapter = String(body.adapter ?? PASSTHROUGH_ROUTE_ADAPTER).trim() || PASSTHROUGH_ROUTE_ADAPTER;
	assertRouteAdapterTopology({
		adapter,
		requestProtocol,
		requestOperation,
		upstreamProtocol: proto,
		upstreamOperation,
	});

	const topology = await repos.routes.ensureModelSurfacePool({
		poolId: crypto.randomUUID(),
		surfaceId: crypto.randomUUID(),
		modelId,
		routeGroup,
		requestProtocol,
		requestOperation,
		poolName: `${requestProtocol}.${requestOperation} · ${routeGroup}`,
	});
	const id = crypto.randomUUID();
	const priceOverride = coerceRoutePriceOverrideInput(body.price_override);
	assertRoutePriceOverrideFactors(priceOverride);

	const weightRaw = body.weight;
	const weight =
		weightRaw === undefined || weightRaw === null || weightRaw === ''
			? 1
			: Number(weightRaw);
	if (!Number.isFinite(weight) || weight < 1) {
		throw badRequest('weight must be a number >= 1');
	}

	await repos.routes.insertModelRoute({
		id,
		modelId,
		providerId,
		providerModelName,
		priority: Number(body.priority ?? 0),
		weight: Math.floor(weight),
		status: String(body.status ?? 'active'),
		routeGroup,
		priceOverride,
		customParams: customParamsNorm.value,
		upstreamProtocol: proto,
		routePoolId: topology.poolId,
		upstreamOperation,
		adapter,
	});

	return { id };
}

/** 单条路由详情；不存在抛 `notFound`。 */
export async function getModelRouteService(repos: GatewayRepositories, id: string): Promise<AdminModelRouteRow> {
	const route = await repos.routes.getModelRouteRowById(id);
	if (!route) throw notFound('Route not found');
	return route as AdminModelRouteRow;
}

/**
 * 部分更新路由；键名与表列一致（snake_case）。无有效字段时直接返回。
 * @throws `badRequest` | `notFound`
 */
export async function updateModelRouteService(
	repos: GatewayRepositories,
	id: string,
	body: AdminModelRouteMutationInput
): Promise<void> {
	const patch = { ...body };
	delete patch.id;
	delete patch.request_protocol;
	delete patch.request_operation;
	if (patch.custom_params !== undefined) {
		const normalized = normalizeJsonObjectField(patch.custom_params, 'custom_params');
		if (!normalized.ok) throw badRequest(normalized.message);
		patch.custom_params = normalized.value;
	}
	if (patch.route_group !== undefined) {
		const g = String(patch.route_group).trim();
		if (g === '') throw badRequest('route_group cannot be empty');
		patch.route_group = g;
	}
	if (patch.weight !== undefined) {
		const weight = Number(patch.weight);
		if (!Number.isFinite(weight) || weight < 1) {
			throw badRequest('weight must be a number >= 1');
		}
		patch.weight = Math.floor(weight);
	}
	if (patch.price_override !== undefined) {
		const normalized = coerceRoutePriceOverrideInput(patch.price_override);
		assertRoutePriceOverrideFactors(normalized);
		patch.price_override = normalized;
	}
	if (patch.upstream_protocol !== undefined) {
		try {
			patch.upstream_protocol = normalizeUpstreamProtocol(String(patch.upstream_protocol));
		} catch (e) {
			throw badRequest(e instanceof Error ? e.message : 'Invalid upstream_protocol');
		}
	}
	const existing = await repos.routes.getModelRouteRowById(id);
	if (!existing) throw notFound('Route not found');
	const effectiveModelId =
		patch.model_id !== undefined ? String(patch.model_id) : String(existing.model_id);
	const effectiveProto = normalizeUpstreamProtocol(
		String(patch.upstream_protocol !== undefined ? patch.upstream_protocol : existing.upstream_protocol)
	);
	const effectiveProviderId =
		patch.provider_id !== undefined ? String(patch.provider_id) : String(existing.provider_id);
	const effectiveProviderModelName =
		patch.provider_model_name !== undefined
			? String(patch.provider_model_name)
			: String(existing.provider_model_name);
	const provider = await repos.providers.getProviderProtocolBases(effectiveProviderId);
	if (!provider) throw badRequest('Provider not found');
	if (!providerSupportsUpstreamProtocol(effectiveProto, provider)) {
		throw badRequest(`Provider has no base URL for upstream protocol "${effectiveProto}".`);
	}
	await assertImageModelUpstreamProtocol(repos, effectiveModelId, effectiveProto);

	const requestProtocolRaw = body.request_protocol;
	const requestOperationRaw = body.request_operation;
	const routeGroupChanging = patch.route_group !== undefined;
	const oldPoolId =
		existing.route_pool_id != null && String(existing.route_pool_id).trim() !== ''
			? String(existing.route_pool_id)
			: null;
	const updatesTopology =
		requestProtocolRaw !== undefined ||
		requestOperationRaw !== undefined ||
		body.upstream_protocol !== undefined ||
		body.upstream_operation !== undefined ||
		body.adapter !== undefined ||
		routeGroupChanging;
	const effectiveUpstreamOperation = canonicalizeRequestOperation(
		effectiveProto,
		normalizeRouteOperation(body.upstream_operation ?? existing.upstream_operation),
	);
	if (!isRequestOperationForProtocol(effectiveProto, effectiveUpstreamOperation)) {
		throw badRequest(
			`upstream_operation "${effectiveUpstreamOperation}" is not valid for upstream_protocol "${effectiveProto}"`,
		);
	}
	assertDashScopeRealtimeAsrTopology({
		upstreamProtocol: effectiveProto,
		upstreamOperation: effectiveUpstreamOperation,
		providerModelName: effectiveProviderModelName,
	});
	if (updatesTopology) {
		// request surface 存在独立表中；拓扑变更要求调用方提交完整 surface，避免从 target 行猜测。
		if (requestProtocolRaw === undefined || requestOperationRaw === undefined) {
			throw badRequest('Topology updates require request_protocol and request_operation');
		}
		let requestProtocol: UpstreamProtocol;
		try {
			requestProtocol = normalizeUpstreamProtocol(String(requestProtocolRaw));
		} catch (e) {
			throw badRequest(e instanceof Error ? e.message : 'Invalid request_protocol');
		}
		const requestOperation = canonicalizeRequestOperation(
			requestProtocol,
			normalizeRouteOperation(requestOperationRaw)
		);
		if (!isRequestOperationForProtocol(requestProtocol, requestOperation)) {
			throw badRequest(
				`request_operation "${requestOperation}" is not valid for request_protocol "${requestProtocol}"`
			);
		}
		const effectiveAdapter =
			body.adapter === undefined
				? String(existing.adapter ?? PASSTHROUGH_ROUTE_ADAPTER)
				: String(body.adapter).trim() || PASSTHROUGH_ROUTE_ADAPTER;
		assertRouteAdapterTopology({
			adapter: effectiveAdapter,
			requestProtocol,
			requestOperation,
			upstreamProtocol: effectiveProto,
			upstreamOperation: effectiveUpstreamOperation,
		});
		const effectiveGroup =
			patch.route_group !== undefined
				? String(patch.route_group)
				: String(existing.route_group ?? 'default');
		const topology = await repos.routes.ensureModelSurfacePool({
			poolId: crypto.randomUUID(),
			surfaceId: crypto.randomUUID(),
			modelId: effectiveModelId,
			routeGroup: effectiveGroup,
			requestProtocol,
			requestOperation,
			poolName: `${requestProtocol}.${requestOperation} · ${effectiveGroup}`,
		});
		patch.route_pool_id = topology.poolId;
		patch.upstream_operation = effectiveUpstreamOperation;
		patch.adapter = effectiveAdapter;
	}

	const hasPatch = Object.values(patch).some((v) => v !== undefined);
	if (!hasPatch) return;
	const changes = await repos.routes.updateModelRouteByPatch(id, patch);
	if (!changes) throw notFound('Route not found');

	const newPoolId =
		patch.route_pool_id != null && String(patch.route_pool_id).trim() !== ''
			? String(patch.route_pool_id)
			: null;
	if (oldPoolId && newPoolId && oldPoolId !== newPoolId) {
		await repos.routes.deleteRoutePoolIfEmpty(oldPoolId);
	}
}

/** 删除路由；不存在抛 `notFound`。空 Pool / Surface 一并 GC。 */
export async function deleteModelRouteService(repos: GatewayRepositories, id: string): Promise<void> {
	const existing = await repos.routes.getModelRouteRowById(id);
	if (!existing) throw notFound('Route not found');
	const poolId =
		existing.route_pool_id != null && String(existing.route_pool_id).trim() !== ''
			? String(existing.route_pool_id)
			: null;
	const changes = await repos.routes.deleteModelRouteById(id);
	if (!changes) throw notFound('Route not found');
	if (poolId) {
		await repos.routes.deleteRoutePoolIfEmpty(poolId);
	}
}

/**
 * Update pool-level routing policy.
 * - `strategy`: pool default (null/empty inherits model/global)
 * - `tier_strategies`: JSON map of priority → strategy (null/empty clears overrides)
 * - `sticky_routing`: `{ enabled, idle_ttl_seconds }` — bumps sticky_epoch
 * Only provided fields are written.
 */
export async function updateRoutePoolPolicyService(
	repos: GatewayRepositories,
	poolId: string,
	body: { strategy?: unknown; tier_strategies?: unknown; sticky_routing?: unknown }
): Promise<void> {
	const patch: {
		strategy?: string | null;
		tierStrategies?: string | null;
		stickyEnabled?: boolean;
		stickyIdleTtlSeconds?: number;
	} = {};

	if (body.strategy !== undefined) {
		const raw = body.strategy == null ? '' : String(body.strategy).trim().toLowerCase();
		if (raw && !isRouteStrategyName(raw)) {
			throw badRequest(`Invalid route pool strategy "${raw}"`);
		}
		patch.strategy = raw || null;
	}

	if (body.tier_strategies !== undefined) {
		try {
			if (
				body.tier_strategies == null ||
				(typeof body.tier_strategies === 'string' && body.tier_strategies.trim() === '')
			) {
				patch.tierStrategies = null;
			} else if (typeof body.tier_strategies === 'string') {
				patch.tierStrategies = normalizeRoutePoolTierStrategiesInput(body.tier_strategies);
			} else if (typeof body.tier_strategies === 'object' && !Array.isArray(body.tier_strategies)) {
				patch.tierStrategies = normalizeRoutePoolTierStrategiesInput(
					body.tier_strategies as Record<string, unknown>
				);
			} else {
				throw new Error('tier_strategies must be a JSON object');
			}
		} catch (err) {
			throw badRequest(err instanceof Error ? err.message : 'Invalid tier_strategies');
		}
	}

	if (body.sticky_routing !== undefined) {
		try {
			const sticky = normalizeStickyRoutingInput(body.sticky_routing);
			patch.stickyEnabled = sticky.enabled;
			patch.stickyIdleTtlSeconds = sticky.idle_ttl_seconds;
		} catch (err) {
			throw badRequest(err instanceof Error ? err.message : 'Invalid sticky_routing');
		}
	}

	if (
		patch.strategy === undefined &&
		patch.tierStrategies === undefined &&
		patch.stickyEnabled === undefined
	) {
		throw badRequest('Provide strategy, tier_strategies, and/or sticky_routing');
	}

	const changes = await repos.routes.updateRoutePoolPolicy(poolId, patch);
	if (!changes) throw notFound('Route pool not found');
}

/** @deprecated Use `updateRoutePoolPolicyService` */
export async function updateRoutePoolStrategyService(
	repos: GatewayRepositories,
	poolId: string,
	strategyInput: unknown
): Promise<void> {
	await updateRoutePoolPolicyService(repos, poolId, { strategy: strategyInput });
}

export type StickyBindingsSummary = {
	total_active: number;
	stale_count: number;
	targets: Array<{
		route_target_id: string;
		active_count: number;
		share: number;
		last_updated_at: string | null;
	}>;
};

/** Aggregate active sticky bindings for a pool (epoch-valid + not expired). */
export async function getStickyBindingsSummaryService(
	repos: GatewayRepositories,
	poolId: string
): Promise<StickyBindingsSummary> {
	const id = poolId.trim();
	if (!id) throw badRequest('poolId is required');
	const nowIso = new Date().toISOString();
	const [counts, stale_count] = await Promise.all([
		repos.routePoolSticky.listBindingTargetCounts(id, nowIso),
		repos.routePoolSticky.countStaleBindings(id, nowIso),
	]);
	const total_active = counts.reduce((sum, row) => sum + row.active_count, 0);
	return {
		total_active,
		stale_count,
		targets: counts.map((row) => ({
			route_target_id: row.route_target_id,
			active_count: row.active_count,
			share: total_active > 0 ? row.active_count / total_active : 0,
			last_updated_at: row.last_updated_at,
		})),
	};
}

export type StickyBindingLookupResult = {
	user_id: string;
	affinity_hash: string;
	affinity_key: string;
	binding: null | {
		route_target_id: string;
		expires_at: string;
		pool_epoch: number;
		remaining_seconds: number;
		epoch_valid: boolean;
		expired: boolean;
	};
};

/**
 * Lookup sticky binding for one user on a pool.
 * Requires surface context (model/group/protocol/operation) and asserts it maps to `poolId`.
 */
export async function lookupStickyBindingService(
	repos: GatewayRepositories,
	poolId: string,
	query: {
		user_id?: string | null;
		email?: string | null;
		model_id?: string | null;
		route_group?: string | null;
		protocol?: string | null;
		request_operation?: string | null;
	}
): Promise<StickyBindingLookupResult> {
	const id = poolId.trim();
	if (!id) throw badRequest('poolId is required');

	const modelId = query.model_id?.trim() || '';
	const routeGroup = query.route_group?.trim() || 'default';
	const protocolRaw = query.protocol?.trim() || '';
	const requestOperationRaw = query.request_operation?.trim() || '*';
	if (!modelId) throw badRequest('model_id is required');
	if (!protocolRaw) throw badRequest('protocol is required');

	let requestProtocol: UpstreamProtocol;
	try {
		requestProtocol = normalizeUpstreamProtocol(protocolRaw);
	} catch (e) {
		throw badRequest(e instanceof Error ? e.message : 'Invalid protocol');
	}
	const requestOperation = canonicalizeRequestOperation(
		requestProtocol,
		normalizeRouteOperation(requestOperationRaw)
	);

	const surface = await repos.modelRouting.resolveModelSurface({
		modelId,
		routeGroup,
		requestProtocol,
		requestOperation,
	});
	if (!surface) throw notFound('Model surface not found for the given context');
	if (String(surface.route_pool_id) !== id) {
		throw badRequest('Surface does not belong to this route pool');
	}

	let userId = query.user_id?.trim() || '';
	const email = query.email?.trim() || '';
	if (!userId && email) {
		const listed = await listAdminUsers(repos, { email, page: 1, page_size: 5 });
		const exact = listed.data.filter(
			(u) => String(u.email ?? '').toLowerCase() === email.toLowerCase()
		);
		if (exact.length === 0) throw notFound('User not found for email');
		if (exact.length > 1) {
			throw badRequest('Multiple users match this email; pass user_id instead');
		}
		userId = exact[0].id;
	}
	if (!userId) throw badRequest('user_id or email is required');
	userId = await resolveAdminUserId(repos, userId);

	const affinity_key = buildAffinityKey(userId, modelId, routeGroup, requestProtocol);
	const affinity_hash = await hashAffinityKey(affinity_key);
	const row = await repos.routePoolSticky.getBinding(id, affinity_hash);
	if (!row) {
		return { user_id: userId, affinity_hash, affinity_key, binding: null };
	}

	const nowMs = Date.now();
	const expiresMs = Date.parse(row.expires_at);
	const expired = !Number.isFinite(expiresMs) || expiresMs <= nowMs;
	const poolEpoch = Number(surface.pool_sticky_epoch ?? 0);
	const epoch_valid = row.pool_epoch === poolEpoch;
	const remaining_seconds = expired
		? 0
		: Math.max(0, Math.floor((expiresMs - nowMs) / 1000));

	return {
		user_id: userId,
		affinity_hash,
		affinity_key,
		binding: {
			route_target_id: row.route_target_id,
			expires_at: row.expires_at,
			pool_epoch: row.pool_epoch,
			remaining_seconds,
			epoch_valid,
			expired,
		},
	};
}

/** Admin force-clear one sticky binding (no token CAS). */
export async function forceClearStickyBindingService(
	repos: GatewayRepositories,
	poolId: string,
	affinityHash: string
): Promise<{ cleared: boolean }> {
	const id = poolId.trim();
	const hash = affinityHash.trim().toLowerCase();
	if (!id) throw badRequest('poolId is required');
	if (!/^[0-9a-f]{64}$/.test(hash)) throw badRequest('affinityHash must be a 64-char hex SHA-256');
	const cleared = await repos.routePoolSticky.forceClearBinding({
		routePoolId: id,
		affinityHash: hash,
	});
	return { cleared };
}

/** Bump pool sticky_epoch to invalidate all bindings. */
export async function resetStickyBindingsService(
	repos: GatewayRepositories,
	poolId: string
): Promise<{ sticky_epoch: number }> {
	const id = poolId.trim();
	if (!id) throw badRequest('poolId is required');
	const sticky_epoch = await repos.routes.bumpRoutePoolStickyEpoch(id);
	if (sticky_epoch == null) throw notFound('Route pool not found');
	return { sticky_epoch };
}
