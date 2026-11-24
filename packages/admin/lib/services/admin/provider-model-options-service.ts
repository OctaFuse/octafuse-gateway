import type { GatewayRepositories } from '@octafuse/core';
import { parseProviderEndpoints } from '@octafuse/core/provider-endpoints';
import { isPendingProviderImportApiKey } from '@octafuse/core/db/provider-key-utils';
import { GCP_OAUTH_TOKEN_URL, getGcpAccessToken, parseGcpServiceAccountJson } from '@octafuse/core/gcp-service-account-token';
import {
	DISCOVERY_BODY_LIMIT, DISCOVERY_MODEL_LIMIT, DISCOVERY_PAGE_ITEMS_LIMIT, DISCOVERY_PAGE_LIMIT,
	discoveryAdapter, parseModelPage, type DiscoveryAdapter, type ModelOption,
} from '@/lib/provider-model-discovery';
import { AdminServiceError, notFound } from './errors';

export type ProviderModelOptions = {
	provider_id: string;
	kind: string;
	models: ModelOption[];
	discovery_available: boolean;
	credential_ready: boolean;
	discovery_reason: 'ready' | 'no_key' | 'endpoint_not_allowed' | 'unsupported';
	fetched_at: string | null;
	truncated: boolean;
};

export class ModelDiscoveryError extends AdminServiceError {
	constructor(status: number, readonly code: string, readonly upstreamStatus?: number, readonly retryAfterSeconds?: number) {
		super(status, code);
	}
}

function retryAfterSeconds(header: string | null): number | undefined {
	if (!header) return undefined;
	const seconds = /^\d+$/.test(header.trim()) ? Number(header.trim()) : Math.ceil((Date.parse(header) - Date.now()) / 1000);
	return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) : undefined;
}

type Provider = NonNullable<Awaited<ReturnType<GatewayRepositories['providers']['getProviderById']>>>;
export type DiscoveryOptions = { fetchImpl?: typeof fetch; now?: () => number; skipDnsCheck?: boolean; disabledKinds?: string };
const lastRefresh = new Map<string, number>();
const RATE_LIMIT_MS = 5_000;
const TOTAL_TIMEOUT_MS = 15_000;
const MAX_RETRY = 2;
const RATE_STATE_LIMIT = 10_000;
const OFFICIAL_INFERENCE_HOSTS: Readonly<Record<string, readonly string[]>> = {
	'MiniMax': ['api.minimaxi.com'],
	'Tencent Hunyuan': ['tokenhub.tencentmaas.com'],
	'Together AI': ['api.together.ai'],
};

function configuredUrls(provider: Provider, adapter: DiscoveryAdapter): string[] {
	const endpoints = parseProviderEndpoints(provider);
	const protocol = adapter.auth === 'anthropic' ? 'anthropic' : adapter.auth === 'google-key' || adapter.auth === 'vertex' ? 'gemini' : 'openai';
	const config = endpoints[protocol];
	return [config?.base, ...Object.values(config?.endpoints ?? {})].filter((value): value is string => typeof value === 'string');
}

function isDisabled(kind: string, disabledKinds?: string): boolean {
	return Boolean(disabledKinds?.split(',').some((item) => item.trim() === kind));
}

function vertexUrl(provider: Provider): URL {
	const urls = configuredUrls(provider, { url: '', auth: 'vertex', shape: 'publisherModels' });
	const base = urls.find((value) => /\/projects\/[^/]+\/locations\/[^/]+\/publishers\/google\/models/.test(value));
	if (!base) throw new ModelDiscoveryError(422, 'endpoint_not_allowed');
	let parsed: URL;
	try { parsed = new URL(base); } catch { throw new ModelDiscoveryError(422, 'endpoint_not_allowed'); }
	const match = /^\/v1\/projects\/([a-z][a-z0-9-]{0,63})\/locations\/([a-z0-9-]{1,20})\/publishers\/google\/models\/?$/.exec(parsed.pathname);
	const expectedHost = match?.[2] === 'global' ? 'aiplatform.googleapis.com' : `${match?.[2]}-aiplatform.googleapis.com`;
	if (!match || parsed.protocol !== 'https:' || parsed.hostname !== expectedHost || parsed.username || parsed.password || parsed.search || parsed.hash) {
		throw new ModelDiscoveryError(422, 'endpoint_not_allowed');
	}
	return parsed;
}

