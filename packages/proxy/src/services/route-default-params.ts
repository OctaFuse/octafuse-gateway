/**
 * 合并路由级默认参数：`custom_params` 与用户请求体深度合并。
 * 默认用户优先；信封 `force_override.body` 为 true 时路由字段优先。`headers` 不进入请求体。
 */
import { mergeRouteRequestBody } from '@octafuse/core/route-custom-params';
import type { RouteResult } from './model-router';

type JsonObject = Record<string, unknown>;

/**
 * 构造发往上游的请求体。
 * @param userBody 客户端 JSON 体（已解析为对象）
 */
export function buildRouteRequestBody(
  route: RouteResult,
  userBody: JsonObject
): JsonObject {
  return mergeRouteRequestBody(route.customParams, userBody);
}
