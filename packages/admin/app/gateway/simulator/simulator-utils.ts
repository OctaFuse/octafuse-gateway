import { canonicalizeRequestOperation } from '@octafuse/core/route-topology';
import {
	AUDIO_SPEECH_BODY_TEMPLATE,
	AUDIO_TRANSCRIPTIONS_BODY_TEMPLATE,
	AUDIO_TRANSCRIPTIONS_FILE_URL_BODY_TEMPLATE,
	DASHSCOPE_MULTIMODAL_ASR_BODY_TEMPLATE,
} from '@/lib/audio-transcriptions';
import {
	IMAGE_EDITS_BODY_TEMPLATE,
	IMAGE_GENERATIONS_BODY_TEMPLATE,
	type ImageOperation,
} from '@/lib/image-generations';
import { GATEWAY_TOOLS, findGatewayToolById, type GatewayToolDefinition } from '@/lib/gateway-tools';
import type { AudioOperation, GatewayToolId, OpenaiLlmOperation, SimulatorProtocol } from '@/lib/invoke-kind';
import type { SimulatorGeminiAction } from '@/lib/simulator/endpoint';
import {
	DASHSCOPE_REALTIME_OPERATIONS,
	buildDashScopeRealtimeAsrTemplate,
	buildDashScopeRealtimeTtsTemplate,
	buildDashScopeSpeechBodyTemplate,
	isDashScopeRealtimeOperation,
	type DashScopeRealtimeOperation,
} from '@/lib/dashscope-realtime-client';
import type { AdminKeyListItem, AdminModelRow, RouteListRow } from './types';

export const LS_PROXY = 'octafuse.simulator.proxyBaseUrl';
export const LS_PROTOCOL = 'octafuse.simulator.protocol';
export const LS_OPENAI_LLM_OPERATION = 'octafuse.simulator.openaiLlmOperation';
export const LS_MODEL_ID = 'octafuse.simulator.modelId';
export const LS_ROUTE_GROUP = 'octafuse.simulator.routeGroup';
export const LS_KEY_ID = 'octafuse.simulator.keyId';
export const LS_INVOKE_KIND = 'octafuse.simulator.invokeKind';
export const LS_TOOL_ID = 'octafuse.simulator.toolId';

export const KEYS_PAGE_SIZE = 200;

export const inputClass =
	'w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white';
export const labelClass = 'block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1';
export const panelClass = 'rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm space-y-3';
export const codeBlockClass =
	'p-3 text-xs overflow-x-auto whitespace-pre-wrap bg-gray-50 border border-gray-200 rounded-md font-mono text-gray-900';

export const BODY_TEMPLATES: Record<SimulatorProtocol, string> = {
	openai: `{
  "model": "<auto>",
  "messages": [{ "role": "user", "content": "Hello" }],
  "max_tokens": 256,
  "stream": true,
  "stream_options": { "include_usage": true }
}`,
	anthropic: `{
  "model": "<auto>",
  "messages": [{ "role": "user", "content": "Hello" }],
  "max_tokens": 256,
  "stream": true
}`,
	gemini: `{
  "contents": [{ "role": "user", "parts": [{ "text": "Hello" }] }]
}`,
	dashscope: '{}',
};

/** OpenAI Responses：`input` + `store: false`，与调试台默认体对齐。 */
export const OPENAI_RESPONSES_BODY_TEMPLATE = `{
  "model": "<auto>",
  "input": [{ "role": "user", "content": "Hello" }],
  "max_output_tokens": 256,
  "store": false,
  "stream": true
}`;

/** Agent Tools request body templates（对齐 Proxy `/v1/tools/*` 入参）。 */
export const TOOL_BODY_TEMPLATES: Record<GatewayToolId, string> = {
	'web-search': `{
  "query": "OctaFuse Gateway",
  "count": 5
}`,
	'web-fetch': `{
  "url": "https://example.com"
}`,
	'web-deep-search': `{
  "query": "OctaFuse Gateway architecture",
  "count": 3
}`,
	'ai-detection': `{
  "text": "This is a sample paragraph for AI-rate detection."
}`,
};

