/**
 * OpenAI 入口的额外顶层字段（SDK `extra_body` 发到线上就是平铺字段）。
 * 按上游结构深度合并进适配器已经建好的请求体；`model` 与适配器声明的路径在合并后恢复。
 */
import { getAdapterById, getAdapterByOptionKey } from './adapters/registry';
import { splitRouteCustomParams } from './route-custom-params';

/** 额外字段 JSON 上限。超出直接 400，避免把大段 base64 再包一层转发。 */
export const UPSTREAM_EXTRA_FIELDS_MAX_BYTES = 32 * 1024;

/** 生图入口已经解析或映射过的字段，不再原样并进上游体。 */
export const IMAGE_GENERATION_KNOWN_KEYS = [
	'model',
	'prompt',
	'n',
	'size',
	'quality',
	'background',
	'response_format',
	'output_format',
	'user',
	'style',
	'moderation',
	'output_compression',
	'partial_images',
	'stream',
	'watermark',
	'sequential_image_generation',
	'sequential_image_generation_options',
	'image',
	'optimize_prompt_options',
] as const;

/** 语音合成入口已经解析过的字段。 */
export const AUDIO_SPEECH_KNOWN_KEYS = [
	'model',
	'input',
	'voice',
	'response_format',
	'speed',
	'stream_format',
	'instructions',
] as const;

/**
 * 转写入口已经解析过的字段。
 * `duration` / `file_url` 只给网关计费和异步提交用，不转发给上游。
 */
export const AUDIO_TRANSCRIPTION_KNOWN_KEYS = [
	'file',
	'model',
	'language',
	'prompt',
	'response_format',
	'temperature',
	'timestamp_granularities',
	'timestamp_granularities[]',
	'chunking_strategy',
	'include',
	'include[]',
	'stream',
	'duration',
	'duration_seconds',
	'file_url',
] as const;

/** 图片编辑 multipart 已经消费的字段。 */
export const IMAGE_EDIT_KNOWN_KEYS = [
	'model',
	'prompt',
	'n',
	'size',
	'quality',
	'background',
	'image',
	'images',
	'image[]',
	'mask',
	'response_format',
	'output_format',
	'user',
	'output_compression',
	'moderation',
	'partial_images',
	'stream',
] as const;

/** 挂在内部请求体上，驱动取出后不会发给上游。 */
export const UPSTREAM_EXTRA_FIELDS_KEY = '__octafuse_extra_fields';

export class UpstreamExtraFieldsError extends Error {
	readonly status = 400;
	constructor(message: string) {
		super(message);
		this.name = 'UpstreamExtraFieldsError';
	}
}

type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMergeJson(base: unknown, overlay: unknown): unknown {
	if (overlay !== undefined) {
		if (Array.isArray(overlay)) return overlay;
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

function cloneJson(value: unknown): unknown {
	if (value === undefined) return undefined;
	return JSON.parse(JSON.stringify(value)) as unknown;
}

export function assertUpstreamExtraFieldsSize(extras: JsonObject): void {
	let encoded: string;
	try {
		encoded = JSON.stringify(extras);
	} catch {
		throw new UpstreamExtraFieldsError('extra fields must be JSON-serializable');
	}
	if (encoded.length > UPSTREAM_EXTRA_FIELDS_MAX_BYTES) {
		throw new UpstreamExtraFieldsError(
			`extra fields must be at most ${UPSTREAM_EXTRA_FIELDS_MAX_BYTES} bytes`,
		);
	}
}

/** 表单里的 JSON 对象 / 数组 / 数字 / 布尔按 JSON 解析，其余保持字符串。 */
export function parseFormExtraValue(value: string): unknown {
	const trimmed = value.trim();
	if (trimmed === '') return value;
	const looksLikeJson =
		trimmed.startsWith('{') ||
		trimmed.startsWith('[') ||
		trimmed === 'true' ||
		trimmed === 'false' ||
		trimmed === 'null' ||
		/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed);
	if (!looksLikeJson) return value;
	try {
		return JSON.parse(trimmed) as unknown;
	} catch {
		return value;
	}
}

/** 去掉入口已知字段，剩下的按上游结构合并。 */
export function pickExtraFields(body: JsonObject, knownKeys: readonly string[]): JsonObject {
	const known = new Set(knownKeys);
	const extras: JsonObject = {};
	for (const [key, value] of Object.entries(body)) {
		if (known.has(key) || value === undefined) continue;
		extras[key] = value;
	}
	assertUpstreamExtraFieldsSize(extras);
	return extras;
}

/** multipart 未知字段：文件跳过；能解析成 JSON 的按 JSON，否则保留字符串。 */
export function pickFormExtraFields(body: Record<string, unknown>, knownKeys: readonly string[]): JsonObject {
	const known = new Set<string>(knownKeys);
	const extras: JsonObject = {};
	for (const [key, value] of Object.entries(body)) {
		if (known.has(key) || value == null) continue;
		if (typeof value === 'string') {
			extras[key] = parseFormExtraValue(value);
			continue;
		}
		if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
			extras[key] = value.map((item) => parseFormExtraValue(item));
		}
	}
	assertUpstreamExtraFieldsSize(extras);
	return extras;
}

/** 表单字段只接受标量；对象和数组序列化成 JSON 字符串。 */
export function formExtraFieldText(value: unknown): string | null {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (value != null && typeof value === 'object') return JSON.stringify(value);
	return null;
}

