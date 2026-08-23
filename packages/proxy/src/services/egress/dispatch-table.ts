/**
 * Adapter ID → driver 实现表。
 * Registry 声明能力，本表声明运行时实现；一致性由 dispatch-table.test.ts 焊死。
 */
import { listConversionAdapters, type RouteAdapter } from '@octafuse/core/adapters/registry';
import type { RouteResult } from '../model-router';
import type { ProxyDispatchResult } from '../failover-dispatch';
import type { RequestTimingAttempt, RequestTimingCollector } from '../request-timing';
import {
	dispatchDashScopeAsyncAsr,
	dispatchDashScopeMultimodalPassthrough,
	dispatchDashScopeSyncAsr,
	type DashScopeAsrDispatchOptions,
} from './dashscope-audio-driver';
import {
	dispatchOpenAiAudioTranscriptions,
	type NormalizedAudioTranscriptionRequest,
} from './openai-audio-driver';
import {
	dispatchDashScopeMiniMaxTts,
	dispatchDashScopeQwenTts,
	dispatchDashScopeSpeechSynthesizer,
	dispatchOpenAiAudioSpeech,
	type AudioSpeechDispatchOptions,
	type NormalizedAudioSpeechRequest,
} from './audio-speech-driver';
import { dispatchDashScopeImageGenerations } from './dashscope-images-driver';
import { dispatchOpenAiImageGenerations } from './openai-images-driver';

type Timing = {
	signal?: AbortSignal;
	timing?: RequestTimingCollector | null;
	attempt?: RequestTimingAttempt;
};

const AUDIO_TRANSCRIPTION_ADAPTERS = [
	'dashscope-asr-qwen-file',
	'dashscope-asr-qwen-audio-file',
	'dashscope-asr-fun-file',
	'dashscope-asr-file-async',
] as const satisfies readonly RouteAdapter[];

const AUDIO_SPEECH_ADAPTERS = [
	'dashscope-tts-speech',
	'dashscope-tts-qwen',
	'dashscope-tts-minimax',
] as const satisfies readonly RouteAdapter[];

const IMAGE_GENERATION_ADAPTERS = [
	'dashscope-image-qwen',
	'dashscope-image-wan',
] as const satisfies readonly RouteAdapter[];

export const IMPLEMENTED_CONVERSION_ADAPTERS: readonly RouteAdapter[] = [
	...AUDIO_TRANSCRIPTION_ADAPTERS,
	...AUDIO_SPEECH_ADAPTERS,
	...IMAGE_GENERATION_ADAPTERS,
];

export function implementedConversionAdapterIds(): readonly string[] {
	return IMPLEMENTED_CONVERSION_ADAPTERS;
}

export function registryConversionAdapterIds(): readonly string[] {
	return listConversionAdapters().map((adapter) => adapter.id);
}

export function dispatchAudioTranscriptions(
	route: RouteResult,
	req: NormalizedAudioTranscriptionRequest,
	signal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt,
	options?: DashScopeAsrDispatchOptions
): Promise<ProxyDispatchResult> {
	const ctx: Timing = { signal, timing, attempt };
	if (route.adapter === 'passthrough' && route.upstreamProtocol === 'openai') {
		return dispatchOpenAiAudioTranscriptions(route, req, ctx.signal, ctx.timing, ctx.attempt);
	}
	if (
		route.adapter === 'dashscope-asr-qwen-file' ||
		route.adapter === 'dashscope-asr-qwen-audio-file' ||
		route.adapter === 'dashscope-asr-fun-file'
	) {
		return dispatchDashScopeSyncAsr(route, req, ctx.signal, ctx.timing, ctx.attempt, options);
	}
	if (route.adapter === 'dashscope-asr-file-async') {
		return dispatchDashScopeAsyncAsr(route, req, ctx.signal, ctx.timing, ctx.attempt, options);
	}
	throw new Error(`Unsupported audio transcription adapter: ${route.adapter}`);
}

const SPEECH_DISPATCH = {
	'dashscope-tts-speech': dispatchDashScopeSpeechSynthesizer,
	'dashscope-tts-qwen': dispatchDashScopeQwenTts,
	'dashscope-tts-minimax': dispatchDashScopeMiniMaxTts,
} as const;

export function dispatchAudioSpeech(
	route: RouteResult,
	request: NormalizedAudioSpeechRequest,
	signal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt,
	options?: AudioSpeechDispatchOptions
): Promise<ProxyDispatchResult> {
	if (route.adapter === 'passthrough' && route.upstreamProtocol === 'openai') {
		return dispatchOpenAiAudioSpeech(route, request, signal, timing, attempt, options);
	}
	const dispatch = SPEECH_DISPATCH[route.adapter as keyof typeof SPEECH_DISPATCH];
	if (!dispatch) {
		throw new Error(`Unsupported audio speech adapter: ${route.adapter}`);
	}
	return dispatch(route, request, signal, timing, attempt, options);
}

export function dispatchImageGenerations(
	route: RouteResult,
	body: Record<string, unknown>,
	signal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt
): Promise<ProxyDispatchResult> {
	if (route.adapter === 'passthrough' && route.upstreamProtocol === 'openai') {
		return dispatchOpenAiImageGenerations(route, body, signal, timing, attempt);
	}
	if (route.adapter === 'dashscope-image-qwen' || route.adapter === 'dashscope-image-wan') {
		return dispatchDashScopeImageGenerations(route, body, signal, timing, attempt);
	}
	throw new Error(`Unsupported image generation adapter: ${route.adapter}`);
}

export function dispatchMultimodalPassthrough(
	route: RouteResult,
	body: Record<string, unknown>,
	signal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt,
	options?: DashScopeAsrDispatchOptions
): Promise<ProxyDispatchResult> {
	if (route.adapter !== 'passthrough' || route.upstreamOperation !== 'audio.transcriptions.multimodal') {
		throw new Error(`Unsupported DashScope multimodal adapter: ${route.adapter}`);
	}
	return dispatchDashScopeMultimodalPassthrough(route, body, signal, timing, attempt, options);
}
