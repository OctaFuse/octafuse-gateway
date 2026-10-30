import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { perCallMcpPricingRule, serializeMcpPricingRule, type McpCallableItem } from '@octafuse/core';
import type { McpCaller } from '../../middleware/mcp-auth';
import { handleMcpAggregateRequest, type McpAggregateDeps } from './aggregate';
import { createMockMcpUpstream } from './mock-upstream';

const caller: McpCaller = {
	userId: 'user',
	userEmail: null,
	budgetMax: 10,
	budgetSpent: 0,
	walletGranted: 0,
	walletSpent: 0,
	apiKeyId: 'key',
	oauthAccessTokenId: null,
	ingressHost: null,
};

function perCall(charged: number): string {
	return serializeMcpPricingRule(perCallMcpPricingRule(charged));
}

function item(partial: Partial<McpCallableItem> = {}): McpCallableItem {
	return {
		id: 'item',
		serverId: 'server',
		kind: 'tool',
		upstreamKey: 'ask',
		upstreamKeyHash: 'hash',
		exposedName: 'deepwiki__ask',
		exposedNameHash: 'exposed',
		definition: JSON.stringify({
			name: 'ask',
			description: 'Ask the repo',
			inputSchema: { type: 'object', properties: {} },
		}),
		contentHash: 'content',
		pendingDefinition: null,
		pendingHash: null,
		reviewState: 'none',
		status: 'enabled',
		pricing: perCall(1),
		syncedAt: '2026-01-01T00:00:00.000Z',
		slug: 'deepwiki',
		serverStatus: 'active',
		url: 'https://mcp.example.com/mcp',
		authHeaders: '{}',
		timeoutMs: 5000,
		maxResponseBytes: 100000,
		defaultPricing: serializeMcpPricingRule(perCallMcpPricingRule(0.4, 2, 0.5)),
		...partial,
	};
}

