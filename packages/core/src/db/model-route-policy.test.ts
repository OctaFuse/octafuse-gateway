import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	DEFAULT_ROUTE_STRATEGY,
	isRouteStrategyName,
	normalizeModelRoutePolicyInput,
	parseModelRoutePolicy,
	resolveModelRoutePolicyStrategy,
	routePolicyRuleKey,
} from './model-route-policy';

describe('routePolicyRuleKey / isRouteStrategyName', () => {
	it('builds protocol and capability keys', () => {
		assert.equal(routePolicyRuleKey('OpenAI', null, 'Default'), 'openai:default');
		assert.equal(routePolicyRuleKey('openai', 'Chat', 'free'), 'openai.chat:free');
	});

	it('recognizes strategy names', () => {
		assert.equal(isRouteStrategyName('hash_affinity'), true);
		assert.equal(isRouteStrategyName(DEFAULT_ROUTE_STRATEGY), true);
		assert.equal(isRouteStrategyName('sticky'), false);
	});
});

describe('parseModelRoutePolicy', () => {
	it('returns null for empty / invalid / empty-content configs', () => {
		assert.equal(parseModelRoutePolicy(null), null);
		assert.equal(parseModelRoutePolicy(''), null);
		assert.equal(parseModelRoutePolicy('not json'), null);
		assert.equal(parseModelRoutePolicy('{"rules":{}}'), null);
		assert.equal(parseModelRoutePolicy('{"strategy":"nope"}'), null);
	});

	it('parses top-level strategy and rules', () => {
		const config = parseModelRoutePolicy(
			JSON.stringify({
				strategy: 'hash_affinity',
				rules: {
					'openai:default': { strategy: 'weighted_random' },
					'openai.chat:default': { strategy: 'weight_priority' },
				},
			})
		);
		assert.ok(config);
		assert.equal(config!.strategy, 'hash_affinity');
		assert.equal(config!.rules.get('openai:default')?.strategy, 'weighted_random');
		assert.equal(config!.rules.get('openai.chat:default')?.strategy, 'weight_priority');
	});

	it('aliases legacy Gemini capabilities onto models.generate with generateContent preferred', () => {
		const config = parseModelRoutePolicy(
			JSON.stringify({
				rules: {
					'gemini.streamGenerateContent:default': { strategy: 'weighted_random' },
					'gemini.generateContent:default': { strategy: 'weight_priority' },
				},
			})
		);
		assert.ok(config);
		assert.equal(config!.rules.get('gemini.models.generate:default')?.strategy, 'weight_priority');
		assert.equal(config!.rules.has('gemini.generatecontent:default'), false);
		assert.equal(
			resolveModelRoutePolicyStrategy(
				JSON.stringify({
					rules: {
						'gemini.generateContent:default': { strategy: 'weight_priority' },
					},
				}),
				'gemini',
				'generateContent',
				'default'
			),
			'weight_priority'
		);
		assert.equal(
			resolveModelRoutePolicyStrategy(
				JSON.stringify({
					rules: {
						'gemini.generateContent:default': { strategy: 'weight_priority' },
					},
				}),
				'gemini',
				'models.generate',
				'default'
			),
			'weight_priority'
		);
	});

	it('accepts DashScope audio capabilities', () => {
		// 使用 2.3.0 仍支持的策略名，测试聚焦协议 capability 而非已移除的旧策略。
		const config = parseModelRoutePolicy(
			JSON.stringify({
				rules: {
				'dashscope.audio.speech:default': { strategy: 'weight_priority' },
				},
			})
		);
		assert.equal(config?.rules.get('dashscope.audio.speech:default')?.strategy, 'weight_priority');
	});

	it('skips illegal strategy and illegal capability keys', () => {
		const config = parseModelRoutePolicy(
			JSON.stringify({
				strategy: 'weighted_round_robin',
				rules: {
					'openai:default': { strategy: 'bad' },
					'openai.messages:default': { strategy: 'weight_priority' },
					'openai.chat:default': { strategy: 'weight_priority' },
				},
			})
		);
		assert.ok(config);
		assert.equal(config!.strategy, 'weighted_round_robin');
		assert.equal(config!.rules.has('openai:default'), false);
		assert.equal(config!.rules.has('openai.messages:default'), false);
		assert.equal(config!.rules.get('openai.chat:default')?.strategy, 'weight_priority');
	});
});

describe('resolveModelRoutePolicyStrategy', () => {
	const raw = JSON.stringify({
		strategy: 'hash_affinity',
		rules: {
			'openai:default': { strategy: 'weighted_random' },
			'openai.chat:default': { strategy: 'weight_priority' },
		},
	});

	it('lets capability rule beat protocol wildcard', () => {
		assert.equal(resolveModelRoutePolicyStrategy(raw, 'openai', 'chat', 'default'), 'weight_priority');
	});

	it('falls back to protocol×group then top-level', () => {
		assert.equal(
			resolveModelRoutePolicyStrategy(raw, 'openai', 'images.generations', 'default'),
			'weighted_random'
		);
		assert.equal(resolveModelRoutePolicyStrategy(raw, 'anthropic', 'messages', 'default'), 'hash_affinity');
	});

	it('returns null when nothing configured', () => {
		assert.equal(resolveModelRoutePolicyStrategy(null, 'openai', 'chat', 'default'), null);
		assert.equal(resolveModelRoutePolicyStrategy('{}', 'openai', 'chat', 'default'), null);
	});
});

describe('normalizeModelRoutePolicyInput', () => {
	it('returns null for empty input', () => {
		assert.equal(normalizeModelRoutePolicyInput(null), null);
		assert.equal(normalizeModelRoutePolicyInput('  '), null);
	});

	it('normalizes keys and strategies', () => {
		const out = normalizeModelRoutePolicyInput(
			JSON.stringify({
				strategy: 'Hash_Affinity',
				rules: {
					'OpenAI.Chat:Default': { strategy: 'Weight_Priority', junk: 1 },
				},
			})
		);
		assert.deepEqual(JSON.parse(out!), {
			strategy: 'hash_affinity',
			rules: { 'openai.chat:default': { strategy: 'weight_priority' } },
		});
	});

	it('throws for illegal strategy / capability / empty content', () => {
		assert.throws(() => normalizeModelRoutePolicyInput('nope'), /valid JSON/);
		assert.throws(
			() => normalizeModelRoutePolicyInput('{"strategy":"sticky"}'),
			/strategy must be one of/
		);
		assert.throws(
			() =>
				normalizeModelRoutePolicyInput(
					JSON.stringify({ rules: { 'openai.messages:default': { strategy: 'weight_priority' } } })
				),
			/capability/
		);
		assert.throws(() => normalizeModelRoutePolicyInput('{"rules":{}}'), /at least one rule/);
	});
});
