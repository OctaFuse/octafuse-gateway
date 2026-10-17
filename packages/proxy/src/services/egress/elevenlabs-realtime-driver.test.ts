import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RouteResult } from '../model-router';
import {
	base64DecodedByteLength,
	bridgeElevenLabsRealtime,
	dispatchElevenLabsRealtime,
	elevenLabsAudioByteRate,
	elevenLabsRealtimeRejectedResult,
	ElevenLabsRealtimeUsageCollector,
	resolveElevenLabsRealtimeTarget,
} from './elevenlabs-realtime-driver';
import { createRealtimeSocket, type RealtimeFrameData } from './dashscope-realtime-socket';

function route(overrides: Partial<RouteResult> = {}): RouteResult {
	return {
		targetId: 'route-1',
		modelSurfaceId: 'surface-1',
		routePoolId: 'pool-1',
		providerId: 'elevenlabs',
		providerName: 'ElevenLabs',
		providerModelName: 'eleven_flash_v2_5',
		upstreamProtocol: 'elevenlabs',
		upstreamOperation: 'audio.speech.realtime',
		adapter: 'passthrough',
		providerEndpoints: {
			elevenlabs: { base: 'https://api.elevenlabs.io/v1' },
		},
		providerApiKey: 'el-secret',
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
		...overrides,
	};
}

function fakeSocket() {
	const sent: RealtimeFrameData[] = [];
	const closes: Array<{ code?: number; reason?: string }> = [];
	let handlers!: {
		message(data: RealtimeFrameData): void;
		close(code: number, reason: string): void;
		error(): void;
	};
	const socket = createRealtimeSocket({
		send: (data) => {
			sent.push(data);
		},
		close: (code, reason) => {
			closes.push({ code, reason });
		},
		subscribe: (h) => {
			handlers = h;
		},
	});
	return {
		socket,
		sent,
		closes,
		emitMessage: (data: RealtimeFrameData) => handlers.message(data),
		emitClose: (code = 1000, reason = '') => handlers.close(code, reason),
		emitError: () => handlers.error(),
	};
}

/** `bytes` 个 0 字节对应的 base64。 */
function base64OfBytes(bytes: number): string {
	return Buffer.alloc(bytes).toString('base64');
}

describe('resolveElevenLabsRealtimeTarget', () => {
	it('derives the wss TTS stream-input URL, swaps model_id and sets xi-api-key', async () => {
		const target = await resolveElevenLabsRealtimeTarget(route(), {
			operation: 'audio.speech.realtime',
			voiceId: 'voice_1',
			query: { model_id: 'gateway-model', output_format: 'pcm_16000', language_code: 'en' },
		});
		const url = new URL(target.url);
		assert.equal(url.protocol, 'wss:');
		assert.equal(url.host, 'api.elevenlabs.io');
		assert.equal(url.pathname, '/v1/text-to-speech/voice_1/stream-input');
		assert.equal(url.searchParams.get('model_id'), 'eleven_flash_v2_5');
		assert.equal(url.searchParams.get('output_format'), 'pcm_16000');
		assert.equal(url.searchParams.get('language_code'), 'en');
		assert.equal(target.headers['xi-api-key'], 'el-secret');
	});

	it('derives the STT realtime URL', async () => {
		const target = await resolveElevenLabsRealtimeTarget(
			route({ providerModelName: 'scribe_v2_realtime', upstreamOperation: 'audio.transcriptions.realtime' }),
			{ operation: 'audio.transcriptions.realtime', query: { audio_format: 'pcm_16000' } }
		);
		const url = new URL(target.url);
		assert.equal(url.pathname, '/v1/speech-to-text/realtime');
		assert.equal(url.searchParams.get('model_id'), 'scribe_v2_realtime');
		assert.equal(url.searchParams.get('audio_format'), 'pcm_16000');
	});

	it('never forwards client credentials in the query string', async () => {
		const target = await resolveElevenLabsRealtimeTarget(route(), {
			operation: 'audio.speech.realtime',
			voiceId: 'voice_1',
			query: {
				'xi-api-key': 'sk-client',
				xi_api_key: 'sk-client',
				api_key: 'sk-client',
				Authorization: 'Bearer sk-client',
				token: 'sk-client',
			},
		});
		assert.ok(!target.url.includes('sk-client'));
		assert.equal(target.headers['xi-api-key'], 'el-secret');
	});
});

