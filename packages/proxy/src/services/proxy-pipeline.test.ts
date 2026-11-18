import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import type { GatewayRepositories } from '@octafuse/core';
import { defaultHasUsage, modelDisplayName, parseJsonModelBody, runProxyPipeline, type AuthedEnv } from './proxy-pipeline';
import { EMPTY_USAGE, type UsageFromStream } from './proxy';
import { GATEWAY_REQUEST_ID_HEADER, GatewayErrorCode, NO_AVAILABLE_ROUTE_MESSAGE } from './gateway-error-codes';
import { describeChatOutcome } from './accounting';
import { buildRouteRequestBody } from './route-default-params';

describe('proxy pipeline helpers', () => {
	it('treats any token counter as usage for chat-family endpoints', () => {
		assert.equal(defaultHasUsage(EMPTY_USAGE), false);
		assert.equal(defaultHasUsage({ ...EMPTY_USAGE, input_tokens: 3 }), true);
		assert.equal(defaultHasUsage({ ...EMPTY_USAGE, output_tokens: 1 }), true);
		assert.equal(defaultHasUsage({ ...EMPTY_USAGE, total_tokens: 8 }), true);
	});

	it('does not treat reasoning-only usage as complete for the default helper', () => {
		const usage: UsageFromStream = { ...EMPTY_USAGE, reasoning_tokens: 12 };
		assert.equal(defaultHasUsage(usage), false);
	});

	it('prefers a non-empty display name', () => {
		assert.equal(modelDisplayName({ display_name: '  GPT  ' }, 'gpt-x'), 'GPT');
		assert.equal(modelDisplayName({ display_name: '' }, 'gpt-x'), 'gpt-x');
		assert.equal(modelDisplayName({ display_name: null }, 'gpt-x'), 'gpt-x');
	});

	it('keeps empty-route errors distinct from model not found', () => {
		assert.equal(NO_AVAILABLE_ROUTE_MESSAGE, 'No available route');
		assert.equal(GatewayErrorCode.noRoute, 'gateway.no_route');
		assert.notEqual(GatewayErrorCode.noRoute, GatewayErrorCode.modelNotFound);
		assert.notEqual(NO_AVAILABLE_ROUTE_MESSAGE, 'Model not found');
	});
});

it('correlates the response with the logged upstream snapshot and sources from the final route', async () => {
	const statements: { sql: string; values: unknown[] }[] = [];
	const repos = {
		client: {
			driver: 'd1',
			raw: {
				prepare: (sql: string) => ({ bind: (...values: unknown[]) => ({ sql, values }) }),
				batch: async (batch: typeof statements) => {
					statements.push(...batch);
					return batch.map(() => ({ success: true }));
				},
			},
		},
		systemConfig: { getConfig: async () => null },
		modelRouting: {
			getModelById: async () => ({ id: 'model', status: 'active' }),
			resolveModelSurface: async () => ({ id: 'surface', route_pool_id: 'pool' }),
			getModelRoutesByPoolId: async () => ['first', 'final'].map((id) => ({
				id, model_id: 'model', provider_id: id, provider_model_name: `upstream-${id}`,
				upstream_protocol: 'openai', upstream_operation: 'chat', adapter: 'passthrough',
				custom_params: JSON.stringify({ body: { temperature: id === 'final' ? 0.4 : 0.9 } }),
			})),
		},
		providers: {
			getProviderById: async (id: string) => ({
				id, name: id, api_key: 'test-key', status: 'active', endpoints: '{}',
				custom_params: JSON.stringify({ openai: { body: { max_tokens: id === 'final' ? 256 : 1024 } } }),
			}),
		},
	} as unknown as GatewayRepositories;
	const app = new Hono<AuthedEnv>();
	app.post('/', (c) => {
		c.set('repositories', repos);
		c.set('apiKey', {
			keyId: 'test-key-id', userId: 'test-user', userEmail: null, budgetMax: 1, budgetSpent: 0,
			walletGranted: 0, walletSpent: 0, budgetPeriod: 'monthly', budgetResetAt: null, metadata: null,
			chargedCostFactors: null, rateLimit: null, userRateLimit: null, ingressHost: null,
		});
		return runProxyPipeline(c, {
			requestProtocol: 'openai', requestOperation: 'chat', strategyCapability: 'chat', logTag: 'test',
			parseRequest: parseJsonModelBody,
			dispatch: async ({ routes, options }) => {
				const [first, final] = routes;
				const firstAttempt = options.timing?.startAttempt(first);
				options.timing?.markAttemptHeaders(firstAttempt, 503);
				const finalAttempt = options.timing?.startAttempt(final);
				options.timing?.markAttemptHeaders(finalAttempt, 200);
				options.timing?.markFinalAttempt(finalAttempt);
				return {
					chosenRoute: final, response: Response.json({ ok: true }),
					usagePromise: Promise.resolve({ ...EMPTY_USAGE, total_tokens: 1 }),
					upstreamRequestId: null, circuitEvents: [], suppressErrorAlert: false,
				};
			},
			accounting: {
				requestBodyForLog: (body) => JSON.stringify(body),
				upstreamWireBodyForLog: (route, body) => JSON.stringify({
					...buildRouteRequestBody(route, body), model: route.providerModelName,
				}),
				requestBodyForSources: (body) => body,
				describeOutcome: describeChatOutcome,
			},
		});
	});
	const tasks: Promise<unknown>[] = [];
	const response = await app.request('/', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ model: 'model' }),
	}, { USAGE_SAFETY_TIMEOUT_MS: '10' }, {
		waitUntil: (task: Promise<unknown>) => tasks.push(task),
		passThroughOnException: () => {},
	});
	assert.equal(response.status, 200);
	await Promise.all(tasks);
	const entry = statements.find(({ sql }) => sql.startsWith('INSERT INTO api_key_request_logs'));
	assert.ok(entry);
	const columns = entry.sql.match(/\(([^)]+)\)/)?.[1].split(',').map((col) => col.trim()) ?? [];
	const row = Object.fromEntries(columns.map((col, index) => [col, entry.values[index]]));
	assert.equal(row.id, response.headers.get(GATEWAY_REQUEST_ID_HEADER));
	assert.equal(row.route_target_id, 'final');
	assert.deepEqual(JSON.parse(String(row.upstream_request_body)), { model: 'upstream-final', max_tokens: 256, temperature: 0.4 });
	assert.deepEqual(JSON.parse(String(row.route_trace)).request_sources, { body: 'pr.', headers: [] });
});
