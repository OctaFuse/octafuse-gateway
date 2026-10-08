import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { RouteResult } from '../model-router';
import {
	dispatchMiniMaxAsrPassthrough,
	dispatchMiniMaxAudioTranscriptions,
} from './minimax-audio-driver';
import type { NormalizedAudioTranscriptionRequest } from './openai-audio-driver';

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function route(customParams: Record<string, unknown> | null = null): RouteResult {
	return {
		targetId: 'route-1',
		modelSurfaceId: null,
		routePoolId: null,
		providerId: 'minimax',
		providerName: 'MiniMax',
		providerModelName: 'asr-1.0',
		upstreamProtocol: 'minimax',
		upstreamOperation: 'audio.transcriptions',
		adapter: 'minimax-asr-file',
		providerEndpoints: { minimax: { base: 'https://api.minimaxi.com/v1' } },
		providerApiKey: 'sk-test',
		priceOverrideRaw: null,
		routeMeteredProfileJson: null,
		routeChargedProfileJson: null,
		customParams,
		routeGroup: 'default',
		routePriority: 0,
		routeWeight: 1,
	};
}

function request(
	format: NormalizedAudioTranscriptionRequest['clientResponseFormat'],
	extra?: Record<string, string>
): NormalizedAudioTranscriptionRequest {
	return {
		file: {
			filename: 'clip.mp3',
			mimeType: 'audio/mpeg',
			bytes: new Uint8Array([1, 2, 3, 4]),
		},
		clientResponseFormat: format,
		language: 'zh',
		prompt: 'ignore me',
		temperature: 0.2,
		extra,
	};
}

describe('dispatchMiniMaxAudioTranscriptions', () => {
	it('sends language as a header and keeps route form fields', async () => {
		let capturedUrl = '';
		let capturedLanguage: string | null = null;
		let capturedAuth = '';
		let form: FormData | null = null;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			capturedUrl = String(input);
			const headers = new Headers(init?.headers);
			capturedLanguage = headers.get('language');
			capturedAuth = headers.get('authorization') ?? '';
			form = init?.body instanceof FormData ? init.body : null;
			return new Response(
				JSON.stringify({
					text: '你好',
					duration: 3.5,
					segments: [{ start: 0, end: 3.5, text: '你好', speaker: '1' }],
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } }
			);
		}) as typeof fetch;

		const result = await dispatchMiniMaxAudioTranscriptions(
			route(),
			request('srt', {
				timestamp_level: 'word',
				prompt: 'from-extra',
				temperature: '0.4',
				language: 'en',
			})
		);
		assert.equal(capturedUrl, 'https://api.minimaxi.com/v1/speech_to_text');
		assert.equal(capturedLanguage, 'zh');
		assert.equal(capturedAuth, 'Bearer sk-test');
		assert.ok(form);
		const sent = form as FormData;
		assert.equal(sent.get('model'), 'asr-1.0');
		assert.equal(sent.get('response_format'), 'verbose_json');
		assert.equal(sent.get('timestamp_level'), 'word');
		assert.equal(sent.get('language'), null);
		assert.equal(sent.get('prompt'), null);
		assert.equal(sent.get('temperature'), null);
		assert.equal(result.meta.audioDurationSeconds, 3.5);
		assert.equal(result.meta.audioDurationSource, 'upstream');
		assert.equal(await result.response.text(), '1\n00:00:00,000 --> 00:00:03,500\n[1] 你好\n');
	});

	it('returns json text without asking verbose_json', async () => {
		let responseFormat = '';
		globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
			const body = init?.body instanceof FormData ? init.body : null;
			responseFormat = String(body?.get('response_format') ?? '');
			return new Response(JSON.stringify({ text: 'hello', duration: 1 }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		}) as typeof fetch;

		const result = await dispatchMiniMaxAudioTranscriptions(route(), request('text'));
		assert.equal(responseFormat, 'json');
		assert.equal(await result.response.text(), 'hello');
	});

	it('passes upstream errors through', async () => {
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ type: 'error', error: { message: 'bad audio' } }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			})) as typeof fetch;
		const result = await dispatchMiniMaxAudioTranscriptions(route(), request('json'));
		assert.equal(result.response.status, 400);
		assert.equal(result.meta.audioDurationSeconds, null);
		const body = JSON.parse(await result.response.text()) as { error: { message: string } };
		assert.equal(body.error.message, 'bad audio');
	});
});

describe('dispatchMiniMaxAsrPassthrough', () => {
	it('forwards the native form and returns the upstream body unchanged', async () => {
		let capturedLanguage: string | null = null;
		let form: FormData | null = null;
		const upstream = {
			text: '你好',
			duration: 3.5,
			segments: [{ start: 0, end: 3.5, text: '你好', speaker: '1' }],
		};
		globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
			const headers = new Headers(init?.headers);
			capturedLanguage = headers.get('language');
			form = init?.body instanceof FormData ? init.body : null;
			return new Response(JSON.stringify(upstream), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		}) as typeof fetch;

		const result = await dispatchMiniMaxAsrPassthrough(
			{ ...route(), adapter: 'passthrough' },
			{
				file: {
					filename: 'clip.wav',
					mimeType: 'audio/wav',
					bytes: new Uint8Array([1, 2, 3, 4]),
				},
				fields: {
					response_format: 'verbose_json',
					timestamp_level: 'word',
					language: 'en',
				},
				languageHeader: 'zh',
			}
		);
		assert.equal(capturedLanguage, 'zh');
		assert.ok(form);
		const sent = form as FormData;
		assert.equal(sent.get('model'), 'asr-1.0');
		assert.equal(sent.get('response_format'), 'verbose_json');
		assert.equal(sent.get('timestamp_level'), 'word');
		assert.equal(sent.get('language'), null);
		assert.equal(result.meta.audioDurationSeconds, 3.5);
		assert.equal(result.meta.audioDurationSource, 'upstream');
		assert.deepEqual(JSON.parse(await result.response.text()), upstream);
	});
});
