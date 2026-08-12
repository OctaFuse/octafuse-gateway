/**
 * Playground Tools：读 system_config catalog，按指定 provider 直连引擎。
 * 不经 Proxy、不计费、不写 api_key_request_logs；可测非 Active 引擎以验证密钥。
 */
import type { GatewayRepositories } from '@octafuse/core';
import {
	AI_DETECTION_CATALOG_KEY,
	AI_DETECTION_IMPLEMENTED_PROVIDERS,
	parseAiDetectionCatalogLenient,
	resolveAiDetectionConfigForProvider,
} from '@octafuse/core/lib/ai-detection-system-config';
import {
	WEB_DEEP_SEARCH_CATALOG_KEY,
	WEB_DEEP_SEARCH_PROVIDERS,
	isWebDeepSearchProvider,
	parseWebDeepSearchCatalogLenient,
	type WebDeepSearchProvider,
} from '@octafuse/core/lib/web-deep-search-system-config';
import {
	WEB_FETCH_CATALOG_KEY,
	WEB_FETCH_PROVIDERS,
	isWebFetchProvider,
	parseWebFetchCatalogLenient,
	type WebFetchProvider,
} from '@octafuse/core/lib/web-fetch-system-config';
import {
	WEB_SEARCH_CATALOG_KEY,
	WEB_SEARCH_PROVIDERS,
	isWebSearchProvider,
	parseWebSearchCatalogLenient,
	type WebSearchProvider,
} from '@octafuse/core/lib/web-search-system-config';
import {
	detectAiRate,
	getAiDetectionDriver,
	AiDetectionProviderError,
} from '@octafuse/tool-engines/ai-detection';
import {
	deepSearchByProvider,
	WebDeepSearchProviderError,
	clampDeepSearchCount,
} from '@octafuse/tool-engines/web-deep-search';
import {
	assertFetchUrlSafe,
	fetchUrlByProvider,
	WebFetchProviderError,
} from '@octafuse/tool-engines/web-fetch';
import {
	searchWebByProvider,
	WebSearchProviderError,
} from '@octafuse/tool-engines/web-search';
import { parseGatewayToolId, type GatewayToolId } from '@/lib/invoke-kind';
import { badRequest } from './errors';

export type PlaygroundToolInvokeInput = {
	toolId: string;
	/** Catalog provider id（可与 Active 不同） */
	provider: string;
	body: Record<string, unknown>;
};

export type PlaygroundToolInvokeResult = {
	response: Response;
	upstreamUrlForHeader: string;
	latencyMs: number;
	upstreamWireBodyJson: string;
};

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body, null, 2), {
		status,
		headers: { 'Content-Type': 'application/json; charset=utf-8' },
	});
}

function requireString(body: Record<string, unknown>, key: string): string {
	const v = body[key];
	if (typeof v !== 'string' || !v.trim()) {
		throw badRequest(`body.${key} must be a non-empty string`);
	}
	return v.trim();
}

async function loadCatalogRaw(
	repos: GatewayRepositories,
	key: string
): Promise<string | null> {
	return repos.systemConfig.getConfig(key);
}

export function listPlaygroundToolProviders(toolId: GatewayToolId): readonly string[] {
	switch (toolId) {
		case 'web-search':
			return WEB_SEARCH_PROVIDERS;
		case 'web-fetch':
			return WEB_FETCH_PROVIDERS;
		case 'web-deep-search':
			return WEB_DEEP_SEARCH_PROVIDERS;
		case 'ai-detection':
			return AI_DETECTION_IMPLEMENTED_PROVIDERS;
		default: {
			const _exhaustive: never = toolId;
			return _exhaustive;
		}
	}
}

/**
 * 直连引擎试调用（Admin 管理面）。
 */
