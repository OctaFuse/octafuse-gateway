import type { UpstreamProtocol } from '../upstream-protocol';

/**
 * 共享类型：仓储与插入语句构造共用。
 * `pricing_audit` 的 JSON 形状见 `pricing-audit.ts`。
 */
export type InsertRequestLogParams = {
	id: string;
	userId: string | null;
	apiKeyId: string;
	userEmail: string | null;
	modelId: string;
	providerId: string;
	providerModelName: string | null;
	modelName: string | null;
	providerName: string | null;
	requestBody: string | null;
	upstreamRequestBody: string | null;
	requestProtocol: 'openai' | 'anthropic' | 'gemini';
	upstreamProtocol: UpstreamProtocol;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	reasoningTokens: number;
	totalTokens: number;
	meteredCost: number;
	standardCost: number;
	chargedCost: number;
	routeGroup: string;
	status: 'success' | 'error' | 'incomplete' | 'cancelled';
	latencyMs: number | null;
	errorMessage: string | null;
	rawUsage: string | null;
	/** 计费审计 JSON 字符串；与 `RequestLogRow.pricing_audit` / `pricing-audit.ts` 对齐 */
	pricingAudit?: string | null;
	providerKeyId?: string | null;
	providerKeyLabel?: string | null;
	providerKeyFingerprint?: string | null;
};
