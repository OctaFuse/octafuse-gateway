import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RouteResult } from '../model-router';
import { countDashScopeImages, dispatchDashScopeJsonPassthrough } from './dashscope-json-passthrough';

function route(operation: string, providerModelName = 'upstream-model'): RouteResult {
	return {
		targetId: 'route-1',
		modelSurfaceId: 'surface-1',
		routePoolId: 'pool-1',
		providerId: 'dashscope',
		providerName: 'DashScope',
		providerModelName,
		upstreamProtocol: 'dashscope',
		upstreamOperation: operation,
		adapter: 'passthrough',
		providerEndpoints: { dashscope: { base: 'https://dashscope.example/api/v1' } },
		providerApiKey: 'sk-test',
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

describe('DashScope JSON passthrough', () => {
	it('forwards native image JSON and counts images without reshaping', async () => {
		let seenUrl = '';
		let seenBody = '';
		const upstream = {
			output: { choices: [{ message: { content: [{ image: 'https://oss.example/a.png' }] } }] },
			usage: { image_count: 1 },
		};
		const result = await dispatchDashScopeJsonPassthrough(
			route('images.generations.multimodal', 'qwen-image'),
			'images.generations.multimodal',
			{ model: 'gateway-image', input: { messages: [] } },
			undefined,
			null,
			undefined,
			{
				fetchImpl: async (url, init) => {
					seenUrl = String(url);
					seenBody = String(init?.body ?? '');
					return new Response(JSON.stringify(upstream), {
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					});
				},
			},
		);
		assert.equal(seenUrl, 'https://dashscope.example/api/v1/services/aigc/multimodal-generation/generation');
		assert.equal(JSON.parse(seenBody).model, 'qwen-image');
		const returned = JSON.parse(await result.response.text()) as typeof upstream;
		assert.deepEqual(returned, upstream);
		assert.equal(result.meta?.imageCount, 1);
	});

	it('enables SSE for speech stream and reads characters from events', async () => {
		const result = await dispatchDashScopeJsonPassthrough(
			route('audio.speech.stream', 'cosyvoice-v2'),
			'audio.speech.stream',
			{ model: 'gateway-tts', input: { text: 'hi' } },
			undefined,
			null,
			undefined,
			{
				fetchImpl: async (_url, init) => {
					const headers = new Headers(init?.headers);
					assert.equal(headers.get('X-DashScope-SSE'), 'enable');
					const stream = new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode('data: {"usage":{"characters":12}}\n\n'));
							controller.close();
						},
					});
					return new Response(stream, {
						status: 200,
						headers: { 'Content-Type': 'text/event-stream' },
					});
				},
			},
		);
		assert.equal(await result.response.text(), 'data: {"usage":{"characters":12}}\n\n');
		assert.equal((await result.usagePromise).audio_characters, 12);
	});

	it('bills async task duration from transcription_url and returns the task JSON', async () => {
		const task = {
			output: {
				task_status: 'SUCCEEDED',
				results: [{ transcription_url: 'https://oss.example/result.json' }],
			},
		};
		const result = await dispatchDashScopeJsonPassthrough(
			route('audio.transcriptions.async', 'fun-asr'),
			'audio.transcriptions.async',
			null,
			undefined,
			null,
			undefined,
			{
				taskId: 'task-1',
				fetchImpl: async (url) => {
					if (String(url).includes('/tasks/task-1')) {
						return new Response(JSON.stringify(task), {
							status: 200,
							headers: { 'Content-Type': 'application/json' },
						});
					}
					return new Response(JSON.stringify({ usage: { seconds: 3.5 } }), {
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					});
				},
			},
		);
		assert.deepEqual(JSON.parse(await result.response.text()), task);
		assert.equal(result.meta?.audioDurationSeconds, 3.5);
		assert.equal(result.meta?.audioDurationSource, 'upstream');
	});

	it('counts only content parts that contain an image', () => {
		assert.equal(
			countDashScopeImages({
				output: { choices: [{ message: { content: [{ text: 'no' }, { image: 'https://a' }, { image: '' }] } }] },
			}),
			1,
		);
	});
});
