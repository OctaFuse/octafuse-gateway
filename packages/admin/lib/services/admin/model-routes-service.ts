/**
 * 管理后台 `model_routes` CRUD：校验上游协议与 provider 是否配置对应 base URL，并规范化 JSON 参数字段。
 */
import type { GatewayRepositories } from '@octafuse/core';
import { isImageGenerationModel } from '@octafuse/core/db/model-modalities';
import { normalizeUpstreamProtocol } from '@octafuse/core/upstream-protocol';
import { badRequest, notFound } from './errors';
import { coerceRoutePriceOverrideInput, assertRoutePriceOverrideFactors } from './pricing-input';
import { normalizeJsonObjectField, providerSupportsUpstreamProtocol } from './shared';
import type {
	AdminCreatedIdOutput,
	AdminModelRouteMutationInput,
	AdminModelRouteRow,
} from './types';

/** Image-generation catalog models may only use OpenAI Images–compatible routes. */
async function assertImageModelOpenaiProtocol(
	repos: GatewayRepositories,
	modelId: string,
	proto: 'openai' | 'anthropic' | 'gemini'
): Promise<void> {
	const model = await repos.models.getModelDetailWithRouteCounts(modelId);
	if (!model) return;
	if (
		isImageGenerationModel({
			output_modalities: model.output_modalities as string | null | undefined,
			pricing_profile: model.pricing_profile as string | null | undefined,
		}) &&
		proto !== 'openai'
	) {
		throw badRequest(
			'Image-generation models require upstream_protocol=openai (Gateway Images API only uses OpenAI routes).'
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

	let proto: 'openai' | 'anthropic' | 'gemini';
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
	await assertImageModelOpenaiProtocol(repos, modelId, proto);

	const routeGroup =
		typeof body.route_group === 'string' && body.route_group.trim() !== '' ? body.route_group.trim() : 'default';
	const id = crypto.randomUUID();
	const priceOverride = coerceRoutePriceOverrideInput(body.price_override);
	assertRoutePriceOverrideFactors(priceOverride);

	await repos.routes.insertModelRoute({
		id,
		modelId,
		providerId,
		providerModelName,
		priority: Number(body.priority ?? 0),
		status: String(body.status ?? 'active'),
		routeGroup,
		priceOverride,
		customParams: customParamsNorm.value,
		upstreamProtocol: proto,
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
	const hasPatch = Object.values(patch).some((v) => v !== undefined);
	if (!hasPatch) return;

	const existing = await repos.routes.getModelRouteRowById(id);
	if (!existing) throw notFound('Route not found');
	const effectiveModelId =
		patch.model_id !== undefined ? String(patch.model_id) : String(existing.model_id);
	const effectiveProto = (patch.upstream_protocol !== undefined
		? patch.upstream_protocol
		: existing.upstream_protocol) as 'openai' | 'anthropic' | 'gemini';
	await assertImageModelOpenaiProtocol(repos, effectiveModelId, effectiveProto);

	const changes = await repos.routes.updateModelRouteByPatch(id, patch);
	if (!changes) throw notFound('Route not found');
}

/** 删除路由；不存在抛 `notFound`。 */
export async function deleteModelRouteService(repos: GatewayRepositories, id: string): Promise<void> {
	const changes = await repos.routes.deleteModelRouteById(id);
	if (!changes) throw notFound('Route not found');
}