export function bodyTemplateForTool(toolId: string): string {
	const tool = findGatewayToolById(toolId);
	if (!tool) return TOOL_BODY_TEMPLATES['web-search'];
	return TOOL_BODY_TEMPLATES[tool.id as GatewayToolId] ?? TOOL_BODY_TEMPLATES['web-search'];
}

/** Chat / Images / Audio / Tools template for the current selection. */
export function bodyTemplateForSelection(
	protocol: SimulatorProtocol,
	isImageModel: boolean,
	imageOperation: ImageOperation = 'generations',
	audioOperation: AudioOperation | null = null,
	toolId?: string | null,
	realtimeOperation?: string | null,
	providerModelName?: string | null,
	llmOperation: OpenaiLlmOperation = 'chat',
): string {
	if (toolId) {
		return bodyTemplateForTool(toolId);
	}
	if (audioOperation && protocol === 'openai') {
		if (audioOperation === 'speech' && providerModelName) {
			// OpenAI surface 可能映射到 DashScope；模板音色必须匹配实际供应商模型。
			return buildDashScopeSpeechBodyTemplate(providerModelName);
		}
		if (audioOperation === 'transcriptions' && realtimeOperation === 'audio.transcriptions.async') {
			return AUDIO_TRANSCRIPTIONS_FILE_URL_BODY_TEMPLATE;
		}
		return audioOperation === 'speech' ? AUDIO_SPEECH_BODY_TEMPLATE : AUDIO_TRANSCRIPTIONS_BODY_TEMPLATE;
	}
	if (audioOperation && protocol === 'dashscope') {
		if (audioOperation === 'speech') {
			return buildDashScopeRealtimeTtsTemplate(providerModelName);
		}
		if (realtimeOperation === 'audio.transcriptions.multimodal') {
			return DASHSCOPE_MULTIMODAL_ASR_BODY_TEMPLATE;
		}
		return buildDashScopeRealtimeAsrTemplate(
			realtimeOperation && isDashScopeRealtimeOperation(realtimeOperation)
				? realtimeOperation
				: undefined,
		);
	}
	if (isImageModel && protocol === 'openai') {
		return imageOperation === 'edits' ? IMAGE_EDITS_BODY_TEMPLATE : IMAGE_GENERATIONS_BODY_TEMPLATE;
	}
	if (protocol === 'openai' && llmOperation === 'responses') {
		return OPENAI_RESPONSES_BODY_TEMPLATE;
	}
	return BODY_TEMPLATES[protocol];
}

/** 从当前模型路由中提取 DashScope 实时 ASR/TTS 的可用对外生命周期。 */
export function listDashScopeRealtimeOperations(
	routes: RouteListRow[],
	modelId: string,
	routeGroup: string,
	audioOperation: AudioOperation,
): readonly DashScopeRealtimeOperation[] {
	const allowed = new Set(
		DASHSCOPE_REALTIME_OPERATIONS.filter((operation) => operation.startsWith(`audio.${audioOperation}.`)),
	);
	const found = new Set<DashScopeRealtimeOperation>();
	for (const route of routes) {
		if (
			route.model_id !== modelId ||
			String(route.status).toLowerCase() !== 'active' ||
			route.upstream_protocol !== 'dashscope' ||
			!routeGroupMatchesSelection(route.route_group, routeGroup)
		) {
			continue;
		}
		const upstreamOperation = route.upstream_operation ?? '';
		let matchedSurface = false;
		if (route.surfaces) {
			try {
				const surfaces = JSON.parse(route.surfaces) as Array<{
					request_protocol?: string;
					request_operation?: string;
					status?: string;
				}>;
				for (const surface of surfaces) {
					if (surface.status === 'disabled' || surface.request_protocol !== 'dashscope') {
						continue;
					}
					matchedSurface = true;
					const operation = surface.request_operation ?? '';
					if (allowed.has(operation as DashScopeRealtimeOperation)) {
						found.add(operation as DashScopeRealtimeOperation);
					} else if (operation === '*' && allowed.has(upstreamOperation as DashScopeRealtimeOperation)) {
						found.add(upstreamOperation as DashScopeRealtimeOperation);
					}
				}
			} catch {
				// Legacy rows without readable surfaces fall back to their upstream operation.
			}
		}
		if (!matchedSurface && allowed.has(upstreamOperation as DashScopeRealtimeOperation)) {
			found.add(upstreamOperation as DashScopeRealtimeOperation);
		}
	}
	return DASHSCOPE_REALTIME_OPERATIONS.filter((operation) => found.has(operation));
}

