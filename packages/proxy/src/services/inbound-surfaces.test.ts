import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ModelRouteJoinRow } from '@octafuse/core';
import { collectLlmInboundSurfaces } from './inbound-surfaces';

const route = (overrides: Partial<ModelRouteJoinRow> & { surfaces: string }): ModelRouteJoinRow => ({
	id: 'r1',
	model_id: 'glm-4',
	provider_id: 'p1',
	provider_model_name: 'glm-4',
	priority: 10,
	status: 'active',
	route_group: 'default',
	price_override: null,
	custom_params: null,
	upstream_protocol: 'openai',
	route_pool_id: 'pool-1',
	upstream_operation: 'chat',
	adapter: 'passthrough',
	pool_name: null,
	pool_strategy: null,
	pool_tier_strategies: null,
	pool_status: null,
	model_name: 'GLM-4',
	provider_name: 'OpenAI',
	...overrides,
});

const surfaces = (...rows: Array<Record<string, string>>): string => JSON.stringify(rows);

describe('collectLlmInboundSurfaces', () => {
	it('returns chat-only inbound', () => {
		const catalog = collectLlmInboundSurfaces(
			[route({ surfaces: surfaces({ request_protocol: 'openai', request_operation: 'chat', status: 'active' }) })],
			['default', 'free'],
		);
		assert.deepEqual(catalog, [{ protocol: 'openai', operation: 'chat' }]);
	});

	it('returns responses-only inbound', () => {
		const catalog = collectLlmInboundSurfaces(
			[route({
				surfaces: surfaces({ request_protocol: 'openai', request_operation: 'responses', status: 'active' }),
			})],
			['default'],
		);
		assert.deepEqual(catalog, [{ protocol: 'openai', operation: 'responses' }]);
	});

	it('lists responses before chat when both exist', () => {
		const catalog = collectLlmInboundSurfaces(
			[route({
				surfaces: surfaces(
					{ request_protocol: 'openai', request_operation: 'chat', status: 'active' },
					{ request_protocol: 'openai', request_operation: 'responses', status: 'active' },
				),
			})],
			['default'],
		);
		assert.deepEqual(catalog, [
			{ protocol: 'openai', operation: 'responses' },
			{ protocol: 'openai', operation: 'chat' },
		]);
	});

	it('drops wildcard when the same protocol already has an exact operation', () => {
		const catalog = collectLlmInboundSurfaces(
			[route({
				surfaces: surfaces(
					{ request_protocol: 'openai', request_operation: '*', status: 'active' },
					{ request_protocol: 'openai', request_operation: 'responses', status: 'active' },
				),
			})],
			['default'],
		);
		assert.deepEqual(catalog, [{ protocol: 'openai', operation: 'responses' }]);
	});

	it('expands a lone openai wildcard to chat', () => {
		const catalog = collectLlmInboundSurfaces(
			[route({ surfaces: surfaces({ request_protocol: 'openai', request_operation: '*', status: 'active' }) })],
			['default'],
		);
		assert.deepEqual(catalog, [{ protocol: 'openai', operation: 'chat' }]);
	});

	it('maps Gemini generate-content family and legacy wire actions', () => {
		const catalog = collectLlmInboundSurfaces(
			[route({
				surfaces: surfaces({
					request_protocol: 'gemini',
					request_operation: 'streamGenerateContent',
					status: 'active',
				}),
			})],
			['default'],
		);
		assert.deepEqual(catalog, [{ protocol: 'gemini', operation: 'models.generate' }]);
	});

	it('ignores images and audio operations', () => {
		const catalog = collectLlmInboundSurfaces(
			[route({
				surfaces: surfaces(
					{ request_protocol: 'openai', request_operation: 'images.generations', status: 'active' },
					{ request_protocol: 'openai', request_operation: 'audio.transcriptions', status: 'active' },
				),
			})],
			['default'],
		);
		assert.deepEqual(catalog, []);
	});

	it('skips disabled surfaces and routes outside the allowlist', () => {
		const catalog = collectLlmInboundSurfaces(
			[
				route({
					surfaces: surfaces({ request_protocol: 'openai', request_operation: 'chat', status: 'disabled' }),
				}),
				route({
					id: 'r2',
					route_group: 'web',
					surfaces: surfaces({ request_protocol: 'anthropic', request_operation: 'messages', status: 'active' }),
				}),
			],
			['default', 'free'],
		);
		assert.deepEqual(catalog, []);
	});

	it('returns empty inbound when there are no surfaces', () => {
		const catalog = collectLlmInboundSurfaces(
			[route({ surfaces: '[]' }), route({ id: 'r2', surfaces: 'not-json' })],
			['default'],
		);
		assert.deepEqual(catalog, []);
	});
});
