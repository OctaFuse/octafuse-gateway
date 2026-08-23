import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	buildPlaygroundDashScopeImageRequest,
	playgroundDashScopeImageFamily,
} from './playground-dashscope-image';
import type { PlaygroundResolvedRoute } from './playground-service';

function route(
	adapter: PlaygroundResolvedRoute['adapter'],
	overrides: Partial<PlaygroundResolvedRoute> = {},
): PlaygroundResolvedRoute {
	return {
		upstreamProtocol: 'dashscope',
		upstreamOperation: 'images.generations.multimodal',
		adapter,
		providerEndpoints: {
			dashscope: { base: 'https://dashscope.aliyuncs.com/api/v1' },
		},
		providerId: 'p1',
		providerApiKey: 'sk-test',
		providerModelName: 'qwen-image-3.0-pro',
		customParams: null,
		isImageModel: true,
		isAudioModel: false,
		...overrides,
	};
}

describe('buildPlaygroundDashScopeImageRequest', () => {
	it('rewrites OpenAI Images JSON to DashScope multimodal and always sends n', () => {
		const request = buildPlaygroundDashScopeImageRequest(route('dashscope-image-qwen'), {
			prompt: 'a red apple',
			size: '1024x1024',
			quality: 'low',
		});
		assert.equal(
			request.url,
			'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
		);
		assert.equal(request.headers.Authorization, 'Bearer sk-test');
		assert.deepEqual(JSON.parse(request.bodyText), {
			model: 'qwen-image-3.0-pro',
			input: {
				messages: [{ role: 'user', content: [{ text: 'a red apple' }] }],
			},
			parameters: { n: 1, size: '1024*1024' },
		});
	});

	it('places reference images before the prompt and redacts data URLs in the wire preview', () => {
		const request = buildPlaygroundDashScopeImageRequest(route('dashscope-image-wan', {
			providerModelName: 'wan2.7-image',
		}), {
			prompt: 'make it green',
			n: 2,
			image: 'data:image/png;base64,iVBORw0KGgo=',
		});
		assert.doesNotMatch(request.wireBodyJson, /iVBORw0KGgo=/);
		assert.deepEqual(JSON.parse(request.bodyText), {
			model: 'wan2.7-image',
			input: {
				messages: [
					{
						role: 'user',
						content: [{ image: 'data:image/png;base64,iVBORw0KGgo=' }, { text: 'make it green' }],
					},
				],
			},
			parameters: { n: 2 },
		});
	});

	it('rejects Qwen 1K/2K/4K size aliases', () => {
		assert.throws(
			() =>
				buildPlaygroundDashScopeImageRequest(route('dashscope-image-qwen'), {
					prompt: 'hi',
					size: '2K',
				}),
			/1024\*1024/,
		);
	});

	it('rejects passthrough and unknown adapters', () => {
		assert.equal(playgroundDashScopeImageFamily('passthrough'), null);
		assert.throws(
			() => buildPlaygroundDashScopeImageRequest(route('passthrough'), { prompt: 'hi' }),
			/dashscope-image-qwen/,
		);
	});
});