export const DASHSCOPE_HTTP_ASR_OPERATION = 'audio.transcriptions.multimodal';

/** 模拟器可选的 DashScope ASR 请求入口：同步 HTTP 透传 + 实时 WSS。 */
export function listDashScopeAudioClientOperations(
	routes: RouteListRow[],
	modelId: string,
	routeGroup: string,
	audioOperation: AudioOperation,
): readonly string[] {
	const realtime = listDashScopeRealtimeOperations(routes, modelId, routeGroup, audioOperation);
	if (audioOperation !== 'transcriptions') return realtime;
	let hasMultimodal = false;
	for (const route of routes) {
		if (
			route.model_id !== modelId ||
			String(route.status).toLowerCase() !== 'active' ||
			!routeGroupMatchesSelection(route.route_group, routeGroup)
		) {
			continue;
		}
		if (route.surfaces) {
			try {
				const surfaces = JSON.parse(route.surfaces) as Array<{
					request_protocol?: string;
					request_operation?: string;
					status?: string;
				}>;
				for (const surface of surfaces) {
					if (surface.status === 'disabled') continue;
					if (
						surface.request_protocol === 'dashscope' &&
						surface.request_operation === DASHSCOPE_HTTP_ASR_OPERATION
					) {
						hasMultimodal = true;
					}
				}
			} catch {
				// ignore unreadable surfaces
			}
		}
		if (
			route.upstream_protocol === 'dashscope' &&
			route.upstream_operation === DASHSCOPE_HTTP_ASR_OPERATION &&
			route.adapter === 'passthrough'
		) {
			hasMultimodal = true;
		}
	}
	return hasMultimodal ? [DASHSCOPE_HTTP_ASR_OPERATION, ...realtime] : realtime;
}

/** Matches Proxy `resolveModelRouting`: default group sends model id only, else `id:group`. */
export function buildModelRoutingString(modelId: string, routeGroup: string): string {
	const g = routeGroup.trim();
	if (!g || g === 'default') return modelId.trim();
	return `${modelId.trim()}:${g}`;
}

export function formatModelLabel(m: AdminModelRow): string {
	const dn = m.display_name?.trim() || 'n/a';
	return `${m.id} · ${dn} · ${m.vendor}`;
}

export function formatModelOptionLabel(m: AdminModelRow, hasActiveRouter: boolean): string {
	const base = formatModelLabel(m);
	return hasActiveRouter ? `🟢 ${base}` : `🔴 ${base}`;
}

export function formatKeyOptionLabel(k: AdminKeyListItem): string {
	return `${k.user_email ?? k.user_id} · ${k.name ?? 'n/a'} · ${k.id.slice(0, 8)}…`;
}

export function normalizeBodyWhitespace(text: string): string {
	return text.replace(/\r\n/g, '\n').trim();
}

export function isBodyDirty(
	bodyText: string,
	protocol: SimulatorProtocol,
	isImageModel = false,
	imageOperation: ImageOperation = 'generations',
	audioOperation: AudioOperation | null = null,
	toolId?: string | null,
	realtimeOperation?: string | null,
	providerModelName?: string | null,
	llmOperation: OpenaiLlmOperation = 'chat',
): boolean {
	return (
		normalizeBodyWhitespace(bodyText) !==
		normalizeBodyWhitespace(
			bodyTemplateForSelection(
				protocol,
				isImageModel,
				imageOperation,
				audioOperation,
				toolId,
				realtimeOperation,
				providerModelName,
				llmOperation,
			),
		)
	);
}

