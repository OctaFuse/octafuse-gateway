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
	requestProtocol: UpstreamProtocol;
	requestOperation?: string | null;
	upstreamProtocol: UpstreamProtocol;
	upstreamOperation?: string | null;
	modelSurfaceId?: string | null;
	routePoolId?: string | null;
	routeTargetId?: string | null;
	adapter?: string | null;
	routeTrace?: string | null;
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
	gatewayOverheadMs?: number | null;
	upstreamResponseMs?: number | null;
	finalUpstreamHeadersMs?: number | null;
	firstReasoningTokenMs?: number | null;
	firstTokenMs?: number | null;
	streamDurationMs?: number | null;
	upstreamAttemptCount?: number | null;
	upstreamFailoverCount?: number | null;
	timingMetadata?: string | null;
	errorMessage: string | null;
	rawUsage: string | null;
	/** 计费审计 JSON 字符串；与 `RequestLogRow.pricing_audit` / `pricing-audit.ts` 对齐 */
	pricingAudit?: string | null;
	providerKeyId?: string | null;
	providerKeyLabel?: string | null;
	providerKeyFingerprint?: string | null;
	/** 上游响应头 request id（传输层追踪句柄） */
	upstreamRequestId?: string | null;
	/** 上游响应 body message id（应用层生成结果 id：chatcmpl-* / msg_* / responseId） */
	upstreamMessageId?: string | null;
	/** 计费种类：`image_tokens` | `image_per_image` | `audio_per_second` | `audio_tokens` | `audio_per_character` */
	billingKind?: string | null;
	/** 按张计费：参考图张数 */
	inputImageCount?: number;
	/** 按张计费：生成图张数 */
	outputImageCount?: number;
	/** 音频转写：计费时长（秒） */
	audioDurationSeconds?: number | null;
	/** TTS：上游返回的有效计费字符数 */
	audioCharacters?: number | null;
};