function targetUrl(provider: Provider, adapter: DiscoveryAdapter): URL {
	const target = adapter.auth === 'vertex' ? vertexUrl(provider) : new URL(adapter.url);
	const officialHost = adapter.auth === 'vertex' ? target.hostname : new URL(adapter.url).hostname;
	if (target.protocol !== 'https:' || target.hostname !== officialHost || target.port || target.username || target.password) throw new ModelDiscoveryError(422, 'endpoint_not_allowed');
	const allowedHosts = new Set([officialHost, ...(OFFICIAL_INFERENCE_HOSTS[provider.kind ?? ''] ?? [])]);
	for (const configured of configuredUrls(provider, adapter)) {
		let url: URL;
		try { url = new URL(configured); } catch { throw new ModelDiscoveryError(422, 'endpoint_not_allowed'); }
		if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname) || url.port || url.username || url.password) throw new ModelDiscoveryError(422, 'endpoint_not_allowed');
	}
	return target;
}

async function assertPublicDns(host: string): Promise<void> {
	if (typeof process === 'undefined' || !process.versions?.node) return;
	let lookup: typeof import('node:dns/promises')['lookup'];
	try { ({ lookup } = await import('node:dns/promises')); } catch { return; }
	let records: { address: string }[];
	try { records = await lookup(host, { all: true }); } catch { throw new ModelDiscoveryError(502, 'upstream_unavailable'); }
	if (!records.length) throw new ModelDiscoveryError(502, 'upstream_unavailable');
	for (const { address } of records) {
		if (!isPublicAddress(address)) throw new ModelDiscoveryError(422, 'endpoint_not_allowed');
	}
}

function isPublicAddress(address: string): boolean {
	const lower = address.toLowerCase();
	if (lower.startsWith('::ffff:')) return isPublicAddress(lower.slice(7));
	if (lower.includes(':')) return /^[23][0-9a-f]{3}:/.test(lower) && !lower.startsWith('2001:db8:');
	const octets = lower.split('.').map(Number);
	if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
	const [a, b] = octets;
	return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) || (a === 198 && (b === 18 || b === 19)));
}

async function readBounded(response: Response): Promise<unknown> {
	const length = Number(response.headers.get('content-length'));
	if (Number.isFinite(length) && length > DISCOVERY_BODY_LIMIT) throw new ModelDiscoveryError(502, 'upstream_response_too_large', response.status);
	if (!response.body) throw new ModelDiscoveryError(502, 'upstream_invalid_response', response.status);
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > DISCOVERY_BODY_LIMIT) throw new ModelDiscoveryError(502, 'upstream_response_too_large', response.status);
			chunks.push(value);
		}
	} finally { await reader.cancel().catch(() => undefined); }
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
	try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; } catch { throw new ModelDiscoveryError(502, 'upstream_invalid_response', response.status); }
}

function nextPageUrl(url: URL, adapter: DiscoveryAdapter, cursor: string, page: number): URL {
	const next = new URL(url);
	if (adapter.pagination === 'anthropic') next.searchParams.set('after_id', cursor);
	else if (adapter.pagination === 'cohere') next.searchParams.set('page_token', cursor);
	else if (adapter.pagination === 'pageToken') next.searchParams.set('pageToken', cursor);
	else if (adapter.pagination === 'aliyun') next.searchParams.set('page_no', String(page + 1));
	return next;
}

