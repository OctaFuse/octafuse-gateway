import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import type { GatewayRepositories, ModelRow, ModelRouteJoinRow, UserRow } from '@octafuse/core';
import { resetUserChargedCostFactorModeCacheForTests } from '@octafuse/core';
import { AdminServiceError } from './errors';
import {
	getAdminUserDisplayDiscounts,
	parseDisplayDiscountRouteGroupsQuery,
} from './user-display-discounts';

const USER_ID = '8c523806-1959-41eb-bfd7-8c5bd307e99a';

function baseUser(overrides: Partial<UserRow> = {}): UserRow {
	return {
		id: USER_ID,
		email: 'ops@example.com',
		budget_max: 9.9,
		budget_base: 9.9,
		budget_spent: 0,
		budget_period: 'none',
		budget_reset_at: null,
		wallet_granted: 0,
		wallet_spent: 0,
		status: 'active',
		metadata: null,
		rate_limit: null,
		charged_cost_factors: null,
		external_system: 'octarouter',
		external_user_id: USER_ID,
		created_at: '2026-08-26T12:19:56.000Z',
		updated_at: '2026-08-26T12:19:56.000Z',
		...overrides,
	};
}

function model(id: string): ModelRow {
	return {
		id,
		display_name: id,
		vendor: 'other',
		context_window: 128000,
		max_tokens: 8192,
		pricing_profile: JSON.stringify({
			tiers: [{ upto: null, label: null, input_price: 1, output_price: 1 }],
		}),
		tags: '[]',
		description: null,
		metadata: null,
		input_modalities: '["text"]',
		output_modalities: '["text"]',
		released_at: null,
		created_at: '2026-08-26T12:19:56.000Z',
	};
}

function route(modelId: string, group: string, chargedFactor: number): ModelRouteJoinRow {
	return {
		id: `${modelId}-${group}`,
		model_id: modelId,
		provider_id: 'p1',
		provider_model_name: modelId,
		priority: 10,
		status: 'active',
		route_group: group,
		weight: 1,
		price_override: JSON.stringify({ charged_factor: chargedFactor }),
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

function mockRepos(options: {
	user: UserRow | null;
	models: ModelRow[];
	routes: ModelRouteJoinRow[];
	mode?: string | null;
}): GatewayRepositories {
	return {
		users: {
			getById: async (id: string) => (options.user && id === options.user.id ? options.user : null),
			getByExternalPair: async () => options.user,
		},
		modelRouting: {
			listModelsWithActiveRoutes: async () => options.models,
		},
		routes: {
			listModelRoutesWithJoins: async () => options.routes,
		},
		systemConfig: {
			getConfig: async (key: string) => {
				if (key === 'BUSINESS_TIMEZONE') return 'UTC';
				if (key === 'USER_CHARGED_COST_FACTOR_MODE') return options.mode ?? 'multiply';
				return null;
			},
		},
	} as unknown as GatewayRepositories;
}

describe('parseDisplayDiscountRouteGroupsQuery', () => {
	it('treats empty as all groups', () => {
		assert.equal(parseDisplayDiscountRouteGroupsQuery(undefined), null);
		assert.equal(parseDisplayDiscountRouteGroupsQuery(''), null);
		assert.equal(parseDisplayDiscountRouteGroupsQuery(' , '), null);
	});

	it('parses a csv allowlist', () => {
		assert.deepEqual(parseDisplayDiscountRouteGroupsQuery('Default, free,default'), ['default', 'free']);
	});
});

describe('getAdminUserDisplayDiscounts', () => {
	beforeEach(() => {
		resetUserChargedCostFactorModeCacheForTests();
	});

	it('returns 404 when the user does not exist', async () => {
		const repos = mockRepos({ user: null, models: [], routes: [] });
		await assert.rejects(
			() => getAdminUserDisplayDiscounts(repos, USER_ID),
			(err: unknown) => err instanceof AdminServiceError && err.status === 404
		);
	});

	it('returns an empty list when the user has no charged cost factors', async () => {
		const repos = mockRepos({
			user: baseUser(),
			models: [model('gpt-4o')],
			routes: [route('gpt-4o', 'default', 0.8)],
		});
		const rows = await getAdminUserDisplayDiscounts(repos, USER_ID);
		assert.deepEqual(rows, []);
	});

	it('returns only models with a user factor and stacks multiply onto route_factor', async () => {
		const repos = mockRepos({
			user: baseUser({ charged_cost_factors: JSON.stringify({ 'gpt-4o': 0.5 }) }),
			models: [model('gpt-4o'), model('claude-sonnet-4')],
			routes: [route('gpt-4o', 'default', 0.8), route('claude-sonnet-4', 'default', 0.7)],
		});
		const rows = await getAdminUserDisplayDiscounts(repos, USER_ID);
		assert.equal(rows.length, 1);
		assert.equal(rows[0]?.id, 'gpt-4o');
		assert.equal(rows[0]?.discounts.default?.current.route_factor, 0.4);
		assert.equal(rows[0]?.discounts.default?.current.composite_factor, 0.4);
	});

	it('omits a personalized model when route_groups filters out every group', async () => {
		const repos = mockRepos({
			user: baseUser({ charged_cost_factors: JSON.stringify({ 'gpt-4o': 0.5 }) }),
			models: [model('gpt-4o')],
			routes: [route('gpt-4o', 'default', 0.8)],
		});
		const rows = await getAdminUserDisplayDiscounts(repos, USER_ID, { routeGroups: ['web'] });
		assert.deepEqual(rows, []);
	});
});
