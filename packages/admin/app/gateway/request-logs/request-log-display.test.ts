import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	isRequestLogStreaming,
	parseGeminiWireAction,
	requestLogFeatureKind,
	requestLogFeatureTags,
} from './request-log-display';

describe('parseGeminiWireAction', () => {
	it('reads generateContent / streamGenerateContent from route_trace', () => {
		assert.equal(
			parseGeminiWireAction(JSON.stringify({ gemini: { action: 'streamGenerateContent' } })),
			'streamGenerateContent',
		);
		assert.equal(
			parseGeminiWireAction(JSON.stringify({ gemini: { action: 'generateContent' } })),
			'generateContent',
		);
		assert.equal(parseGeminiWireAction(JSON.stringify({ pool: 'p1' })), undefined);
		assert.equal(parseGeminiWireAction('not-json'), undefined);
	});
});

describe('isRequestLogStreaming', () => {
	it('treats Gemini streamGenerateContent as streaming', () => {
		assert.equal(
			isRequestLogStreaming({
				route_trace: JSON.stringify({ gemini: { action: 'streamGenerateContent' } }),
			}),
			true,
		);
		assert.equal(
			isRequestLogStreaming({
				route_trace: JSON.stringify({ gemini: { action: 'generateContent' } }),
			}),
			false,
		);
	});

	it('reads stream from the redacted request body', () => {
		assert.equal(isRequestLogStreaming({ request_body: JSON.stringify({ stream: true }) }), true);
		assert.equal(isRequestLogStreaming({ request_body: JSON.stringify({ stream: false }) }), false);
		assert.equal(
			isRequestLogStreaming({
				request_body: JSON.stringify({ _gemini_action: 'streamGenerateContent' }),
			}),
			true,
		);
	});

	it('treats DashScope realtime operations as streaming', () => {
		assert.equal(
			isRequestLogStreaming({ request_operation: 'audio.transcriptions.realtime.inference' }),
			true,
		);
	});
});

describe('requestLogFeatureKind', () => {
	it('classifies tools, image, TTS, and ASR from log fields', () => {
		assert.equal(requestLogFeatureKind({ provider_id: 'octafuse-tools', model_id: 'tool:web-search' }), 'tool');
		assert.equal(requestLogFeatureKind({ model_id: 'tool:ai-detection' }), 'tool');
		assert.equal(requestLogFeatureKind({ billing_kind: 'image_per_image' }), 'image');
		assert.equal(requestLogFeatureKind({ request_operation: 'audio.speech' }), 'tts');
		assert.equal(requestLogFeatureKind({ upstream_operation: 'audio.transcriptions.multimodal' }), 'asr');
		assert.equal(requestLogFeatureKind({ request_operation: 'chat' }), 'llm');
	});
});

describe('requestLogFeatureTags', () => {
	it('always includes kind and adds distinctive chips only when hit', () => {
		assert.deepEqual(requestLogFeatureTags({ request_operation: 'chat' }), [{ key: 'kind', kind: 'llm' }]);
		assert.deepEqual(
			requestLogFeatureTags({
				request_operation: 'chat',
				request_body: JSON.stringify({ stream: true }),
				first_reasoning_token_ms: 120,
				upstream_failover_count: 1,
			}),
			[
				{ key: 'kind', kind: 'llm' },
				{ key: 'stream' },
				{ key: 'reasoning' },
				{ key: 'failover' },
			],
		);
		assert.deepEqual(
			requestLogFeatureTags({ request_operation: 'audio.speech.realtime.inference' }),
			[{ key: 'kind', kind: 'tts' }, { key: 'realtime' }],
		);
	});
});
