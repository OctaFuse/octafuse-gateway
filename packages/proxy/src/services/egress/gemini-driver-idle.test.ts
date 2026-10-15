import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import type { RouteResult } from '../model-router';
import { dispatchGeminiRoute } from './gemini-driver';

function geminiRoute(): RouteResult {
	return {
		providerId: 'p1',
		providerName: 'Test Provider',
		providerModelName: 'gemini-2.5-flash',
		upstreamProtocol: 'gemini',
		providerEndpoints: {
			gemini: { base: 'https://generativelanguage.googleapis.com/v1beta/models' },
		},
		providerApiKey: 'provider-key',
		priceOverrideRaw: null,
		routeMeteredProfileJson: null,
		routeChargedProfileJson: null,
		customParams: null,
		routeGroup: 'default',
		routePriority: 0,
		routeWeight: 1,
	} as unknown as RouteResult;
}

describe('dispatchGeminiRoute stream idle timeout', () => {
	afterEach(() => {
		mock.reset();
	});

	it('writes an SSE error frame instead of a clean EOF when the upstream goes idle', async () => {
		const encoder = new TextEncoder();
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(
					encoder.encode(
						`data: ${JSON.stringify({
							candidates: [{ content: { parts: [{ text: 'hi', thought: true }] } }],
							usageMetadata: { promptTokenCount: 3 },
						})}\r\n\r\n`
					)
				);
			},
			cancel() {},
		});
		mock.method(globalThis, 'fetch', async () =>
			new Response(stream, {
				status: 200,
				headers: { 'Content-Type': 'text/event-stream' },
			})
		);
		const result = await dispatchGeminiRoute(
			geminiRoute(),
			{},
			'streamGenerateContent',
			'?alt=sse',
			undefined,
			null,
			undefined,
			{ idleTimeoutMs: 40 }
		);
		const [usage, text] = await Promise.all([result.usagePromise, result.response.text()]);
		assert.equal(usage.stream_error, 'Stream idle timeout');
		assert.ok(
			text.endsWith(
				`\ndata: ${JSON.stringify({
					error: { code: 504, status: 'DEADLINE_EXCEEDED', message: 'Stream idle timeout' },
				})}\n\n`
			),
			text
		);
	});
});
