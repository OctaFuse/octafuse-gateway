import type { UpstreamProtocol } from "./upstream-protocol";
import {
	PASSTHROUGH_ROUTE_ADAPTER,
	ROUTE_ADAPTER_MAPPINGS,
	isRouteAdapter,
} from "./adapters/registry";

export {
	DASHSCOPE_MULTIMODAL_GENERATION_PATH,
	PASSTHROUGH_ROUTE_ADAPTER,
	ROUTE_ADAPTER_MAPPINGS,
	ROUTE_ADAPTERS,
	isRouteAdapter,
	type RouteAdapter,
	type RouteAdapterMapping,
} from "./adapters/registry";

/** Gemini generate-content family (stream + non-stream). */
export const GEMINI_GENERATE_OPERATION = 'models.generate';

/** Legacy Gemini wire-action operation names (pre-v2.2.0). */
export const GEMINI_LEGACY_GENERATE_OPERATIONS = [
	'generateContent',
	'streamGenerateContent',
] as const;

/** Stable request-operation identifiers. `*` is reserved for migrated legacy surfaces/targets. */
export const REQUEST_OPERATIONS_BY_PROTOCOL = {
	openai: [
		"chat",
		"responses",
		"images.generations",
		"images.edits",
		"audio.transcriptions",
		"audio.speech",
	],
	anthropic: ['messages'],
	gemini: [GEMINI_GENERATE_OPERATION],
	dashscope: [
		"audio.transcriptions",
		"audio.transcriptions.multimodal",
		"audio.transcriptions.async",
		"audio.transcriptions.realtime.inference",
		"audio.transcriptions.realtime.session",
		"audio.speech",
		"audio.speech.stream",
		"audio.speech.multimodal",
		"audio.speech.realtime.inference",
		"audio.speech.realtime.session",
	],
} as const satisfies Record<UpstreamProtocol, readonly string[]>;

export type RequestOperation =
	| (typeof REQUEST_OPERATIONS_BY_PROTOCOL)[UpstreamProtocol][number]
	| "*";

export const LEGACY_WILDCARD_OPERATION: RequestOperation = "*";

/**
 * 校验 request surface 与 upstream target 是否由 adapter 明确定义。
 * passthrough 只允许同协议且 operation 相同（`*` 保留迁移兼容）。
 */
export function isRouteAdapterCompatible(input: {
	adapter: string;
	requestProtocol: UpstreamProtocol;
	requestOperation: string;
	upstreamProtocol: UpstreamProtocol;
	upstreamOperation: string;
}): boolean {
	if (!isRouteAdapter(input.adapter)) return false;
	if (input.adapter === PASSTHROUGH_ROUTE_ADAPTER) {
		return (
			input.requestProtocol === input.upstreamProtocol &&
			(input.requestOperation === LEGACY_WILDCARD_OPERATION ||
				input.upstreamOperation === LEGACY_WILDCARD_OPERATION ||
				input.requestOperation === input.upstreamOperation)
		);
	}
	const mapping = ROUTE_ADAPTER_MAPPINGS[input.adapter];
	return (
		input.requestProtocol === mapping.requestProtocol &&
		input.requestOperation === mapping.requestOperation &&
		input.upstreamProtocol === mapping.upstreamProtocol &&
		input.upstreamOperation === mapping.upstreamOperation
	);
}

export function isRequestOperationForProtocol(
	protocol: UpstreamProtocol,
	operation: string
): boolean {
	return (
		operation === LEGACY_WILDCARD_OPERATION ||
		(REQUEST_OPERATIONS_BY_PROTOCOL[protocol] as readonly string[]).includes(
			operation
		)
	);
}

/**
 * DashScope 实时 ASR 有两套不兼容的生命周期：Qwen3-ASR 使用 session，
 * Fun-ASR/Qwen-Audio/Paraformer 使用 inference。供应商模型名是唯一可靠的上游标识。
 */
export function isDashScopeRealtimeAsrModelOperationCompatible(
	providerModelName: string,
	operation: string
): boolean {
	if (!operation.startsWith("audio.transcriptions.realtime.")) return true;
	const model = providerModelName.trim().toLowerCase();
	if (!model) return true;
	const isQwen3SessionModel =
		model === "qwen3-asr-flash-realtime" ||
		model.startsWith("qwen3-asr-flash-realtime-");
	return operation.endsWith(".session")
		? isQwen3SessionModel
		: !isQwen3SessionModel;
}

export function normalizeRouteOperation(raw: unknown): string {
	const operation = typeof raw === "string" ? raw.trim() : "";
	return operation || LEGACY_WILDCARD_OPERATION;
}

/**
 * Map legacy Gemini operations to the canonical family; non-gemini / unknown values (incl. `*`) pass through.
 */
export function canonicalizeRequestOperation(protocol: string, operation: string): string {
	const op = operation.trim();
	if (protocol.trim().toLowerCase() !== 'gemini') return op;
	if (
		op === GEMINI_GENERATE_OPERATION ||
		(GEMINI_LEGACY_GENERATE_OPERATIONS as readonly string[]).includes(op)
	) {
		return GEMINI_GENERATE_OPERATION;
	}
	return op;
}

/**
 * Alias priority when multiple legacy keys collapse to the same canonical key:
 * `models.generate` (2) > `generateContent` (1) > `streamGenerateContent` (0); others -1.
 * Comparison is case-insensitive.
 */
export function requestOperationAliasRank(operation: string): number {
	const op = operation.trim().toLowerCase();
	if (op === GEMINI_GENERATE_OPERATION.toLowerCase()) return 2;
	if (op === 'generatecontent') return 1;
	if (op === 'streamgeneratecontent') return 0;
	return -1;
}

export function effectiveUpstreamOperation(
	configuredOperation: string | null | undefined,
	requestOperation: string
): string {
	const configured = normalizeRouteOperation(configuredOperation);
	return configured === LEGACY_WILDCARD_OPERATION
		? requestOperation
		: configured;
}

export interface RoutePoolRow {
	id: string;
	model_id: string;
	route_group: string;
	name: string;
	strategy: string | null;
	/** JSON map: {"10":"hash_affinity","0":"weight_priority"} — per-priority-tier overrides */
	tier_strategies?: string | null;
	/** Provider sticky routing (0/1 or boolean depending on driver) */
	sticky_enabled?: boolean | number | null;
	sticky_idle_ttl_seconds?: number | null;
	/** Bumped when sticky config changes to invalidate bindings */
	sticky_epoch?: number | null;
	status: string;
	created_at?: string;
	updated_at?: string;
}

export interface ModelSurfaceRow {
	id: string;
	model_id: string;
	route_group: string;
	request_protocol: string;
	request_operation: string;
	route_pool_id: string;
	status: string;
	created_at?: string;
	updated_at?: string;
}

export type ResolvedModelSurfaceRow = ModelSurfaceRow & {
	pool_name: string;
	pool_strategy: string | null;
	/** JSON map from `route_pools.tier_strategies` */
	pool_tier_strategies: string | null;
	pool_status: string;
	/** Provider sticky routing from `route_pools` */
	pool_sticky_enabled?: boolean | number | null;
	pool_sticky_idle_ttl_seconds?: number | null;
	pool_sticky_epoch?: number | null;
};
