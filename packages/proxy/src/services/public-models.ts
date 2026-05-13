/**
 * 对外模型列表：`GET /v1/models` 使用的只读视图（仅含至少一条 active 路由的模型）。
 */
import type { GatewayRepositories, ModelRow } from '@octafuse/core';

/**
 * 对外枚举可调用模型（至少一条 active 路由）；供 `GET /v1/models`。
 */
export async function listPublicModelsWithRoutes(repos: GatewayRepositories): Promise<ModelRow[]> {
	return repos.modelRouting.listModelsWithActiveRoutes();
}
