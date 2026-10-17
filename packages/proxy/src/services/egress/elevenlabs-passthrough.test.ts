import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RouteResult } from '../model-router';
import {
	dispatchElevenLabsSttPassthrough,
	dispatchElevenLabsTtsPassthrough,
	resolveElevenLabsTtsUrl,
} from './elevenlabs-passthrough';

function route(operation: 'audio.speech' | 'audio.transcriptions', providerModelName: string): RouteResult {
	return {
		targetId: 'route-1',
		modelSurfaceId: 'surface-1',
		routePoolId: 'pool-1',
		providerId: 'elevenlabs',
		providerName: 'ElevenLabs',
		providerModelName,
		upstreamProtocol: 'elevenlabs',
		upstreamOperation: operation,
		adapter: 'passthrough',
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

describe('resolveElevenLabsTtsUrl', () => {
	it('fills the voice, appends the variant suffix and query', () => {
		assert.equal(
			resolveElevenLabsTtsUrl(route('audio.speech', 'eleven_v3'), 'v1', '/stream/with-timestamps', {
				output_format: 'mp3_44100_128',
			}),
			'https://api.elevenlabs.io/v1/text-to-speech/v1/stream/with-timestamps?output_format=mp3_44100_128',
		);
	});
});

describe('ElevenLabs TTS passthrough', () => {
	it('replaces model_id, sends xi-api-key and bills x-character-count', async () => {
		let seenUrl = '';
		let seenBody = '';
		let seenHeaders: Headers | null = null;
		const result = await dispatchElevenLabsTtsPassthrough(
			route('audio.speech', 'eleven_multilingual_v2'),
			{
				voiceId: 'voice1',
				variant: 'speech',
				query: { output_format: 'mp3_44100_128' },
				body: { text: 'hello', model_id: 'gateway-tts' },
				inputCharacters: 5,
			},
			undefined,
			null,
			undefined,
			{
				fetchImpl: async (url, init) => {
					seenUrl = String(url);
					seenBody = String(init?.body ?? '');
					seenHeaders = new Headers(init?.headers);
					return new Response(new Uint8Array([1, 2, 3]), {
						status: 200,
						headers: {
							'Content-Type': 'audio/mpeg',
							'x-character-count': '42',
							'request-id': 'req-1',
						},
					});
				},
			},
		);
		assert.equal(seenUrl, 'https://api.elevenlabs.io/v1/text-to-speech/voice1?output_format=mp3_44100_128');
		assert.deepEqual(JSON.parse(seenBody), { text: 'hello', model_id: 'eleven_multilingual_v2' });
		assert.equal(seenHeaders!.get('xi-api-key'), 'xi-test');
		assert.equal(seenHeaders!.has('authorization'), false);
		assert.equal(result.response.status, 200);
		assert.deepEqual([...new Uint8Array(await result.response.arrayBuffer())], [1, 2, 3]);
		assert.equal((await result.usagePromise).audio_characters, 42);
		assert.equal(result.upstreamRequestId, 'req-1');
	});

	it('falls back to the input length when the character header is missing', async () => {
		const result = await dispatchElevenLabsTtsPassthrough(
			route('audio.speech', 'eleven_v3'),
			{ voiceId: 'voice1', variant: 'stream', query: {}, body: { text: 'hello' }, inputCharacters: 5 },
			undefined,
			null,
			undefined,
			{ fetchImpl: async () => new Response('audio', { status: 200 }) },
		);
		await result.response.arrayBuffer();
		assert.equal((await result.usagePromise).audio_characters, 5);
	});

	it('rewrites quota_exceeded to 402 and keeps the error body', async () => {
		const upstream = { detail: { status: 'quota_exceeded', message: 'out of credits' } };
		const result = await dispatchElevenLabsTtsPassthrough(
			route('audio.speech', 'eleven_v3'),
			{ voiceId: 'voice1', variant: 'speech', query: {}, body: { text: 'hi' }, inputCharacters: 2 },
			undefined,
			null,
			undefined,
			{ fetchImpl: async () => new Response(JSON.stringify(upstream), { status: 401 }) },
		);
		assert.equal(result.response.status, 402);
		assert.deepEqual(await result.response.json(), upstream);
		assert.equal((await result.usagePromise).audio_characters, undefined);
	});

	it('turns network failures into 502 and timeouts into 504', async () => {
		const failed = await dispatchElevenLabsTtsPassthrough(
			route('audio.speech', 'eleven_v3'),
			{ voiceId: 'voice1', variant: 'speech', query: {}, body: { text: 'hi' }, inputCharacters: 2 },
			undefined,
			null,
			undefined,
			{
				fetchImpl: async () => {
					throw new Error('boom');
				},
			},
		);
		assert.equal(failed.response.status, 502);
		const timedOut = await dispatchElevenLabsTtsPassthrough(
			route('audio.speech', 'eleven_v3'),
			{ voiceId: 'voice1', variant: 'speech', query: {}, body: { text: 'hi' }, inputCharacters: 2 },
			undefined,
			null,
			undefined,
			{
				timeoutMs: 5,
				fetchImpl: (_url, init) =>
					new Promise((_resolve, reject) => {
						init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
					}),
			},
		);
		assert.equal(timedOut.response.status, 504);
	});

	it('rejects non-passthrough routes', async () => {
		const bad = { ...route('audio.speech', 'eleven_v3'), adapter: 'elevenlabs-tts' as const };
		await assert.rejects(() =>
			dispatchElevenLabsTtsPassthrough(bad, {
				voiceId: 'v',
				variant: 'speech',
				query: {},
				body: { text: 'x' },
				inputCharacters: 1,
			}),
		);
	});
});

describe('ElevenLabs STT passthrough', () => {
	it('forwards the form, replaces model_id and bills audio_duration_secs', async () => {
		let seenUrl = '';
		let form: FormData | null = null;
		const result = await dispatchElevenLabsSttPassthrough(
			route('audio.transcriptions', 'scribe_v2'),
			{
				file: { filename: 'a.mp3', mimeType: 'audio/mpeg', bytes: new Uint8Array([1, 2, 3, 4]) },
				fields: [
					['language_code', 'eng'],
					['keyterms', 'a'],
					['keyterms', 'b'],
				],
			},
			undefined,
			null,
			undefined,
			{
				fetchImpl: async (url, init) => {
					seenUrl = String(url);
					form = init?.body as FormData;
					return new Response(
						JSON.stringify({ language_code: 'eng', text: 'hi', audio_duration_secs: 3.5, words: [] }),
						{ status: 200, headers: { 'Content-Type': 'application/json' } },
					);
				},
			},
		);
		assert.equal(seenUrl, 'https://api.elevenlabs.io/v1/speech-to-text');
		assert.equal(form!.get('model_id'), 'scribe_v2');
		assert.deepEqual(form!.getAll('keyterms'), ['a', 'b']);
		assert.equal(form!.get('language_code'), 'eng');
		assert.ok(form!.get('file') instanceof Blob);
		assert.equal(result.meta?.audioDurationSeconds, 3.5);
		assert.equal(result.meta?.audioDurationSource, 'upstream');
		assert.equal((await result.response.json() as { text: string }).text, 'hi');
	});

	it('supports URL sources without a file and rewrites upstream errors', async () => {
		let form: FormData | null = null;
		const ok = await dispatchElevenLabsSttPassthrough(
			route('audio.transcriptions', 'scribe_v2'),
			{ file: null, fields: [['cloud_storage_url', 'https://example.com/a.mp3']] },
			undefined,
			null,
			undefined,
			{
				fetchImpl: async (_url, init) => {
					form = init?.body as FormData;
					return new Response(JSON.stringify({ text: 'x', audio_duration_secs: 2 }), { status: 200 });
				},
			},
		);
		assert.equal(form!.has('file'), false);
		assert.equal(ok.meta?.audioDurationSeconds, 2);
		const busy = await dispatchElevenLabsSttPassthrough(
			route('audio.transcriptions', 'scribe_v2'),
			{ file: null, fields: [['cloud_storage_url', 'https://example.com/a.mp3']] },
			undefined,
			null,
			undefined,
			{
				fetchImpl: async () =>
					new Response(JSON.stringify({ detail: { status: 'too_many_concurrent_requests' } }), {
						status: 429,
					}),
			},
		);
		assert.equal(busy.response.status, 429);
	});
});
