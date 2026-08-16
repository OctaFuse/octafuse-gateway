import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	BODY_TEMPLATES,
	isPlaygroundBodyDirty,
	isResponsesPlaygroundRoute,
	LLM_SAMPLE_BODIES,
	matchPlaygroundLlmSample,
	matchResponsesPlaygroundSample,
	PLAYGROUND_LLM_SAMPLE_IDS,
	playgroundLlmFamilyForRoute,
	resolvePlaygroundLlmFamily,
	routeMatchesSearch,
	templateForRoute,
	type PlaygroundLlmFamily,
} from './playground-utils';
import type { RouteListRow } from './types';

function route(overrides: Partial<RouteListRow> = {}): RouteListRow {
	return {
		id: 'route-abc12345',
		model_id: 'gpt-4o',
		provider_id: 'openai',
		provider_model_name: 'gpt-4o',
		priority: 1,
		status: 'active',
		route_group: 'default',
		price_override: null,
		custom_params: null,
		upstream_protocol: 'openai',
		upstream_operation: 'chat',
		model_name: 'GPT-4o',
		provider_name: 'OpenAI',
		...overrides,
	};
}

describe('playground-utils', () => {
	it('routeMatchesSearch matches model, provider, protocol, and id', () => {
		const r = route();
		assert.equal(routeMatchesSearch(r, ''), true);
		assert.equal(routeMatchesSearch(r, 'gpt-4o'), true);
		assert.equal(routeMatchesSearch(r, 'OpenAI'), true);
		assert.equal(routeMatchesSearch(r, 'openai.chat'), true);
		assert.equal(routeMatchesSearch(r, 'route-abc'), true);
		assert.equal(routeMatchesSearch(r, 'anthropic'), false);
	});

	it('templateForRoute picks Responses vs Chat from upstream_operation', () => {
		assert.equal(
			templateForRoute(route({ upstream_operation: 'responses' }), undefined),
			BODY_TEMPLATES.openai_responses,
		);
		assert.equal(templateForRoute(route({ upstream_operation: 'chat' }), undefined), BODY_TEMPLATES.openai);
	});

	it('keeps the default Responses template without tools', () => {
		const body = JSON.parse(BODY_TEMPLATES.openai_responses) as { tools?: unknown; stream?: boolean };
		assert.equal(body.stream, true);
		assert.equal(body.tools, undefined);
		assert.equal(isResponsesPlaygroundRoute(route({ upstream_operation: 'responses' })), true);
		assert.equal(isResponsesPlaygroundRoute(route({ upstream_operation: 'chat' })), false);
	});

	it('openai_responses_tools includes stream and a function tool', () => {
		const body = JSON.parse(BODY_TEMPLATES.openai_responses_tools) as {
			stream?: boolean;
			store?: boolean;
			tools?: Array<{ type?: string; name?: string; parameters?: { properties?: Record<string, unknown> } }>;
		};
		assert.equal(body.stream, true);
		assert.equal(body.store, false);
		assert.equal(body.tools?.[0]?.type, 'function');
		assert.equal(body.tools?.[0]?.name, 'write_note');
		assert.ok(body.tools?.[0]?.parameters?.properties?.content);
	});

	it('matchResponsesPlaygroundSample distinguishes connectivity vs tools', () => {
		assert.equal(matchResponsesPlaygroundSample(BODY_TEMPLATES.openai_responses), 'connectivity');
		assert.equal(matchResponsesPlaygroundSample(BODY_TEMPLATES.openai_responses_tools), 'tools');
		assert.equal(matchResponsesPlaygroundSample('{ "input": [] }'), null);
	});

	it('LLM samples are valid JSON for all families and protocols', () => {
		const families: PlaygroundLlmFamily[] = ['openai_chat', 'openai_responses', 'anthropic', 'gemini'];
		for (const family of families) {
			for (const sampleId of PLAYGROUND_LLM_SAMPLE_IDS) {
				const parsed = JSON.parse(LLM_SAMPLE_BODIES[family][sampleId]) as Record<string, unknown>;
				assert.equal(typeof parsed, 'object');
				assert.equal(matchPlaygroundLlmSample(family, LLM_SAMPLE_BODIES[family][sampleId]), sampleId);
			}
		}
	});

	it('tools samples use the protocol-native write_note shape', () => {
		const chat = JSON.parse(LLM_SAMPLE_BODIES.openai_chat.tools) as {
			tools?: Array<{ type?: string; function?: { name?: string } }>;
		};
		assert.equal(chat.tools?.[0]?.type, 'function');
		assert.equal(chat.tools?.[0]?.function?.name, 'write_note');

		const responses = JSON.parse(LLM_SAMPLE_BODIES.openai_responses.tools) as {
			tools?: Array<{ type?: string; name?: string }>;
		};
		assert.equal(responses.tools?.[0]?.type, 'function');
		assert.equal(responses.tools?.[0]?.name, 'write_note');

		const anthropic = JSON.parse(LLM_SAMPLE_BODIES.anthropic.tools) as {
			tools?: Array<{ name?: string; input_schema?: unknown }>;
		};
		assert.equal(anthropic.tools?.[0]?.name, 'write_note');
		assert.ok(anthropic.tools?.[0]?.input_schema);

		const gemini = JSON.parse(LLM_SAMPLE_BODIES.gemini.tools) as {
			tools?: Array<{ functionDeclarations?: Array<{ name?: string; parameters?: { additionalProperties?: unknown } }> }>;
		};
		assert.equal(gemini.tools?.[0]?.functionDeclarations?.[0]?.name, 'write_note');
		assert.equal(gemini.tools?.[0]?.functionDeclarations?.[0]?.parameters?.additionalProperties, undefined);
	});

	it('reasoning samples set protocol-native thinking fields', () => {
		const chat = JSON.parse(LLM_SAMPLE_BODIES.openai_chat.reasoning) as { reasoning_effort?: string };
		assert.equal(chat.reasoning_effort, 'medium');
		const responses = JSON.parse(LLM_SAMPLE_BODIES.openai_responses.reasoning) as {
			reasoning?: { effort?: string };
		};
		assert.equal(responses.reasoning?.effort, 'medium');
		const anthropic = JSON.parse(LLM_SAMPLE_BODIES.anthropic.reasoning) as {
			thinking?: { type?: string; budget_tokens?: number };
			max_tokens?: number;
		};
		assert.equal(anthropic.thinking?.type, 'enabled');
		assert.ok((anthropic.max_tokens ?? 0) > (anthropic.thinking?.budget_tokens ?? 0));
		const gemini = JSON.parse(LLM_SAMPLE_BODIES.gemini.reasoning) as {
			generationConfig?: { thinkingConfig?: { includeThoughts?: boolean } };
		};
		assert.equal(gemini.generationConfig?.thinkingConfig?.includeThoughts, true);
	});

	it('resolvePlaygroundLlmFamily maps chat, responses, anthropic, gemini', () => {
		assert.equal(resolvePlaygroundLlmFamily(route({ upstream_operation: 'chat' })), 'openai_chat');
		assert.equal(resolvePlaygroundLlmFamily(route({ upstream_operation: 'responses' })), 'openai_responses');
		assert.equal(
			resolvePlaygroundLlmFamily(route({ upstream_protocol: 'anthropic', upstream_operation: 'messages' })),
			'anthropic',
		);
		assert.equal(
			resolvePlaygroundLlmFamily(route({ upstream_protocol: 'gemini', upstream_operation: 'generateContent' })),
			'gemini',
		);
		assert.equal(resolvePlaygroundLlmFamily(route({ upstream_operation: 'images.generations' })), 'openai_chat');
		assert.equal(
			playgroundLlmFamilyForRoute(route({ upstream_operation: 'images.generations' }), { isImage: true }),
			null,
		);
		assert.equal(playgroundLlmFamilyForRoute(route({ upstream_protocol: 'anthropic' }), { isImage: true }), null);
	});

	it('isPlaygroundBodyDirty ignores whitespace-only edits', () => {
		assert.equal(isPlaygroundBodyDirty(BODY_TEMPLATES.openai, BODY_TEMPLATES.openai), false);
		assert.equal(isPlaygroundBodyDirty(`  ${BODY_TEMPLATES.openai}  `, BODY_TEMPLATES.openai), false);
		assert.equal(isPlaygroundBodyDirty('{ "messages": [] }', BODY_TEMPLATES.openai), true);
	});
});
