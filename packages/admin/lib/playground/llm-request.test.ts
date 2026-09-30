import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { llmRequestSample, matchLlmRequestSample, parseLlmRequest } from './llm-request';
import { PLAYGROUND_LLM_SAMPLE_IDS, type PlaygroundLlmFamily } from './samples';
import { setQuickTestStreaming } from './quick-test-samples';
describe('Shared LLM request editor', () => {
	it('keeps client routing placeholders out of Gemini bodies and uses endpoint-native fields', () => {
		for (const family of [
			'openai_chat',
			'openai_responses',
			'anthropic',
			'gemini',
		] as PlaygroundLlmFamily[]) {
			for (const id of PLAYGROUND_LLM_SAMPLE_IDS) {
				const text = llmRequestSample(family, id, 'deepseek', false, '<auto>');
				const body = JSON.parse(text);
				assert.equal(body.model, family === 'gemini' ? undefined : '<auto>');
				assert.equal(body.stream, family === 'gemini' ? undefined : false);
				assert.ok(
					family === 'gemini' ? body.contents : family === 'openai_responses' ? body.input : body.messages,
				);
				assert.equal(matchLlmRequestSample(text, family, 'deepseek', false, '<auto>'), id);
			}
		}
	});
	it('recognizes reordered JSON and preserves a user-selected nonstream mode when changing templates', () => {
		const body = JSON.parse(llmRequestSample('openai_chat', 'tools', 'GPT-5', true, '<auto>'));
		assert.ok(body.max_completion_tokens);
		assert.equal(body.max_tokens, undefined);
		const changed = setQuickTestStreaming(
			JSON.stringify(Object.fromEntries(Object.entries(body).reverse())),
			'openai_chat',
			false,
		);
		assert.equal(matchLlmRequestSample(changed, 'openai_chat', 'GPT-5', false, '<auto>'), 'tools');
		const custom = JSON.parse(changed);
		custom.messages[0].content = 'Custom prompt';
		assert.equal(
			matchLlmRequestSample(JSON.stringify(custom), 'openai_chat', 'GPT-5', false, '<auto>'),
			'custom',
		);
	});
	it('rejects invalid or non-object input without silently replacing it', () => {
		for (const text of ['{', '[]', 'null', '5', '"text"']) assert.equal(parseLlmRequest(text), null);
	});
});
