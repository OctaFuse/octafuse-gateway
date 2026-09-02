import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EMPTY_USAGE, type UsageFromStream } from '../proxy';
import {
	defaultDescribeOutcome,
	defaultHasUsage,
	describeChatOutcome,
	describeGeminiOutcome,
	describeMessagesOutcome,
	describeResponsesOutcome,
	geminiHasUsage,
} from './describe-outcome';

function outcomeInput(overrides: {
	usage?: UsageFromStream;
	timedOut?: boolean;
	headerRequestId?: string | null;
	httpStatus?: number;
	body?: unknown;
} = {}) {
	return {
		body: overrides.body ?? {},
		usage: overrides.usage ?? EMPTY_USAGE,
		timedOut: overrides.timedOut ?? false,
		headerRequestId: 'headerRequestId' in overrides ? (overrides.headerRequestId ?? null) : 'hdr-1',
		httpStatus: overrides.httpStatus ?? 200,
	};
}

describe('describeOutcome billing口径', () => {
	it('chat / messages: any input/output/total token counts as usage; reasoning-only does not', () => {
		assert.equal(defaultHasUsage(EMPTY_USAGE), false);
		assert.equal(defaultHasUsage({ ...EMPTY_USAGE, input_tokens: 3 }), true);
		assert.equal(defaultHasUsage({ ...EMPTY_USAGE, output_tokens: 1 }), true);
		assert.equal(defaultHasUsage({ ...EMPTY_USAGE, total_tokens: 8 }), true);
		assert.equal(defaultHasUsage({ ...EMPTY_USAGE, reasoning_tokens: 12 }), false);

		const reasoningOnly = outcomeInput({ usage: { ...EMPTY_USAGE, reasoning_tokens: 12 } });
		assert.equal(describeChatOutcome(reasoningOnly).hasUsage, false);
		assert.equal(describeMessagesOutcome(reasoningOnly).hasUsage, false);
		assert.equal(describeChatOutcome(reasoningOnly).loggedRequestId, 'hdr-1');
	});

	it('chat / messages: default incomplete and HTTP fallback copy', () => {
		const timedOut = defaultDescribeOutcome(outcomeInput({ timedOut: true, httpStatus: 200 }));
		assert.equal(timedOut.incompleteErrorMessage, 'Stream usage timeout (no usage within limit)');
		const ended = defaultDescribeOutcome(outcomeInput({ timedOut: false }));
		assert.equal(ended.incompleteErrorMessage, 'Stream ended before usage available');
		assert.equal(ended.httpErrorFallback, 'HTTP 200');
		assert.equal(ended.extraRecordUsage, undefined);
	});

	it('responses: incomplete / HTTP fallback prefer usage.stream_error unless timed out', () => {
		const withError = describeResponsesOutcome(
			outcomeInput({
				usage: { ...EMPTY_USAGE, stream_error: 'upstream truncated' },
				httpStatus: 502,
			})
		);
		assert.equal(withError.incompleteErrorMessage, 'upstream truncated');
		assert.equal(withError.httpErrorFallback, 'upstream truncated');

		const timedOut = describeResponsesOutcome(
			outcomeInput({
				usage: { ...EMPTY_USAGE, stream_error: 'upstream truncated' },
				timedOut: true,
			})
		);
		assert.equal(timedOut.incompleteErrorMessage, 'Stream usage timeout (no usage within limit)');
		assert.equal(timedOut.httpErrorFallback, 'upstream truncated');
		assert.equal(timedOut.hasUsage, false);
	});

	it('gemini: reasoning-only counts as usage; request id falls back to body; writes wire action', () => {
		assert.equal(geminiHasUsage({ ...EMPTY_USAGE, reasoning_tokens: 4 }), true);
		const described = describeGeminiOutcome(
			outcomeInput({
				body: { action: 'streamGenerateContent' },
				usage: {
					...EMPTY_USAGE,
					reasoning_tokens: 4,
					upstreamBodyRequestId: 'body-req',
				},
				headerRequestId: null,
			})
		);
		assert.equal(described.hasUsage, true);
		assert.equal(described.loggedRequestId, 'body-req');
		assert.deepEqual(described.extraRecordUsage, { gemini_wire_action: 'streamGenerateContent' });
	});

	it('gemini: header request id wins over body request id', () => {
		const described = describeGeminiOutcome(
			outcomeInput({
				body: { action: 'generateContent' },
				usage: { ...EMPTY_USAGE, input_tokens: 1, upstreamBodyRequestId: 'body-req' },
				headerRequestId: 'hdr-gemini',
			})
		);
		assert.equal(described.loggedRequestId, 'hdr-gemini');
	});
});
