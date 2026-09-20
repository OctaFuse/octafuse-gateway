import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ModelRouteJoinRow } from '@octafuse/core';
import { collectInboundSurfaces } from './inbound-surfaces';

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

describe('collectInboundSurfaces', () => {
	it('returns chat-only inbound', () => {
		const catalog = collectInboundSurfaces(
			[route({ surfaces: surfaces({ request_protocol: 'openai', request_operation: 'chat', status: 'active' }) })],
			['default', 'free'],
		);
		assert.deepEqual(catalog, [{ protocol: 'openai', operation: 'chat' }]);
	});

	it('returns responses-only inbound', () => {
		const catalog = collectInboundSurfaces(
			[route({
				surfaces: surfaces({ request_protocol: 'openai', request_operation: 'responses', status: 'active' }),
			})],
			['default'],
		);
		assert.deepEqual(catalog, [{ protocol: 'openai', operation: 'responses' }]);
	});

	it('lists responses before chat when both exist', () => {
		const catalog = collectInboundSurfaces(
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
		const catalog = collectInboundSurfaces(
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
		const catalog = collectInboundSurfaces(
			[route({ surfaces: surfaces({ request_protocol: 'openai', request_operation: '*', status: 'active' }) })],
			['default'],
		);
		assert.deepEqual(catalog, [{ protocol: 'openai', operation: 'chat' }]);
	});

	it('maps Gemini generate-content family and legacy wire actions', () => {
		const catalog = collectInboundSurfaces(
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

	it('lists image and audio operations after LLM text', () => {
		const catalog = collectInboundSurfaces(
			[route({
				surfaces: surfaces(
					{ request_protocol: 'openai', request_operation: 'chat', status: 'active' },
					{ request_protocol: 'openai', request_operation: 'images.generations', status: 'active' },
					{ request_protocol: 'openai', request_operation: 'audio.transcriptions', status: 'active' },
					{ request_protocol: 'openai', request_operation: 'audio.speech', status: 'active' },
				),
			})],
			['default'],
		);
		assert.deepEqual(catalog, [
			{ protocol: 'openai', operation: 'chat' },
			{ protocol: 'openai', operation: 'images.generations' },
			{ protocol: 'openai', operation: 'audio.transcriptions' },
			{ protocol: 'openai', operation: 'audio.speech' },
		]);
	});

	it('lists image and audio operations without LLM text', () => {
		const catalog = collectInboundSurfaces(
			[route({
				surfaces: surfaces(
					{ request_protocol: 'openai', request_operation: 'images.generations', status: 'active' },
					{ request_protocol: 'openai', request_operation: 'audio.speech', status: 'active' },
				),
			})],
			['default'],
		);
		assert.deepEqual(catalog, [
			{ protocol: 'openai', operation: 'images.generations' },
			{ protocol: 'openai', operation: 'audio.speech' },
		]);
	});

	it('does not list images.edits or dashscope-only operations', () => {
		const catalog = collectInboundSurfaces(
			[route({
				surfaces: surfaces(
					{ request_protocol: 'openai', request_operation: 'images.edits', status: 'active' },
					{ request_protocol: 'dashscope', request_operation: 'audio.transcriptions.multimodal', status: 'active' },
				),
			})],
			['default'],
		);
		assert.deepEqual(catalog, []);
	});

	it('does not expand wildcard to chat when the protocol already has image or audio', () => {
		const catalog = collectInboundSurfaces(
			[route({
				surfaces: surfaces(
					{ request_protocol: 'openai', request_operation: '*', status: 'active' },
					{ request_protocol: 'openai', request_operation: 'images.generations', status: 'active' },
				),
			})],
			['default'],
		);
		assert.deepEqual(catalog, [{ protocol: 'openai', operation: 'images.generations' }]);
	});

	it('skips disabled surfaces and routes outside the allowlist', () => {
		const catalog = collectInboundSurfaces(
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
		const catalog = collectInboundSurfaces(
			[route({ surfaces: '[]' }), route({ id: 'r2', surfaces: 'not-json' })],
			['default'],
		);
		assert.deepEqual(catalog, []);
	});
});
