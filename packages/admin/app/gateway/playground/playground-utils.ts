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

export const BODY_TEMPLATES: Record<string, string> = {
	openai: `{
  "messages": [{ "role": "user", "content": "Hello" }],
  "max_tokens": 256,
  "stream": true,
  "stream_options": { "include_usage": true }
}`,
	openai_responses: `{
  "input": [{ "role": "user", "content": "Hello" }],
  "max_output_tokens": 256,
  "store": false,
  "stream": true
}`,
	anthropic: `{
  "messages": [{ "role": "user", "content": "Hello" }],
  "max_tokens": 256,
  "stream": true
}`,
	gemini: `{
  "contents": [{ "role": "user", "parts": [{ "text": "Hello" }] }]
}`,
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
	if (proto === 'openai' && route.upstream_operation === 'responses') {
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
