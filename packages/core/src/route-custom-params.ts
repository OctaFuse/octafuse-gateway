/**
 * 路由 `custom_params`：信封 `{ headers, body, force_override }`。
 * 仍可读旧扁平对象（顶层除 `headers` 外即请求体）。强制覆盖分 headers / body 两侧。
 */

export const ROUTE_CUSTOM_PARAMS_HEADERS_KEY = 'headers';
export const ROUTE_CUSTOM_PARAMS_BODY_KEY = 'body';
export const ROUTE_CUSTOM_PARAMS_FORCE_OVERRIDE_KEY = 'force_override';

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
	forceOverrideHeaders: boolean;
	forceOverrideBody: boolean;
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

/** D1/MySQL 的 0/1、JSON boolean、缺省均视为关闭。 */
export function isRouteCustomParamsForceOverride(value: unknown): boolean {
	return value === true || value === 1 || value === '1';
}

function parseForceOverrideBlock(raw: unknown): { headers: boolean; body: boolean } {
	if (isRouteCustomParamsForceOverride(raw)) {
		return { headers: true, body: true };
	}
	if (!isPlainObject(raw)) {
		return { headers: false, body: false };
	}
	return {
		headers: isRouteCustomParamsForceOverride(raw.headers),
		body: isRouteCustomParamsForceOverride(raw.body),
	};
}