describe('audio helpers', () => {
	it('maps audio_format to a byte rate', () => {
		assert.equal(elevenLabsAudioByteRate('pcm_16000'), 32_000);
		assert.equal(elevenLabsAudioByteRate('pcm_8000'), 16_000);
		assert.equal(elevenLabsAudioByteRate('pcm_44100'), 88_200);
		assert.equal(elevenLabsAudioByteRate('ulaw_8000'), 8_000);
		assert.equal(elevenLabsAudioByteRate('alaw_8000'), 8_000);
		assert.equal(elevenLabsAudioByteRate(undefined), 32_000);
		assert.equal(elevenLabsAudioByteRate('mp3_44100_128'), 32_000);
	});

	it('computes the decoded length of base64 without decoding', () => {
		for (const size of [0, 1, 2, 3, 4, 5, 100, 3200]) {
			assert.equal(base64DecodedByteLength(base64OfBytes(size)), size);
		}
	});
});

describe('ElevenLabsRealtimeUsageCollector', () => {
	it('counts TTS characters in code points and skips the init frame', () => {
		const collector = new ElevenLabsRealtimeUsageCollector('audio.speech.realtime');
		collector.observeClientMessage(JSON.stringify({ text: ' ', voice_settings: {} }));
		collector.observeClientMessage(JSON.stringify({ text: 'Hello ' }));
		collector.observeClientMessage(JSON.stringify({ text: '你好😀' }));
		collector.observeClientMessage(JSON.stringify({ text: '' }));
		collector.observeServerMessage(JSON.stringify({ isFinal: true }));
		const usage = collector.toUsage({ clientClosedFirst: false });
		assert.equal(usage.audio_characters, 6 + 3);
		assert.equal(usage.audio_duration_seconds, 0);
		assert.equal(usage.stream_error, undefined);
		assert.equal(usage.cancelled, false);
	});

	it('only treats the first " " as the init frame', () => {
		const collector = new ElevenLabsRealtimeUsageCollector('audio.speech.realtime');
		collector.observeClientMessage(JSON.stringify({ text: 'a' }));
		collector.observeClientMessage(JSON.stringify({ text: ' ' }));
		collector.observeServerMessage(JSON.stringify({ isFinal: true }));
		assert.equal(collector.toUsage({ clientClosedFirst: false }).audio_characters, 2);
	});

	it('strips credentials from TTS frames before they reach upstream', () => {
		const collector = new ElevenLabsRealtimeUsageCollector('audio.speech.realtime');
		const out = collector.observeClientMessage(
			JSON.stringify({ text: ' ', xi_api_key: 'sk-client', authorization: 'Bearer sk-client', 'xi-api-key': 'sk-client' })
		);
		assert.ok(!out.includes('sk-client'));
		assert.equal(JSON.parse(out).text, ' ');
		// 无需改写时原样返回
		const plain = JSON.stringify({ text: 'hi' });
		assert.equal(collector.observeClientMessage(plain), plain);
		// 非 JSON 帧原样返回
		assert.equal(collector.observeClientMessage('not json'), 'not json');
	});

	it('flags a TTS session as cancelled when the client leaves before isFinal', () => {
		const collector = new ElevenLabsRealtimeUsageCollector('audio.speech.realtime');
		collector.observeClientMessage(JSON.stringify({ text: 'hello' }));
		const usage = collector.toUsage({ clientClosedFirst: true });
		assert.equal(usage.cancelled, true);
		assert.equal(usage.audio_characters, 5);
	});

	it('flags a TTS session that ends upstream without isFinal as incomplete', () => {
		const collector = new ElevenLabsRealtimeUsageCollector('audio.speech.realtime');
		collector.observeClientMessage(JSON.stringify({ text: 'hello' }));
		const usage = collector.toUsage({ clientClosedFirst: false });
		assert.match(usage.stream_error ?? '', /terminal event/);
	});

	it('records TTS error frames from the server', () => {
		const collector = new ElevenLabsRealtimeUsageCollector('audio.speech.realtime');
		collector.observeServerMessage(JSON.stringify({ error: 'quota exceeded', message: 'out of credits' }));
		const usage = collector.toUsage({ clientClosedFirst: false });
		assert.match(usage.stream_error ?? '', /quota exceeded/);
	});

	it('converts STT audio bytes to seconds using the query audio_format', () => {
		const collector = new ElevenLabsRealtimeUsageCollector('audio.transcriptions.realtime', 'pcm_16000');
		// 32_000 字节/秒 → 64_000 字节 = 2 秒
		collector.observeClientMessage(
			JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: base64OfBytes(32_000) })
		);
		collector.observeClientMessage(
			JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: base64OfBytes(32_000), commit: true })
		);
		const usage = collector.toUsage({ clientClosedFirst: true });
		assert.equal(usage.audio_duration_seconds, 2);
		assert.equal(usage.audio_characters, 0);
		assert.equal(usage.cancelled, false);
		assert.equal(usage.stream_error, undefined);
	});

	it('prefers the server session_started audio_format over the query', () => {
		const collector = new ElevenLabsRealtimeUsageCollector('audio.transcriptions.realtime', 'pcm_16000');
		collector.observeServerMessage(
			JSON.stringify({ message_type: 'session_started', config: { audio_format: 'pcm_8000' } })
		);
		collector.observeClientMessage(JSON.stringify({ audio_base_64: base64OfBytes(16_000) }));
		assert.equal(collector.toUsage({ clientClosedFirst: true }).audio_duration_seconds, 1);
	});

	it('does not rewrite STT frames', () => {
		const collector = new ElevenLabsRealtimeUsageCollector('audio.transcriptions.realtime');
		const frame = JSON.stringify({ audio_base_64: 'AAAA', authorization: 'x' });
		assert.equal(collector.observeClientMessage(frame), frame);
	});

	it('records STT server error events', () => {
		const collector = new ElevenLabsRealtimeUsageCollector('audio.transcriptions.realtime');
		collector.observeServerMessage(JSON.stringify({ message_type: 'quota_exceeded', error: 'no credits' }));
		assert.match(collector.toUsage({ clientClosedFirst: false }).stream_error ?? '', /quota_exceeded/);
		const other = new ElevenLabsRealtimeUsageCollector('audio.transcriptions.realtime');
		other.observeServerMessage(JSON.stringify({ message_type: 'partial_transcript', text: 'hi' }));
		assert.equal(other.toUsage({ clientClosedFirst: false }).stream_error, undefined);
	});
});

