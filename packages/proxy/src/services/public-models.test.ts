import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { GatewayRepositories, ModelRow, ModelRouteJoinRow } from '@octafuse/core';
import {
	groupActiveRoutesByModel,
	loadPublicModelListContext,
	resetPublicModelListContextCacheForTests,
} from './public-models';

function model(id: string): ModelRow {
	return {
		id,
		display_name: id,
		vendor: 'other',
		context_window: 128000,
		max_tokens: 8192,
		pricing_profile: null,
		tags: '[]',
		description: null,
		metadata: null,
		input_modalities: '["text"]',
		output_modalities: '["text"]',
		released_at: null,
		created_at: '2026-08-26T12:19:56.000Z',
	};
}

function route(modelId: string, status: string): ModelRouteJoinRow {
	return {
		id: `${modelId}-${status}`,
		model_id: modelId,
		provider_id: 'p1',
		provider_model_name: modelId,
		priority: 10,
		status,
		route_group: 'default',
		weight: 1,
		price_override: null,
		custom_params: null,
		upstream_protocol: 'openai',
		route_pool_id: 'pool-1',
		upstream_operation: 'chat.completions',
		adapter: 'passthrough',
		surfaces: null,
		pool_name: null,
		pool_strategy: null,
		pool_tier_strategies: null,
		pool_status: 'active',
		model_name: modelId,
		provider_name: 'p1',
	};
}

function mockRepos(options?: {
	models?: ModelRow[];
	routes?: ModelRouteJoinRow[];
	onListRoutes?: (filters: unknown) => void;
	gate?: Promise<void>;
}): { repos: GatewayRepositories; counts: { models: number; routes: number; timezone: number } } {
	const counts = { models: 0, routes: 0, timezone: 0 };
	const repos = {
		modelRouting: {
			listModelsWithActiveRoutes: async () => {
				counts.models += 1;
				if (options?.gate) await options.gate;
				return options?.models ?? [model('gpt-4o')];
			},
		},
		routes: {
			listModelRoutesWithJoins: async (filters: unknown) => {
				counts.routes += 1;
				options?.onListRoutes?.(filters);
				return options?.routes ?? [route('gpt-4o', 'active')];
			},
		},
		systemConfig: {
			getConfig: async (key: string) => {
				if (key === 'BUSINESS_TIMEZONE') {
					counts.timezone += 1;
					return 'UTC';
				}
				return null;
			},
		},
	} as unknown as GatewayRepositories;
	return { repos, counts };
}

describe('groupActiveRoutesByModel', () => {
	it('drops inactive routes and groups by model id', () => {
		const map = groupActiveRoutesByModel([
			route('gpt-4o', 'active'),
			route('gpt-4o', 'inactive'),
			route('claude', 'active'),
		]);
		assert.equal(map.get('gpt-4o')?.length, 1);
		assert.equal(map.get('gpt-4o')?.[0]?.status, 'active');
		assert.equal(map.get('claude')?.length, 1);
		assert.equal(map.has('missing'), false);
	});
});

describe('loadPublicModelListContext', () => {
	beforeEach(() => {
		resetPublicModelListContextCacheForTests();
	});

	it('loads active routes only and caches models + routes + timezone', async () => {
		const seenFilters: unknown[] = [];
		const { repos, counts } = mockRepos({
			routes: [route('gpt-4o', 'active'), route('gpt-4o', 'inactive')],
			onListRoutes: (filters) => seenFilters.push(filters),
		});
		const first = await loadPublicModelListContext(repos);
		const second = await loadPublicModelListContext(repos);

		assert.deepEqual(seenFilters, [{ status: 'active' }]);
		assert.equal(counts.models, 1);
		assert.equal(counts.routes, 1);
		assert.equal(counts.timezone, 1);
		assert.equal(first.timezone, 'UTC');
		assert.equal(first.routesByModel.get('gpt-4o')?.length, 1);
		assert.equal(first, second);
	});

	it('coalesces concurrent misses into one fetch', async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { repos, counts } = mockRepos({ gate });
		const pending = Promise.all([loadPublicModelListContext(repos), loadPublicModelListContext(repos)]);
		release();
		const [a, b] = await pending;
		assert.equal(counts.models, 1);
		assert.equal(counts.routes, 1);
		assert.equal(a, b);
	});
});
