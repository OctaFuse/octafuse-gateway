import {
	AUDIO_SPEECH_BODY_TEMPLATE,
	AUDIO_TRANSCRIPTIONS_BODY_TEMPLATE,
	isAudioRouteModel,
} from '@/lib/audio-transcriptions';
import { isAudioTranscriptionModel } from '@octafuse/core/db/model-modalities';
import {
	IMAGE_EDITS_BODY_TEMPLATE,
	IMAGE_GENERATIONS_BODY_TEMPLATE,
	isImageRouteModel,
	type ImageOperation,
} from '@/lib/image-generations';
import {
	buildDashScopeRealtimeAsrTemplate,
	buildDashScopeRealtimeTtsTemplate,
	buildDashScopeSpeechBodyTemplate,
	isDashScopeRealtimeOperation,
} from '@/lib/dashscope-realtime-client';
import {
	loadPlaygroundSampleBody,
	PLAYGROUND_LLM_SAMPLE_IDS,
	type PlaygroundLlmFamily,
	type PlaygroundLlmSampleId,
} from '@/lib/playground/samples';
import { normalizeProtocol } from '@/lib/playground/usage-parsing';
import type { AdminModelRow } from '@/lib/services/admin/types';
import type { ModelKindFilter } from '../models/types';
import type { RouteListRow } from './types';

export {
	PLAYGROUND_LLM_SAMPLE_IDS,
	resolveClaudeThinkingProfile,
	resolveGeminiThinkingProfile,
	type ClaudeThinkingProfile,
	type GeminiThinkingProfile,
	type PlaygroundLlmFamily,
	type PlaygroundLlmSampleId,
} from '@/lib/playground/samples';

export const inputClass =
	'w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white';
export const labelClass = 'block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1';
export const panelClass = 'rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm space-y-3';
export const codeBlockClass =
	'p-3 text-xs overflow-x-auto whitespace-pre-wrap bg-gray-50 border border-gray-200 rounded-md font-mono text-gray-900';
export const routeJsonPreClass = `${codeBlockClass} max-h-40 overflow-y-auto`;

export const LLM_SAMPLE_BODIES: Record<PlaygroundLlmFamily, Record<PlaygroundLlmSampleId, string>> = {
	openai_chat: {
		connectivity: loadPlaygroundSampleBody('openai_chat', 'connectivity'),
		tools: loadPlaygroundSampleBody('openai_chat', 'tools'),
		reasoning: loadPlaygroundSampleBody('openai_chat', 'reasoning'),
	},
	openai_responses: {
		connectivity: loadPlaygroundSampleBody('openai_responses', 'connectivity'),
		tools: loadPlaygroundSampleBody('openai_responses', 'tools'),
		reasoning: loadPlaygroundSampleBody('openai_responses', 'reasoning'),
	},
	anthropic: {
		connectivity: loadPlaygroundSampleBody('anthropic', 'connectivity'),
		tools: loadPlaygroundSampleBody('anthropic', 'tools'),
		reasoning: loadPlaygroundSampleBody('anthropic', 'reasoning'),
	},
	gemini: {
		connectivity: loadPlaygroundSampleBody('gemini', 'connectivity'),
		tools: loadPlaygroundSampleBody('gemini', 'tools'),
		reasoning: loadPlaygroundSampleBody('gemini', 'reasoning'),
	},
};

export const BODY_TEMPLATES: Record<string, string> = {
	openai: LLM_SAMPLE_BODIES.openai_chat.connectivity,
	openai_responses: LLM_SAMPLE_BODIES.openai_responses.connectivity,
	openai_responses_tools: LLM_SAMPLE_BODIES.openai_responses.tools,
	anthropic: LLM_SAMPLE_BODIES.anthropic.connectivity,
	gemini: LLM_SAMPLE_BODIES.gemini.connectivity,
};

export function resolveRouteModelKind(m: AdminModelRow | undefined): ModelKindFilter {
	if (!m) return 'llm';
	if (isAudioRouteModel(m)) return 'audio';
	if (isImageRouteModel(m)) return 'image';
	return 'llm';
}

export function isRouteActive(status: string): boolean {
	return status.trim().toLowerCase() === 'active';
}

