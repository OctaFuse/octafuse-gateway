import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestTimingCollector } from './request-timing';
import type { RouteResult } from './model-router';

function route(overrides: Partial<RouteResult> = {}): RouteResult {
	return {
		providerId: 'provider-a',
		providerName: 'Provider A',
		providerModelName: 'model-a',
		upstreamProtocol: 'openai',
		baseUrl: 'https://example.test/v1',
		providerApiKey: 'secret',
		priceOverrideRaw: null,
		routeMeteredProfileJson: null,
		routeChargedProfileJson: null,
		customParams: null,
		routeGroup: 'default',
		routePriority: 0,
		providerKeyId: 'key-a',
		providerKeyLabel: 'primary',
		providerKeyFingerprint: 'fp-a',
		...overrides,
	};
}

test('RequestTimingCollector snapshots stable timing metrics and attempt metadata', () => {
	const timing = new RequestTimingCollector();
	timing.markGatewayComplete();
	timing.markGatewayComplete();

	const first = timing.startAttempt(route());
	timing.markAttemptHeaders(first, 429);
	timing.markAttemptFailover(first);

	const second = timing.startAttempt(route({ providerId: 'provider-b', providerKeyId: 'key-b' }));
	timing.markAttemptHeaders(second, 200);
	timing.markFinalAttempt(second);
	timing.markFirstByte();
	timing.markFirstEvent();
	timing.markFirstReasoningToken();
	timing.markFirstReasoningToken();
	timing.markFirstToken();
	timing.markFirstToken();
	timing.markStreamComplete();

	const snapshot = timing.snapshot();
	assert.equal(snapshot.upstreamAttemptCount, 2);
	assert.equal(snapshot.upstreamFailoverCount, 1);
	assert.equal(typeof snapshot.gatewayOverheadMs, 'number');
	assert.equal(typeof snapshot.upstreamResponseMs, 'number');
	assert.equal(typeof snapshot.finalUpstreamHeadersMs, 'number');
	assert.equal(typeof snapshot.firstReasoningTokenMs, 'number');
	assert.equal(typeof snapshot.firstTokenMs, 'number');
	assert.equal(typeof snapshot.streamDurationMs, 'number');

	const metadata = JSON.parse(snapshot.timingMetadata ?? '{}') as {
		first_byte_ms?: number;
		first_event_ms?: number;
		attempts?: Array<{ provider_id: string; status: number; selected: boolean }>;
	};
	assert.equal(typeof metadata.first_byte_ms, 'number');
	assert.equal(typeof metadata.first_event_ms, 'number');
	assert.equal(metadata.attempts?.length, 2);
	assert.equal(metadata.attempts?.[0]?.status, 429);
	assert.equal(metadata.attempts?.[1]?.provider_id, 'provider-b');
	assert.equal(metadata.attempts?.[1]?.selected, true);
});
