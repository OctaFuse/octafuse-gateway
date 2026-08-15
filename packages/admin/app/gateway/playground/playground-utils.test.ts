import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	BODY_TEMPLATES,
	isPlaygroundBodyDirty,
	routeMatchesSearch,
	templateForRoute,
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

	it('isPlaygroundBodyDirty ignores whitespace-only edits', () => {
		assert.equal(isPlaygroundBodyDirty(BODY_TEMPLATES.openai, BODY_TEMPLATES.openai), false);
		assert.equal(isPlaygroundBodyDirty(`  ${BODY_TEMPLATES.openai}  `, BODY_TEMPLATES.openai), false);
		assert.equal(isPlaygroundBodyDirty('{ "messages": [] }', BODY_TEMPLATES.openai), true);
	});
});
