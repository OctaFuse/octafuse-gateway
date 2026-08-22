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
	playgroundLlmSampleBody,
	previewPlaygroundMergedBody,
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
			toolConfig?: { functionCallingConfig?: { mode?: string; streamFunctionCallArguments?: boolean } };
		};
		assert.equal(gemini.tools?.[0]?.functionDeclarations?.[0]?.name, 'write_note');
		assert.equal(gemini.tools?.[0]?.functionDeclarations?.[0]?.parameters?.additionalProperties, undefined);
		assert.equal(gemini.toolConfig?.functionCallingConfig?.mode, 'ANY');
		assert.equal(gemini.toolConfig?.functionCallingConfig?.streamFunctionCallArguments, true);
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

	it('Claude reasoning samples follow Anthropic thinking modes by model generation', () => {
		const parse = (modelId: string, providerModelName = modelId) =>
			JSON.parse(
				playgroundLlmSampleBody('anthropic', 'reasoning', { modelId, providerModelName }),
			) as {
				thinking?: { type?: string; budget_tokens?: number; display?: string };
				output_config?: { effort?: string };
			};

		const haiku45 = parse('claude-haiku-4.5', 'claude-haiku-4-5-20251001');
		assert.equal(haiku45.thinking?.type, 'enabled');
		assert.equal(haiku45.thinking?.budget_tokens, 1024);
		assert.equal(haiku45.output_config, undefined);

		const sonnet45 = parse('claude-sonnet-4.5', 'claude-sonnet-4-5-20250929');
		assert.equal(sonnet45.thinking?.type, 'enabled');
		assert.equal(sonnet45.output_config, undefined);

		const opus45 = parse('claude-opus-4.5', 'claude-opus-4-5-20251101');
		assert.equal(opus45.thinking?.type, 'enabled');
		assert.equal(opus45.thinking?.budget_tokens, 1024);
		assert.equal(opus45.output_config?.effort, 'medium');

		const sonnet46 = parse('claude-sonnet-4.6', 'claude-sonnet-4-6');
		assert.equal(sonnet46.thinking?.type, 'adaptive');
		assert.equal(sonnet46.thinking?.display, 'summarized');
		assert.equal(sonnet46.output_config?.effort, 'high');
		assert.equal(sonnet46.thinking?.budget_tokens, undefined);

		const opus47 = parse('claude-opus-4.7', 'claude-opus-4-7');
		assert.equal(opus47.thinking?.type, 'adaptive');
		assert.equal(opus47.output_config?.effort, 'high');

		const opus5 = parse('claude-opus-5');
		assert.equal(opus5.thinking?.type, 'adaptive');
		assert.equal(opus5.thinking?.display, 'summarized');

		const fable5 = parse('claude-fable-5');
		assert.equal(fable5.thinking?.type, 'adaptive');

		const sonnet4 = parse('claude-sonnet-4', 'claude-sonnet-4-20250514');
		assert.equal(sonnet4.thinking?.type, 'enabled');
		assert.equal(sonnet4.output_config, undefined);

		const sonnet37 = parse('claude-3.7-sonnet', 'claude-3-7-sonnet-20250219');
		assert.equal(sonnet37.thinking?.type, 'enabled');
		assert.equal(sonnet37.output_config, undefined);

		assert.equal(
			matchPlaygroundLlmSample(
				'anthropic',
				playgroundLlmSampleBody('anthropic', 'reasoning', { modelId: 'claude-opus-4.8' }),
				{ modelId: 'claude-opus-4.8' },
			),
			'reasoning',
		);
	});

	it('Gemini reasoning samples use thinkingBudget on 2.5 and thinkingLevel on 3+', () => {
		const gemini25 = JSON.parse(
			playgroundLlmSampleBody('gemini', 'reasoning', { modelId: 'gemini-2.5-pro' }),
		) as { generationConfig?: { thinkingConfig?: { thinkingBudget?: number; thinkingLevel?: string } } };
		assert.equal(gemini25.generationConfig?.thinkingConfig?.thinkingBudget, 1024);
		assert.equal(gemini25.generationConfig?.thinkingConfig?.thinkingLevel, undefined);

		const gemini35 = JSON.parse(
			playgroundLlmSampleBody('gemini', 'reasoning', { modelId: 'gemini-3.5-flash' }),
		) as { generationConfig?: { thinkingConfig?: { thinkingBudget?: number; thinkingLevel?: string } } };
		assert.equal(gemini35.generationConfig?.thinkingConfig?.thinkingLevel, 'MEDIUM');
		assert.equal(gemini35.generationConfig?.thinkingConfig?.thinkingBudget, undefined);
	});

	it('omits Chat Completions reasoning_effort for GPT-4o', () => {
		const gpt4o = JSON.parse(
			playgroundLlmSampleBody('openai_chat', 'reasoning', { modelId: 'gpt-4o' }),
		) as { reasoning_effort?: string; max_tokens?: number; max_completion_tokens?: number };
		assert.equal(gpt4o.reasoning_effort, undefined);
		assert.equal(gpt4o.max_tokens, 1024);
		const gpt5 = JSON.parse(
			playgroundLlmSampleBody('openai_chat', 'reasoning', { modelId: 'gpt-5.4' }),
		) as { reasoning_effort?: string; max_tokens?: number; max_completion_tokens?: number };
		assert.equal(gpt5.reasoning_effort, 'medium');
		assert.equal(gpt5.max_completion_tokens, 4096);
		assert.equal(gpt5.max_tokens, undefined);
	});

	it('uses OpenAI-compat vendor thinking fields for DeepSeek, GLM, Qwen, MiniMax, and Kimi', () => {
		const deepseek = JSON.parse(
			playgroundLlmSampleBody('openai_chat', 'reasoning', { modelId: 'deepseek-v4-pro' }),
		) as { thinking?: { type?: string }; reasoning_effort?: string };
		assert.equal(deepseek.thinking?.type, 'enabled');
		assert.equal(deepseek.reasoning_effort, 'high');

		const glm5 = JSON.parse(
			playgroundLlmSampleBody('openai_chat', 'reasoning', { modelId: 'glm-5' }),
		) as { thinking?: { type?: string }; reasoning_effort?: string };
		assert.equal(glm5.thinking?.type, 'enabled');
		assert.equal(glm5.reasoning_effort, undefined);

		const glm52 = JSON.parse(
			playgroundLlmSampleBody('openai_chat', 'reasoning', { modelId: 'glm-5.2' }),
		) as { thinking?: { type?: string }; reasoning_effort?: string };
		assert.equal(glm52.thinking?.type, 'enabled');
		assert.equal(glm52.reasoning_effort, 'high');

		const qwen = JSON.parse(
			playgroundLlmSampleBody('openai_chat', 'reasoning', { modelId: 'qwen3.8-max' }),
		) as { enable_thinking?: boolean; reasoning_effort?: string; thinking?: unknown };
		assert.equal(qwen.enable_thinking, true);
		assert.equal(qwen.reasoning_effort, 'medium');
		assert.equal(qwen.thinking, undefined);

		const minimax = JSON.parse(
			playgroundLlmSampleBody('openai_chat', 'reasoning', { modelId: 'minimax-m2.7' }),
		) as { reasoning_split?: boolean; thinking?: { type?: string }; reasoning_effort?: string };
		assert.equal(minimax.reasoning_split, true);
		assert.equal(minimax.thinking?.type, 'adaptive');
		assert.equal(minimax.reasoning_effort, undefined);

		const kimi = JSON.parse(
			playgroundLlmSampleBody('openai_chat', 'reasoning', { modelId: 'kimi-k2.5' }),
		) as { thinking?: { type?: string } };
		assert.equal(kimi.thinking?.type, 'enabled');

		const doubao = JSON.parse(
			playgroundLlmSampleBody('openai_chat', 'reasoning', { modelId: 'doubao-seed-2-1-pro-260628' }),
		) as { thinking?: { type?: string } };
		assert.equal(doubao.thinking?.type, 'enabled');
	});

	it('uses max_completion_tokens for GPT-5 connectivity and omits Gemini 2.5 tool arg streaming', () => {
		const gpt5 = JSON.parse(
			playgroundLlmSampleBody('openai_chat', 'connectivity', { modelId: 'gpt-5.4' }),
		) as { max_completion_tokens?: number; max_tokens?: number };
		assert.equal(gpt5.max_completion_tokens, 256);
		assert.equal(gpt5.max_tokens, undefined);

		const gemini25 = JSON.parse(
			playgroundLlmSampleBody('gemini', 'tools', { modelId: 'gemini-2.5-flash' }),
		) as { toolConfig?: { functionCallingConfig?: { streamFunctionCallArguments?: boolean } } };
		assert.equal(gemini25.toolConfig?.functionCallingConfig?.streamFunctionCallArguments, undefined);

		const gemini3 = JSON.parse(
			playgroundLlmSampleBody('gemini', 'tools', { modelId: 'gemini-3.5-flash' }),
		) as { toolConfig?: { functionCallingConfig?: { streamFunctionCallArguments?: boolean } } };
		assert.equal(gemini3.toolConfig?.functionCallingConfig?.streamFunctionCallArguments, true);
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

	it('previewPlaygroundMergedBody merges custom_params with user fields winning', () => {
		const result = previewPlaygroundMergedBody({
			bodyText: JSON.stringify({ model: 'glm-5.3', stream: true, messages: [] }),
			customParams: JSON.stringify({ tool_stream: true, stream: false }),
			upstreamProtocol: 'openai',
			providerModelName: 'glm-5.3-upstream',
		});
		assert.equal(result.status, 'preview');
		const body = JSON.parse(result.json) as {
			tool_stream?: boolean;
			stream?: boolean;
			model?: string;
		};
		assert.equal(body.tool_stream, true);
		assert.equal(body.stream, true);
		assert.equal(body.model, 'glm-5.3-upstream');
	});

	it('previewPlaygroundMergedBody deep-merges nested custom_params objects', () => {
		const result = previewPlaygroundMergedBody({
			bodyText: JSON.stringify({ parameters: { temperature: 0.2 } }),
			customParams: JSON.stringify({ parameters: { temperature: 0.8, tool_stream: true } }),
			upstreamProtocol: 'dashscope',
			providerModelName: 'qwen-audio',
		});
		assert.equal(result.status, 'preview');
		const body = JSON.parse(result.json) as {
			model?: string;
			parameters?: { temperature?: number; tool_stream?: boolean };
		};
		assert.equal(body.model, 'qwen-audio');
		assert.equal(body.parameters?.temperature, 0.2);
		assert.equal(body.parameters?.tool_stream, true);
	});

	it('previewPlaygroundMergedBody does not rewrite Gemini model and rejects invalid JSON', () => {
		const preview = previewPlaygroundMergedBody({
			bodyText: JSON.stringify({ contents: [] }),
			customParams: JSON.stringify({ generationConfig: { thinkingConfig: { includeThoughts: true } } }),
			upstreamProtocol: 'gemini',
			providerModelName: 'gemini-3.1-pro',
		});
		assert.equal(preview.status, 'preview');
		const body = JSON.parse(preview.json) as { model?: string; generationConfig?: unknown };
		assert.equal(body.model, undefined);
		assert.ok(body.generationConfig);
		assert.equal(previewPlaygroundMergedBody({ bodyText: '{not json' }).status, 'invalid');
	});
});
