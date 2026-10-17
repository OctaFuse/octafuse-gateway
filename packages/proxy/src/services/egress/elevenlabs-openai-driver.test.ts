import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RouteResult } from '../model-router';
import type { NormalizedAudioSpeechRequest } from './audio-speech-driver';
import type { NormalizedAudioTranscriptionRequest } from './openai-audio-driver';
import {
	dispatchElevenLabsAudioTranscriptions,
	dispatchElevenLabsOpenAiSpeech,
} from './elevenlabs-openai-driver';

function route(adapter: 'elevenlabs-tts' | 'elevenlabs-asr-file', providerModelName: string): RouteResult {
	return {
		targetId: 'route-1',
		modelSurfaceId: 'surface-1',
		routePoolId: 'pool-1',
		providerId: 'elevenlabs',
		providerName: 'ElevenLabs',
		providerModelName,
		upstreamProtocol: 'elevenlabs',
		upstreamOperation: adapter === 'elevenlabs-tts' ? 'audio.speech' : 'audio.transcriptions',
		adapter,
		providerEndpoints: { elevenlabs: { base: 'https://api.elevenlabs.io/v1' } },
		providerApiKey: 'xi-test',
		priceOverrideRaw: null,
		routeMeteredProfileJson: null,
		routeChargedProfileJson: null,
		customParams: null,
		routeGroup: 'default',
		routePriority: 0,
		routeWeight: 1,
		providerKeyId: null,
		providerKeyLabel: null,
		providerKeyFingerprint: null,
	};
}

const speech = (patch: Partial<NormalizedAudioSpeechRequest> = {}): NormalizedAudioSpeechRequest => ({
	input: 'hello',
	voice: 'voice1',
	responseFormat: 'mp3',
	speed: 1,
	streamFormat: 'audio',
	...patch,
});

describe('ElevenLabs OpenAI speech', () => {
	it('maps the request, merges extras into the body and moves query fields', async () => {
		let seenUrl = '';
		let seenBody: Record<string, unknown> = {};
		const result = await dispatchElevenLabsOpenAiSpeech(
			route('elevenlabs-tts', 'eleven_multilingual_v2'),
			speech({
				speed: 1.1,
				extraFields: {
					seed: 7,
					enable_logging: false,
					voice_settings: { stability: 0.4 },
					model_id: 'evil',
					text: 'evil',
				},
			}),
			undefined,
			null,
			undefined,
			{
				fetchImpl: async (url, init) => {
					seenUrl = String(url);
					seenBody = JSON.parse(String(init?.body));
					return new Response('audio', {
						status: 200,
						headers: { 'x-character-count': '5' },
					});
				},
			},
		);
		const url = new URL(seenUrl);
		assert.equal(url.pathname, '/v1/text-to-speech/voice1');
		assert.equal(url.searchParams.get('output_format'), 'mp3_44100_128');
		assert.equal(url.searchParams.get('enable_logging'), 'false');
		assert.equal(seenBody.text, 'hello');
		assert.equal(seenBody.model_id, 'eleven_multilingual_v2');
		assert.equal(seenBody.seed, 7);
		assert.deepEqual(seenBody.voice_settings, { speed: 1.1, stability: 0.4 });
		assert.equal('enable_logging' in seenBody, false);
		assert.equal(result.response.headers.get('content-type'), 'audio/mpeg');
		assert.equal(await result.response.text(), 'audio');
		assert.equal((await result.usagePromise).audio_characters, 5);
		assert.ok(result.meta?.restoredUpstreamPaths?.includes('text'));
	});

	it('rejects unsupported formats, instructions and speeds with 400', async () => {
		for (const patch of [
			{ responseFormat: 'aac' as const },
			{ responseFormat: 'flac' as const },
			{ instructions: 'calm' },
			{ speed: 2 },
			{ voice: { id: '../x' } },
		]) {
			const result = await dispatchElevenLabsOpenAiSpeech(
				route('elevenlabs-tts', 'eleven_v3'),
				speech(patch),
				undefined,
				null,
				undefined,
				{
					fetchImpl: async () => {
						throw new Error('upstream must not be called');
					},
				},
			);
			assert.equal(result.response.status, 400, JSON.stringify(patch));
		}
	});

	it('re-wraps the stream as OpenAI speech SSE and bills the input length', async () => {
		let seenPath = '';
		const result = await dispatchElevenLabsOpenAiSpeech(
			route('elevenlabs-tts', 'eleven_v3'),
			speech({ streamFormat: 'sse', input: '你好' }),
			undefined,
			null,
			undefined,
			{
				fetchImpl: async (url) => {
					seenPath = new URL(String(url)).pathname;
					const stream = new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(new Uint8Array([104, 105]));
							controller.enqueue(new Uint8Array([33]));
							controller.close();
						},
					});
					return new Response(stream, { status: 200 });
				},
			},
		);
		assert.equal(seenPath, '/v1/text-to-speech/voice1/stream');
		assert.match(result.response.headers.get('content-type') ?? '', /text\/event-stream/);
		const text = await result.response.text();
		const events = text
			.split('\n\n')
			.filter(Boolean)
			.map((frame) => JSON.parse(frame.replace(/^data: /, '')) as { type: string; audio?: string });
		assert.deepEqual(
			events.map((e) => e.type),
			['speech.audio.delta', 'speech.audio.delta', 'speech.audio.done'],
		);
		assert.equal(Buffer.from(events[0]!.audio!, 'base64').toString(), 'hi');
		assert.equal((await result.usagePromise).audio_characters, 2);
	});

	it('rewrites upstream quota errors to 402', async () => {
		const result = await dispatchElevenLabsOpenAiSpeech(
			route('elevenlabs-tts', 'eleven_v3'),
			speech(),
			undefined,
			null,
			undefined,
			{
				fetchImpl: async () =>
					new Response(JSON.stringify({ detail: { status: 'quota_exceeded', message: 'no' } }), {
						status: 401,
					}),
			},
		);
		assert.equal(result.response.status, 402);
	});
});

