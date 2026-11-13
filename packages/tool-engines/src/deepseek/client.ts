/**
 * DeepSeek 独立 Search / Fetch API 的共享客户端
 * （https://api-docs.deepseek.com/guides/search）。
 * web-search、web-deep-search、web-fetch 三个引擎共用：鉴权、错误映射、查询词截断。
 */

export const DEEPSEEK_TOOLS_BASE = 'https://api.deepseek.com/v1/tools';

/** DeepSeek Search 的 query 上限（Unicode 字符数）。 */
export const DEEPSEEK_QUERY_MAX_CHARS = 128;

/** DeepSeek Search 单次 `count` 上限。 */
export const DEEPSEEK_SEARCH_MAX_COUNT = 50;

export type DeepSeekToolPath = 'search' | 'fetch';

type DeepSeekErrorBody = {
	error?: { message?: string } | string;
	message?: string;
};

/** 按 Unicode 字符（非 UTF-16 单元）截断到 128 个，并去掉首尾空白。 */
export function truncateDeepSeekQuery(query: string): string {
	const chars = [...query.trim()];
	if (chars.length <= DEEPSEEK_QUERY_MAX_CHARS) {
		return chars.join('');
	}
	return chars.slice(0, DEEPSEEK_QUERY_MAX_CHARS).join('').trim();
}

/** 字符数（Unicode 字符）。 */
export function deepSeekQueryLength(query: string): number {
	return [...query].length;
}

function extractErrorMessage(json: DeepSeekErrorBody | null, fallback: string): string {
	if (!json) {
		return fallback;
	}
	if (json.error && typeof json.error === 'object' && typeof json.error.message === 'string') {
		const m = json.error.message.trim();
		if (m) return m;
	}
	if (typeof json.error === 'string' && json.error.trim()) {
		return json.error.trim();
	}
	if (typeof json.message === 'string' && json.message.trim()) {
		return json.message.trim();
	}
	return fallback;
}

/**
 * 上游状态码 → Gateway 引擎错误状态码与文案。
 * 路由层：400 原样返回，401/403 转成“上游拒绝请求”，其余转 502。
 */
export function mapDeepSeekError(
	path: DeepSeekToolPath,
	upstreamStatus: number,
	upstreamMessage: string
): { status: number; message: string } {
	switch (upstreamStatus) {
		case 400:
			return { status: 400, message: upstreamMessage };
		case 401:
		case 402:
			// 密钥无效或账户余额不足：都是运营侧问题，不暴露给用户
			return { status: 401, message: `DeepSeek rejected the credentials or balance (HTTP ${upstreamStatus})` };
		case 403:
			return path === 'fetch'
				? { status: 502, message: 'DeepSeek rejected fetching this URL (blocked by upstream security policy)' }
				: { status: 502, message: upstreamMessage };
		case 404:
			return path === 'fetch'
				? { status: 502, message: 'DeepSeek could not extract usable content from this URL' }
				: { status: 502, message: upstreamMessage };
		default:
			return { status: 502, message: upstreamMessage };
	}
}

export type DeepSeekCallOptions<E extends Error> = {
	path: DeepSeekToolPath;
	apiKey: string;
	body: Record<string, unknown>;
	fetchImpl?: typeof fetch;
	/** 构造各能力自己的 ProviderError。 */
	createError: (message: string, status: number) => E;
};

/** 调用 DeepSeek Search / Fetch，成功返回解析后的 JSON，失败抛 `createError` 构造的错误。 */
export async function callDeepSeekTool<T, E extends Error>(options: DeepSeekCallOptions<E>): Promise<T> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const response = await fetchImpl(`${DEEPSEEK_TOOLS_BASE}/${options.path}`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${options.apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(options.body),
	});

	const text = await response.text();
	let json: unknown = null;
	try {
		json = JSON.parse(text);
	} catch {
		json = null;
	}

	if (!response.ok) {
		const upstream = extractErrorMessage(
			json as DeepSeekErrorBody | null,
			`DeepSeek HTTP ${response.status}`
		);
		const mapped = mapDeepSeekError(options.path, response.status, upstream);
		throw options.createError(mapped.message, mapped.status);
	}

	if (json == null || typeof json !== 'object') {
		throw options.createError(`DeepSeek returned non-JSON (HTTP ${response.status})`, 502);
	}
	return json as T;
}