describe('bridgeElevenLabsRealtime', () => {
	it('relays frames both ways and reports TTS usage after isFinal', async () => {
		const client = fakeSocket();
		const upstream = fakeSocket();
		const usagePromise = bridgeElevenLabsRealtime({
			client: client.socket,
			upstream: upstream.socket,
			operation: 'audio.speech.realtime',
		});

		client.emitMessage(JSON.stringify({ text: ' ', xi_api_key: 'sk-client' }));
		client.emitMessage(JSON.stringify({ text: 'Hi there.' }));
		assert.equal(upstream.sent.length, 2);
		assert.ok(!String(upstream.sent[0]).includes('sk-client'));

		upstream.emitMessage(JSON.stringify({ audio: 'AAAA', isFinal: null }));
		upstream.emitMessage(JSON.stringify({ isFinal: true }));
		assert.equal(client.sent.length, 2);

		upstream.emitClose(1000, '');
		const usage = await usagePromise;
		assert.equal(usage.audio_characters, 9);
		assert.equal(usage.stream_error, undefined);
		assert.equal(usage.cancelled, false);
		assert.equal(client.closes[0]?.code, 1000);
	});

	it('forwards binary frames untouched', async () => {
		const client = fakeSocket();
		const upstream = fakeSocket();
		const usagePromise = bridgeElevenLabsRealtime({
			client: client.socket,
			upstream: upstream.socket,
			operation: 'audio.transcriptions.realtime',
		});
		const bytes = new Uint8Array([1, 2, 3]);
		client.emitMessage(bytes);
		assert.deepEqual([...(upstream.sent[0] as Uint8Array)], [1, 2, 3]);
		client.emitClose(1000, 'bye');
		await usagePromise;
		assert.equal(upstream.closes[0]?.code, 1000);
	});

	it('closes upstream and settles when the client disconnects (STT bills the bytes sent)', async () => {
		const client = fakeSocket();
		const upstream = fakeSocket();
		const usagePromise = bridgeElevenLabsRealtime({
			client: client.socket,
			upstream: upstream.socket,
			operation: 'audio.transcriptions.realtime',
			audioFormat: 'pcm_16000',
		});
		client.emitMessage(JSON.stringify({ audio_base_64: base64OfBytes(64_000) }));
		client.emitClose(1000, 'done');
		const usage = await usagePromise;
		assert.equal(usage.audio_duration_seconds, 2);
		assert.equal(upstream.closes[0]?.code, 1000);
	});

	it('reports an upstream transport error', async () => {
		const client = fakeSocket();
		const upstream = fakeSocket();
		const usagePromise = bridgeElevenLabsRealtime({
			client: client.socket,
			upstream: upstream.socket,
			operation: 'audio.transcriptions.realtime',
		});
		upstream.emitError();
		const usage = await usagePromise;
		assert.match(usage.stream_error ?? '', /Upstream WebSocket transport error/);
		assert.equal(client.closes[0]?.code, 1011);
	});

	it('reports an abnormal upstream close code', async () => {
		const client = fakeSocket();
		const upstream = fakeSocket();
		const usagePromise = bridgeElevenLabsRealtime({
			client: client.socket,
			upstream: upstream.socket,
			operation: 'audio.transcriptions.realtime',
		});
		upstream.emitClose(1011, 'boom');
		const usage = await usagePromise;
		assert.match(usage.stream_error ?? '', /1011/);
	});
});

