import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EMPTY_USAGE } from '../proxy';
import { buildAccountingEvent, resolveAccountingErrorMessage } from './build-accounting-event';
import { describeChatOutcome, describeGeminiOutcome } from './describe-outcome';
import type { BuildAccountingEventInput } from './build-accounting-event';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function baseInput(
	overrides: Partial<BuildAccountingEventInput> = {}
): BuildAccountingEventInput {
	return {
		apiKey: {
			keyId: 'key-1',
			userId: 'user-1',
			userEmail: 'a@b.c',
			chargedCostFactors: null,
		},
		described: describeChatOutcome({
			body: {},
			usage: { ...EMPTY_USAGE, input_tokens: 10, total_tokens: 10 },
			timedOut: false,
			headerRequestId: 'up-req',
			httpStatus: 200,
		}),
		usage: { ...EMPTY_USAGE, input_tokens: 10, total_tokens: 10, upstreamMessageId: 'chatcmpl-1' },
		responseOk: true,
		errorBodyText: null,
		responseStatus: 200,
		responseContentType: 'application/json',
		baseModelId: 'gpt-x',
		modelName: 'GPT X',
		modelPricingProfile: null,
		requestProtocol: 'openai',
		requestOperation: 'chat',
		requestBodyForLog: '{"model":"gpt-x"}',
		upstreamRequestBody: '{"model":"upstream-gpt"}',
		chosenRoute: {
			providerId: 'prov-1',
			providerModelName: 'upstream-gpt',
			providerName: 'Prov',
			upstreamProtocol: 'openai',
			upstreamOperation: 'chat',
			modelSurfaceId: 'surf-1',
			routePoolId: 'pool-1',
			targetId: 'tgt-1',
			adapter: 'passthrough',
			priceOverrideRaw: null,
			routeMeteredProfileJson: null,
			routeChargedProfileJson: null,
			routeGroup: 'default',
			providerKeyId: 'pk-1',
			providerKeyLabel: 'prod',
			providerKeyFingerprint: 'fp',
		},
		stickyTrace: null,
		requestStartedAtMs: 1_700_000_000_000,
		latencyMs: 42,
		timing: null,
		circuitEvents: [],
		suppressErrorAlert: false,
		...overrides,
	};
}

describe('buildAccountingEvent', () => {
	it('allocates a stable requestLogId and is JSON-serializable without I/O', () => {
		const event = buildAccountingEvent(baseInput());
		assert.match(event.requestLogId, UUID_RE);
		const roundTrip = JSON.parse(JSON.stringify(event)) as typeof event;
		assert.equal(roundTrip.requestLogId, event.requestLogId);
		assert.equal(roundTrip.api_key_id, 'key-1');
		assert.equal(roundTrip.model_id, 'gpt-x');
		assert.equal(roundTrip.status, 'success');
		assert.equal(roundTrip.upstream_request_id, 'up-req');
		assert.equal(roundTrip.upstream_message_id, 'chatcmpl-1');
		assert.equal(roundTrip.latency_ms, 42);
		assert.equal(roundTrip.error_message, undefined);
	});

	it('uses an injected requestLogId instead of generating a new one', () => {
		const event = buildAccountingEvent(baseInput({ requestLogId: 'fixed-id' }));
		assert.equal(event.requestLogId, 'fixed-id');
	});

	it('generates distinct ids across calls', () => {
		const a = buildAccountingEvent(baseInput());
		const b = buildAccountingEvent(baseInput());
		assert.notEqual(a.requestLogId, b.requestLogId);
	});

	it('marks incomplete when describeOutcome reports no usage', () => {
		const usage = EMPTY_USAGE;
		const event = buildAccountingEvent(
			baseInput({
				described: describeChatOutcome({
					body: {},
					usage,
					timedOut: true,
					headerRequestId: null,
					httpStatus: 200,
				}),
				usage,
				responseOk: true,
			})
		);
		assert.equal(event.status, 'incomplete');
		assert.equal(event.error_message, 'Stream usage timeout (no usage within limit)');
	});

	it('prefers cancelled over incomplete', () => {
		const usage = { ...EMPTY_USAGE, cancelled: true };
		const event = buildAccountingEvent(
			baseInput({
				described: describeChatOutcome({
					body: {},
					usage,
					timedOut: false,
					headerRequestId: null,
					httpStatus: 200,
				}),
				usage,
				responseOk: true,
			})
		);
		assert.equal(event.status, 'cancelled');
		assert.equal(event.error_message, 'Client disconnected (e.g. user cancelled)');
	});

	it('formats HTTP error body for error status', () => {
		const usage = EMPTY_USAGE;
		const event = buildAccountingEvent(
			baseInput({
				described: describeChatOutcome({
					body: {},
					usage,
					timedOut: false,
					headerRequestId: null,
					httpStatus: 400,
				}),
				usage,
				responseOk: false,
				responseStatus: 400,
				errorBodyText: JSON.stringify({ error: { message: 'bad request' } }),
			})
		);
		assert.equal(event.status, 'error');
		assert.match(event.error_message ?? '', /HTTP 400/);
		assert.match(event.error_message ?? '', /bad request/);
	});

	it('copies gemini extraRecordUsage onto the event', () => {
		const usage = { ...EMPTY_USAGE, input_tokens: 2, total_tokens: 2 };
		const event = buildAccountingEvent(
			baseInput({
				described: describeGeminiOutcome({
					body: { action: 'generateContent' },
					usage,
					timedOut: false,
					headerRequestId: 'g-hdr',
					httpStatus: 200,
				}),
				usage,
				requestProtocol: 'gemini',
				requestOperation: 'generateContent',
			})
		);
		assert.equal(event.gemini_wire_action, 'generateContent');
		assert.equal(event.upstream_request_id, 'g-hdr');
		assert.equal(event.status, 'success');
	});
});

describe('resolveAccountingErrorMessage', () => {
	it('returns undefined on success and HTTP fallback when no error body', () => {
		const described = describeChatOutcome({
			body: {},
			usage: EMPTY_USAGE,
			timedOut: false,
			headerRequestId: null,
			httpStatus: 502,
		});
		assert.equal(
			resolveAccountingErrorMessage({
				status: 'success',
				described,
				errorBodyText: null,
				responseStatus: 200,
				responseContentType: null,
			}),
			undefined
		);
		assert.equal(
			resolveAccountingErrorMessage({
				status: 'error',
				described,
				errorBodyText: null,
				responseStatus: 502,
				responseContentType: null,
			}),
			'HTTP 502'
		);
	});
});