export async function invokePlaygroundTool(
	repos: GatewayRepositories,
	input: PlaygroundToolInvokeInput,
	requestSignal?: AbortSignal
): Promise<PlaygroundToolInvokeResult> {
	const toolId = parseGatewayToolId(input.toolId);
	if (!toolId) {
		throw badRequest(`Unknown toolId: ${input.toolId}`);
	}
	const provider = input.provider?.trim() ?? '';
	if (!provider) {
		throw badRequest('provider is required');
	}
	const allowed = listPlaygroundToolProviders(toolId);
	if (!(allowed as readonly string[]).includes(provider)) {
		throw badRequest(
			`provider "${provider}" is not available for tool "${toolId}". Allowed: ${allowed.join(', ')}`
		);
	}

	const start = Date.now();
	const wire = {
		toolId,
		provider,
		body: input.body,
		mode: 'playground-direct-engine' as const,
	};
	const upstreamWireBodyJson = JSON.stringify(wire, null, 2);

	try {
		let payload: unknown;
		let upstreamLabel = `catalog://${toolId}/${provider}`;

		switch (toolId) {
			case 'web-search': {
				if (!isWebSearchProvider(provider)) throw badRequest('invalid web-search provider');
				const catalogRaw = await loadCatalogRaw(repos, WEB_SEARCH_CATALOG_KEY);
				const catalog = parseWebSearchCatalogLenient(catalogRaw);
				const entry = catalog?.[provider as WebSearchProvider];
				const apiKey = entry?.apiKey?.trim() ?? '';
				if (!apiKey) {
					return {
						response: jsonResponse(503, {
							error: `Web search provider "${provider}" has no API key in WEB_SEARCH_CATALOG`,
						}),
						upstreamUrlForHeader: upstreamLabel,
						latencyMs: Date.now() - start,
						upstreamWireBodyJson,
					};
				}
				const query = requireString(input.body, 'query');
				if (query.length < 2) throw badRequest('query must be at least 2 characters');
				const results = await searchWebByProvider(provider, {
					apiKey,
					query,
					count: typeof input.body.count === 'number' ? input.body.count : undefined,
					allowedDomains: Array.isArray(input.body.allowed_domains)
						? (input.body.allowed_domains as string[])
						: undefined,
					blockedDomains: Array.isArray(input.body.blocked_domains)
						? (input.body.blocked_domains as string[])
						: undefined,
					fetchImpl: globalThis.fetch.bind(globalThis),
				});
				payload = { provider, results, playground: true };
				upstreamLabel = `engine://web-search/${provider}`;
				break;
			}
			case 'web-fetch': {
				if (!isWebFetchProvider(provider)) throw badRequest('invalid web-fetch provider');
				const catalogRaw = await loadCatalogRaw(repos, WEB_FETCH_CATALOG_KEY);
				const catalog = parseWebFetchCatalogLenient(catalogRaw);
				const entry = catalog?.[provider as WebFetchProvider];
				const apiKey = entry?.apiKey?.trim() ?? '';
				if (!apiKey) {
					return {
						response: jsonResponse(503, {
							error: `Web fetch provider "${provider}" has no API key in WEB_FETCH_CATALOG`,
						}),
						upstreamUrlForHeader: upstreamLabel,
						latencyMs: Date.now() - start,
						upstreamWireBodyJson,
					};
				}
				const url = requireString(input.body, 'url');
				const guard = assertFetchUrlSafe(url);
				if (!guard.ok) {
					throw badRequest(guard.error);
				}
				const result = await fetchUrlByProvider(provider, {
					apiKey,
					url,
					fetchImpl: globalThis.fetch.bind(globalThis),
				});
				payload = { provider, result, playground: true };
				upstreamLabel = `engine://web-fetch/${provider}`;
				break;
			}
			case 'web-deep-search': {
				if (!isWebDeepSearchProvider(provider)) {
					throw badRequest('invalid web-deep-search provider');
				}
				const catalogRaw = await loadCatalogRaw(repos, WEB_DEEP_SEARCH_CATALOG_KEY);
				const catalog = parseWebDeepSearchCatalogLenient(catalogRaw);
				const entry = catalog?.[provider as WebDeepSearchProvider];
				const apiKey = entry?.apiKey?.trim() ?? '';
				if (!apiKey) {
					return {
						response: jsonResponse(503, {
							error: `Web deep search provider "${provider}" has no API key in WEB_DEEP_SEARCH_CATALOG`,
						}),
						upstreamUrlForHeader: upstreamLabel,
						latencyMs: Date.now() - start,
						upstreamWireBodyJson,
					};
				}
				const query = requireString(input.body, 'query');
				if (query.length < 2) throw badRequest('query must be at least 2 characters');
				const count =
					typeof input.body.count === 'number'
						? clampDeepSearchCount(input.body.count)
						: undefined;
				const results = await deepSearchByProvider(provider, {
					apiKey,
					query,
					count,
					fetchImpl: globalThis.fetch.bind(globalThis),
				});
				payload = { provider, results, playground: true };
				upstreamLabel = `engine://web-deep-search/${provider}`;
				break;
			}
			case 'ai-detection': {
				const catalogRaw = await loadCatalogRaw(repos, AI_DETECTION_CATALOG_KEY);
				const catalog = parseAiDetectionCatalogLenient(catalogRaw);
				if (!catalog) {
					return {
						response: jsonResponse(503, { error: 'AI_DETECTION_CATALOG is missing or invalid' }),
						upstreamUrlForHeader: upstreamLabel,
						latencyMs: Date.now() - start,
						upstreamWireBodyJson,
					};
				}
				const resolved = resolveAiDetectionConfigForProvider(catalog, provider);
				if (!resolved.ok) {
					const message =
						resolved.reason === 'active_missing_key'
							? `AI detection provider "${resolved.provider}" credentials incomplete in catalog`
							: resolved.reason === 'provider_not_implemented'
								? `AI detection provider "${resolved.provider}" is not implemented`
								: resolved.reason === 'invalid_catalog'
									? 'AI_DETECTION_CATALOG is invalid'
									: `Invalid AI detection provider: ${'raw' in resolved ? resolved.raw : provider}`;
					return {
						response: jsonResponse(503, { error: message }),
						upstreamUrlForHeader: upstreamLabel,
						latencyMs: Date.now() - start,
						upstreamWireBodyJson,
					};
				}
				const driver = getAiDetectionDriver(resolved.config.provider);
				if (!driver) {
					return {
						response: jsonResponse(503, {
							error: `No driver for AI detection provider "${resolved.config.provider}"`,
						}),
						upstreamUrlForHeader: upstreamLabel,
						latencyMs: Date.now() - start,
						upstreamWireBodyJson,
					};
				}
				const text = requireString(input.body, 'text');
				const result = await detectAiRate(text, driver, resolved.config, {
					fetchImpl: globalThis.fetch.bind(globalThis),
				});
				payload = {
					provider: resolved.config.provider,
					score: result.overallScore,
					total_chars: result.totalChars,
					segments: result.segments.map((s) => ({
						index: s.index,
						chars: s.chars,
						score: s.score,
					})),
					playground: true,
					note: 'Playground direct engine call — no billing, no request log',
				};
				upstreamLabel = `engine://ai-detection/${resolved.config.provider}`;
				break;
			}
			default: {
				const _exhaustive: never = toolId;
				throw badRequest(`Unsupported tool: ${String(_exhaustive)}`);
			}
		}

		if (requestSignal?.aborted) {
			throw new DOMException('Aborted', 'AbortError');
		}

		return {
			response: jsonResponse(200, payload),
			upstreamUrlForHeader: upstreamLabel,
			latencyMs: Date.now() - start,
			upstreamWireBodyJson,
		};
	} catch (e) {
		if (e instanceof WebSearchProviderError || e instanceof WebFetchProviderError || e instanceof WebDeepSearchProviderError || e instanceof AiDetectionProviderError) {
			return {
				response: jsonResponse(e.status, { error: e.message, provider: e.provider, playground: true }),
				upstreamUrlForHeader: `engine://${toolId}/${provider}`,
				latencyMs: Date.now() - start,
				upstreamWireBodyJson,
			};
		}
		throw e;
	}
}
