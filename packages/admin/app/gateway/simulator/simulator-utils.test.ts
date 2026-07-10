import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	buildModelRoutingString,
	buildRequestLogsHref,
	filterMatchingActiveRoutes,
	isBodyDirty,
	redactAuthHeader,
	routeGroupMatchesSelection,
} from './simulator-utils';
import type { RouteListRow } from './types';

describe('simulator-utils', () => {
	it('buildModelRoutingString omits default group', () => {
		assert.equal(buildModelRoutingString('gpt-4', ''), 'gpt-4');
		assert.equal(buildModelRoutingString('gpt-4', 'default'), 'gpt-4');
		assert.equal(buildModelRoutingString('gpt-4', 'vip'), 'gpt-4:vip');
	});

	it('routeGroupMatchesSelection treats empty as default', () => {
		assert.equal(routeGroupMatchesSelection('default', ''), true);
		assert.equal(routeGroupMatchesSelection('', ''), true);
		assert.equal(routeGroupMatchesSelection('vip', ''), false);
		assert.equal(routeGroupMatchesSelection('vip', 'vip'), true);
	});

	it('filterMatchingActiveRoutes filters and sorts by priority desc', () => {
		const routes: RouteListRow[] = [
			{
				id: 'a',
				model_id: 'm1',
				provider_id: 'p1',
				priority: 1,
				status: 'active',
				route_group: 'default',
			},
			{
				id: 'b',
				model_id: 'm1',
				provider_id: 'p2',
				priority: 10,
				status: 'active',
				route_group: 'default',
			},
			{
				id: 'c',
				model_id: 'm1',
				provider_id: 'p3',
				priority: 5,
				status: 'inactive',
				route_group: 'default',
			},
			{
				id: 'd',
				model_id: 'm1',
				provider_id: 'p4',
				priority: 99,
				status: 'active',
				route_group: 'vip',
			},
		];
		const matched = filterMatchingActiveRoutes(routes, 'm1', '');
		assert.deepEqual(
			matched.map((r) => r.id),
			['b', 'a']
		);
	});

	it('redactAuthHeader masks sk keys', () => {
		assert.match(redactAuthHeader('Bearer sk-abcdefghijklmnop1234'), /^Bearer sk-abcdefghi…1234$/);
	});

	it('buildRequestLogsHref includes filters', () => {
		assert.equal(
			buildRequestLogsHref({
				apiKeyId: 'k1',
				modelId: 'm1',
				routeGroup: 'vip',
				protocol: 'openai',
			}),
			'/gateway/request-logs?api_key_id=k1&model_id=m1&route_group=vip&protocol=openai'
		);
		assert.equal(buildRequestLogsHref({ routeGroup: 'default' }), '/gateway/request-logs');
	});

	it('isBodyDirty detects edits', () => {
		assert.equal(
			isBodyDirty(
				`{
  "model": "<auto>",
  "messages": [{ "role": "user", "content": "Hello" }],
  "max_tokens": 256,
  "stream": true,
  "stream_options": { "include_usage": true }
}`,
				'openai'
			),
			false
		);
		assert.equal(isBodyDirty('{ "messages": [] }', 'openai'), true);
	});
});