export function formatRouteJsonColumn(raw: string | null | undefined): string {
	if (raw == null || String(raw).trim() === '') {
		return '—';
	}
	const text = String(raw).trim();
	try {
		return JSON.stringify(JSON.parse(text), null, 2);
	} catch {
		return text;
	}
}

export function decodeWireRequestBodyHeader(res: Response, decodeFailedLabel: string): string | null {
	const raw = res.headers.get('x-playground-request-body');
	if (raw == null || raw === '') return null;
	try {
		const decoded = decodeURIComponent(raw);
		try {
			return JSON.stringify(JSON.parse(decoded), null, 2);
		} catch {
			return decoded;
		}
	} catch {
		return decodeFailedLabel;
	}
}

type JsonObject = Record<string, unknown>;

function isPlainJsonObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 与 Proxy / Playground 服务端相同：custom_params 与用户体深度合并，用户字段优先。 */
export function deepMergePlaygroundDefaults(defaultValue: unknown, userValue: unknown): unknown {
	if (userValue !== undefined) {
		if (Array.isArray(userValue)) {
			return userValue;
		}
		if (isPlainJsonObject(defaultValue) && isPlainJsonObject(userValue)) {
			const merged: JsonObject = {};
			const keys = new Set([...Object.keys(defaultValue), ...Object.keys(userValue)]);
			for (const key of keys) {
				merged[key] = deepMergePlaygroundDefaults(defaultValue[key], userValue[key]);
			}
			return merged;
		}
		return userValue;
	}
	return defaultValue;
}

export type PlaygroundMergedBodyPreview = { status: 'invalid' } | { status: 'preview'; json: string };

/**
 * 客户端预览即将发往上游的 JSON：合并路由 `custom_params`，并在非 Gemini 协议写入 provider model。
 * 发送后仍以服务端 `x-playground-request-body` 为准（multipart / Vertex 前缀等无法在本地完整复现）。
 */
export function previewPlaygroundMergedBody(input: {
	bodyText: string;
	customParams?: string | null;
	upstreamProtocol?: string | null;
	providerModelName?: string | null;
}): PlaygroundMergedBodyPreview {
	let userBody: unknown;
	try {
		userBody = JSON.parse(input.bodyText);
	} catch {
		return { status: 'invalid' };
	}
	if (!isPlainJsonObject(userBody)) {
		return { status: 'invalid' };
	}

	let customParams: JsonObject = {};
	const rawCustom = input.customParams?.trim() ?? '';
	if (rawCustom) {
		try {
			const parsed = JSON.parse(rawCustom) as unknown;
			if (isPlainJsonObject(parsed)) {
				customParams = parsed;
			}
		} catch {
			// 无效 custom_params 在 Send 时会被服务端拒绝；预览仍展示用户体。
		}
	}

	const merged = deepMergePlaygroundDefaults(customParams, userBody);
	const body: JsonObject = isPlainJsonObject(merged) ? { ...merged } : { ...userBody };
	const proto = normalizeProtocol(input.upstreamProtocol ?? 'openai');
	const model = input.providerModelName?.trim() ?? '';
	if (model && proto !== 'gemini') {
		body.model = model;
	}
	return { status: 'preview', json: JSON.stringify(body, null, 2) };
}

export function routeMatchesSearch(route: RouteListRow, query: string): boolean {
	const needle = query.trim().toLowerCase();
	if (!needle) return true;
	const hay = [
		route.id,
		route.model_id,
		route.model_name,
		route.provider_id,
		route.provider_name,
		route.provider_model_name,
		route.route_group,
		route.upstream_protocol,
		route.upstream_operation,
		`${route.upstream_protocol}.${route.upstream_operation ?? '*'}`,
		route.pool_name,
		route.route_pool_id,
	]
		.filter((part) => part != null && String(part).trim() !== '')
		.join(' ')
		.toLowerCase();
	return hay.includes(needle);
}

