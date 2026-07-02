/**
 * 上游追踪 id 提取（两类，语义不同，见 docs / RequestLogRow 注释）：
 *
 * 1) **request id**（传输层）：来自上游 HTTP 响应头，是 provider/网关对这次 HTTP 调用的追踪句柄。
 *    经 CDN / 聚合商时常被剥离或替换（例如网宿仅回 `x-ws-request-id`），因此名单里既含各家标准头，
 *    也含已知中转/CDN 的兜底头（标准头优先，兜底头置后）。
 * 2) **message id**（应用层）：来自响应 body，是这次「生成结果对象」的 id（OpenAI `chatcmpl-*`、
 *    Anthropic `msg_*`、Gemini `responseId`）。属于 API 契约，穿透聚合商，几乎恒有。见各 driver。
 */

/**
 * 响应头候选名（按优先级）：先各 provider 官方标准头，再已知中转 / CDN 兜底头。
 * `Headers.get` 大小写不敏感，这里统一小写即可。
 */
const UPSTREAM_REQUEST_ID_HEADER_NAMES = [
	// —— provider 官方标准头 ——
	'x-request-id', // OpenAI 及多数 OpenAI 兼容供应商
	'request-id', // Anthropic（直连）
	'anthropic-request-id',
	'x-goog-request-id', // Google / Gemini
	'x-amzn-requestid', // AWS Bedrock
	'x-amzn-request-id',
	'apim-request-id', // Azure API Management（Azure OpenAI）
	'x-ms-request-id', // Azure
	// —— Gemini / Google 中转与 CDN 兜底头 ——
	'http_x_reqid', // 七牛 APISIX 等代理（上游 x-goog-request-id 的别名）
	'x-cloud-trace-context', // GCP（值为 TRACE_ID/SPAN;o=1，取 TRACE_ID 段）
	'eo-log-uuid', // EdgeOne CDN
	// —— 其他中转 / CDN 兜底头 ——
	'x-ws-request-id', // 网宿（Wangsu）边缘网关
] as const;

const UPSTREAM_ID_MAX_LENGTH = 200;

/** 归一化任意 id 值：转字符串、trim、空则 null、超长则截断。 */
export function normalizeUpstreamId(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	return trimmed.length > UPSTREAM_ID_MAX_LENGTH ? trimmed.slice(0, UPSTREAM_ID_MAX_LENGTH) : trimmed;
}

function normalizeCloudTraceContextRequestId(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed) return null;
	const slash = trimmed.indexOf('/');
	return normalizeUpstreamId(slash >= 0 ? trimmed.slice(0, slash) : trimmed);
}

function extractHeaderRequestId(headers: Headers, name: (typeof UPSTREAM_REQUEST_ID_HEADER_NAMES)[number]): string | null {
	const raw = headers.get(name);
	if (!raw) return null;
	if (name === 'x-cloud-trace-context') {
		return normalizeCloudTraceContextRequestId(raw);
	}
	return normalizeUpstreamId(raw);
}

/**
 * 从上游响应头提取 request id（OpenAI / Anthropic / Gemini / Bedrock / Azure / 中转 CDN）。
 */
export function extractUpstreamRequestId(headers: Headers): string | null {
	for (const name of UPSTREAM_REQUEST_ID_HEADER_NAMES) {
		const value = extractHeaderRequestId(headers, name);
		if (value) return value;
	}
	return null;
}

/**
 * 写入 Gemini 请求日志时的 request id 解析（严格与 message id 分离，不用 responseId 兜底）：
 * 1) HTTP 响应头（含聚合商别名，如 http_x_reqid）
 * 2) body 内非标准 `requestId` / `request_id`（部分代理追加）
 * Vertex Express 等直连 Google 若两者皆无，则 request id 为 null（message id 仍取 responseId）。
 */
export function resolveGeminiLoggedRequestId(options: {
	headerRequestId: string | null;
	bodyRequestId?: string | null;
}): string | null {
	return options.headerRequestId ?? normalizeUpstreamId(options.bodyRequestId);
}
