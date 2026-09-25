/**
 * 实时查询供应商额度。不落库；密钥只交给对应 kind 的适配器。
 */
import type { GatewayRepositories } from '@octafuse/core';
import { isPendingProviderImportApiKey } from '@octafuse/core/db/provider-key-utils';
import {
	getProviderQuotaAdapter,
	ProviderQuotaParseError,
	ProviderQuotaUpstreamError,
	resolveProviderQuotaOrigin,
	type ProviderQuotaSnapshot,
} from '@octafuse/core/provider-quota';
import { AdminServiceError, badRequest, notFound } from './errors';

const DEFAULT_TIMEOUT_MS = 10_000;

export type ProviderQuotaQueryOptions = {
	fetchImpl?: typeof fetch;
	now?: () => Date;
	timeoutMs?: number;
};

function upstreamError(status: number, message: string): AdminServiceError {
	return new AdminServiceError(status, message);
}

function isTimeoutError(error: unknown): boolean {
	return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

export async function getProviderQuotaService(
	repos: GatewayRepositories,
	providerId: string,
	options: ProviderQuotaQueryOptions = {},
): Promise<ProviderQuotaSnapshot> {
	const provider = await repos.providers.getProviderById(providerId);
	if (!provider) throw notFound('Provider not found');
	const adapter = getProviderQuotaAdapter(provider.kind);
	if (!adapter) throw badRequest('Provider kind does not support quota query');
	const apiKey = provider.api_key?.trim() ?? '';
	if (!apiKey || isPendingProviderImportApiKey(apiKey)) {
		throw badRequest('Provider API key is not configured');
	}

	const origin = resolveProviderQuotaOrigin(provider.endpoints, adapter.defaultOrigin);
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	try {
		return await adapter.fetch({
			apiKey,
			origin,
			fetchImpl: options.fetchImpl ?? fetch,
			signal: AbortSignal.timeout(timeoutMs),
			now: options.now,
		});
	} catch (error) {
		if (error instanceof ProviderQuotaUpstreamError) {
			throw upstreamError(502, error.message);
		}
		if (error instanceof ProviderQuotaParseError) {
			throw upstreamError(502, error.message);
		}
		if (isTimeoutError(error)) {
			throw upstreamError(504, 'Upstream quota request timed out');
		}
		throw error;
	}
}
