import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isRequestLogStreaming, parseGeminiWireAction } from './request-log-display';

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
