/**
 * Gateway 产品工具目录（Admin Tools 菜单与调用日志筛选）。
 * 记账侧 `provider_id` 固定为 {@link GATEWAY_TOOLS_PROVIDER_ID}；`model_id` 为 `tool:*`。
 */

export const GATEWAY_TOOLS_PROVIDER_ID = 'octafuse-tools';

export type GatewayToolDefinition = {
	/** 稳定 id，用于 UI / query `tool=` */
	id: string;
	/** 写入 `api_key_request_logs.model_id` */
	modelId: string;
	/** next-intl key under `tools.catalog.*` */
	nameKey: 'webSearch';
	/** 配置锚点（Tools Config 页内） */
	configAnchor: string;
};

/** 已上线的工具；新增 tool 时在此登记，供 Invocations 筛选与 Config 卡片扩展。 */
export const GATEWAY_TOOLS: readonly GatewayToolDefinition[] = [
	{
		id: 'web-search',
		modelId: 'tool:web-search',
		nameKey: 'webSearch',
		configAnchor: 'web-search',
	},
] as const;

export function findGatewayToolById(id: string | null | undefined): GatewayToolDefinition | undefined {
	if (!id?.trim()) {
		return undefined;
	}
	const raw = id.trim();
	return GATEWAY_TOOLS.find((t) => t.id === raw || t.modelId === raw);
}
