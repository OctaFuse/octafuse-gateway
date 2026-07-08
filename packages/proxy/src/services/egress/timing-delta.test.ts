import test from 'node:test';
import assert from 'node:assert/strict';
import { hasOpenAiContentDelta, hasOpenAiReasoningDelta } from './openai-driver';
import { hasAnthropicContentDelta, hasAnthropicReasoningDelta } from './anthropic-driver';
import { hasGeminiContentPart, hasGeminiReasoningPart } from './gemini-driver';

test('hasOpenAiReasoningDelta detects reasoning fields but not content', () => {
	assert.equal(
		hasOpenAiReasoningDelta({
			choices: [{ delta: { reasoning_content: 'think' } }],
		}),
		true,
	);
	assert.equal(
		hasOpenAiReasoningDelta({
			choices: [{ delta: { content: 'hello' } }],
		}),
		false,
	);
	assert.equal(hasOpenAiContentDelta({ choices: [{ delta: { content: 'hello' } }] }), true);
});

test('hasAnthropicReasoningDelta detects thinking_delta but not text_delta', () => {
	assert.equal(
		hasAnthropicReasoningDelta({
			type: 'content_block_delta',
			delta: { type: 'thinking_delta', thinking: 'hmm' },
		}),
		true,
	);
	assert.equal(
		hasAnthropicContentDelta({
			type: 'content_block_delta',
			delta: { type: 'text_delta', text: 'hi' },
		}),
		true,
	);
	assert.equal(
		hasAnthropicContentDelta({
			type: 'content_block_delta',
			delta: { type: 'thinking_delta', thinking: 'hmm' },
		}),
		false,
	);
});

test('hasGeminiReasoningPart and hasGeminiContentPart split thought parts', () => {
	const parsed = {
		candidates: [
			{
				content: {
					parts: [
						{ text: 'thought', thought: true },
						{ text: 'answer' },
					],
				},
			},
		],
	};
	assert.equal(hasGeminiReasoningPart(parsed), true);
	assert.equal(hasGeminiContentPart(parsed), true);
	assert.equal(
		hasGeminiContentPart({
			candidates: [{ content: { parts: [{ text: 'only-thought', thought: true }] } }],
		}),
		false,
	);
});
