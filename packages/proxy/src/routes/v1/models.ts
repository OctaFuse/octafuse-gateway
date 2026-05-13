/**
 * 用户路由：`GET /v1/models` — OpenAI 兼容列表形态，附带 `model_info`（定价、tags、route_groups 等）。
 */
import { parsePricingProfile } from '@octafuse/core';
import { Hono } from 'hono';
import type { Env } from '../../app';
import { requireApiKey } from '../../middleware/auth';
import { listPublicModelsWithRoutes } from '../../services/public-models';

type ModelsEnv = Env & { Variables: { apiKey: import('../../middleware/auth').ApiKeyContext } };

export const modelsRoutes = new Hono<ModelsEnv>();

modelsRoutes.use('*', requireApiKey);

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
  supports_images: boolean;
  description: string | null;
  metadata?: Record<string, unknown>;
}

interface ModelResponse {
  id: string;
  object: string;
  owned_by: string;
  model_info?: ModelInfoResponse;
}

/** D1 / 服务层 JSON 字符串列 → 标签 id 列表；解析失败返回 []。 */
function parseTags(tagsJson: string | null): string[] {
  if (tagsJson == null || tagsJson === '') return [];
  try {
    const arr = JSON.parse(tagsJson);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** `model_routes` 聚合得到的 JSON 数组 → 去重后的 `route_group` 字符串列表。 */
function parseRouteGroupsJson(json: string | null | undefined): string[] {
  if (json == null || json === '') return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const x of arr) {
      if (typeof x === 'string' && x !== '' && !seen.has(x)) {
        seen.add(x);
        out.push(x);
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** `models.metadata` JSON 对象；非对象或解析失败返回 `undefined`。 */
function parseMetadata(metadataJson: string | null): Record<string, unknown> | undefined {
  if (metadataJson == null || metadataJson === '') return undefined;
  try {
    const obj = JSON.parse(metadataJson);
    return obj && typeof obj === 'object' ? obj : undefined;
  } catch {
    return undefined;
  }
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

/** 无查询参数；返回全部对外可见模型及 `model_info`（含 tags、route_groups）。 */
modelsRoutes.get('/', async (c) => {
  const repos = c.get('repositories');
  const models = await listPublicModelsWithRoutes(repos);

  const list: ModelResponse[] = models.map((m) => {
    const { input_price, output_price } = displayCompatPricesFromProfile(m.pricing_profile);
    return {
      id: m.id,
      object: 'model',
      owned_by: 'octafuse',
      model_info: {
        display_name: m.display_name,
        vendor: m.vendor,
        tags: parseTags(m.tags),
        route_groups: parseRouteGroupsJson(m.route_groups ?? null),
        context_window: m.context_window,
        max_tokens: m.max_tokens,
        pricing_profile: m.pricing_profile,
        input_price,
        output_price,
        supports_images: !!m.supports_images,
        description: m.description,
        metadata: parseMetadata(m.metadata),
      },
    };
  });

  return c.json({
    data: list,
    object: 'list',
  });
});
