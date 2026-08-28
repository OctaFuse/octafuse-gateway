import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PlaygroundResolvedRoute } from './playground-service';
import { rewritePlaygroundRealtimeClientMessage } from './playground-realtime-service';

function route(overrides: Partial<PlaygroundResolvedRoute> = {}): PlaygroundResolvedRoute {
	return {
		upstreamProtocol: 'dashscope',
		upstreamOperation: 'audio.transcriptions.realtime.inference',
		adapter: 'passthrough',
		providerEndpoints: {
			dashscope: { base: 'https://dashscope.aliyuncs.com/api/v1' },
		},
		providerId: 'p1',
		providerApiKey: 'sk-test',
		providerModelName: 'qwen3-asr-flash-realtime',
		customParams: { vad_enabled: true },
		isImageModel: false,
		isAudioModel: true,
		...overrides,
	};
}

describe('rewritePlaygroundRealtimeClientMessage', () => {
	it('injects the provider model into run-task', () => {
		const rewritten = JSON.parse(
			rewritePlaygroundRealtimeClientMessage(
				route(),
				'audio.transcriptions.realtime.inference',
				JSON.stringify({
					header: { action: 'run-task' },
					payload: { model: '<auto>', parameters: { format: 'pcm' } },
				}),
			),
		) as { payload: { model: string; parameters: { format: string } } };
		assert.equal(rewritten.payload.model, 'qwen3-asr-flash-realtime');
		assert.equal(rewritten.payload.parameters.format, 'pcm');
	});

	it('leaves non-start events unchanged', () => {
		const message = JSON.stringify({ header: { action: 'finish-task' }, payload: { input: {} } });
		assert.equal(
			rewritePlaygroundRealtimeClientMessage(route(), 'audio.transcriptions.realtime.inference', message),
			message,
		);
	});
});