export function attachUpstreamExtraFields(body: JsonObject, extras: JsonObject): JsonObject {
	if (Object.keys(extras).length === 0) return body;
	return { ...body, [UPSTREAM_EXTRA_FIELDS_KEY]: extras };
}

export function detachUpstreamExtraFields(body: JsonObject): { body: JsonObject; extras: JsonObject } {
	const raw = body[UPSTREAM_EXTRA_FIELDS_KEY];
	const extras = isPlainObject(raw) ? { ...raw } : {};
	if (!(UPSTREAM_EXTRA_FIELDS_KEY in body)) {
		return { body, extras };
	}
	const next = { ...body };
	delete next[UPSTREAM_EXTRA_FIELDS_KEY];
	return { body: next, extras };
}

type PathLookup = { found: boolean; value: unknown };

function lookupPath(root: unknown, path: string): PathLookup {
	const parts = path.split('.').filter((part) => part.length > 0);
	if (parts.length === 0) return { found: false, value: undefined };
	let current: unknown = root;
	for (const part of parts) {
		if (!isPlainObject(current) || !Object.prototype.hasOwnProperty.call(current, part)) {
			return { found: false, value: undefined };
		}
		current = current[part];
	}
	return { found: true, value: current };
}

function assignPath(root: JsonObject, path: string, value: unknown): void {
	const parts = path.split('.').filter((part) => part.length > 0);
	if (parts.length === 0) return;
	let current = root;
	for (let index = 0; index < parts.length - 1; index += 1) {
		const part = parts[index]!;
		const next = current[part];
		if (!isPlainObject(next)) {
			current[part] = {};
		}
		current = current[part] as JsonObject;
	}
	current[parts[parts.length - 1]!] = value;
}

function deletePath(root: JsonObject, path: string): void {
	const parts = path.split('.').filter((part) => part.length > 0);
	if (parts.length === 0) return;
	let current: unknown = root;
	for (let index = 0; index < parts.length - 1; index += 1) {
		if (!isPlainObject(current)) return;
		current = current[parts[index]!];
	}
	if (isPlainObject(current)) delete current[parts[parts.length - 1]!];
}

function sameJson(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

export type ApplyUpstreamExtraFieldsInput = {
	built: JsonObject;
	customParams?: JsonObject | null;
	extras?: JsonObject | null;
	protectedPaths?: readonly string[];
};

export type ApplyUpstreamExtraFieldsResult = {
	body: JsonObject;
	restoredPaths: string[];
};

/**
 * 合并顺序（后者覆盖前者）：
 * 路由 body 默认值 → 适配器构建结果 → 客户端额外字段 → 路由 `force_override.body` → 受保护路径恢复。
 * `model` 始终受保护。
 */
export function applyUpstreamExtraFields(
	input: ApplyUpstreamExtraFieldsInput,
): ApplyUpstreamExtraFieldsResult {
	const extras = input.extras ?? {};
	assertUpstreamExtraFieldsSize(extras);
	const split = splitRouteCustomParams(input.customParams);
	let merged = deepMergeJson(deepMergeJson(split.body, input.built), extras);
	if (split.forceOverrideBody) {
		merged = deepMergeJson(merged, split.body);
	}
	const body = isPlainObject(merged) ? merged : { ...input.built };
	const protectedPaths = ['model', ...(input.protectedPaths ?? [])];
	const restoredPaths: string[] = [];
	const seen = new Set<string>();
	for (const path of protectedPaths) {
		if (seen.has(path)) continue;
		seen.add(path);
		const builtValue = lookupPath(input.built, path);
		const current = lookupPath(body, path);
		const builtMissing = !builtValue.found;
		const currentMissing = !current.found;
		if (builtMissing && currentMissing) continue;
		if (!builtMissing && !currentMissing && sameJson(builtValue.value, current.value)) continue;
		if (builtMissing) {
			deletePath(body, path);
		} else {
			assignPath(body, path, cloneJson(builtValue.value));
		}
		restoredPaths.push(path);
	}
	return { body, restoredPaths };
}

export function protectedUpstreamPathsForRoute(route: {
	adapter: string;
	upstreamProtocol: string;
	upstreamOperation: string;
}): readonly string[] {
	const descriptor =
		route.adapter === 'passthrough'
			? getAdapterByOptionKey(
					`passthrough:${route.upstreamProtocol}:${route.upstreamOperation}`,
				)
			: getAdapterById(route.adapter);
	return descriptor?.protectedUpstreamPaths ?? [];
}

/** 管理后台展示用。`model` 由网关统一保留，描述符里不必再写一遍。 */
export function displayedProtectedUpstreamPaths(
	protectedPaths: readonly string[] | undefined,
): string[] {
	const paths = ['model', ...(protectedPaths ?? [])];
	return [...new Set(paths)];
}

/** 请求日志里替换 data URL，避免把图片或音频原文落库。 */
export function redactExtraFieldsForLog(value: unknown): unknown {
	if (typeof value === 'string') {
		const marker = ';base64,';
		const index = value.indexOf(marker);
		if (value.startsWith('data:') && index >= 0) {
			return `[redacted data-url ${value.length} chars]`;
		}
		return value;
	}
	if (Array.isArray(value)) return value.map(redactExtraFieldsForLog);
	if (isPlainObject(value)) {
		const out: JsonObject = {};
		for (const [key, nested] of Object.entries(value)) {
			out[key] = redactExtraFieldsForLog(nested);
		}
		return out;
	}
	return value;
}
