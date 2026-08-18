/**
 * Gemini 上游出站 URL：`providers.endpoints.gemini.base` 须配置到 `{model}` 之前的完整路径前缀。
 * 示例：
 * - Developer API：`https://generativelanguage.googleapis.com/v1beta/models`
 * - Vertex Express：`https://aiplatform.googleapis.com/v1/publishers/google/models`
 * - 正式 Vertex（项目级）：`https://aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models`
 */
export type GeminiContentAction = 'generateContent' | 'streamGenerateContent';

/** Gemini 上游 provider key 传递方式：`query-key` 为 Google 官方 `?key=`；`bearer` 为 `Authorization: Bearer`。 */
export type GeminiUpstreamAuthScheme = 'query-key' | 'bearer';

export const GEMINI_UPSTREAM_AUTH_SCHEMES = ['query-key', 'bearer'] as const satisfies readonly GeminiUpstreamAuthScheme[];

export function isGeminiUpstreamAuthScheme(value: unknown): value is GeminiUpstreamAuthScheme {
	return value === 'query-key' || value === 'bearer';
}

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
			'Gemini upstream base URL is empty (configure providers.endpoints.gemini.base with full path prefix)'
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

/** 规范化 Gemini base：host 小写、路径折叠 `//`、去末尾 `/`。 */
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

/** 解析 Gemini 上游鉴权：只认 `endpoints.gemini.auth`，省略则为 `query-key`。 */
export function resolveGeminiUpstreamAuth(
	configuredAuth?: GeminiUpstreamAuthScheme | null
): GeminiUpstreamAuthScheme {
	return isGeminiUpstreamAuthScheme(configuredAuth) ? configuredAuth : 'query-key';
}

/** 服务账号必须走 Bearer，禁止把 JSON / access token 塞进 `?key=`。 */
export function resolveGeminiAuthForUpstreamSecret(
	configuredAuth: GeminiUpstreamAuthScheme | null | undefined,
	isServiceAccount: boolean
): GeminiUpstreamAuthScheme {
	return isServiceAccount ? 'bearer' : resolveGeminiUpstreamAuth(configuredAuth);
}

export type PrepareGeminiUpstreamFetchInput = {
	/**
	 * 协议根 URL（到 `{model}` 之前）。与 `resolvedUrl` 二选一；
	 * 提供时由本函数调用 {@link buildGeminiUpstreamActionUrl}。
	 */
	baseUrl?: string;
	/**
	 * 已由 {@link resolveUpstreamEndpoint} 解析的完整 action URL（可含模板填充结果）。
	 * 优先于 `baseUrl` + `modelName` 拼接。
	 */
	resolvedUrl?: string;
	modelName: string;
	action: GeminiContentAction;
	apiKey: string;
	/** 原始 query 字符串（可含或不含 `?`），会与上游所需参数合并 */
	search?: string;
	/** `endpoints.gemini.auth`；省略则为 `query-key` */
	auth?: GeminiUpstreamAuthScheme | null;
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
	const url = input.resolvedUrl
		? new URL(input.resolvedUrl)
		: new URL(
				buildGeminiUpstreamActionUrl(
					input.baseUrl ??
						(() => {
							throw new Error(
								'prepareGeminiUpstreamFetch requires baseUrl or resolvedUrl'
							);
						})(),
					input.modelName,
					input.action
				)
			);
	if (input.search) {
		const source = new URLSearchParams(
			input.search.startsWith('?') ? input.search.slice(1) : input.search
		);
		for (const [k, v] of source.entries()) {
			url.searchParams.set(k, v);
		}
	}

	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	const authScheme = resolveGeminiUpstreamAuth(input.auth);
	if (authScheme === 'bearer') {
		headers.Authorization = `Bearer ${input.apiKey}`;
	} else if (!url.searchParams.get('key')) {
		url.searchParams.set('key', input.apiKey);
	}

	applyGeminiStreamQueryParams(url, input.action);
	return { url, headers };
}