export function templateForRoute(
	route: RouteListRow,
	model: AdminModelRow | undefined,
	imageOperation: ImageOperation = 'generations',
): string {
	const proto = normalizeProtocol(route.upstream_protocol);
	const isImage = model ? isImageRouteModel(model) : false;
	const isAudio = model ? isAudioRouteModel(model) : false;
	const isAudioTranscription = isAudioTranscriptionModel(model ?? {});
	const isAudioHttp = proto === 'openai' || proto === 'dashscope';
	const realtime = isAudio && proto === 'dashscope' && isDashScopeRealtimeOperation(route.upstream_operation ?? '');
	if (realtime) {
		return route.upstream_operation?.startsWith('audio.speech.')
			? buildDashScopeRealtimeTtsTemplate(route.provider_model_name)
			: buildDashScopeRealtimeAsrTemplate(
					(route.upstream_operation ?? 'audio.transcriptions.realtime.inference') as
						| 'audio.transcriptions.realtime.inference'
						| 'audio.transcriptions.realtime.session',
				);
	}
	if (isAudio && isAudioHttp) {
		if (isAudioTranscription) return AUDIO_TRANSCRIPTIONS_BODY_TEMPLATE;
		if (proto === 'dashscope' && route.upstream_operation === 'audio.speech') {
			return buildDashScopeSpeechBodyTemplate(route.provider_model_name);
		}
		return AUDIO_SPEECH_BODY_TEMPLATE;
	}
	if (isImage && proto === 'openai') {
		return imageOperation === 'edits' ? IMAGE_EDITS_BODY_TEMPLATE : IMAGE_GENERATIONS_BODY_TEMPLATE;
	}
	const family = resolvePlaygroundLlmFamily(route);
	if (family) {
		return playgroundLlmSampleBody(family, 'connectivity', playgroundModelHintFromRoute(route));
	}
	return BODY_TEMPLATES[proto] ?? BODY_TEMPLATES.openai;
}

export function normalizeBodyWhitespace(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

export function isPlaygroundBodyDirty(bodyText: string, template: string): boolean {
	return normalizeBodyWhitespace(bodyText) !== normalizeBodyWhitespace(template);
}

export function isResponsesPlaygroundRoute(route: RouteListRow | null | undefined): boolean {
	return resolvePlaygroundLlmFamily(route) === 'openai_responses';
}

export function resolvePlaygroundLlmFamily(route: RouteListRow | null | undefined): PlaygroundLlmFamily | null {
	if (!route) return null;
	const proto = normalizeProtocol(route.upstream_protocol);
	if (proto === 'anthropic') return 'anthropic';
	if (proto === 'gemini') return 'gemini';
	if (proto === 'openai') {
		return route.upstream_operation?.trim() === 'responses' ? 'openai_responses' : 'openai_chat';
	}
	return null;
}

export function playgroundLlmFamilyForRoute(
	route: RouteListRow | null | undefined,
	opts: { isImage?: boolean; isAudio?: boolean } = {},
): PlaygroundLlmFamily | null {
	if (opts.isImage || opts.isAudio) return null;
	return resolvePlaygroundLlmFamily(route);
}

export type PlaygroundModelHint = {
	modelId?: string | null;
	providerModelName?: string | null;
};

export function playgroundModelHintFromRoute(
	route: Pick<RouteListRow, 'model_id' | 'provider_model_name'> | null | undefined,
): PlaygroundModelHint | null {
	if (!route) return null;
	return { modelId: route.model_id, providerModelName: route.provider_model_name };
}

export function playgroundModelHintText(model?: PlaygroundModelHint | null): string {
	return [model?.modelId, model?.providerModelName]
		.filter((part): part is string => part != null && String(part).trim() !== '')
		.join(' ')
		.toLowerCase();
}

export function playgroundLlmSampleBody(
	family: PlaygroundLlmFamily,
	sampleId: PlaygroundLlmSampleId,
	model?: PlaygroundModelHint | null,
): string {
	return loadPlaygroundSampleBody(family, sampleId, playgroundModelHintText(model));
}

export function matchPlaygroundLlmSample(
	family: PlaygroundLlmFamily,
	bodyText: string,
	model?: PlaygroundModelHint | null,
): PlaygroundLlmSampleId | null {
	for (const sampleId of PLAYGROUND_LLM_SAMPLE_IDS) {
		if (!isPlaygroundBodyDirty(bodyText, playgroundLlmSampleBody(family, sampleId, model))) {
			return sampleId;
		}
	}
	return null;
}

/** @deprecated Use matchPlaygroundLlmSample('openai_responses', bodyText) */
export function matchResponsesPlaygroundSample(bodyText: string): PlaygroundLlmSampleId | null {
	return matchPlaygroundLlmSample('openai_responses', bodyText);
}
