import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildRouteRequestBody } from './route-default-params';
import type { RouteResult } from './model-router';

function route(customParams: Record<string, unknown> | null): RouteResult {
	return {
		targetId: 't1',
		modelSurfaceId: 's1',
		routePoolId: 'p1',
		providerId: 'prov1',
		providerName: 'OpenAI',
		providerModelName: 'gpt-4o-mini',
		upstreamProtocol: 'openai',
		upstreamOperation: 'chat',
		adapter: 'passthrough',
		providerEndpoints: { openai: { base: 'https://api.openai.com/v1' } },
		providerApiKey: 'sk-test',
		priceOverrideRaw: null,
		routeMeteredProfileJson: null,
		routeChargedProfileJson: null,
		customParams,
		routeGroup: 'default',
		routePriority: 0,
		routeWeight: 1,
	};
}

describe('buildRouteRequestBody', () => {
	it('strips custom_params.headers from the upstream JSON body', () => {
		const body = buildRouteRequestBody(
			route({
				temperature: 0.7,
				headers: { 'HTTP-Referer': 'https://example.com' },
			}),
			{ messages: [] },
		);
		assert.equal(body.temperature, 0.7);
		assert.equal(body.headers, undefined);
		assert.deepEqual(body.messages, []);
	});
});
