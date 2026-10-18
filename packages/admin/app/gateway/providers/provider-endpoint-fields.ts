import type { ProviderEndpointCapability } from '@octafuse/core/provider-endpoints';
import {
	UPSTREAM_PROTOCOLS,
	type UpstreamProtocol,
} from '@octafuse/core/upstream-protocol';
import { requiredCapabilitiesForUpstreamOperation } from '@octafuse/core/adapters/registry';
import { canonicalizeRequestOperation } from '@octafuse/core/route-topology';
import type { ProtocolEndpointForm } from './types';

type EndpointFormField = Exclude<
	keyof ProtocolEndpointForm,
	| 'mode'
	| 'selectedCapabilities'
	| 'base'
	| 'auth'
	| 'legacyPerAction'
	| 'generateContent'
	| 'streamGenerateContent'
>;
export type ProviderEndpointField = {
	field: EndpointFormField;
	capability: ProviderEndpointCapability;
	/** Standard suffix relative to Base URL, except origin-relative WebSocket paths. */
	path: string;
	description: string;
	websocket?: boolean;
	originRelative?: boolean;
};

export const PROVIDER_ENDPOINT_FIELDS: Record<
	UpstreamProtocol,
	readonly ProviderEndpointField[]
> = {
	openai: [
		{
			field: 'chat',
			capability: 'chat',
			path: '/chat/completions',
			description: 'chat',
		},
		{
			field: 'responses',
			capability: 'responses',
			path: '/responses',
			description: 'responses',
		},
		{
			field: 'images_generations',
			capability: 'images.generations',
			path: '/images/generations',
			description: 'imageGeneration',
		},
		{
			field: 'images_edits',
			capability: 'images.edits',
			path: '/images/edits',
			description: 'imageEditing',
		},
		{
			field: 'embeddings',
			capability: 'embeddings',
			path: '/embeddings',
			description: 'embeddings',
		},
		{
			field: 'audio_transcriptions',
			capability: 'audio.transcriptions',
			path: '/audio/transcriptions',
			description: 'transcription',
		},
		{
			field: 'audio_speech',
			capability: 'audio.speech',
			path: '/audio/speech',
			description: 'speech',
		},
	],
	anthropic: [
		{
			field: 'messages',
			capability: 'messages',
			path: '/v1/messages',
			description: 'messages',
		},
	],
	gemini: [
		{
			field: 'modelsGenerate',
			capability: 'models.generate',
			path: '/{model}:{action}',
			description: 'geminiGenerate',
		},
		{
			field: 'modelsEmbed',
			capability: 'models.embed',
			path: '/{model}:{action}',
			description: 'geminiEmbed',
		},
	],
	dashscope: [
		{
			field: 'images_generations_multimodal',
			capability: 'images.generations.multimodal',
			path: '/services/aigc/multimodal-generation/generation',
			description: 'dashscopeImage',
		},
		{
			field: 'audio_transcriptions',
			capability: 'audio.transcriptions',
			path: '/services/audio/asr/transcription',
			description: 'asyncTranscription',
		},
		{
			field: 'audio_transcriptions_multimodal',
			capability: 'audio.transcriptions.multimodal',
			path: '/services/aigc/multimodal-generation/generation',
			description: 'multimodalTranscription',
		},
		{
			field: 'audio_transcriptions_tasks',
			capability: 'audio.transcriptions.tasks',
			path: '/tasks/{task_id}',
			description: 'transcriptionTasks',
		},
		{
			field: 'audio_speech',
			capability: 'audio.speech',
			path: '/services/audio/tts/SpeechSynthesizer',
			description: 'dashscopeSpeech',
		},
		{
			field: 'audio_speech_multimodal',
			capability: 'audio.speech.multimodal',
			path: '/services/aigc/multimodal-generation/generation',
			description: 'multimodalSpeech',
		},
		{
			field: 'audio_realtime_inference',
			capability: 'audio.realtime.inference',
			path: '/api-ws/v1/inference',
			description: 'realtimeInference',
			websocket: true,
			originRelative: true,
		},
		{
			field: 'audio_realtime_session',
			capability: 'audio.realtime.session',
			path: '/api-ws/v1/realtime',
			description: 'realtimeSession',
			websocket: true,
			originRelative: true,
		},
		{
			field: 'audio_hotwords',
			capability: 'audio.hotwords',
			path: '/services/audio/asr/customization',
			description: 'hotwords',
		},
		{
			field: 'audio_voices',
			capability: 'audio.voices',
			path: '/services/audio/tts/customization',
			description: 'voices',
		},
	],
	minimax: [
		{
			field: 'audio_transcriptions',
			capability: 'audio.transcriptions',
			path: '/speech_to_text',
			description: 'transcription',
		},
		{
			field: 'audio_speech',
			capability: 'audio.speech',
			path: '/t2a_v2',
			description: 'minimaxSpeech',
		},
		{
			field: 'images_generations',
			capability: 'images.generations',
			path: '/image_generation',
			description: 'minimaxImage',
		},
	],
	volcengine: [
		{
			field: 'images_generations',
			capability: 'images.generations',
			path: '/images/generations',
			description: 'seedreamImage',
		},
	],
	elevenlabs: [
		{
			field: 'audio_transcriptions',
			capability: 'audio.transcriptions',
			path: '/speech-to-text',
			description: 'scribeTranscription',
		},
		{
			field: 'audio_speech',
			capability: 'audio.speech',
			path: '/text-to-speech/{voice_id}',
			description: 'voiceSpeech',
		},
		{
			field: 'audio_transcriptions_realtime',
			capability: 'audio.transcriptions.realtime',
			path: '/speech-to-text/realtime',
			description: 'realtimeTranscription',
			websocket: true,
		},
		{
			field: 'audio_speech_realtime',
			capability: 'audio.speech.realtime',
			path: '/text-to-speech/{voice_id}/stream-input',
			description: 'realtimeSpeech',
			websocket: true,
		},
	],
};

/** Resolve route operations through the same endpoint dependencies used by runtime adapters. */
export function endpointFieldsForUpstreamOperation(
	protocol: string,
	operation: string | null | undefined
): readonly ProviderEndpointField[] {
	const knownProtocol = UPSTREAM_PROTOCOLS.find(
		(value) => value === protocol.trim().toLowerCase()
	);
	const op = operation?.trim();
	if (!knownProtocol || !op || op === '*') return [];
	const capabilities = [
		...new Set(
			requiredCapabilitiesForUpstreamOperation(
				knownProtocol,
				canonicalizeRequestOperation(knownProtocol, op)
			)
		),
	];
	const fields = capabilities.map((capability) =>
		PROVIDER_ENDPOINT_FIELDS[knownProtocol].find(
			(field) => field.capability === capability
		)
	);
	// Keep an unknown operation visible as-is rather than describing only part of its requirements.
	return fields.every((field) => field !== undefined) ? fields : [];
}
