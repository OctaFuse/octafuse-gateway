import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import sampleRoutes from './routes.json';
import {
	loadPlaygroundSampleBody,
	PLAYGROUND_LLM_SAMPLE_IDS,
	PLAYGROUND_SAMPLE_IDS,
	resolvePlaygroundSampleId,
	type PlaygroundLlmFamily,
} from './index';

const FAMILIES: PlaygroundLlmFamily[] = ['openai_chat', 'openai_responses', 'anthropic', 'gemini'];

describe('playground samples', () => {
	it('routes every family/sample to a registered JSON body', () => {
		const registered = new Set(PLAYGROUND_SAMPLE_IDS);
		for (const family of FAMILIES) {
			for (const sampleId of PLAYGROUND_LLM_SAMPLE_IDS) {
				const rules = sampleRoutes[family][sampleId];
				assert.ok(rules.length > 0, `${family}.${sampleId} has no routes`);
				assert.equal(rules[rules.length - 1]?.when, undefined, `${family}.${sampleId} needs a default route`);
				for (const rule of rules) {
					assert.ok(registered.has(rule.id), `missing JSON for ${rule.id}`);
					JSON.parse(loadPlaygroundSampleBody(family, sampleId));
				}
			}
		}
	});

	it('resolves Claude 4.7 and DeepSeek to vendor-specific ids', () => {
		assert.equal(
			resolvePlaygroundSampleId('anthropic', 'reasoning', 'claude-opus-4.7'),
			'anthropic/reasoning.adaptive',
		);
		assert.equal(
			resolvePlaygroundSampleId('openai_chat', 'reasoning', 'deepseek-v4-pro'),
			'openai-chat/reasoning.thinking-effort',
		);
		assert.equal(
			resolvePlaygroundSampleId('openai_chat', 'connectivity', 'gpt-5.4'),
			'openai-chat/connectivity.max-completion',
		);
	});
});
