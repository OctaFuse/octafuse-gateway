/**
 * 路由 `custom_params`：请求体默认值与保留键 `headers`（上游 HTTP 头）。
 * `headers` 不参与 body 合并；鉴权与 hop-by-hop 头由驱动保留。
 */

export const ROUTE_CUSTOM_PARAMS_HEADERS_KEY = 'headers';

/** RFC 7230 header-name token。 */
const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

const PROTECTED_HEADER_NAMES = new Set([
	'authorization',
	'x-api-key',
	'x-goog-api-key',
	'host',
	'content-length',
	'content-type',
	'connection',
	'keep-alive',
	'te',
	'trailer',
	'trailers',
	'transfer-encoding',
	'upgrade',
	'cookie',
	'cookie2',
	'proxy-authenticate',
	'proxy-authorization',
]);

export type RouteExtraHeaders = Record<string, string>;

export type SplitRouteCustomParamsResult = {
	body: Record<string, unknown>;
	extraHeaders: RouteExtraHeaders;
};

export type ValidateRouteCustomParamsHeadersResult =
	| { ok: true }
	| { ok: false; message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isProtectedUpstreamHeaderName(name: string): boolean {
	const lower = name.toLowerCase();
	return PROTECTED_HEADER_NAMES.has(lower) || lower.startsWith('proxy-');
}

export function isValidHttpHeaderName(name: string): boolean {
	return name.length > 0 && HEADER_NAME_RE.test(name);
}

function headerValueFromUnknown(value: unknown): string | null {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' && Number.isFinite(value)) return String(value);
	return null;
}

function deleteCaseInsensitive(headers: Record<string, string>, name: string): void {
	const lower = name.toLowerCase();
	for (const key of Object.keys(headers)) {
		if (key.toLowerCase() === lower) delete headers[key];
	}
}

function parseExtraHeaders(
	raw: unknown,
	mode: 'strict' | 'lenient',
): { extraHeaders: RouteExtraHeaders; error: string | null } {
	if (raw === undefined || raw === null) {
		return { extraHeaders: {}, error: null };
	}
	if (!isPlainObject(raw)) {
		return {
			extraHeaders: {},
			error: 'custom_params.headers must be an object',
		};
	}

	const extraHeaders: RouteExtraHeaders = {};
	for (const [name, value] of Object.entries(raw)) {
		if (!isValidHttpHeaderName(name)) {
			if (mode === 'strict') {
				return {
					extraHeaders: {},
					error: `custom_params.headers has invalid header name ${JSON.stringify(name)}`,
				};
			}
			continue;
		}
		if (isProtectedUpstreamHeaderName(name)) {
			if (mode === 'strict') {
				return {
					extraHeaders: {},
					error: `custom_params.headers cannot set protected header ${JSON.stringify(name)}`,
				};
			}
			continue;
		}
		const normalized = headerValueFromUnknown(value);
		if (normalized === null) {
			if (mode === 'strict') {
				return {
					extraHeaders: {},
					error: `custom_params.headers[${JSON.stringify(name)}] must be a string`,
				};
			}
			continue;
		}
		extraHeaders[name] = normalized;
	}
	return { extraHeaders, error: null };
}

/**
 * 拆出 body 默认值与额外请求头。非法 `headers` 在运行时忽略（保存时由 {@link validateRouteCustomParamsHeaders} 拒绝）。
 */
export function splitRouteCustomParams(
	customParams: Record<string, unknown> | null | undefined,
): SplitRouteCustomParamsResult {
	if (!isPlainObject(customParams)) {
		return { body: {}, extraHeaders: {} };
	}
	const { [ROUTE_CUSTOM_PARAMS_HEADERS_KEY]: rawHeaders, ...rest } = customParams;
	const { extraHeaders } = parseExtraHeaders(rawHeaders, 'lenient');
	return { body: rest, extraHeaders };
}

export function routeCustomParamsBody(
	customParams: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
	return splitRouteCustomParams(customParams).body;
}

export function extraHeadersFromCustomParams(
	customParams: Record<string, unknown> | null | undefined,
): RouteExtraHeaders {
	return splitRouteCustomParams(customParams).extraHeaders;
}

/** Admin 保存 `custom_params` 时校验 `headers` 形状。 */
export function validateRouteCustomParamsHeaders(
	customParams: Record<string, unknown> | null | undefined,
): ValidateRouteCustomParamsHeadersResult {
	if (!isPlainObject(customParams) || !(ROUTE_CUSTOM_PARAMS_HEADERS_KEY in customParams)) {
		return { ok: true };
	}
	const { error } = parseExtraHeaders(customParams[ROUTE_CUSTOM_PARAMS_HEADERS_KEY], 'strict');
	return error ? { ok: false, message: error } : { ok: true };
}

/**
 * 合并上游请求头：允许的自定义头可覆盖驱动非保护键；鉴权 / Content-Type / hop-by-hop 始终用 `base`。
 */
export function mergeUpstreamHeaders(
	base: Record<string, string>,
	extra: RouteExtraHeaders | null | undefined,
): Record<string, string> {
	const result: Record<string, string> = { ...base };
	for (const [name, value] of Object.entries(extra ?? {})) {
		if (!isValidHttpHeaderName(name) || isProtectedUpstreamHeaderName(name)) continue;
		deleteCaseInsensitive(result, name);
		result[name] = value;
	}
	for (const [name, value] of Object.entries(base)) {
		if (!isProtectedUpstreamHeaderName(name)) continue;
		deleteCaseInsensitive(result, name);
		result[name] = value;
	}
	return result;
}

export function applyRouteExtraHeaders(
	base: Record<string, string>,
	customParams: Record<string, unknown> | null | undefined,
): Record<string, string> {
	return mergeUpstreamHeaders(base, extraHeadersFromCustomParams(customParams));
}
