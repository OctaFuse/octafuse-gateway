/**
 * Stateless MCP aggregator. Each POST builds a server from the reviewed snapshot
 * and forwards tools/call, prompts/get, and resources/read to the owning upstream.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
	CallToolRequestSchema,
	ErrorCode,
	GetPromptRequestSchema,
	ListPromptsRequestSchema,
	ListResourcesRequestSchema,
	ListToolsRequestSchema,
	McpError,
	ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
	MCP_LEDGER_PROVIDER_ID,
	callMcpUpstreamTool,
	getMcpUpstreamPrompt,
	parseMcpAuthHeaders,
	parseStoredMcpPricingRule,
	preflightMcpPricing,
	readMcpUpstreamResource,
	settleMcpPricing,
	summarizeMcpPricingRule,
	type McpCallableItem,
	type McpPricingQuote,
	type McpPricingRule,
} from '@octafuse/core';
import { proxyAppVersion } from '../../app-version';
import type { ApiKeyContext } from '../../middleware/auth';
import { GatewayErrorCode } from '../gateway-error-codes';
import { canAffordToolCost, chargeToolUsage, type ChargeToolUsageParams } from '../tool-usage-charge';

const LOG_BODY_LIMIT = 8000;

export type McpAggregateDeps = {
	listCallable: (slug?: string) => Promise<McpCallableItem[]>;
	charge: (params: ChargeToolUsageParams) => Promise<{ requestLogId: string; chargedCost: number }>;
	callTool?: typeof callMcpUpstreamTool;
	getPrompt?: typeof getMcpUpstreamPrompt;
	readResource?: typeof readMcpUpstreamResource;
	fetchImpl?: typeof fetch;
};

function clip(value: string): string {
	return value.length <= LOG_BODY_LIMIT ? value : `${value.slice(0, LOG_BODY_LIMIT)}…`;
}

function parseDefinition(raw: string): Record<string, unknown> {
	try {
		const value = JSON.parse(raw) as unknown;
		if (value && typeof value === 'object' && !Array.isArray(value)) {
			return value as Record<string, unknown>;
		}
	} catch {
		// ignore malformed snapshots
	}
	return {};
}

type ResolvedPricing = { rule: McpPricingRule; source: 'item' | 'server' };

/** Item rule replaces the server default. Stored rules are validated on write; a broken one fails closed. */
function pricingOf(item: McpCallableItem): ResolvedPricing | null {
	const source = item.pricing ? 'item' : 'server';
	try {
		return { rule: parseStoredMcpPricingRule(item.pricing ?? item.defaultPricing), source };
	} catch (error) {
		console.warn('[mcp] invalid pricing rule', {
			tool: item.exposedName,
			source,
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

function pricingAudit(pricing: ResolvedPricing, preflight: McpPricingQuote, settled: McpPricingQuote | null) {
	return {
		mcp_pricing: {
			rule_source: pricing.source,
			rule_version: pricing.rule.v,
			...(pricing.rule.v === 2
				? { charged_factor: pricing.rule.chargedFactor, metered_factor: pricing.rule.meteredFactor }
				: {}),
			preflight_units: preflight.units,
			unit: pricing.rule.unit,
			...(settled ? { settled_units: settled.units } : {}),
		},
	};
}

function targetOf(item: McpCallableItem) {
	return {
		serverId: item.serverId,
		url: item.url,
		authHeaders: parseMcpAuthHeaders(item.authHeaders),
		timeoutMs: item.timeoutMs,
		maxResponseBytes: item.maxResponseBytes,
	};
}

function textResult(text: string, code: string, extra?: Record<string, unknown>) {
	return {
		content: [{ type: 'text' as const, text }],
		isError: true,
		_meta: { octafuse: { code, ...extra } },
	};
}

function asContent(result: Record<string, unknown>): Array<{ type: 'text'; text: string }> {
	if (Array.isArray(result.content) && result.content.length > 0) {
		return result.content as Array<{ type: 'text'; text: string }>;
	}
	return [{ type: 'text', text: clip(JSON.stringify(result)) }];
}

export async function handleMcpAggregateRequest(
	request: Request,
	input: {
		apiKey: ApiKeyContext;
		slug: string | null;
		deps: McpAggregateDeps;
	}
): Promise<Response> {
	if (request.method !== 'POST') {
		return new Response(
			JSON.stringify({
				jsonrpc: '2.0',
				id: null,
				error: { code: -32000, message: 'Method not allowed' },
			}),
			{
				status: 405,
				headers: { Allow: 'POST', 'Content-Type': 'application/json' },
			}
		);
	}
	const items = await input.deps.listCallable(input.slug ?? undefined);
	const byName = new Map(items.map((item) => [item.exposedName, item]));
	const enabled = items.filter((item) => item.status === 'enabled');
	const callTool = input.deps.callTool ?? callMcpUpstreamTool;
	const getPrompt = input.deps.getPrompt ?? getMcpUpstreamPrompt;
	const readResource = input.deps.readResource ?? readMcpUpstreamResource;
	const fetchImpl = input.deps.fetchImpl ?? fetch;

	const server = new Server(
		{ name: input.slug ? `octafuse-gateway/${input.slug}` : 'octafuse-gateway', version: proxyAppVersion },
		{ capabilities: { tools: {}, prompts: {}, resources: {} } }
	);

	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: enabled
			.filter((item) => item.kind === 'tool')
			.map((item) => {
				const definition = parseDefinition(item.definition);
				const pricing = pricingOf(item);
				return {
					name: item.exposedName,
					title: typeof definition.title === 'string' ? definition.title : undefined,
					description: typeof definition.description === 'string' ? definition.description : undefined,
					inputSchema:
						definition.inputSchema && typeof definition.inputSchema === 'object'
							? definition.inputSchema
							: { type: 'object', properties: {} },
					annotations: definition.annotations,
					...(pricing ? { _meta: { octafuse: summarizeMcpPricingRule(pricing.rule) } } : {}),
				};
			}),
	}));

	server.setRequestHandler(CallToolRequestSchema, async (rpcRequest) => {
		const name = rpcRequest.params.name;
		const args = rpcRequest.params.arguments ?? {};
		const item = byName.get(name);
		if (!item || item.kind !== 'tool') {
			throw new McpError(ErrorCode.InvalidParams, `Unknown MCP tool: ${name}`);
		}
		if (item.status !== 'enabled') {
			return textResult(`Tool ${name} is disabled`, GatewayErrorCode.mcpItemDisabled);
		}
		const pricing = pricingOf(item);
		if (!pricing) {
			return textResult(
				`Tool ${name} has an invalid price configuration`,
				GatewayErrorCode.mcpPricingInvalid
			);
		}
		const preflight = preflightMcpPricing(pricing.rule, args);
		if (
			!canAffordToolCost(
				input.apiKey.budgetMax,
				input.apiKey.budgetSpent,
				preflight.totals.charged,
				input.apiKey.walletGranted,
				input.apiKey.walletSpent
			)
		) {
			return textResult('Budget exceeded', GatewayErrorCode.budgetExceeded);
		}

		const started = Date.now();
		const requestBody = clip(JSON.stringify({ name: item.upstreamKey, arguments: args }));
		const chargeBase = {
			repos: undefined as never,
			apiKeyId: input.apiKey.keyId,
			userId: input.apiKey.userId,
			userEmail: input.apiKey.userEmail,
			ingressHost: input.apiKey.ingressHost,
			toolId: `mcp:${item.slug}/${item.upstreamKey}`,
			toolProvider: item.slug,
			pricingUnit: pricing.rule.unit,
			unitPrices: preflight.unitPrices,
			requestBody,
			ledgerProviderId: MCP_LEDGER_PROVIDER_ID,
			ledgerProviderName: 'OctaFuse MCP',
		};

		try {
			const upstream = await callTool(targetOf(item), item.upstreamKey, args, fetchImpl);
			const responseBody = clip(JSON.stringify(upstream.result));
			if (upstream.isError) {
				await input.deps.charge({
					...chargeBase,
					billingUnits: 0,
					meteredCost: 0,
					standardCost: 0,
					chargedCost: 0,
					pricingAuditExtra: pricingAudit(pricing, preflight, null),
					latencyMs: Date.now() - started,
					responseBody,
					errorMessage: 'Upstream tool returned isError',
					status: 'error',
				});
				return {
					...upstream.result,
					content: asContent(upstream.result),
					isError: true,
					_meta: {
						...(typeof upstream.result._meta === 'object' && upstream.result._meta
							? upstream.result._meta
							: {}),
						octafuse: { code: GatewayErrorCode.upstreamRequestFailed, charged: 0 },
					},
				};
			}
			const settled = settleMcpPricing(pricing.rule, args, upstream.result);
			const charged = await input.deps.charge({
				...chargeBase,
				billingUnits: settled.units,
				meteredCost: settled.totals.metered,
				standardCost: settled.totals.standard,
				chargedCost: settled.totals.charged,
				pricingAuditExtra: pricingAudit(pricing, preflight, settled),
				latencyMs: Date.now() - started,
				responseBody,
				status: 'success',
			});
			return {
				...upstream.result,
				content: asContent(upstream.result),
				isError: false,
				_meta: {
					...(typeof upstream.result._meta === 'object' && upstream.result._meta
						? upstream.result._meta
						: {}),
					octafuse: {
						unit: settled.unit,
						units: settled.units,
						charged: charged.chargedCost,
						requestLogId: charged.requestLogId,
					},
				},
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : 'MCP upstream request failed';
			await input.deps.charge({
				...chargeBase,
				billingUnits: 0,
				meteredCost: 0,
				standardCost: 0,
				chargedCost: 0,
				pricingAuditExtra: pricingAudit(pricing, preflight, null),
				latencyMs: Date.now() - started,
				errorMessage: clip(message),
				status: 'error',
			});
			return textResult(message, GatewayErrorCode.upstreamRequestFailed);
		}
	});

	server.setRequestHandler(ListPromptsRequestSchema, async () => ({
		prompts: enabled
			.filter((item) => item.kind === 'prompt')
			.map((item) => {
				const definition = parseDefinition(item.definition);
				return {
					name: item.exposedName,
					title: typeof definition.title === 'string' ? definition.title : undefined,
					description: typeof definition.description === 'string' ? definition.description : undefined,
					arguments: Array.isArray(definition.arguments) ? definition.arguments : undefined,
				};
			}),
	}));

	server.setRequestHandler(GetPromptRequestSchema, async (rpcRequest) => {
		const item = byName.get(rpcRequest.params.name);
		if (!item || item.kind !== 'prompt' || item.status !== 'enabled') {
			throw new McpError(ErrorCode.InvalidParams, `Unknown MCP prompt: ${rpcRequest.params.name}`);
		}
		return getPrompt(targetOf(item), item.upstreamKey, rpcRequest.params.arguments ?? {}, fetchImpl);
	});

	server.setRequestHandler(ListResourcesRequestSchema, async () => ({
		resources: enabled
			.filter((item) => item.kind === 'resource')
			.map((item) => {
				const definition = parseDefinition(item.definition);
				return {
					uri: item.exposedName,
					name: typeof definition.name === 'string' ? definition.name : item.upstreamKey,
					description: typeof definition.description === 'string' ? definition.description : undefined,
					mimeType: typeof definition.mimeType === 'string' ? definition.mimeType : undefined,
				};
			}),
	}));

	server.setRequestHandler(ReadResourceRequestSchema, async (rpcRequest) => {
		const item = byName.get(rpcRequest.params.uri);
		if (!item || item.kind !== 'resource' || item.status !== 'enabled') {
			throw new McpError(ErrorCode.InvalidParams, `Unknown MCP resource: ${rpcRequest.params.uri}`);
		}
		return readResource(targetOf(item), item.upstreamKey, fetchImpl);
	});

	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
	});
	await server.connect(transport);
	try {
		return await transport.handleRequest(request);
	} finally {
		await server.close().catch(() => undefined);
		await transport.close().catch(() => undefined);
	}
}

/** Production wiring: snapshot from the database, billing through the shared tool ledger. */
export function mcpAggregateDeps(repos: ChargeToolUsageParams['repos']): McpAggregateDeps {
	return {
		listCallable: (slug) => repos.mcpServers.listCallable(slug),
		charge: (params) => chargeToolUsage({ ...params, repos }),
	};
}
