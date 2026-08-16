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
import { normalizeProtocol } from '@/lib/playground/usage-parsing';
import type { AdminModelRow } from '@/lib/services/admin/types';
import type { ModelKindFilter } from '../models/types';
import type { RouteListRow } from './types';

export const inputClass =
	'w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white';
export const labelClass = 'block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1';
export const panelClass = 'rounded-xl border border-gray-200/80 bg-white p-4 shadow-sm space-y-3';
export const codeBlockClass =
	'p-3 text-xs overflow-x-auto whitespace-pre-wrap bg-gray-50 border border-gray-200 rounded-md font-mono text-gray-900';
export const routeJsonPreClass = `${codeBlockClass} max-h-40 overflow-y-auto`;

export type PlaygroundLlmFamily = 'openai_chat' | 'openai_responses' | 'anthropic' | 'gemini';

export type PlaygroundLlmSampleId = 'connectivity' | 'tools' | 'reasoning';

export const PLAYGROUND_LLM_SAMPLE_IDS: readonly PlaygroundLlmSampleId[] = [
	'connectivity',
	'tools',
	'reasoning',
];

const WRITE_NOTE_PROMPT =
	'Call write_note now. Put a title and a multi-sentence body in content. Do not answer with plain text.';
const REASONING_PROMPT = 'Think step by step, then answer in a few sentences: why does streaming tool arguments matter?';

const WRITE_NOTE_JSON_SCHEMA = `{
      "type": "object",
      "additionalProperties": false,
      "required": ["title", "content"],
      "properties": {
        "title": { "type": "string" },
        "content": { "type": "string", "description": "Note body; use several sentences so arguments can stream." }
      }
    }`;

/** Gemini functionDeclarations use an OpenAPI subset and reject additionalProperties. */
const WRITE_NOTE_GEMINI_SCHEMA = `{
      "type": "object",
      "required": ["title", "content"],
      "properties": {
        "title": { "type": "string" },
        "content": { "type": "string", "description": "Note body; use several sentences so arguments can stream." }
      }
    }`;

export const LLM_SAMPLE_BODIES: Record<PlaygroundLlmFamily, Record<PlaygroundLlmSampleId, string>> = {
	openai_chat: {
		connectivity: `{
  "messages": [{ "role": "user", "content": "Hello" }],
  "max_tokens": 256,
  "stream": true,
  "stream_options": { "include_usage": true }
}`,
		tools: `{
  "messages": [{ "role": "user", "content": "${WRITE_NOTE_PROMPT}" }],
  "max_tokens": 512,
  "stream": true,
  "stream_options": { "include_usage": true },
  "tools": [{
    "type": "function",
    "function": {
      "name": "write_note",
      "description": "Write a note with a title and a longer body.",
      "parameters": ${WRITE_NOTE_JSON_SCHEMA}
    }
  }]
}`,
		reasoning: `{
  "messages": [{ "role": "user", "content": "${REASONING_PROMPT}" }],
  "max_tokens": 1024,
  "stream": true,
  "stream_options": { "include_usage": true },
  "reasoning_effort": "medium"
}`,
	},
	openai_responses: {
		connectivity: `{
  "input": [{ "role": "user", "content": "Hello" }],
  "max_output_tokens": 256,
  "store": false,
  "stream": true
}`,
		tools: `{
  "input": [{
    "role": "user",
    "content": "${WRITE_NOTE_PROMPT}"
  }],
  "max_output_tokens": 512,
  "store": false,
  "stream": true,
  "tools": [{
    "type": "function",
    "name": "write_note",
    "description": "Write a note with a title and a longer body.",
    "strict": true,
    "parameters": ${WRITE_NOTE_JSON_SCHEMA}
  }]
}`,
		reasoning: `{
  "input": [{ "role": "user", "content": "${REASONING_PROMPT}" }],
  "max_output_tokens": 1024,
  "store": false,
  "stream": true,
  "reasoning": { "effort": "medium", "summary": "auto" }
}`,
	},
	anthropic: {
		connectivity: `{
  "messages": [{ "role": "user", "content": "Hello" }],
  "max_tokens": 256,
  "stream": true
}`,
		tools: `{
  "messages": [{ "role": "user", "content": "${WRITE_NOTE_PROMPT}" }],
  "max_tokens": 512,
  "stream": true,
  "tools": [{
    "name": "write_note",
    "description": "Write a note with a title and a longer body.",
    "input_schema": ${WRITE_NOTE_JSON_SCHEMA}
  }]
}`,
		reasoning: `{
  "messages": [{ "role": "user", "content": "${REASONING_PROMPT}" }],
  "max_tokens": 2048,
  "stream": true,
  "thinking": { "type": "enabled", "budget_tokens": 1024 }
}`,
	},
	gemini: {
		connectivity: `{
  "contents": [{ "role": "user", "parts": [{ "text": "Hello" }] }]
}`,
		tools: `{
  "contents": [{ "role": "user", "parts": [{ "text": "${WRITE_NOTE_PROMPT}" }] }],
  "tools": [{
    "functionDeclarations": [{
      "name": "write_note",
      "description": "Write a note with a title and a longer body.",
      "parameters": ${WRITE_NOTE_GEMINI_SCHEMA}
    }]
  }]
}`,
		reasoning: `{
  "contents": [{ "role": "user", "parts": [{ "text": "${REASONING_PROMPT}" }] }],
  "generationConfig": {
    "thinkingConfig": { "includeThoughts": true, "thinkingBudget": 1024 }
  }
}`,
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
	if (isResponsesPlaygroundRoute(route)) {
		return BODY_TEMPLATES.openai_responses;
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

export function playgroundLlmSampleBody(family: PlaygroundLlmFamily, sampleId: PlaygroundLlmSampleId): string {
	return LLM_SAMPLE_BODIES[family][sampleId];
}

export function matchPlaygroundLlmSample(
	family: PlaygroundLlmFamily,
	bodyText: string,
): PlaygroundLlmSampleId | null {
	for (const sampleId of PLAYGROUND_LLM_SAMPLE_IDS) {
		if (!isPlaygroundBodyDirty(bodyText, playgroundLlmSampleBody(family, sampleId))) {
			return sampleId;
		}
	}
	return null;
}

/** @deprecated Use matchPlaygroundLlmSample('openai_responses', bodyText) */
export function matchResponsesPlaygroundSample(bodyText: string): PlaygroundLlmSampleId | null {
	return matchPlaygroundLlmSample('openai_responses', bodyText);
}
