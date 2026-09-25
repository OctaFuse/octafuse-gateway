/**
 * 额度 HTTP：只把密钥发到已解析 origin，不跟随重定向，错误信息不带回响应体。
 */
import { registrableDomain } from './origin';
import {
	ProviderQuotaParseError,
	ProviderQuotaUpstreamError,
	type ProviderQuotaFetchContext,
} from './types';

export function finiteNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
}

export function isJsonRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === 'object' && !Array.isArray(value);
}

export async function fetchProviderQuotaJson(
	ctx: ProviderQuotaFetchContext,
	path: string,
): Promise<unknown> {
	if (!path.startsWith('/') || path.startsWith('//')) {
		throw new ProviderQuotaParseError('Quota path must be a relative path');
	}
	const origin = new URL(ctx.origin);
	if (origin.protocol !== 'https:') {
		throw new ProviderQuotaUpstreamError(0, 'Upstream quota origin must be https');
	}
	const url = new URL(path, origin.origin);
	if (url.origin !== origin.origin || registrableDomain(url.hostname) !== registrableDomain(origin.hostname)) {
		throw new ProviderQuotaUpstreamError(0, 'Upstream quota host is not allowed');
	}

	let response: Response;
	try {
		response = await ctx.fetchImpl(url, {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${ctx.apiKey}`,
				Accept: 'application/json',
			},
			redirect: 'error',
			signal: ctx.signal,
		});
	} catch (error) {
		if (error instanceof Error && /redirect/i.test(error.message)) {
			throw new ProviderQuotaUpstreamError(0, 'Upstream quota request was redirected');
		}
		throw error;
	}

	if (!response.ok) {
		throw new ProviderQuotaUpstreamError(response.status, `Upstream quota request failed (${response.status})`);
	}
	try {
		return await response.json();
	} catch {
		throw new ProviderQuotaParseError();
	}
}
