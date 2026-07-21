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
