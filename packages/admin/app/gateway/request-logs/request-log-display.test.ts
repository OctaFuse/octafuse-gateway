import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compareLogBodies, flowTimeExtent, readFlowAttempts, readLogObject, requestAccountingHref } from './request-log-flow-data';
import {
	isRequestLogStreaming,
	parseGeminiWireAction,
	requestLogFeatureKind,
	requestLogFeatureTags,
} from './request-log-display';

describe('request flow observations', () => {
	it('opens usage charge audits for the request date, including historical requests', () => {
		const url = new URL(requestAccountingHref('request/1', '2026-08-01T03:00:00Z'), 'http://localhost');
		assert.equal(url.searchParams.get('correlation_id'), 'request/1');
		assert.equal(url.searchParams.get('event_type'), 'usage_charge');
		assert.equal(url.searchParams.get('start_date'), '2026-07-31T03:00:00.000Z');
		assert.equal(url.searchParams.get('end_date'), '2026-08-02T03:00:00.000Z');
	});
	it('keeps failed attempts and final selection distinct from request success', () => {
		const attempts = readFlowAttempts(JSON.stringify({ attempts: [
			{ index: 1, provider_name: 'A', start_ms: 8, headers_ms: 40, headers_elapsed_ms: 48, status: 429, failure_kind: 'rate_limit', error: 'slow down', selected: false },
			{ index: 2, provider_name: 'B', start_ms: 60, headers_ms: 90, headers_elapsed_ms: 150, status: 503, selected: true },
		] }));
		assert.equal(attempts.length, 2);
		assert.equal(attempts[0].failed, true);
		assert.equal(attempts[0].failureKind, 'rate_limit');
		assert.equal(attempts[1].selected, true);
		assert.equal(attempts[1].failed, true);
		assert.equal(flowTimeExtent(200, attempts, 8, 120), 270);
	});

	it('does not invent headers or duration for transport errors and tolerates legacy data', () => {
		const attempts = readFlowAttempts(JSON.stringify({ attempts: [null, 'bad', { error: 'fetch failed', start_ms: 0, selected: false }, { start_ms: -1, headers_ms: '12', selected: 'true' }] }));
		assert.equal(attempts.length, 2);
		assert.equal(attempts[0].startMs, 0);
		assert.equal(attempts[0].headersMs, null);
		assert.equal(attempts[0].status, null);
		assert.equal(attempts[0].failed, true);
		assert.equal(attempts[1].startMs, null);
		assert.equal(attempts[1].headersMs, null);
		assert.equal(attempts[1].selected, false);
		for (const raw of [null, '', 'invalid', '[]', '{"attempts":{}}']) assert.deepEqual(readFlowAttempts(raw), []);
		assert.equal(readLogObject('null'), null);
	});

	it('compares redacted bodies including additions, removals, nulls and nested parameter changes', () => {
		const changes = compareLogBodies(
			JSON.stringify({ model: 'public', thinking: { enabled: true, budget: 1 }, removed: null, 'a/b~c': 1 }),
			JSON.stringify({ model: 'upstream', thinking: { enabled: true, budget: 2 }, added: null, 'a/b~c': 2 }),
		);
		assert.deepEqual(changes, [
			{ path: '/a~1b~0c', kind: 'changed', before: 1, after: 2 },
			{ path: '/added', kind: 'added', after: null },
			{ path: '/model', kind: 'changed', before: 'public', after: 'upstream' },
			{ path: '/removed', kind: 'removed', before: null },
			{ path: '/thinking/budget', kind: 'changed', before: 1, after: 2 },
		]);
	});

	it('ignores object key ordering but preserves array order and unavailable snapshots', () => {
		assert.deepEqual(compareLogBodies('{"tools":[{"a":1,"b":2}]}', '{"tools":[{"b":2,"a":1}]}'), []);
		assert.equal(compareLogBodies('{"tools":[1,2]}', '{"tools":[2,1]}')?.length, 1);
		assert.deepEqual(compareLogBodies('{}', '{}'), []);
		assert.equal(compareLogBodies(null, '{}'), null);
		assert.equal(compareLogBodies('{}', 'invalid'), null);
	});
});

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
		assert.equal(requestLogFeatureKind({ provider_id: 'octafuse-mcp', model_id: 'mcp:deepwiki/ask' }), 'mcp');
		assert.equal(requestLogFeatureKind({ model_id: 'tool:ai-detection' }), 'tool');
		assert.equal(requestLogFeatureKind({ billing_kind: 'image_per_image' }), 'image');
		assert.equal(requestLogFeatureKind({ request_operation: 'audio.speech' }), 'tts');
		assert.equal(requestLogFeatureKind({ upstream_operation: 'audio.transcriptions.multimodal' }), 'asr');
		assert.equal(requestLogFeatureKind({ request_operation: 'chat' }), 'llm');
	});

	it('does not treat audio_tokens billing as ASR when the operation is TTS', () => {
		assert.equal(
			requestLogFeatureKind({ billing_kind: 'audio_tokens', request_operation: 'audio.speech' }),
			'tts',
		);
		assert.equal(
			requestLogFeatureKind({ billing_kind: 'audio_tokens', request_operation: 'audio.transcriptions' }),
			'asr',
		);
		assert.equal(requestLogFeatureKind({ billing_kind: 'audio_tokens' }), 'asr');
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

describe('requestLogFeatureKind embedding', () => {
	it('classifies embeddings by operation and catalog model', () => {
		assert.equal(requestLogFeatureKind({ request_operation: 'embeddings', upstream_operation: 'embeddings' }), 'embedding');
		assert.equal(requestLogFeatureKind({ request_operation: 'models.embed', upstream_operation: 'models.embed' }), 'embedding');
		assert.equal(
			requestLogFeatureKind({ model_id: 'text-embedding-3-small' }, { output_modalities: ['embedding'] } as never),
			'embedding',
		);
		assert.equal(requestLogFeatureKind({ request_operation: 'chat.completions' }), 'llm');
	});
});