/** Effective route_group for matching: empty / default → routes with empty or "default" group. */
export function routeGroupMatchesSelection(routeGroup: string, selected: string): boolean {
	const sel = selected.trim();
	const rg = (routeGroup ?? '').trim() || 'default';
	if (!sel || sel === 'default') {
		return rg === 'default' || rg === '';
	}
	return rg === sel;
}

export const SIMULATOR_PROTOCOL_ORDER: readonly SimulatorProtocol[] = [
	'openai',
	'anthropic',
	'gemini',
	'dashscope',
];

export type SimulatorClientSurfaceOptions = {
	protocols: SimulatorProtocol[];
	openaiLlmOperations: OpenaiLlmOperation[];
	geminiActions: SimulatorGeminiAction[];
	imageOperations: ImageOperation[];
};

const EMPTY_CLIENT_SURFACES: SimulatorClientSurfaceOptions = {
	protocols: [],
	openaiLlmOperations: [],
	geminiActions: [],
	imageOperations: [],
};

type RouteSurfaceEntry = {
	request_protocol?: string;
	request_operation?: string;
	status?: string;
};

function parseRouteSurfaceEntries(raw: string | null | undefined): RouteSurfaceEntry[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw) as unknown;
		return Array.isArray(parsed)
			? parsed.filter((entry): entry is RouteSurfaceEntry => Boolean(entry && typeof entry === 'object'))
			: [];
	} catch {
		return [];
	}
}

function isSimulatorProtocol(value: string): value is SimulatorProtocol {
	return (SIMULATOR_PROTOCOL_ORDER as readonly string[]).includes(value);
}

function surfaceHasOperation(operations: Set<string>, ...wanted: string[]): boolean {
	return operations.has('*') || wanted.some((operation) => operations.has(operation));
}

/**
 * Client-facing protocols / endpoints from active public surfaces for the selected model + route group.
 * Legacy rows without surfaces fall back to upstream_protocol + `*`.
 */
export function listSupportedClientSurfaces(
	routes: RouteListRow[],
	modelId: string,
	routeGroup: string,
): SimulatorClientSurfaceOptions {
	if (!modelId) return EMPTY_CLIENT_SURFACES;

	const operationsByProtocol = new Map<SimulatorProtocol, Set<string>>();
	for (const route of routes) {
		if (
			route.model_id !== modelId ||
			String(route.status).toLowerCase() !== 'active' ||
			!routeGroupMatchesSelection(route.route_group, routeGroup)
		) {
			continue;
		}
		const parsed = parseRouteSurfaceEntries(route.surfaces);
		const entries =
			parsed.length > 0
				? parsed
				: [
						{
							request_protocol: route.upstream_protocol ?? 'openai',
							request_operation: '*',
							status: 'active',
						},
					];
		for (const surface of entries) {
			if (surface.status === 'disabled') continue;
			const protocol = String(surface.request_protocol ?? route.upstream_protocol ?? '')
				.trim()
				.toLowerCase();
			if (!isSimulatorProtocol(protocol)) continue;
			const operation = canonicalizeRequestOperation(
				protocol,
				String(surface.request_operation ?? '*').trim() || '*',
			);
			const bucket = operationsByProtocol.get(protocol) ?? new Set<string>();
			bucket.add(operation);
			operationsByProtocol.set(protocol, bucket);
		}
	}

	const protocols = SIMULATOR_PROTOCOL_ORDER.filter((protocol) => operationsByProtocol.has(protocol));
	const openaiOps = operationsByProtocol.get('openai') ?? new Set<string>();
	const openaiLlmOperations: OpenaiLlmOperation[] = [];
	if (surfaceHasOperation(openaiOps, 'chat')) openaiLlmOperations.push('chat');
	if (surfaceHasOperation(openaiOps, 'responses')) openaiLlmOperations.push('responses');

	const geminiOps = operationsByProtocol.get('gemini') ?? new Set<string>();
	const geminiActions: SimulatorGeminiAction[] = surfaceHasOperation(
		geminiOps,
		'models.generate',
		'generateContent',
		'streamGenerateContent',
	)
		? ['generateContent', 'streamGenerateContent']
		: [];

	const imageOperations: ImageOperation[] = [];
	if (surfaceHasOperation(openaiOps, 'images.generations')) imageOperations.push('generations');
	if (surfaceHasOperation(openaiOps, 'images.edits')) imageOperations.push('edits');

	return { protocols, openaiLlmOperations, geminiActions, imageOperations };
}

