/**
 * 用户路由：`GET /v1/models` — OpenAI 兼容列表形态，附带 `model_info`（定价、tags、route_groups 等）。
 * 未传 `route_groups` 时默认仅返回 `default`/`free`，主要为兼容 agent 默认拉列表（FREE/VIP 分组）。
 * 未传 `kind` 时默认仅返回 LLM（排除文生图，如 gpt-image-2）；文生图见 `POST /v1/images/*`。
 */
import {
	isImageGenerationModel,
	isTextLlmModel,
	parseModelModalitiesJson,
	parsePricingProfile,
} from '@octafuse/core';
import { Hono } from 'hono';
import type { Env } from '../../app';
import { requireApiKey } from '../../middleware/auth';
import {
	filterRouteGroupsByAllowlist,
	parseMetadata,
	parseModelsKindQuery,
	parseModelsRouteGroupsQuery,
	parseRouteGroupsJson,
	parseTags,
} from '../../lib/model-list-parse';
import { listPublicModelsWithRoutes } from '../../services/public-models';

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
 * 说明：`supports_prompt_cache`、`thinking_config` 等由 Agent 本地维护，不由网关返回。
 */
interface ModelInfoResponse {
	display_name: string | null;
	/** 厂商/品牌；缺省归为 other */
	vendor: string;
	tags: string[];
	/** 来自 active `model_routes` 的去重 route_group（计费通道） */
	route_groups: string[];
	context_window: number | null;
	max_tokens: number | null;
	/** 网关主定价 JSON；完整阶梯等以此为准 */
	pricing_profile: string | null;
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
	metadata?: Record<string, unknown>;
}

interface ModelResponse {
	id: string;
	object: string;
	owned_by: string;
	model_info?: ModelInfoResponse;
}

/** 对外列表：从 `tiers` 取 input 最低价所在档作为 headline in/out；无 profile 返回 null。 */
function displayCompatPricesFromProfile(pricingProfile: string | null): {
	input_price: number | null;
	output_price: number | null;
} {
	const p = parsePricingProfile(pricingProfile ?? undefined);
	if (!p || p.tiers.length === 0) {
		return { input_price: null, output_price: null };
	}
	let best = p.tiers[0]!;
	for (const t of p.tiers) {
		if (t.input_price < best.input_price) {
			best = t;
		}
	}
	return { input_price: best.input_price, output_price: best.output_price };
}

/**
 * `GET /v1/models` — 可选 `route_groups`（CSV）过滤 `model_info.route_groups`；
 * 可选 `kind`：`llm`（默认）| `image` | `all`。
 * 未传 `route_groups` 时默认 `default,free`，主要为兼容 agent 默认拉列表方式；
 * 业务需额外分组时可显式传 `route_groups=web` 或 `route_groups=default,free,web`。
 */
modelsRoutes.get('/', async (c) => {
	const repos = c.get('repositories');
	const models = await listPublicModelsWithRoutes(repos);
	const allowedRouteGroups = parseModelsRouteGroupsQuery(c.req.query('route_groups'));
	const kind = parseModelsKindQuery(c.req.query('kind'));

	const list: ModelResponse[] = [];
	for (const m of models) {
		const kindFields = {
			output_modalities: m.output_modalities,
			pricing_profile: m.pricing_profile,
		};
		if (kind === 'llm' && !isTextLlmModel(kindFields)) {
			continue;
		}
		if (kind === 'image' && !isImageGenerationModel(kindFields)) {
			continue;
		}
		const { input_price, output_price } = displayCompatPricesFromProfile(m.pricing_profile);
		const routeGroups = filterRouteGroupsByAllowlist(
			parseRouteGroupsJson(m.route_groups ?? null),
			allowedRouteGroups
		);
		if (routeGroups.length === 0) {
			continue;
		}
		list.push({
			id: m.id,
			object: 'model',
			owned_by: 'octafuse',
			model_info: {
				display_name: m.display_name,
				vendor: m.vendor,
				tags: parseTags(m.tags),
				route_groups: routeGroups,
				context_window: m.context_window,
				max_tokens: m.max_tokens,
				pricing_profile: m.pricing_profile,
				input_price,
				output_price,
				description: m.description,
				input_modalities: parseModelModalitiesJson(m.input_modalities),
				output_modalities: parseModelModalitiesJson(m.output_modalities),
				released_at: m.released_at ?? null,
				metadata: parseMetadata(m.metadata),
			},
		});
	}

	return c.json({
		data: list,
		object: 'list',
	});
});
