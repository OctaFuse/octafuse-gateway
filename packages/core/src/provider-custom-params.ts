/**
 * Provider 级 `custom_params`：按上游协议分组的默认值下界，形如
 * `{ "<protocol>": { headers?: Record<string,string>, body?: Record<string,unknown> } }`。
 * 没有 `force_override`（该字段仍只属于 Route，见 `route-custom-params.ts`）。
 *
 * 运行时合并唯一入口是 {@link resolveEffectiveCustomParams}：把 Provider 默认值（按协议筛选）
 * 与 Route 的信封合成一份「有效参数」，合成结果的形状与 Route 现有的 `{headers, body, force_override}`
 * 信封完全一致，供 `packages/proxy/src/services/model-router.ts` 的 `routeRowToResult` 调用，
 * 下游 `route-custom-params.ts` 现有导出、`failover-dispatch.ts`、各 egress 驱动零改动。
 */
import { UPSTREAM_PROTOCOLS, type UpstreamProtocol } from './upstream-protocol';
import {
	composeRouteCustomParamsEnvelope,
	deepMergeJson,
	isProtectedUpstreamHeaderName,
	isValidHttpHeaderName,
	splitRouteCustomParams,
} from './route-custom-params';

/** 单个协议分组：headers 需为非受保护头，body 为任意 JSON 对象。 */
export interface ProviderCustomParamsProtocolConfig {
	headers?: Record<string, string>;
	body?: Record<string, unknown>;
}

/** `providers.custom_params` 落库信封：按协议分组，无 `force_override`。 */
export type ProviderCustomParamsMap = Partial<Record<UpstreamProtocol, ProviderCustomParamsProtocolConfig>>;

/** 与 Route 级 `custom_params` 大小限制保持同一量级，避免单个 Provider 的参数拖慢其下所有 Route。 */
const MAX_SERIALIZED_LENGTH = 32 * 1024;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUpstreamProtocolKey(key: string): key is UpstreamProtocol {
	return (UPSTREAM_PROTOCOLS as readonly string[]).includes(key);
}

function validateHeadersObject(headers: unknown, protocol: string): Record<string, string> | undefined {
	if (headers === undefined || headers === null) return undefined;
	if (!isPlainObject(headers)) {
		throw new Error(`providers.custom_params.${protocol}.headers must be an object`);
	}
	const result: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) {
		if (!isValidHttpHeaderName(name)) {
			throw new Error(`providers.custom_params.${protocol}.headers has invalid header name ${JSON.stringify(name)}`);
		}
		if (isProtectedUpstreamHeaderName(name)) {
			throw new Error(
				`providers.custom_params.${protocol}.headers cannot set protected header ${JSON.stringify(name)}`,
			);
		}
		if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) {
			throw new Error(`providers.custom_params.${protocol}.headers[${JSON.stringify(name)}] must be a string`);
		}
		result[name] = String(value);
	}
	return Object.keys(result).length > 0 ? result : undefined;
}

function validateBodyObject(body: unknown, protocol: string): Record<string, unknown> | undefined {
	if (body === undefined || body === null) return undefined;
	if (!isPlainObject(body)) {
		throw new Error(`providers.custom_params.${protocol}.body must be an object`);
	}
	return Object.keys(body).length > 0 ? (body as Record<string, unknown>) : undefined;
}

/**
 * 解析 + 校验：输入可以是 JSON 字符串、已解析对象，或 `null`/`undefined`（视为未配置，返回空对象，不抛错）。
 * 非法输入抛出的 `Error.message` 带字段路径（如 `providers.custom_params.openai.headers.Authorization`），
 * 供 Admin 层捕获后转 400。
 */
export function validateAndNormalizeProviderCustomParams(raw: unknown): ProviderCustomParamsMap {
	let parsed: unknown = raw;
	if (typeof raw === 'string') {
		const trimmed = raw.trim();
		if (trimmed === '') return {};
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			throw new Error('providers.custom_params must be valid JSON');
		}
	}
	if (parsed === undefined || parsed === null) return {};
	if (!isPlainObject(parsed)) {
		throw new Error('providers.custom_params must be a JSON object keyed by upstream protocol');
	}

	const result: ProviderCustomParamsMap = {};
	for (const [protocol, value] of Object.entries(parsed)) {
		if (!isUpstreamProtocolKey(protocol)) {
			throw new Error(
				`providers.custom_params has unknown protocol key ${JSON.stringify(protocol)}: expected one of ${UPSTREAM_PROTOCOLS.join(', ')}`,
			);
		}
		if (value === undefined || value === null) continue;
		if (!isPlainObject(value)) {
			throw new Error(`providers.custom_params.${protocol} must be an object`);
		}
		const headers = validateHeadersObject(value.headers, protocol);
		const body = validateBodyObject(value.body, protocol);
		if (headers || body) {
			result[protocol] = {
				...(headers ? { headers } : {}),
				...(body ? { body } : {}),
			};
		}
	}
	return result;
}