const transcriptBody = {
	language_code: 'eng',
	text: 'Hello world. Bye',
	audio_duration_secs: 4,
	words: [
		{ text: 'Hello', type: 'word', start: 0, end: 0.5, speaker_id: 'speaker_0' },
		{ text: ' ', type: 'spacing', start: 0.5, end: 0.6 },
		{ text: 'world.', type: 'word', start: 0.6, end: 1.2, speaker_id: 'speaker_0' },
		{ text: ' ', type: 'spacing', start: 1.2, end: 1.3 },
		{ text: 'Bye', type: 'word', start: 1.3, end: 1.6, speaker_id: 'speaker_1' },
	],
};

const transcription = (
	patch: Partial<NormalizedAudioTranscriptionRequest> = {},
): NormalizedAudioTranscriptionRequest => ({
	file: { filename: 'a.mp3', mimeType: 'audio/mpeg', bytes: new Uint8Array([1, 2, 3, 4]) },
	clientResponseFormat: 'json',
	...patch,
});

describe('ElevenLabs OpenAI transcriptions', () => {
	it('maps language, forces word timestamps, drops prompt and bills upstream duration', async () => {
		let form: FormData | null = null;
		const result = await dispatchElevenLabsAudioTranscriptions(
			route('elevenlabs-asr-file', 'scribe_v2'),
			transcription({
				language: 'en',
				prompt: 'ignored',
				extra: { num_speakers: 2, timestamps_granularity: 'none' },
			}),
			undefined,
			null,
			undefined,
			{
				fetchImpl: async (_url, init) => {
					form = init?.body as FormData;
					return new Response(JSON.stringify(transcriptBody), { status: 200 });
				},
			},
		);
		assert.equal(form!.get('model_id'), 'scribe_v2');
		assert.equal(form!.get('language_code'), 'en');
		assert.equal(form!.get('timestamps_granularity'), 'word');
		assert.equal(form!.get('num_speakers'), '2');
		assert.equal(form!.has('prompt'), false);
		assert.deepEqual(await result.response.json(), { text: 'Hello world. Bye' });
		assert.equal(result.meta?.audioDurationSeconds, 4);
		assert.equal(result.meta?.audioDurationSource, 'upstream');
	});

	it('forces diarize for diarized_json and renders subtitles locally', async () => {
		let form: FormData | null = null;
		const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
			form = init?.body as FormData;
			return new Response(JSON.stringify(transcriptBody), { status: 200 });
		};
		const diarized = await dispatchElevenLabsAudioTranscriptions(
			route('elevenlabs-asr-file', 'scribe_v2'),
			transcription({ clientResponseFormat: 'diarized_json' }),
			undefined,
			null,
			undefined,
			{ fetchImpl },
		);
		assert.equal(form!.get('diarize'), 'true');
		const body = (await diarized.response.json()) as { segments: Array<{ speaker: string }> };
		assert.deepEqual(
			body.segments.map((s) => s.speaker),
			['speaker_0', 'speaker_1'],
		);
		const srt = await dispatchElevenLabsAudioTranscriptions(
			route('elevenlabs-asr-file', 'scribe_v2'),
			transcription({ clientResponseFormat: 'srt' }),
			undefined,
			null,
			undefined,
			{ fetchImpl },
		);
		assert.match(await srt.response.text(), /00:00:00,000 --> 00:00:01,200/);
	});

	it('rejects webhook mode and rewrites upstream errors', async () => {
		const webhook = await dispatchElevenLabsAudioTranscriptions(
			route('elevenlabs-asr-file', 'scribe_v2'),
			transcription({ extra: { webhook: true } }),
			undefined,
			null,
			undefined,
			{
				fetchImpl: async () => {
					throw new Error('must not call upstream');
				},
			},
		);
		assert.equal(webhook.response.status, 400);
		const busy = await dispatchElevenLabsAudioTranscriptions(
			route('elevenlabs-asr-file', 'scribe_v2'),
			transcription(),
			undefined,
			null,
			undefined,
			{
				fetchImpl: async () =>
					new Response(JSON.stringify({ detail: { status: 'system_busy' } }), { status: 503 }),
			},
		);
		assert.equal(busy.response.status, 429);
	});
});