function isCustomParamsEnvelope(obj: Record<string, unknown>): boolean {
	for (const key of Object.keys(obj)) {
		if (
			key !== ROUTE_CUSTOM_PARAMS_HEADERS_KEY &&
			key !== ROUTE_CUSTOM_PARAMS_BODY_KEY &&
			key !== ROUTE_CUSTOM_PARAMS_FORCE_OVERRIDE_KEY
		) {
			return false;
		}
	}
	if (obj.body !== undefined && obj.body !== null && !isPlainObject(obj.body)) {
		return false;
	}
	if (
		obj.force_override !== undefined &&
		obj.force_override !== null &&
		!isPlainObject(obj.force_override) &&
		!isRouteCustomParamsForceOverride(obj.force_override)
	) {
		return false;
	}
	return true;
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
 * 拆出 body 默认值、额外请求头与分侧强制覆盖。非法 `headers` 在运行时忽略（保存时由 {@link validateRouteCustomParamsHeaders} 拒绝）。
 */
export function splitRouteCustomParams(
	customParams: Record<string, unknown> | null | undefined,
): SplitRouteCustomParamsResult {
	const empty: SplitRouteCustomParamsResult = {
		body: {},
		extraHeaders: {},
		forceOverrideHeaders: false,
		forceOverrideBody: false,
	};
	if (!isPlainObject(customParams)) {
		return empty;
	}
	if (isCustomParamsEnvelope(customParams)) {
		const { extraHeaders } = parseExtraHeaders(customParams.headers, 'lenient');
		const body = isPlainObject(customParams.body) ? { ...customParams.body } : {};
		delete body[ROUTE_CUSTOM_PARAMS_HEADERS_KEY];
		const force = parseForceOverrideBlock(customParams.force_override);
		return {
			body,
			extraHeaders,
			forceOverrideHeaders: force.headers,
			forceOverrideBody: force.body,
		};
	}
	const { [ROUTE_CUSTOM_PARAMS_HEADERS_KEY]: rawHeaders, ...rest } = customParams;
	const { extraHeaders } = parseExtraHeaders(rawHeaders, 'lenient');
	return {
		body: rest,
		extraHeaders,
		forceOverrideHeaders: false,
		forceOverrideBody: false,
	};
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

export function composeRouteCustomParamsEnvelope(input: {
	body?: Record<string, unknown> | null;
	extraHeaders?: RouteExtraHeaders | null;
	forceOverrideHeaders?: boolean;
	forceOverrideBody?: boolean;
}): Record<string, unknown> | null {
	const out: Record<string, unknown> = {};
	const extraHeaders = input.extraHeaders ?? {};
	if (Object.keys(extraHeaders).length > 0) {
		out[ROUTE_CUSTOM_PARAMS_HEADERS_KEY] = extraHeaders;
	}
	const body: Record<string, unknown> = { ...(input.body ?? {}) };
	delete body[ROUTE_CUSTOM_PARAMS_HEADERS_KEY];
	delete body[ROUTE_CUSTOM_PARAMS_BODY_KEY];
	delete body[ROUTE_CUSTOM_PARAMS_FORCE_OVERRIDE_KEY];
	if (Object.keys(body).length > 0) {
		out[ROUTE_CUSTOM_PARAMS_BODY_KEY] = body;
	}
	const forceOverride: Record<string, true> = {};
	if (input.forceOverrideHeaders) forceOverride.headers = true;
	if (input.forceOverrideBody) forceOverride.body = true;
	if (Object.keys(forceOverride).length > 0) {
		out[ROUTE_CUSTOM_PARAMS_FORCE_OVERRIDE_KEY] = forceOverride;
	}
	return Object.keys(out).length > 0 ? out : null;
}

/** 把旧扁平或信封规范成落库信封。旧扁平没有强制覆盖信息，两侧都视为关。 */
export function normalizeRouteCustomParamsForStorage(
	customParams: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
	const split = splitRouteCustomParams(customParams);
	return composeRouteCustomParamsEnvelope({
		body: split.body,
		extraHeaders: split.extraHeaders,
		forceOverrideHeaders: split.forceOverrideHeaders,
		forceOverrideBody: split.forceOverrideBody,
	});
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

export type ClientHeaderSource = Headers | Record<string, string> | null | undefined;

function readClientHeader(source: ClientHeaderSource, name: string): string | null {
	if (!source) return null;
	if (typeof Headers !== 'undefined' && source instanceof Headers) {
		return source.get(name);
	}
	const lower = name.toLowerCase();
	for (const [key, value] of Object.entries(source)) {
		if (key.toLowerCase() === lower) return value;
	}
	return null;
}

/**
 * 未开 headers 强制覆盖时，用客户端同名请求头覆盖路由已配置的头（仅路由已配置的头名）。
 */
export function overlayClientHeadersOnRouteCustomParams(
	customParams: Record<string, unknown> | null | undefined,
	options?: { forceOverride?: boolean; clientHeaders?: ClientHeaderSource },
): Record<string, unknown> | null {
	if (!customParams) return customParams ?? null;
	const split = splitRouteCustomParams(customParams);
	if (options?.forceOverride ?? split.forceOverrideHeaders) return customParams;
	const names = Object.keys(split.extraHeaders);
	if (names.length === 0) return customParams;
	const rawHeaders = isPlainObject(customParams[ROUTE_CUSTOM_PARAMS_HEADERS_KEY])
		? customParams[ROUTE_CUSTOM_PARAMS_HEADERS_KEY]
		: split.extraHeaders;

	let changed = false;
	const nextHeaders: Record<string, unknown> = { ...rawHeaders };
	for (const name of names) {
		const clientValue = readClientHeader(options?.clientHeaders, name);
		if (clientValue == null || split.extraHeaders[name] === clientValue) continue;
		nextHeaders[name] = clientValue;
		changed = true;
	}
	if (!changed) return customParams;
	return { ...customParams, [ROUTE_CUSTOM_PARAMS_HEADERS_KEY]: nextHeaders };
}

export function applyRouteExtraHeaders(
	base: Record<string, string>,
	customParams: Record<string, unknown> | null | undefined,
	options?: { forceOverride?: boolean; clientHeaders?: ClientHeaderSource },
): Record<string, string> {
	const resolved = overlayClientHeadersOnRouteCustomParams(customParams, options);
	return mergeUpstreamHeaders(base, extraHeadersFromCustomParams(resolved));
}

type JsonObject = Record<string, unknown>;

function deepMergeJson(base: unknown, overlay: unknown): unknown {
	if (overlay !== undefined) {
		if (Array.isArray(overlay)) {
			return overlay;
		}
		if (isPlainObject(base) && isPlainObject(overlay)) {
			const merged: JsonObject = {};
			const keys = new Set([...Object.keys(base), ...Object.keys(overlay)]);
			for (const key of keys) {
				merged[key] = deepMergeJson(base[key], overlay[key]);
			}
			return merged;
		}
		return overlay;
	}
	return base;
}

export type MergeRouteRequestBodyOptions = {
	forceOverride?: boolean;
};

/**
 * 路由 `custom_params` 与客户端 JSON 深度合并。默认客户端字段优先；`forceOverride` 时路由字段优先。
 */
export function mergeRouteRequestBody(
	customParams: Record<string, unknown> | null | undefined,
	userBody: JsonObject,
	options?: MergeRouteRequestBodyOptions,
): JsonObject {
	const split = splitRouteCustomParams(customParams);
	const forceOverride = options?.forceOverride ?? split.forceOverrideBody;
	const merged = forceOverride ? deepMergeJson(userBody, split.body) : deepMergeJson(split.body, userBody);
	return isPlainObject(merged) ? merged : { ...userBody };
}
