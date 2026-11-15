/**
 * 从工具调用 request_logs 行解析展示用内容：请求参数、响应摘要、MCP 结果、定价快照。
 * 这些行的请求体在 `request_body`，响应在 `raw_usage`，定价在 `pricing_audit`。
 */

export type ToolInvocationRequestSummary = {
	query: string | null;
	provider: string | null;
	raw: unknown | null;
};

export type ToolInvocationResultItem = {
	title?: string;
	url?: string;
	snippet?: string;
	siteName?: string;
};

export type ToolInvocationResponseSummary = {
	resultCount: number | null;
	results: ToolInvocationResultItem[];
	/** web-fetch：抓取到的正文总长度（字符）。 */
	contentLength: number | null;
	raw: unknown | null;
};

function tryParseJson(raw: string | null | undefined): unknown | null {
	if (raw == null || !String(raw).trim()) {
		return null;
	}
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return null;
	}
}

export type InvocationSource = 'rest' | 'mcp';

export function resolveInvocationSource(log: {
	provider_id?: string | null;
	model_id?: string | null;
}): InvocationSource | null {
	const provider = log.provider_id?.trim() ?? '';
	const model = log.model_id?.trim() ?? '';
	if (provider === 'octafuse-mcp' || model.startsWith('mcp:')) return 'mcp';
	if (provider === 'octafuse-tools' || model.startsWith('tool:')) return 'rest';
	return null;
}

export type McpInvocationSummary = {
	slug: string | null;
	tool: string | null;
	label: string;
	argumentSummary: string | null;
};

function summarizeArguments(args: unknown): string | null {
	if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
	const parts = Object.entries(args as Record<string, unknown>).slice(0, 3).map(([key, value]) => {
		const text = typeof value === 'string' ? value : JSON.stringify(value);
		const clipped = text.length > 80 ? `${text.slice(0, 77)}…` : text;
		return `${key}=${clipped}`;
	});
	return parts.length > 0 ? parts.join(' ') : null;
}

/** MCP 请求日志：`model_id` 为 `mcp:{slug}/{tool}`，请求体为 `{ name, arguments }`。 */
export function parseMcpInvocationSummary(log: {
	model_id?: string | null;
	request_body?: string | null;
}): McpInvocationSummary {
	const model = log.model_id?.trim() ?? '';
	const body = model.startsWith('mcp:') ? model.slice(4) : '';
	const slash = body.indexOf('/');
	const slug = slash >= 0 ? body.slice(0, slash) : body || null;
	const toolFromModel = slash >= 0 ? body.slice(slash + 1) : null;
	const raw = tryParseJson(log.request_body);
	const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
	const tool = typeof record?.name === 'string' && record.name.trim() ? record.name.trim() : toolFromModel;
	const label = slug && tool ? `${slug} / ${tool}` : tool || slug || model || '—';
	return {
		slug,
		tool,
		label,
		argumentSummary: summarizeArguments(record?.arguments),
	};
}

export function parseToolRequestSummary(requestBody: string | null | undefined): ToolInvocationRequestSummary {
	const raw = tryParseJson(requestBody);
	if (!raw || typeof raw !== 'object') {
		return { query: null, provider: null, raw };
	}
	const rec = raw as Record<string, unknown>;
	// web-search 用 query；web-fetch 用 url（列表「查询」列复用）
	const query =
		typeof rec.query === 'string'
			? rec.query
			: typeof rec.url === 'string'
				? rec.url
				: null;
	const provider = typeof rec.provider === 'string' ? rec.provider : null;
	return { query, provider, raw };
}

/**
 * 解析工具调用引擎：优先 `provider_model_name`（新写入），再 requestBody / pricing_audit。
 * 旧行曾把 tool id 写入 provider_model_name，需排除。
 */
export function resolveToolEngineProvider(log: {
	model_id?: string | null;
	provider_model_name?: string | null;
	request_body?: string | null;
	pricing_audit?: string | null;
}): string | null {
	const modelId = log.model_id?.trim() || '';
	const fromColumn = log.provider_model_name?.trim() || '';
	if (fromColumn && fromColumn !== modelId && !fromColumn.startsWith('tool:')) {
		return fromColumn;
	}
	const fromRequest = parseToolRequestSummary(log.request_body).provider;
	if (fromRequest?.trim()) {
		return fromRequest.trim();
	}
	const audit = tryParseJson(log.pricing_audit);
	if (audit && typeof audit === 'object') {
		const p = (audit as Record<string, unknown>).provider;
		if (typeof p === 'string' && p.trim()) {
			return p.trim();
		}
	}
	return null;
}