describe('elevenLabsRealtimeRejectedResult', () => {
	it('keeps the upstream status and body for ordinary failures', async () => {
		const result = await elevenLabsRealtimeRejectedResult(
			new Response(JSON.stringify({ detail: { status: 'invalid_api_key', message: 'bad key' } }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' },
			}),
			'req-1'
		);
		assert.equal(result.response.status, 401);
		assert.equal(result.upstreamRequestId, 'req-1');
		assert.match(await result.response.text(), /bad key/);
	});

	it('rewrites quota_exceeded to 402 so failover can move on', async () => {
		const result = await elevenLabsRealtimeRejectedResult(
			new Response(JSON.stringify({ detail: { status: 'quota_exceeded', message: 'out of credits' } }), {
				status: 401,
			}),
			null
		);
		assert.equal(result.response.status, 402);
	});

	it('rewrites concurrency limits to 429', async () => {
		const result = await elevenLabsRealtimeRejectedResult(
			new Response(JSON.stringify({ detail: { status: 'too_many_concurrent_requests', message: 'busy' } }), {
				status: 403,
			}),
			null
		);
		assert.equal(result.response.status, 429);
	});

	it('synthesizes an error body when upstream sent none', async () => {
		const result = await elevenLabsRealtimeRejectedResult(new Response(null, { status: 503 }), null);
		assert.equal(result.response.status, 503);
		const body = JSON.parse(await result.response.text());
		assert.match(body.error.message, /503/);
	});
});

describe('dispatchElevenLabsRealtime', () => {
	it('delegates to the Node dispatch when one is provided', async () => {
		let seen: { route: RouteResult; operation: string } | null = null;
		const expected = {
			response: new Response(null, { status: 200 }),
			usagePromise: Promise.resolve({} as never),
			upstreamRequestId: null,
		};
		const result = await dispatchElevenLabsRealtime(
			route(),
			{ operation: 'audio.speech.realtime', voiceId: 'v', query: {} },
			undefined,
			null,
			undefined,
			{
				nodeDispatch: async (r, p) => {
					seen = { route: r, operation: p.operation };
					return expected;
				},
			}
		);
		assert.equal(result, expected);
		assert.equal(seen!.operation, 'audio.speech.realtime');
	});

	it('returns 501 outside the Workers runtime', async () => {
		const result = await dispatchElevenLabsRealtime(route(), {
			operation: 'audio.speech.realtime',
			voiceId: 'v',
			query: {},
		});
		assert.equal(result.response.status, 501);
	});

	it('sends the upstream handshake with xi-api-key + Upgrade and surfaces a rejection', async () => {
		(globalThis as { WebSocketPair?: unknown }).WebSocketPair = function () {};
		try {
			let requested: { url: string; headers: Record<string, string> } | null = null;
			const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
				requested = {
					url: String(input),
					headers: init?.headers as Record<string, string>,
				};
				return new Response(JSON.stringify({ detail: { status: 'quota_exceeded', message: 'x' } }), {
					status: 401,
					headers: { 'Content-Type': 'application/json' },
				});
			}) as typeof fetch;
			const result = await dispatchElevenLabsRealtime(
				route(),
				{ operation: 'audio.speech.realtime', voiceId: 'voice_1', query: { model_id: 'gw', output_format: 'pcm_16000' } },
				undefined,
				null,
				undefined,
				{ fetchImpl }
			);
			assert.equal(result.response.status, 402);
			assert.match(requested!.url, /^https:\/\/api\.elevenlabs\.io\/v1\/text-to-speech\/voice_1\/stream-input\?/);
			assert.match(requested!.url, /model_id=eleven_flash_v2_5/);
			assert.equal(requested!.headers['xi-api-key'], 'el-secret');
			assert.equal(requested!.headers.Upgrade, 'websocket');
		} finally {
			delete (globalThis as { WebSocketPair?: unknown }).WebSocketPair;
		}
	});
});