/** 空 map 序列化为 `null`（= 清空/未配置）；超长抛错，供 Admin 层转 400。 */
export function serializeProviderCustomParams(map: ProviderCustomParamsMap): string | null {
	if (!map || Object.keys(map).length === 0) return null;
	const serialized = JSON.stringify(map);
	if (serialized.length > MAX_SERIALIZED_LENGTH) {
		throw new Error(
			`providers.custom_params is too large (${serialized.length} bytes, max ${MAX_SERIALIZED_LENGTH} bytes)`,
		);
	}
	return serialized;
}

/**
 * Admin 保存入口：解析 → 校验 → 规范化 → 序列化一步到位，返回可直接入库的字符串或 `null`（清空）。
 * 不要拆成「先 normalize 再单独 assert」两步调用——那样校验用的和落库用的是两次独立解析的结果，
 * 容易出现两者不一致的漂移。调用方（Admin service）捕获抛出的 `Error` 并转 400 即可。
 */
export function parseAndNormalizeProviderCustomParams(raw: unknown): string | null {
	const map = validateAndNormalizeProviderCustomParams(raw);
	return serializeProviderCustomParams(map);
}

/** 运行时安全解析：JSON 损坏或非对象一律降级为空 map，并 warn（不抛异常，不能让装配点因为一行脏数据整体失败）。 */
function safeParseProviderCustomParams(raw: string | null | undefined, providerId: string | undefined): ProviderCustomParamsMap {
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (isPlainObject(parsed)) {
			return parsed as ProviderCustomParamsMap;
		}
	} catch {
		// fallthrough to warn below
	}
	console.warn(`[Gateway Router] ignored invalid providers.custom_params JSON providerId=${providerId ?? 'unknown'}`);
	return {};
}

/** 与 `model-router.ts` 原有的 Route 侧降级语义保持一致：JSON 损坏/非对象一律视为未配置，并 warn。 */
function safeParseRouteCustomParams(
	raw: string | null | undefined,
	context: { routeId?: string; modelId?: string },
): Record<string, unknown> | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		// fallthrough to warn below
	}
	console.warn(
		`[Gateway Router] ignored invalid custom_params JSON routeId=${context.routeId ?? 'unknown'} modelId=${context.modelId ?? 'unknown'}`,
	);
	return null;
}

/**
 * Header 合并前按大小写不敏感去重：Provider 与 Route 配了同名但大小写不同的 header 时，
 * 只保留 Route 一侧的大小写与值（Route 优先级更高），避免两个键并存导致结果不确定。
 */
function mergeHeadersCaseInsensitive(
	providerHeaders: Record<string, string> | undefined,
	routeHeaders: Record<string, string>,
): Record<string, string> {
	const result: Record<string, string> = {};
	const lowerToKey = new Map<string, string>();
	for (const [name, value] of Object.entries(providerHeaders ?? {})) {
		result[name] = value;
		lowerToKey.set(name.toLowerCase(), name);
	}
	for (const [name, value] of Object.entries(routeHeaders)) {
		const lower = name.toLowerCase();
		const existingKey = lowerToKey.get(lower);
		if (existingKey !== undefined && existingKey !== name) {
			delete result[existingKey];
		}
		result[name] = value;
		lowerToKey.set(lower, name);
	}
	return result;
}

/**
 * 运行时唯一入口：把 Provider 默认值（按 `protocol` 筛选）与 Route 的信封合成为一份有效参数。
 *
 * - 两侧 JSON 解析都安全降级，绝不向上抛异常：Provider 一行坏数据只影响它自己（视为未配置），
 *   不会让该 Provider 下所有 Route 解析失败。
 * - `force_override` 只取自 Route（Provider 没有这个字段），作用于合并后的整份有效 body/headers。
 * - 两侧都为空时返回 `null`，与改造前 `parseJsonObject(route.custom_params)` 的产出完全一致（回归基线）。
 */
export function resolveEffectiveCustomParams(
	providerCustomParamsJson: string | null | undefined,
	routeCustomParamsJson: string | null | undefined,
	protocol: UpstreamProtocol,
	context?: { providerId?: string; routeId?: string; modelId?: string },
): Record<string, unknown> | null {
	return resolveCustomParamsLayers(providerCustomParamsJson, routeCustomParamsJson, protocol, context).effective;
}

/** Keep the original layers alongside the effective configuration for request inspection. */
export function resolveCustomParamsLayers(
	providerCustomParamsJson: string | null | undefined,
	routeCustomParamsJson: string | null | undefined,
	protocol: UpstreamProtocol,
	context?: { providerId?: string; routeId?: string; modelId?: string },
) {
	const providerMap = safeParseProviderCustomParams(providerCustomParamsJson, context?.providerId);
	const providerPart = providerMap[protocol];

	const routeCustomParams = safeParseRouteCustomParams(routeCustomParamsJson, context ?? {});
	const routeSplit = splitRouteCustomParams(routeCustomParams);

	const mergedHeaders = mergeHeadersCaseInsensitive(providerPart?.headers, routeSplit.extraHeaders);
	const mergedBody = deepMergeJson(providerPart?.body ?? {}, routeSplit.body) as Record<string, unknown>;

	const effective = composeRouteCustomParamsEnvelope({
		body: mergedBody,
		extraHeaders: mergedHeaders,
		forceOverrideHeaders: routeSplit.forceOverrideHeaders,
		forceOverrideBody: routeSplit.forceOverrideBody,
	});
	return { effective, provider: providerPart, route: routeSplit };
}