export function parseToolResponseSummary(rawUsage: string | null | undefined): ToolInvocationResponseSummary {
	const raw = tryParseJson(rawUsage);
	if (!raw || typeof raw !== 'object') {
		return { resultCount: null, results: [], contentLength: null, raw };
	}
	const rec = raw as Record<string, unknown>;
	const resultCount = typeof rec.result_count === 'number' ? rec.result_count : null;
	const resultsRaw = Array.isArray(rec.results) ? rec.results : [];
	const results: ToolInvocationResultItem[] = resultsRaw
		.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
		.map((x) => ({
			title: typeof x.title === 'string' ? x.title : undefined,
			url: typeof x.url === 'string' ? x.url : undefined,
			snippet:
				typeof x.snippet === 'string'
					? x.snippet
					: typeof x.content_preview === 'string'
						? x.content_preview
						: undefined,
			siteName: typeof x.siteName === 'string' ? x.siteName : undefined,
		}));

	// web-fetch：单页摘要（content_preview / title / url）
	if (results.length === 0 && (typeof rec.content_preview === 'string' || typeof rec.url === 'string')) {
		results.push({
			title: typeof rec.title === 'string' ? rec.title : undefined,
			url: typeof rec.url === 'string' ? rec.url : undefined,
			snippet: typeof rec.content_preview === 'string' ? rec.content_preview : undefined,
		});
	}

	return {
		resultCount: resultCount ?? (results.length > 0 ? results.length : null),
		results,
		contentLength: typeof rec.content_length === 'number' ? rec.content_length : null,
		raw,
	};
}

export type ToolRequestParam = { name: string; value: string };

const paramText = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value, null, 2));

/** 把请求对象拆成「参数名 / 值」逐行展示；`omit` 用于已在别处展示的字段（如引擎）。 */
export function listRequestParams(value: unknown, omit: readonly string[] = []): ToolRequestParam[] {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
	return Object.entries(value as Record<string, unknown>)
		.filter(([name, item]) => !omit.includes(name) && item !== undefined)
		.map(([name, item]) => ({ name, value: paramText(item) }));
}

/** MCP 请求体 `{ name, arguments }` 里的调用参数；请求体被截断或不是 JSON 时返回 null。 */
export function parseMcpArguments(requestBody: string | null | undefined): ToolRequestParam[] | null {
	const raw = tryParseJson(requestBody);
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	return listRequestParams((raw as Record<string, unknown>).arguments);
}

export type AiDetectionSummary = {
	overallScore: number | null;
	totalChars: number | null;
	segmentCount: number | null;
	segments: { index: number; chars: number | null; score: number | null }[];
};

const numberOrNull = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** AI 率检测的响应摘要只有分数与字符数，不含原文。 */
export function parseAiDetectionSummary(rawUsage: string | null | undefined): AiDetectionSummary | null {
	const raw = tryParseJson(rawUsage);
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const rec = raw as Record<string, unknown>;
	const segments = (Array.isArray(rec.segments) ? rec.segments : [])
		.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
		.map((item, position) => ({
			index: numberOrNull(item.index) ?? position,
			chars: numberOrNull(item.chars),
			score: numberOrNull(item.score),
		}));
	return {
		overallScore: numberOrNull(rec.overall_score),
		totalChars: numberOrNull(rec.total_chars),
		segmentCount: numberOrNull(rec.segment_count) ?? (segments.length || null),
		segments,
	};
}

export type McpResultBlock = {
	type: string;
	/** 文本块的正文；正文本身是 JSON 时已排版。其他类型的块为整块 JSON。 */
	text: string;
	isJson: boolean;
};

export type McpResultSummary = {
	blocks: McpResultBlock[];
	/** `structuredContent`，已排版；没有时为 null。 */
	structured: string | null;
	isError: boolean;
	/** 日志只保留前 8000 个字符，超出的结果在这里不完整。 */
	truncated: boolean;
};

const TEXT_BLOCK_PREFIX = '{"content":[{"type":"text","text":"';

