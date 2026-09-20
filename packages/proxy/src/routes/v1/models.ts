/**
 * 用户路由：`GET /v1/models` — OpenAI 兼容列表形态，附带 `model_info`（定价、tags、route_groups 等）。
 * 未传 `route_groups` 时默认仅返回 `default`/`free`，主要为兼容 agent 默认拉列表（FREE/VIP 分组）。
 * 未传 `kind` 时默认仅返回 LLM（排除文生图 / ASR / TTS）；文生图见 `POST /v1/images/*`。
 */
import {
	getUserChargedCostFactorMode,
	isAudioModel,
	isImageGenerationModel,
	isTextLlmModel,
	lookupUserChargedCostFactor,
	parseModelModalitiesJson,
	parsePricingProfile,
	parseUserChargedCostFactors,
	type DisplayDiscountGroup,
	type ParsedPricingProfile,
} from '@octafuse/core';
import { Hono } from 'hono';
import type { Env } from '../../app';
import { requireApiKey } from '../../middleware/auth';
import {
	filterRouteGroupsByAllowlist,
	normalizePublicModelVendor,
	parseMetadata,
	parseModelsKindQuery,
	parseModelsRouteGroupsQuery,
	parseRouteGroupsJson,
	parseTags,
} from '../../lib/model-list-parse';
import { collectInboundSurfaces, type InboundSurface } from '../../services/inbound-surfaces';
import { buildModelDisplayDiscounts, loadPublicModelListContext } from '../../services/public-models';

type ModelsEnv = Env & { Variables: { apiKey: import('../../middleware/auth').ApiKeyContext } };

export const modelsRoutes = new Hono<ModelsEnv>();

modelsRoutes.use('*', requireApiKey);

export {
	DEFAULT_MODELS_ROUTE_GROUPS,
	parseModelsKindQuery,
	parseModelsRouteGroupsQuery,
} from '../../lib/model-list-parse';

/**
 * `/v1/models` 中扩展字段：定价、能力与展示用元数据。
 * 说明：`supports_prompt_cache`、`thinking_config` 等由客户端维护，不由网关返回。
 * `inbound` 是请求入口（protocol + operation），不是上游协议；选哪条由客户端决定。
 */
interface ModelInfoResponse {
	display_name: string | null;
	/** 厂商/品牌；空串回退 other */
	vendor: string;
	/** 运营维护的展示标签，不含派生 Discount.* */
	tags: string[];
	/** 来自 active `model_routes` 的去重 route_group（计费通道） */
	route_groups: string[];
	context_window: number | null;
	max_tokens: number | null;
	/** 网关主定价对象（与 Catalog 同形）；完整阶梯等以此为准 */
	pricing_profile: ParsedPricingProfile | null;
	/**
	 * 由 `pricing_profile` 派生的兼容展示价（$/1M）：取各档中 **最低 input_price** 所在档的 in/out；
	 * 无合法 profile 时为 null。新客户端应解析完整 `pricing_profile`（`tiers`）。
	 */
	input_price: number | null;
	output_price: number | null;
	description: string | null;
	/** Parsed input modality list (e.g. text, image, file). */
	input_modalities: string[] | null;
	/** Parsed output modality list (e.g. text). */
	output_modalities: string[] | null;
	/** Model release date `YYYY-MM-DD`. */
	released_at: string | null;
	/**
	 * 按 route_group 派生的前台折扣（官方时段 × 代表路由 charged 有效倍率）。
	 * 已叠该用户的 `charged_cost_factors`（若已配置该模型）。
	 */
	discounts?: Record<string, DisplayDiscountGroup>;
	metadata?: Record<string, unknown>;
	/** 请求入口（LLM 文本 + 文生图 / ASR / TTS operation），按可见路由聚合。 */
	inbound: InboundSurface[];
}

interface ModelResponse {
	id: string;
	object: string;
	owned_by: string;
	model_info?: ModelInfoResponse;
}

/** 对外列表：从 `tiers` 取 input 最低价所在档作为 headline in/out；无 profile 返回 null。 */
function displayCompatPricesFromProfile(profile: ParsedPricingProfile | null): {
	input_price: number | null;
	output_price: number | null;
} {
	if (!profile || profile.tiers.length === 0) {
		return { input_price: null, output_price: null };
	}
	let best = profile.tiers[0]!;
	for (const t of profile.tiers) {
		if (t.input_price < best.input_price) {
			best = t;
		}
	}
	return { input_price: best.input_price, output_price: best.output_price };
}

/**
 * `GET /v1/models` — 可选 `route_groups`（CSV）过滤 `model_info.route_groups`；
 * 可选 `kind`：`llm`（默认）| `image` | `audio`（ASR + TTS）| `all`。
 * 未传 `route_groups` 时默认 `default,free`，主要为兼容 agent 默认拉列表方式；
 * 业务需额外分组时可显式传 `route_groups=web` 或 `route_groups=default,free,web`。
 */
modelsRoutes.get('/', async (c) => {
	const repos = c.get('repositories');
	const apiKey = c.get('apiKey');
	const { models, routesByModel, timezone } = await loadPublicModelListContext(repos);
	const allowedRouteGroups = parseModelsRouteGroupsQuery(c.req.query('route_groups'));
	const kind = parseModelsKindQuery(c.req.query('kind'));
	const userChargedFactorMode = await getUserChargedCostFactorMode(repos);
	const userFactors = parseUserChargedCostFactors(apiKey.chargedCostFactors);

	const list: ModelResponse[] = [];
	for (const m of models) {
		const kindFields = {
			output_modalities: m.output_modalities,
			input_modalities: m.input_modalities,
			pricing_profile: m.pricing_profile,
		};
		if (kind === 'llm' && !isTextLlmModel(kindFields)) {
			continue;
		}
		if (kind === 'image' && !isImageGenerationModel(kindFields)) {
			continue;
		}
		if (kind === 'audio' && !isAudioModel(kindFields)) {
			continue;
		}
		const pricingProfile = parsePricingProfile(m.pricing_profile ?? undefined);
		const { input_price, output_price } = displayCompatPricesFromProfile(pricingProfile);
		const routeGroups = filterRouteGroupsByAllowlist(
			parseRouteGroupsJson(m.route_groups ?? null),
			allowedRouteGroups
		);
		if (routeGroups.length === 0) {
			continue;
		}
		const discounts = buildModelDisplayDiscounts({
			model: m,
			routes: routesByModel.get(m.id) ?? [],
			timezone,
			allowedRouteGroups: routeGroups,
			userChargedFactor: lookupUserChargedCostFactor(userFactors, m.id),
			userChargedFactorMode,
		});
		const inbound = collectInboundSurfaces(routesByModel.get(m.id) ?? [], routeGroups);
		list.push({
			id: m.id,
			object: 'model',
			owned_by: 'octafuse',
			model_info: {
				display_name: m.display_name,
				vendor: normalizePublicModelVendor(m.vendor),
				tags: parseTags(m.tags),
				route_groups: routeGroups,
				discounts,
				context_window: m.context_window,
				max_tokens: m.max_tokens,
				pricing_profile: pricingProfile,
				input_price,
				output_price,
				description: m.description,
				input_modalities: parseModelModalitiesJson(m.input_modalities),
				output_modalities: parseModelModalitiesJson(m.output_modalities),
				released_at: m.released_at ?? null,
				metadata: parseMetadata(m.metadata),
				inbound,
			},
		});
	}

	return c.json({
		data: list,
		object: 'list',
	});
});
