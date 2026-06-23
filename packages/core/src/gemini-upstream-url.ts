/**
 * Gemini 上游出站 URL：`providers.base_url_gemini` 须配置到 `{model}` 之前的完整路径前缀。
 * 示例：
 * - Developer API：`https://generativelanguage.googleapis.com/v1beta/models`
 * - Vertex Express：`https://aiplatform.googleapis.com/v1/publishers/google/models`
 */
export type GeminiContentAction = 'generateContent' | 'streamGenerateContent';

/** Gemini 上游 provider key 传递方式：`query-key` 为 Google 官方 `?key=`；`bearer` 为 `Authorization: Bearer`。 */
export type GeminiUpstreamAuthScheme = 'query-key' | 'bearer';

/**
 * 使用 Bearer 鉴权（非 Google 官方 `?key=`）的 Gemini `base_url_gemini` 前缀。
 * 匹配前会规范化 URL（trim、host 小写、路径折叠重复 `/`、去末尾 `/`）。
 */
export const GEMINI_BEARER_AUTH_BASE_URLS: readonly string[] = [
	'https://api.qnaigc.com/bypass/vertex/v1/models',
	'https://api.modelink.ai/bypass/vertex/v1/models',
];

function trimTrailingSlash(baseUrl: string): string {
	return baseUrl.replace(/\/$/, '');
}

/** base 是否已含非根路径前缀（裸 host 视为未配置完整前缀）。 */
function geminiUpstreamBaseHasPathPrefix(baseUrl: string): boolean {
	try {
		const pathname = new URL(baseUrl.trim()).pathname;
		return pathname !== '' && pathname !== '/';
	} catch {
		return false;
	}
}

function assertGeminiUpstreamBaseUrl(baseUrl: string): void {
	const trimmed = baseUrl.trim();
	if (!trimmed) {
		throw new Error(
			'Gemini upstream base URL is empty (configure providers.base_url_gemini with full path prefix)'
		);
	}
	if (!geminiUpstreamBaseHasPathPrefix(trimmed)) {
		throw new Error(
			'Gemini upstream base URL must include path prefix before {model} (e.g. .../v1beta/models for Developer API, .../v1/publishers/google/models for Vertex Express)'
		);
	}
}

/**
 * 构建 Gemini `generateContent` / `streamGenerateContent` 上游 action URL（不含 query）。
 * base 会先规范化（host 小写、路径折叠重复 `/`、去末尾 `/`），避免 provider 配置 `//` 导致上游 404。
 */
export function buildGeminiUpstreamActionUrl(
	baseUrl: string,
	modelName: string,
	action: GeminiContentAction
): string {
	assertGeminiUpstreamBaseUrl(baseUrl);
	const base = normalizeGeminiUpstreamBaseForAuthMatch(baseUrl);
	const modelSegment = `${encodeURIComponent(modelName)}:${action}`;
	return `${base}/${modelSegment}`;
}

/**
 * 为 Gemini `streamGenerateContent` 强制 SSE framing（Vertex / Developer API 需 `alt=sse`）。
 * 在合并客户端 query 之后调用，会覆盖已有 `alt`。
 */
export function applyGeminiStreamQueryParams(url: URL, action: GeminiContentAction): void {
	if (action === 'streamGenerateContent') {
		url.searchParams.set('alt', 'sse');
	}
}

/** 供 Bearer allowlist 匹配：host 小写、路径折叠 `//`、去末尾 `/`。 */
export function normalizeGeminiUpstreamBaseForAuthMatch(baseUrl: string): string {
	const trimmed = baseUrl.trim();
	try {
		const u = new URL(trimmed);
		u.hostname = u.hostname.toLowerCase();
		const path = u.pathname.replace(/\/+/g, '/').replace(/\/$/, '') || '';
		return `${u.protocol}//${u.host}${path}`;
	} catch {
		return trimTrailingSlash(trimmed);
	}
}

/** 按 `base_url_gemini` 解析上游 provider key 传递方式；未命中 allowlist 时默认 `query-key`。 */
export function resolveGeminiUpstreamAuth(baseUrl: string): GeminiUpstreamAuthScheme {
	const normalized = normalizeGeminiUpstreamBaseForAuthMatch(baseUrl);
	const bearerSet = new Set(GEMINI_BEARER_AUTH_BASE_URLS.map(normalizeGeminiUpstreamBaseForAuthMatch));
	return bearerSet.has(normalized) ? 'bearer' : 'query-key';
}

export type PrepareGeminiUpstreamFetchInput = {
	baseUrl: string;
	modelName: string;
	action: GeminiContentAction;
	apiKey: string;
	/** 原始 query 字符串（可含或不含 `?`），会与上游所需参数合并 */
	search?: string;
};

export type PrepareGeminiUpstreamFetchResult = {
	url: URL;
	headers: Record<string, string>;
};

/**
 * 构建 Gemini 上游 action URL、合并 query、按 baseUrl 策略注入 provider key，并设置流式 `alt=sse`。
 * Proxy 与 Admin Playground 共用，保证出站鉴权一致。
 */
export function prepareGeminiUpstreamFetch(
	input: PrepareGeminiUpstreamFetchInput
): PrepareGeminiUpstreamFetchResult {
	const url = new URL(buildGeminiUpstreamActionUrl(input.baseUrl, input.modelName, input.action));
	if (input.search) {
		const source = new URLSearchParams(
			input.search.startsWith('?') ? input.search.slice(1) : input.search
		);
		for (const [k, v] of source.entries()) {
			url.searchParams.set(k, v);
		}
	}

	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	const authScheme = resolveGeminiUpstreamAuth(input.baseUrl);
	if (authScheme === 'bearer') {
		headers.Authorization = `Bearer ${input.apiKey}`;
	} else if (!url.searchParams.get('key')) {
		url.searchParams.set('key', input.apiKey);
	}

	applyGeminiStreamQueryParams(url, input.action);
	return { url, headers };
}
