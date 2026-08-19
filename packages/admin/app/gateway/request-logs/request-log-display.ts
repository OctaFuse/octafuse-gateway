/**
 * Request Logs 列表展示辅助：Gemini wire action、是否流式、特性标签。
 */

import {
	isAudioSpeechModel,
	isAudioTranscriptionModel,
	isImageGenerationModel,
	type ModelKindFields,
} from '@octafuse/core/db/model-modalities';
import { GATEWAY_TOOLS_PROVIDER_ID } from '@/lib/gateway-tools';

export type GeminiWireAction = 'generateContent' | 'streamGenerateContent';

export type RequestLogFeatureKind = 'llm' | 'image' | 'tts' | 'asr' | 'tool';

export type RequestLogFeatureTag =
	| { key: 'kind'; kind: RequestLogFeatureKind }
	| { key: 'stream' }
	| { key: 'realtime' }
	| { key: 'reasoning' }
	| { key: 'failover' };

export function parseGeminiWireAction(routeTrace: string | null | undefined): GeminiWireAction | undefined {
	if (!routeTrace?.trim()) return undefined;
	try {
		const parsed = JSON.parse(routeTrace) as { gemini?: { action?: unknown } };
		const action = typeof parsed.gemini?.action === 'string' ? parsed.gemini.action.trim() : '';
		if (action === 'generateContent' || action === 'streamGenerateContent') return action;
	} catch {
		return undefined;
	}
	return undefined;
}

function readJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
	if (!raw?.trim()) return null;
	try {
		const parsed = JSON.parse(raw) as unknown;
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function streamFlagFromBody(raw: string | null | undefined): boolean | null {
	const body = readJsonObject(raw);
	if (!body) return null;
	if (body._gemini_action === 'streamGenerateContent') return true;
	if (body._gemini_action === 'generateContent') return false;
	if (body.stream === true) return true;
	if (body.stream === false) return false;
	return null;
}

/** 客户端是否请求流式：Gemini wire action、脱敏 body.stream、DashScope realtime。 */
export function isRequestLogStreaming(log: {
	request_operation?: string | null;
	upstream_operation?: string | null;
	route_trace?: string | null;
	request_body?: string | null;
	upstream_request_body?: string | null;
}): boolean {
	const geminiAction = parseGeminiWireAction(log.route_trace);
	if (geminiAction === 'streamGenerateContent') return true;
	if (geminiAction === 'generateContent') return false;

	const operation = `${log.request_operation ?? ''} ${log.upstream_operation ?? ''}`;
	if (operation.includes('.realtime.')) return true;

	return streamFlagFromBody(log.request_body) ?? streamFlagFromBody(log.upstream_request_body) ?? false;
}

function joinedOperations(log: {
	request_operation?: string | null;
	upstream_operation?: string | null;
}): string {
	return `${log.request_operation ?? ''} ${log.upstream_operation ?? ''}`;
}

export function isRequestLogRealtime(log: {
	request_operation?: string | null;
	upstream_operation?: string | null;
}): boolean {
	return joinedOperations(log).includes('.realtime.');
}

export function requestLogFeatureKind(
	log: {
		provider_id?: string | null;
		model_id?: string | null;
		billing_kind?: string | null;
		request_operation?: string | null;
		upstream_operation?: string | null;
	},
	catalogModel?: ModelKindFields | null,
): RequestLogFeatureKind {
	const modelId = log.model_id?.trim() ?? '';
	if (log.provider_id === GATEWAY_TOOLS_PROVIDER_ID || modelId.startsWith('tool:')) {
		return 'tool';
	}

	const billing = log.billing_kind?.trim() ?? '';
	if (billing === 'image_per_image' || billing === 'image_tokens') return 'image';
	if (billing === 'audio_per_character') return 'tts';
	if (billing === 'audio_per_second' || billing === 'audio_tokens') return 'asr';

	const operation = joinedOperations(log);
	if (operation.includes('images.')) return 'image';
	if (operation.includes('audio.speech')) return 'tts';
	if (operation.includes('audio.transcriptions')) return 'asr';

	if (catalogModel) {
		if (isImageGenerationModel(catalogModel)) return 'image';
		if (isAudioSpeechModel(catalogModel)) return 'tts';
		if (isAudioTranscriptionModel(catalogModel)) return 'asr';
	}
	return 'llm';
}

/** 列表特性标签：模型类型始终在前，其余仅在命中时出现。实时请求不再重复标流式。 */
export function requestLogFeatureTags(
	log: {
		provider_id?: string | null;
		model_id?: string | null;
		billing_kind?: string | null;
		request_operation?: string | null;
		upstream_operation?: string | null;
		route_trace?: string | null;
		request_body?: string | null;
		upstream_request_body?: string | null;
		reasoning_tokens?: number | null;
		first_reasoning_token_ms?: number | null;
		upstream_failover_count?: number | null;
	},
	catalogModel?: ModelKindFields | null,
): RequestLogFeatureTag[] {
	const tags: RequestLogFeatureTag[] = [{ key: 'kind', kind: requestLogFeatureKind(log, catalogModel) }];
	if (isRequestLogRealtime(log)) {
		tags.push({ key: 'realtime' });
	} else if (isRequestLogStreaming(log)) {
		tags.push({ key: 'stream' });
	}
	if (
		(log.first_reasoning_token_ms != null && Number.isFinite(log.first_reasoning_token_ms)) ||
		(log.reasoning_tokens != null && log.reasoning_tokens > 0)
	) {
		tags.push({ key: 'reasoning' });
	}
	if ((log.upstream_failover_count ?? 0) > 0) {
		tags.push({ key: 'failover' });
	}
	return tags;
}
