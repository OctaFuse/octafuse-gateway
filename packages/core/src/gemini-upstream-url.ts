/**
 * Gemini 上游出站 URL：`providers.base_url_gemini` 须配置到 `{model}` 之前的完整路径前缀。
 * 示例：
 * - Developer API：`https://generativelanguage.googleapis.com/v1beta/models`
 * - Vertex Express：`https://aiplatform.googleapis.com/v1/publishers/google/models`
 */
export type GeminiContentAction = 'generateContent' | 'streamGenerateContent';

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
 */
export function buildGeminiUpstreamActionUrl(
	baseUrl: string,
	modelName: string,
	action: GeminiContentAction
): string {
	assertGeminiUpstreamBaseUrl(baseUrl);
	const base = trimTrailingSlash(baseUrl.trim());
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