async function oneAttempt(url: URL, headers: Headers, adapter: DiscoveryAdapter, kind: string, fetchImpl: typeof fetch, deadline: number, now: () => number): Promise<{ models: ModelOption[]; truncated: boolean }> {
	const models: ModelOption[] = [];
	const seen = new Set<string>();
	const cursors = new Set<string>();
	let pageUrl = url;
	let truncated = false;
	for (let page = 0; page < DISCOVERY_PAGE_LIMIT; page++) {
		const remaining = deadline - now();
		if (remaining <= 0) throw new ModelDiscoveryError(504, 'upstream_timeout');
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), remaining);
		let response: Response;
		let body: unknown;
		try {
			response = await fetchImpl(pageUrl, { headers, redirect: 'manual', signal: controller.signal });
			if (response.status === 204) return { models, truncated };
			if (response.status === 401 || response.status === 403) throw new ModelDiscoveryError(502, 'upstream_auth_failed', response.status);
			if (response.status === 429) throw new ModelDiscoveryError(502, 'upstream_rate_limited', response.status, retryAfterSeconds(response.headers.get('Retry-After')));
			if (response.status >= 500) throw new ModelDiscoveryError(502, 'upstream_unavailable', response.status);
			if (!response.ok) throw new ModelDiscoveryError(502, 'upstream_invalid_response', response.status);
			body = await readBounded(response);
		} catch (error) {
			if (controller.signal.aborted) throw new ModelDiscoveryError(504, 'upstream_timeout');
			if (error instanceof ModelDiscoveryError) throw error;
			if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) throw new ModelDiscoveryError(504, 'upstream_timeout');
			throw new ModelDiscoveryError(502, 'upstream_unavailable');
		} finally { clearTimeout(timer); }
		let parsed: ReturnType<typeof parseModelPage>;
		try { parsed = parseModelPage(kind, adapter, body); } catch { throw new ModelDiscoveryError(502, 'upstream_invalid_response', response.status); }
		if (parsed.truncated) truncated = true;
		for (const option of parsed.models) {
			if (seen.has(option.id)) continue;
			seen.add(option.id);
			models.push(option);
			if (models.length >= DISCOVERY_MODEL_LIMIT) return { models, truncated: true };
		}
		const cursor = adapter.pagination === 'aliyun'
			? parsed.total && (page + 1) * DISCOVERY_PAGE_ITEMS_LIMIT < parsed.total ? String(page + 2) : null
			: parsed.next;
		if (!cursor) return { models, truncated };
		if (cursor.length > 256 || /[\u0000-\u001f\u007f]/.test(cursor)) return { models, truncated: true };
		if (cursors.has(cursor)) return { models, truncated: true };
		cursors.add(cursor);
		pageUrl = nextPageUrl(url, adapter, cursor, page + 1);
		if (page === DISCOVERY_PAGE_LIMIT - 1) truncated = true;
	}
	return { models, truncated };
}

function headersFor(adapter: DiscoveryAdapter, key: string): Headers {
	const headers = new Headers({ Accept: 'application/json' });
	if (adapter.auth === 'bearer' || adapter.auth === 'vertex') headers.set('Authorization', `Bearer ${key}`);
	if (adapter.auth === 'anthropic') { headers.set('x-api-key', key); headers.set('anthropic-version', '2023-06-01'); }
	return headers;
}

async function providerAndAdapter(repos: GatewayRepositories, id: string): Promise<{ provider: Provider; adapter?: DiscoveryAdapter }> {
	const provider = await repos.providers.getProviderById(id);
	if (!provider) throw notFound('Provider not found');
	return { provider, adapter: discoveryAdapter(provider.kind) };
}

export async function getProviderModelOptionsService(repos: GatewayRepositories, id: string, options: Pick<DiscoveryOptions, 'disabledKinds'> = {}): Promise<ProviderModelOptions> {
	const { provider, adapter } = await providerAndAdapter(repos, id);
	const enabledAdapter = adapter && !isDisabled(provider.kind ?? '', options.disabledKinds) ? adapter : undefined;
	const credentialReady = Boolean(provider.api_key?.trim()) && !isPendingProviderImportApiKey(provider.api_key);
	let reason: ProviderModelOptions['discovery_reason'] = !enabledAdapter ? 'unsupported' : enabledAdapter.auth !== 'none' && !credentialReady ? 'no_key' : 'ready';
	if (enabledAdapter && reason === 'ready') {
		try { targetUrl(provider, enabledAdapter); } catch { reason = 'endpoint_not_allowed'; }
	}
	return { provider_id: id, kind: provider.kind ?? '', models: [], discovery_available: Boolean(enabledAdapter), credential_ready: credentialReady, discovery_reason: reason, fetched_at: null, truncated: false };
}