export function filterMatchingActiveRoutes(
	routes: RouteListRow[],
	modelId: string,
	routeGroup: string,
	requestProtocol?: string,
	requestOperation?: string,
): RouteListRow[] {
	if (!modelId) return [];
	const matchesSurface = (route: RouteListRow): boolean => {
		if (!requestProtocol || !requestOperation || !route.surfaces) return true;
		try {
			const surfaces = JSON.parse(route.surfaces) as Array<{
				request_protocol?: string;
				request_operation?: string;
				status?: string;
			}>;
			return surfaces.some(
				(surface) =>
					surface.status !== 'disabled' &&
					surface.request_protocol === requestProtocol &&
					(surface.request_operation === requestOperation || surface.request_operation === '*'),
			);
		} catch {
			return true;
		}
	};
	return routes
		.filter(
			(r) =>
				r.model_id === modelId &&
				String(r.status).toLowerCase() === 'active' &&
				routeGroupMatchesSelection(r.route_group, routeGroup) &&
				matchesSurface(r),
		)
		.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

export function redactAuthHeader(value: string): string {
	const t = value.trim();
	const m = /^(Bearer\s+)(.+)$/i.exec(t);
	if (!m) {
		if (t.startsWith('sk-') && t.length > 16) return `${t.slice(0, 12)}…${t.slice(-4)}`;
		return t;
	}
	const sk = m[2];
	if (sk.startsWith('sk-') && sk.length > 16) {
		return `${m[1]}${sk.slice(0, 12)}…${sk.slice(-4)}`;
	}
	return `${m[1]}***`;
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(headers)) {
		out[k] = k.toLowerCase() === 'authorization' ? redactAuthHeader(v) : v;
	}
	return out;
}

export function buildRequestLogsHref(opts: {
	apiKeyId?: string;
	modelId?: string;
	routeGroup?: string;
	protocol?: string;
}): string {
	const sp = new URLSearchParams();
	if (opts.apiKeyId) sp.set('api_key_id', opts.apiKeyId);
	if (opts.modelId) sp.set('model_id', opts.modelId);
	const rg = opts.routeGroup?.trim();
	if (rg && rg !== 'default') sp.set('route_group', rg);
	if (opts.protocol) sp.set('protocol', opts.protocol);
	const q = sp.toString();
	return q ? `/gateway/request-logs?${q}` : '/gateway/request-logs';
}

/** Tools Invocations；可选按 tool id 筛选（页面读 `?tool=`）。 */
export function buildToolsInvocationsHref(opts?: { toolId?: string }): string {
	const sp = new URLSearchParams();
	const tool = opts?.toolId ? findGatewayToolById(opts.toolId) : undefined;
	if (tool) sp.set('tool', tool.id);
	const q = sp.toString();
	return q ? `/gateway/tools/invocations?${q}` : '/gateway/tools/invocations';
}

export function listGatewayTools(): readonly GatewayToolDefinition[] {
	return GATEWAY_TOOLS;
}

export function tryParseProxyBaseUrl(
	raw: string,
): { ok: true; base: string } | { ok: false; reason: 'empty' | 'invalid' } {
	const trimmed = raw.trim();
	if (!trimmed) return { ok: false, reason: 'empty' };
	try {
		const u = new URL(trimmed);
		if (u.protocol !== 'http:' && u.protocol !== 'https:') {
			return { ok: false, reason: 'invalid' };
		}
		return { ok: true, base: trimmed.replace(/\/+$/, '') };
	} catch {
		return { ok: false, reason: 'invalid' };
	}
}

export function prettyJsonBody(bodyText: string): string {
	try {
		return JSON.stringify(JSON.parse(bodyText), null, 2);
	} catch {
		return bodyText;
	}
}