/** 被截断的结果不是合法 JSON；多数结果以一个文本块开头，尽量把这一块还原成可读文本。 */
function readLeadingTextBlock(raw: string): string | null {
	if (!raw.startsWith(TEXT_BLOCK_PREFIX)) return null;
	const body = raw.slice(TEXT_BLOCK_PREFIX.length).replace(/…$/, '');
	let end = body.length;
	for (let i = 0; i < body.length; i++) {
		if (body[i] === '"') {
			end = i;
			break;
		}
		if (body[i] !== '\\') continue;
		const escapeLength = body[i + 1] === 'u' ? 6 : 2;
		// 截断点落在转义序列中间时，丢掉这半个转义。
		if (i + escapeLength > body.length) {
			end = i;
			break;
		}
		i += escapeLength - 1;
	}
	try {
		return JSON.parse(`"${body.slice(0, end)}"`) as string;
	} catch {
		return null;
	}
}

function textBlock(text: string): McpResultBlock {
	const parsed = /^\s*[[{]/.test(text) ? tryParseJson(text) : null;
	return parsed == null
		? { type: 'text', text, isJson: false }
		: { type: 'text', text: JSON.stringify(parsed, null, 2), isJson: true };
}

/** MCP 工具行的 `raw_usage` 是上游 `tools/call` 的结果：`{ content, structuredContent?, isError? }`。 */
export function parseMcpResult(rawUsage: string | null | undefined): McpResultSummary | null {
	const source = rawUsage?.trim() ?? '';
	if (!source) return null;
	const raw = tryParseJson(source);
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		const truncated = source.endsWith('…');
		const leading = truncated ? readLeadingTextBlock(source) : null;
		return {
			blocks: [{ type: 'text', text: leading ?? source, isJson: false }],
			structured: null,
			isError: false,
			truncated,
		};
	}
	const rec = raw as Record<string, unknown>;
	const blocks = (Array.isArray(rec.content) ? rec.content : []).map((item): McpResultBlock => {
		const block = item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
		if (block?.type === 'text' && typeof block.text === 'string') return textBlock(block.text);
		return {
			type: typeof block?.type === 'string' ? block.type : 'unknown',
			text: JSON.stringify(item, null, 2),
			isJson: true,
		};
	});
	return {
		blocks,
		structured: rec.structuredContent == null ? null : JSON.stringify(rec.structuredContent, null, 2),
		isError: rec.isError === true,
		truncated: false,
	};
}

export type McpFailureKind = 'toolError' | 'invalidResult' | 'timeout' | 'upstream';

/** 按 Gateway 写入的错误信息区分 MCP 调用失败在哪一步，用于给出排查方向。 */
export function classifyMcpFailure(message: string | null | undefined): McpFailureKind | null {
	const text = message?.trim().toLowerCase() ?? '';
	if (!text) return null;
	if (text.includes('returned iserror')) return 'toolError';
	if (text.includes('invalid tool result')) return 'invalidResult';
	if (text.includes('timed out')) return 'timeout';
	return 'upstream';
}

export type ToolPricingSnapshot = {
	unit: string | null;
	billingUnits: number | null;
	unitPrices: { charged: number | null; metered: number | null; standard: number | null };
	/** 调用时生效的倍率；旧记录没有。 */
	chargedFactor: number | null;
	meteredFactor: number | null;
	/** MCP：价格来自工具自己的设置（item）还是服务默认价格（server）。 */
	ruleSource: 'item' | 'server' | null;
	preflightUnits: number | null;
	settledUnits: number | null;
};

/** 工具与 MCP 调用的 `pricing_audit`（`kind: fixed_tool_cost`）：单价、计费单元和倍率快照。 */
export function parseToolPricingAudit(pricingAudit: string | null | undefined): ToolPricingSnapshot | null {
	const raw = tryParseJson(pricingAudit);
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const rec = raw as Record<string, unknown>;
	if (rec.kind !== 'fixed_tool_cost') return null;
	const object = (value: unknown) =>
		value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
	const prices = object(rec.unit_prices);
	const mcp = object(rec.mcp_pricing);
	const factors = rec.mcp_pricing ? mcp : object(rec.tool_pricing);
	return {
		unit: typeof rec.unit === 'string' && rec.unit.trim() ? rec.unit : null,
		billingUnits: numberOrNull(rec.billing_units),
		unitPrices: {
			charged: numberOrNull(prices.charged),
			metered: numberOrNull(prices.metered),
			standard: numberOrNull(prices.standard),
		},
		chargedFactor: numberOrNull(factors.charged_factor),
		meteredFactor: numberOrNull(factors.metered_factor),
		ruleSource: mcp.rule_source === 'item' || mcp.rule_source === 'server' ? mcp.rule_source : null,
		preflightUnits: numberOrNull(mcp.preflight_units),
		settledUnits: numberOrNull(mcp.settled_units),
	};
}
