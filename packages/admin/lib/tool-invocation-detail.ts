/**
 * 从工具调用 request_logs 行解析展示用摘要（query / 结果条数等）。
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
		return { resultCount: null, results: [], raw };
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

	return { resultCount: resultCount ?? (results.length > 0 ? results.length : null), results, raw };
}
