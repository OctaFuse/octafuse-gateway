import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type {
	GatewayRepositories,
	ModelRow,
	ModelRouteJoinRow,
	UserRow,
} from '@octafuse/core';
import { resetUserChargedCostFactorModeCacheForTests } from '@octafuse/core';
import { AdminServiceError } from './errors';
import {
	getAdminUserModelsPreview,
	parseUserModelsPreviewKind,
	parseUserModelsPreviewRouteGroups,
	USER_MODELS_PREVIEW_LIMIT,
} from './user-models-preview';

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

function model(id: string, overrides: Partial<ModelRow> = {}): ModelRow {
	return {
		id,
		display_name: id,
		vendor: 'other',
		context_window: 128000,
		max_tokens: 8192,
		pricing_profile: JSON.stringify({
			tiers: [{ upto: null, label: null, input_price: 1, output_price: 4 }],
		}),
		tags: '[]',
		description: null,
		metadata: null,
		input_modalities: '["text"]',
		output_modalities: '["text"]',
		released_at: null,
		created_at: '2026-08-26T12:19:56.000Z',
		...overrides,
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

describe('parseUserModelsPreview query', () => {
	it('defaults to llm and default,free', () => {
		assert.equal(parseUserModelsPreviewKind(undefined), 'llm');
		assert.equal(parseUserModelsPreviewKind('nope'), 'llm');
		assert.deepEqual(parseUserModelsPreviewRouteGroups(undefined), ['default', 'free']);
		assert.deepEqual(parseUserModelsPreviewRouteGroups('Web, default'), ['web', 'default']);
	});
});

describe('getAdminUserModelsPreview', () => {
	beforeEach(() => {
		resetUserChargedCostFactorModeCacheForTests();
	});

	it('returns 404 when the user does not exist', async () => {
		const repos = mockRepos({ user: null, models: [], routes: [] });
		await assert.rejects(
			() => getAdminUserModelsPreview(repos, USER_ID),
			(err: unknown) => err instanceof AdminServiceError && err.status === 404
		);
	});

	it('keeps catalog discounts when the user has no charged cost factors', async () => {
		const repos = mockRepos({
			user: baseUser(),
			models: [model('deepseek-v4.1-flash', { display_name: 'DeepSeek V4.1 Flash' })],
			routes: [route('deepseek-v4.1-flash', 'default', 0.5)],
		});
		const body = await getAdminUserModelsPreview(repos, USER_ID, { modelRaw: 'v4.1' });
		assert.equal(body.data.length, 1);
		assert.equal(body.data[0]?.id, 'deepseek-v4.1-flash');
		assert.equal(body.data[0]?.model_info.input_price, 1);
		assert.equal(body.data[0]?.model_info.output_price, 4);
		assert.equal(body.data[0]?.model_info.discounts.default?.current.catalog_factor, 1);
		assert.equal(body.data[0]?.model_info.discounts.default?.current.route_factor, 0.5);
		assert.equal(body.data[0]?.model_info.discounts.default?.current.composite_factor, 0.5);
		assert.equal(body.preview.user_charged_factor_mode, 'multiply');
	});

	it('stacks the saved user factor onto the default group', async () => {
		const repos = mockRepos({
			user: baseUser({
				charged_cost_factors: JSON.stringify({ 'deepseek-v4.1-flash': { '*': 0.5, default: 0.4 } }),
			}),
			models: [model('deepseek-v4.1-flash')],
			routes: [route('deepseek-v4.1-flash', 'default', 0.5)],
			mode: 'multiply',
		});
		const body = await getAdminUserModelsPreview(repos, USER_ID);
		assert.equal(body.data[0]?.model_info.discounts.default?.current.route_factor, 0.2);
		assert.equal(body.data[0]?.model_info.discounts.default?.current.composite_factor, 0.2);
	});

	it('uses the agent default route groups and llm kind', async () => {
		const repos = mockRepos({
			user: baseUser(),
			models: [
				model('text-model'),
				model('web-only'),
				model('image-model', { output_modalities: '["image"]' }),
			],
			routes: [
				route('text-model', 'default', 0.8),
				route('web-only', 'web', 0.8),
				route('image-model', 'default', 0.8),
			],
		});
		const body = await getAdminUserModelsPreview(repos, USER_ID);
		assert.deepEqual(body.data.map((item) => item.id), ['text-model']);
		assert.deepEqual(body.preview.route_groups, ['default', 'free']);
		assert.equal(body.preview.kind, 'llm');
	});

	it('truncates after the preview limit', async () => {
		const models = Array.from({ length: USER_MODELS_PREVIEW_LIMIT + 2 }, (_, index) => model(`m-${index}`));
		const routes = models.map((item) => route(item.id, 'default', 1));
		const repos = mockRepos({ user: baseUser(), models, routes });
		const body = await getAdminUserModelsPreview(repos, USER_ID);
		assert.equal(body.data.length, USER_MODELS_PREVIEW_LIMIT);
		assert.equal(body.preview.truncated, true);
	});
});
