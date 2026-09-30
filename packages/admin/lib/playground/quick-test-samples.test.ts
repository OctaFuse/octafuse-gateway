import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PLAYGROUND_LLM_SAMPLE_IDS } from './samples';
import { quickTestLlmFamily, quickTestSample, setQuickTestStreaming } from './quick-test-samples';

const route = {
	model_id: 'deepseek-v4',
	provider_model_name: 'deepseek-v4',
	upstream_protocol: 'openai',
	upstream_operation: 'chat',
};

describe('Quick test protocol templates', () => {
	it('selects exact endpoint families and excludes media/unsupported operations', () => {
		assert.equal(quickTestLlmFamily(route), 'openai_chat');
		assert.equal(quickTestLlmFamily({ ...route, upstream_operation: 'responses' }), 'openai_responses');
		assert.equal(
			quickTestLlmFamily({ ...route, upstream_protocol: 'anthropic', upstream_operation: 'messages' }),
			'anthropic'
		);
		assert.equal(
			quickTestLlmFamily({ ...route, upstream_protocol: 'gemini', upstream_operation: 'models.generate' }),
			'gemini'
		);
		assert.equal(quickTestLlmFamily({ ...route, upstream_operation: 'images.generations' }), null);
		assert.equal(quickTestLlmFamily(route, true), null);
	});
	it('builds all templates using protocol-specific request shapes and streaming fields', () => {
		for (const family of ['openai_chat', 'openai_responses', 'anthropic', 'gemini'] as const) {
			for (const id of PLAYGROUND_LLM_SAMPLE_IDS) {
				const body = JSON.parse(quickTestSample(route, family, id, false));
				assert.ok(
					body[family === 'gemini' ? 'contents' : family === 'openai_responses' ? 'input' : 'messages']
				);
				assert.equal(body.stream, family === 'gemini' ? undefined : false);
				assert.equal(body.stream_options, undefined);
				if (id === 'tools') assert.ok(body.tools.length > 0);
			}
		}
	});
	it('uses model-specific reasoning knobs and preserves user content when toggling streaming', () => {
		assert.deepEqual(JSON.parse(quickTestSample(route, 'openai_chat', 'reasoning', true)).thinking, {
			type: 'enabled',
		});
		const text = '{"messages":[{"role":"user","content":"custom"}],"temperature":0.2}';
		const stream = JSON.parse(setQuickTestStreaming(text, 'openai_chat', true));
		assert.equal(stream.messages[0].content, 'custom');
		assert.equal(stream.temperature, 0.2);
		assert.equal(stream.stream_options.include_usage, true);
		const plain = JSON.parse(setQuickTestStreaming(JSON.stringify(stream), 'openai_chat', false));
		assert.equal(plain.stream, false);
		assert.equal(plain.stream_options, undefined);
		assert.equal(setQuickTestStreaming('{"contents":[]}', 'gemini', true), '{"contents":[]}');
		assert.throws(() => setQuickTestStreaming('[]', 'openai_chat', true));
	});
});
