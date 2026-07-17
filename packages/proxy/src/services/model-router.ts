/**
 * 模型路由解析：把 `model_routes` 行 + `providers` 拼成可上游请求的 `RouteResult`
 *（`providerEndpoints`、协议、`price_override` 等）。
 * 与 `route-selection` 配合：本模块负责「行 → 可调用对象」，不负责选哪几条 failover。
 * 完整上游 URL 由各 driver 按 capability 调用 `resolveUpstreamEndpoint`。
 */
import type { GatewayRepositories, ModelRouteRow, ProviderEndpointsMap, UpstreamProtocol } from '@octafuse/core';
import {
  extractMeteredProfileFromPriceOverrideJson,
  extractChargedProfileFromPriceOverrideJson,
  normalizeUpstreamProtocol,
  parseProviderEndpoints,
} from '@octafuse/core';

export interface RouteResult {
  providerId: string;
  /** `providers.name` 快照，供 `api_key_request_logs` 等落库 */
  providerName: string;
  providerModelName: string;
  upstreamProtocol: UpstreamProtocol;
  /**
   * 解析后的 provider endpoints（`providers.endpoints`）。
   * Driver 按 capability 调用 `resolveUpstreamEndpoint`。
   */
  providerEndpoints: ProviderEndpointsMap;
  providerApiKey: string;
  /** 原始 `model_routes.price_override` JSON，供审计与嵌套 profile 解析 */
  priceOverrideRaw: string | null;
  /** 自 `price_override.metered` 解析出的 JSON 字符串（无则 null）；供应侧 `metered_cost` */
  routeMeteredProfileJson: string | null;
  /** 自 `price_override.charged` 解析出的 JSON 字符串（无则 null）；用户预算 `charged_cost` 优先于此 */
  routeChargedProfileJson: string | null;
  customParams: Record<string, unknown> | null;
  routeGroup: string;
  /** `model_routes.priority`；同层 provider 的 key 池在调度时合并 */
  routePriority: number;
  /** 本次 attempt 选用的 provider key（由 failover 层写入） */
  providerKeyId?: string | null;
  providerKeyLabel?: string | null;
  providerKeyFingerprint?: string | null;
}

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignored by caller
  }
  return null;
}

async function routeRowToResult(repos: GatewayRepositories, route: ModelRouteRow): Promise<RouteResult | null> {
  const provider = await repos.providers.getProviderById(route.provider_id);
  if (!provider) {
    return null;
  }
  const protocol = normalizeUpstreamProtocol(route.upstream_protocol);
  const providerEndpoints = parseProviderEndpoints(provider);
  const customParams = parseJsonObject(route.custom_params);
  if (route.custom_params && !customParams) {
    console.warn(
      `[Gateway Router] ignored invalid custom_params JSON routeId=${route.id} modelId=${route.model_id}`
    );
  }

  const routeGroup =
    typeof route.route_group === 'string' && route.route_group.trim() !== ''
      ? route.route_group
      : 'default';

  return {
    providerId: provider.id,
    providerName: provider.name,
    providerModelName: route.provider_model_name,
    upstreamProtocol: protocol,
    providerEndpoints,
    providerApiKey: '',
    priceOverrideRaw: route.price_override,
    routeMeteredProfileJson: extractMeteredProfileFromPriceOverrideJson(route.price_override),
    routeChargedProfileJson: extractChargedProfileFromPriceOverrideJson(route.price_override),
    customParams,
    routeGroup,
    routePriority: route.priority,
    providerKeyId: null,
    providerKeyLabel: null,
    providerKeyFingerprint: null,
  };
}

/**
 * 将已筛选、已排序的 `model_routes` 行转为 `RouteResult[]`（顺序不变，通常应按 priority DESC）。
 * @param repos 网关仓储（按行查 provider）
 * @param rows 来自 `getModelRoutesByModelId` 或筛选子集
 * @returns 解析失败的行会被跳过（如 provider 缺失）
 */
export async function resolveRouteResultsFromRows(
  repos: GatewayRepositories,
  rows: ModelRouteRow[]
): Promise<RouteResult[]> {
  const result: RouteResult[] = [];
  for (const route of rows) {
    const r = await routeRowToResult(repos, route);
    if (r) {
      result.push(r);
    }
  }
  return result;
}

/**
 * 解析某统一模型 id 下全部 active 路由，按 priority 从高到低，供流式请求前故障转移依次尝试。
 * @param repos 网关仓储
 * @param modelId `models.id`（不含 `:route_group` 后缀）
 */
export async function resolveAllRoutes(repos: GatewayRepositories, modelId: string): Promise<RouteResult[]> {
  const routes = await repos.modelRouting.getModelRoutesByModelId(modelId);
  return resolveRouteResultsFromRows(repos, routes);
}

/**
 * 返回某模型下 active 路由的原始行（未 JOIN provider；供按协议过滤后再 `resolveRouteResultsFromRows`）。
 * @param repos 网关仓储
 * @param modelId `models.id`
 */
export async function getActiveModelRouteRows(repos: GatewayRepositories, modelId: string): Promise<ModelRouteRow[]> {
  return repos.modelRouting.getModelRoutesByModelId(modelId);
}

/**
 * 仅取最高一条路由（单路）。
 * @param repos 网关仓储
 * @param modelId `models.id`
 * @deprecated 请使用 `resolveAllRoutes` + proxy 故障转移。
 */
export async function resolveModel(repos: GatewayRepositories, modelId: string): Promise<RouteResult | null> {
  const routes = await resolveAllRoutes(repos, modelId);
  return routes.length > 0 ? routes[0]! : null;
}