export async function refreshProviderModelOptionsService(repos: GatewayRepositories, id: string, options: DiscoveryOptions = {}): Promise<ProviderModelOptions> {
	const now = options.now ?? Date.now;
	const started = now();
	let kind = '';
	try {
		const { provider, adapter } = await providerAndAdapter(repos, id);
		kind = provider.kind ?? '';
		if (!adapter || isDisabled(kind, options.disabledKinds)) throw new ModelDiscoveryError(422, 'discovery_unsupported');
		const key = provider.api_key?.trim() ?? '';
		if (adapter.auth !== 'none' && (!key || isPendingProviderImportApiKey(key))) throw new ModelDiscoveryError(400, 'provider_key_missing');
		const url = targetUrl(provider, adapter);
		if (!options.skipDnsCheck && !options.fetchImpl) await assertPublicDns(url.hostname);
		const previous = lastRefresh.get(id) ?? 0;
		if (started - previous < RATE_LIMIT_MS) throw new ModelDiscoveryError(429, 'refresh_rate_limited', undefined, Math.ceil((RATE_LIMIT_MS - (started - previous)) / 1000));
		lastRefresh.set(id, started);
		if (lastRefresh.size > RATE_STATE_LIMIT) lastRefresh.delete(lastRefresh.keys().next().value!);
		let secret = key;
		if (adapter.auth === 'vertex') {
			const account = parseGcpServiceAccountJson(key);
			if (!account) throw new ModelDiscoveryError(400, 'provider_key_missing');
			try {
				secret = await getGcpAccessToken({ ...account, token_uri: GCP_OAUTH_TOKEN_URL }, {
					fetchImpl: async (_input, init) => {
						const controller = new AbortController();
						const timer = setTimeout(() => controller.abort(), Math.max(1, started + TOTAL_TIMEOUT_MS - now()));
						try {
							const response = await (options.fetchImpl ?? fetch)(GCP_OAUTH_TOKEN_URL, { ...init, redirect: 'manual', signal: controller.signal });
							if (!response.ok) return new Response('{}', { status: response.status });
							return Response.json(await readBounded(response));
						} finally { clearTimeout(timer); }
					},
				});
			}
			catch { throw new ModelDiscoveryError(502, 'upstream_auth_failed'); }
		}
		if (adapter.auth === 'google-key') url.searchParams.set('key', key);
		if (adapter.pagination === 'aliyun') { url.searchParams.set('page_no', '1'); url.searchParams.set('page_size', String(DISCOVERY_PAGE_ITEMS_LIMIT)); }
		const headers = headersFor(adapter, secret);
		const deadline = started + TOTAL_TIMEOUT_MS;
		let result: { models: ModelOption[]; truncated: boolean } | undefined;
		for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
			try { result = await oneAttempt(url, headers, adapter, kind, options.fetchImpl ?? fetch, deadline, now); break; }
			catch (error) {
				if (!(error instanceof ModelDiscoveryError) || !['upstream_timeout', 'upstream_unavailable'].includes(error.code) || attempt === MAX_RETRY) throw error;
				const delay = (attempt === 0 ? 500 : 1000) + Math.floor(Math.random() * 201);
				if (now() + delay >= deadline) throw error;
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		}
		if (!result) throw new ModelDiscoveryError(502, 'upstream_unavailable');
		return { provider_id: id, kind, models: result.models, discovery_available: true, credential_ready: Boolean(key), discovery_reason: 'ready', fetched_at: new Date(now()).toISOString(), truncated: result.truncated };
	} catch (error) {
		const safe = error instanceof ModelDiscoveryError ? error : error instanceof AdminServiceError ? new ModelDiscoveryError(error.status, 'provider_not_found') : new ModelDiscoveryError(502, 'upstream_unavailable');
		const logKey = `${id}:${safe.code}`;
		if (now() - (lastFailureLog.get(logKey) ?? 0) > 10_000) {
			lastFailureLog.set(logKey, now());
			if (lastFailureLog.size > RATE_STATE_LIMIT) lastFailureLog.delete(lastFailureLog.keys().next().value!);
			console.info('[provider-model-discovery]', { provider_id: id, kind, code: safe.code, duration_ms: now() - started, ...(safe.upstreamStatus ? { upstream_status: safe.upstreamStatus } : {}) });
		}
		throw safe;
	}
}

const lastFailureLog = new Map<string, number>();