async function rpc(
	deps: McpAggregateDeps,
	method: string,
	params?: unknown,
	methodName: 'POST' | 'GET' = 'POST'
) {
	const response = await handleMcpAggregateRequest(
		new Request('http://localhost/mcp', {
			method: methodName,
			headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
			body: methodName === 'GET' ? undefined : JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
		}),
		{ caller, slug: null, deps }
	);
	const text = await response.text();
	return { status: response.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

describe('mcp aggregate server', () => {
	it('answers initialize and lists only enabled snapshot tools', async () => {
		const deps: McpAggregateDeps = {
			listCallable: async () => [
				item(),
				item({ id: 'off', exposedName: 'deepwiki__hidden', status: 'disabled' }),
			],
			charge: async () => ({ requestLogId: 'log', chargedCost: 0 }),
		};
		const init = await rpc(deps, 'initialize', {
			protocolVersion: '2025-06-18',
			capabilities: {},
			clientInfo: { name: 'test', version: '0' },
		});
		assert.equal(init.status, 200);
		const listed = await rpc(deps, 'tools/list', {});
		const tools = (listed.body?.result as { tools: Array<{ name: string; description: string }> }).tools;
		assert.deepEqual(
			tools.map((tool) => tool.name),
			['deepwiki__ask']
		);
		assert.equal(tools[0]?.description, 'Ask the repo');
		const get = await rpc(deps, 'ping', {}, 'GET');
		assert.equal(get.status, 405);
	});

	it('answers resources/templates/list with an empty list instead of method-not-found', async () => {
		const deps: McpAggregateDeps = {
			listCallable: async () => [item()],
			charge: async () => ({ requestLogId: 'log', chargedCost: 0 }),
		};
		const listed = await rpc(deps, 'resources/templates/list', {});
		assert.equal(listed.status, 200);
		assert.equal(listed.body?.error, undefined);
		assert.deepEqual(listed.body?.result, { resourceTemplates: [] });
	});

	it('bills a successful call and records an error without a charge when the upstream fails', async () => {
		const charges: Array<{ status?: string; chargedCost: number; ledgerProviderId?: string }> = [];
		let calls = 0;
		const deps: McpAggregateDeps = {
			listCallable: async () => [item()],
			charge: async (params) => {
				charges.push(params);
				return { requestLogId: 'log-1', chargedCost: params.chargedCost };
			},
			callTool: async () => {
				calls += 1;
				return { result: { content: [{ type: 'text', text: 'architecture' }] }, isError: false };
			},
		};
		const ok = await rpc(deps, 'tools/call', { name: 'deepwiki__ask', arguments: { repo: 'octafuse' } });
		const okResult = ok.body?.result as { isError?: boolean; _meta?: { octafuse?: { charged?: number } } };
		assert.equal(okResult.isError, false);
		assert.equal(okResult._meta?.octafuse?.charged, 1);
		assert.equal(charges[0]?.ledgerProviderId, 'octafuse-mcp');
		assert.equal(charges[0]?.status, 'success');

		deps.callTool = async () => {
			throw new Error('timed out');
		};
		const failed = await rpc(deps, 'tools/call', { name: 'deepwiki__ask', arguments: {} });
		const failedResult = failed.body?.result as { isError?: boolean; content?: Array<{ text: string }> };
		assert.equal(failedResult.isError, true);
		assert.match(failedResult.content?.[0]?.text ?? '', /timed out/);
		assert.equal(charges[1]?.status, 'error');
		assert.equal(charges[1]?.chargedCost, 0);
		assert.equal(calls, 1);
	});

	it('does not charge when the upstream tool result fails the MCP result schema', async () => {
		const charges: Array<{ status?: string; chargedCost: number }> = [];
		const deps: McpAggregateDeps = {
			listCallable: async () => [item()],
			charge: async (params) => {
				charges.push(params);
				return { requestLogId: 'log', chargedCost: params.chargedCost };
			},
			callTool: async () => ({ result: { content: [{ type: 'text', text: 42 }] }, isError: false }),
		};
		const res = await rpc(deps, 'tools/call', { name: 'deepwiki__ask', arguments: {} });
		const result = res.body?.result as { isError?: boolean } | undefined;
		assert.equal(res.body?.error, undefined);
		assert.equal(result?.isError, true);
		assert.equal(charges.length, 1);
		assert.equal(charges[0]?.status, 'error');
		assert.equal(charges[0]?.chargedCost, 0);
	});

	it('attributes an access token call to the token, not to an api key', async () => {
		const charged: Array<{ apiKeyId: string | null; oauthAccessTokenId?: string | null; userId: string }> = [];
		const deps: McpAggregateDeps = {
			listCallable: async () => [item()],
			charge: async (params) => {
				charged.push(params);
				return { requestLogId: 'log', chargedCost: params.chargedCost };
			},
			callTool: async () => ({ result: { content: [{ type: 'text', text: 'ok' }] }, isError: false }),
		};
		const response = await handleMcpAggregateRequest(
			new Request('http://localhost/mcp', {
				method: 'POST',
				headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'tools/call',
					params: { name: 'deepwiki__ask', arguments: {} },
				}),
			}),
			{ caller: { ...caller, apiKeyId: null, oauthAccessTokenId: 'tok-1' }, slug: null, deps }
		);
		assert.equal(response.status, 200);
		assert.equal(charged.length, 1);
		assert.equal(charged[0]?.apiKeyId, null);
		assert.equal(charged[0]?.oauthAccessTokenId, 'tok-1');
		assert.equal(charged[0]?.userId, 'user');
	});

	it('does not call upstream when the tool is disabled or the balance is short', async () => {
		let calls = 0;
		const deps: McpAggregateDeps = {
			listCallable: async () => [item({ status: 'disabled' })],
			charge: async () => {
				throw new Error('should not charge');
			},
			callTool: async () => {
				calls += 1;
				return { result: {}, isError: false };
			},
		};
		const disabled = await rpc(deps, 'tools/call', { name: 'deepwiki__ask', arguments: {} });
		assert.equal((disabled.body?.result as { isError?: boolean }).isError, true);
		const broke = await handleMcpAggregateRequest(
			new Request('http://localhost/mcp', {
				method: 'POST',
				headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					method: 'tools/call',
					params: { name: 'deepwiki__ask', arguments: {} },
				}),
			}),
			{
				caller: { ...caller, budgetMax: 0, budgetSpent: 0 },
				slug: null,
				deps: { ...deps, listCallable: async () => [item()] },
			}
		);
		const brokeBody = (await broke.json()) as {
			result?: { isError?: boolean; content?: Array<{ text: string }> };
		};
		assert.equal(brokeBody.result?.isError, true);
		assert.match(brokeBody.result?.content?.[0]?.text ?? '', /Budget/);
		assert.equal(calls, 0);
	});

	it('forwards a call to the mock upstream under the original tool name', async () => {
		const mock = createMockMcpUpstream({ callText: 'from-mock' });
		const deps: McpAggregateDeps = {
			listCallable: async () => [
				item({ pricing: serializeMcpPricingRule(perCallMcpPricingRule(0.01, 0, 0.8)) }),
			],
			charge: async (params) => ({ requestLogId: 'log', chargedCost: params.chargedCost }),
			fetchImpl: mock.fetchImpl,
		};
		const response = await rpc(deps, 'tools/call', {
			name: 'deepwiki__ask',
			arguments: { q: 'architecture' },
		});
		const result = response.body?.result as { content?: Array<{ text: string }>; isError?: boolean };
		assert.equal(result.isError, false);
		assert.equal(result.content?.[0]?.text, 'from-mock');
		assert.ok(mock.calls.some((call) => call.method === 'tools/call'));
		assert.equal(mock.calls.find((call) => call.method === 'tools/call')?.authorization, null);
	});

	it('lists and charges exactly one request while ignoring upstream usage fields', async () => {
		const charges: Array<{
			billingUnits?: number;
			chargedCost: number;
			pricingUnit?: string;
			pricingAuditExtra?: Record<string, unknown>;
		}> = [];
		const deps: McpAggregateDeps = {
			listCallable: async () => [item({ pricing: perCall(0.5) })],
			charge: async (params) => {
				charges.push(params);
				return { requestLogId: 'log', chargedCost: params.chargedCost };
			},
			callTool: async () => ({
				result: { content: [{ type: 'text', text: '{"usage":{"credits":400},"data":[1,2,3]}' }] },
				isError: false,
			}),
		};
		const listed = await rpc(deps, 'tools/list', {});
		const meta = (listed.body?.result as { tools: Array<{ _meta?: { octafuse?: Record<string, unknown> } }> })
			.tools[0]?._meta?.octafuse;
		assert.equal(meta?.unit, 'request');
		assert.equal(meta?.charged, 0.5);
		const call = await rpc(deps, 'tools/call', { name: 'deepwiki__ask', arguments: { page_count: 100 } });
		const octafuse = (call.body?.result as { _meta?: { octafuse?: Record<string, unknown> } })._meta
			?.octafuse;
		assert.equal(octafuse?.units, 1);
		assert.equal(octafuse?.charged, 0.5);
		assert.equal(charges[0]?.billingUnits, 1);
		assert.equal(charges[0]?.pricingUnit, 'request');
		const audit = charges[0]?.pricingAuditExtra?.mcp_pricing as {
			rule_source?: string;
			preflight_units?: number;
			settled_units?: number;
		};
		assert.equal(audit.rule_source, 'item');
		assert.equal(audit.preflight_units, 1);
		assert.equal(audit.settled_units, 1);
	});
	it('inherits all server prices and records the server as the rule source', async () => {
		const charges: Array<{
			meteredCost: number;
			standardCost: number;
			chargedCost: number;
			billingUnits?: number;
			pricingAuditExtra?: Record<string, unknown>;
		}> = [];
		const deps: McpAggregateDeps = {
			listCallable: async () => [item({ pricing: null })],
			charge: async (params) => {
				charges.push(params);
				return { requestLogId: 'log', chargedCost: params.chargedCost };
			},
			callTool: async () => ({ result: { content: [] }, isError: false }),
		};
		await rpc(deps, 'tools/call', { name: 'deepwiki__ask', arguments: {} });
		assert.equal(charges[0]?.billingUnits, 1);
		assert.equal(charges[0]?.meteredCost, 0.2);
		assert.equal(charges[0]?.standardCost, 0.4);
		assert.equal(charges[0]?.chargedCost, 0.8);
		const audit = charges[0]?.pricingAuditExtra?.mcp_pricing as {
			rule_version?: number;
			charged_factor?: number;
			metered_factor?: number;
		};
		assert.equal(audit.rule_version, 2);
		assert.equal(audit.charged_factor, 2);
		assert.equal(audit.metered_factor, 0.5);
		assert.equal(
			(charges[0]?.pricingAuditExtra?.mcp_pricing as { rule_source?: string }).rule_source,
			'server'
		);
	});
	it('logs one free successful request at zero balance and zero units for an upstream isError result', async () => {
		const charges: Array<{
			status?: string;
			chargedCost: number;
			meteredCost: number;
			standardCost: number;
			billingUnits?: number;
		}> = [];
		let failed = false;
		const deps: McpAggregateDeps = {
			listCallable: async () => [
				item({ pricing: serializeMcpPricingRule(perCallMcpPricingRule(0.01, 0, 0.8)) }),
			],
			charge: async (params) => {
				charges.push(params);
				return { requestLogId: 'log', chargedCost: params.chargedCost };
			},
			callTool: async () => ({ result: { content: [] }, isError: failed }),
		};
		async function call() {
			return handleMcpAggregateRequest(
				new Request('http://localhost/mcp', {
					method: 'POST',
					headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
					body: JSON.stringify({
						jsonrpc: '2.0',
						id: 1,
						method: 'tools/call',
						params: { name: 'deepwiki__ask', arguments: {} },
					}),
				}),
				{ caller: { ...caller, budgetMax: 0 }, slug: null, deps }
			);
		}
		await call();
		assert.equal(charges[0]?.status, 'success');
		assert.equal(charges[0]?.billingUnits, 1);
		assert.equal(charges[0]?.chargedCost, 0);
		assert.equal(charges[0]?.meteredCost, 0.008);
		assert.equal(charges[0]?.standardCost, 0.01);
		failed = true;
		await call();
		assert.equal(charges[1]?.status, 'error');
		assert.equal(charges[1]?.billingUnits, 0);
		assert.equal(charges[1]?.chargedCost, 0);
		assert.equal(charges[1]?.meteredCost, 0);
		assert.equal(charges[1]?.standardCost, 0);
	});
	it('rejects unsupported stored modes and guards before upstream calls or charging', async () => {
		let calls = 0;
		let charges = 0;
		const unsupported = [
			JSON.stringify({ unit: 'credit', prices: { metered: 0, standard: 0, charged: 0 } }),
			JSON.stringify({
				prices: { metered: 0, standard: 0, charged: 0 },
				guards: [{ kind: 'max', path: 'limit', max: 10 }],
			}),
			'{"prices":{}}',
			JSON.stringify({ v: 2, standard: 0.01, chargedFactor: -1 }),
		];
		for (const pricing of unsupported) {
			const deps: McpAggregateDeps = {
				listCallable: async () => [item({ pricing })],
				charge: async () => {
					charges += 1;
					return { requestLogId: 'log', chargedCost: 0 };
				},
				callTool: async () => {
					calls += 1;
					return { result: {}, isError: false };
				},
			};
			const rejected = await rpc(deps, 'tools/call', { name: 'deepwiki__ask', arguments: {} });
			const result = rejected.body?.result as { isError?: boolean; _meta?: { octafuse?: { code?: string } } };
			assert.equal(result.isError, true);
			assert.equal(result._meta?.octafuse?.code, 'gateway.mcp_pricing_invalid');
		}
		assert.equal(calls, 0);
		assert.equal(charges, 0);
	});
	it('tool factors override all server prices and legacy absolute prices still settle unchanged', async () => {
		for (const pricing of [
			serializeMcpPricingRule(perCallMcpPricingRule(0.01, 1.2, 0.8)),
			JSON.stringify({ v: 1, unit: 'request', prices: { standard: 0, charged: 0.012, metered: 0.008 } }),
		]) {
			const charges: Array<{ chargedCost: number; standardCost: number; meteredCost: number }> = [];
			const deps: McpAggregateDeps = {
				listCallable: async () => [item({ pricing })],
				charge: async (params) => {
					charges.push(params);
					return { requestLogId: 'log', chargedCost: params.chargedCost };
				},
				callTool: async () => ({ result: { content: [] }, isError: false }),
			};
			await rpc(deps, 'tools/call', { name: 'deepwiki__ask', arguments: {} });
			assert.equal(charges[0]?.chargedCost, 0.012);
			assert.equal(charges[0]?.meteredCost, 0.008);
			assert.equal(charges[0]?.standardCost, JSON.parse(pricing).v === 1 ? 0 : 0.01);
		}
	});
	it('reports an uncertain settlement without writing a second zero-cost log', async () => {
		const attempts: string[] = [];
		let upstreamCalls = 0;
		const result = await rpc({
			listCallable: async () => [item()],
			callTool: async () => {
				upstreamCalls += 1;
				return { result: { content: [{ type: 'text', text: 'done' }] }, isError: false };
			},
			charge: async (params) => {
				attempts.push(params.status);
				if (params.status === 'success') throw new Error('commit response lost');
				return { requestLogId: 'misleading-error-log', chargedCost: 0 };
			},
		}, 'tools/call', { name: 'deepwiki__ask', arguments: {} });
		assert.equal(upstreamCalls, 1);
		assert.deepEqual(attempts, ['success']);
		const body = result.body?.result as { isError: boolean; _meta: { octafuse: { code: string; retryable: boolean } } };
		assert.equal(body.isError, true);
		assert.equal(body._meta.octafuse.code, 'gateway.mcp_settlement_failed');
		assert.equal(body._meta.octafuse.retryable, false);
	});
	it('does not retry a failed error-log write or expose its database error', async () => {
		let attempts = 0;
		const result = await rpc({
			listCallable: async () => [item()],
			callTool: async () => { throw new Error('upstream unavailable'); },
			charge: async () => {
				attempts += 1;
				throw new Error('private database detail');
			},
		}, 'tools/call', { name: 'deepwiki__ask', arguments: {} });
		assert.equal(attempts, 1);
		const body = result.body?.result as { _meta: { octafuse: { code: string } } };
		assert.equal(body._meta.octafuse.code, 'gateway.mcp_settlement_failed');
		assert.ok(!JSON.stringify(body).includes('private database detail'));
	});
});
