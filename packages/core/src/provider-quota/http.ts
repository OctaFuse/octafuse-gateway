/**
 * 额度 HTTP：密钥只发到已解析 origin 的同一注册域，不跟随重定向，错误信息不带回响应体。
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

function assertQuotaUrl(ctx: ProviderQuotaFetchContext, url: URL, sameOrigin: boolean): void {
	const origin = new URL(ctx.origin);
	if (origin.protocol !== 'https:' || url.protocol !== 'https:') {
		throw new ProviderQuotaUpstreamError(0, 'Upstream quota origin must be https');
	}
	if (registrableDomain(url.hostname) !== registrableDomain(origin.hostname)) {
		throw new ProviderQuotaUpstreamError(0, 'Upstream quota host is not allowed');
	}
	if (sameOrigin && url.origin !== origin.origin) {
		throw new ProviderQuotaUpstreamError(0, 'Upstream quota host is not allowed');
	}
}

async function requestQuotaJson(ctx: ProviderQuotaFetchContext, url: URL): Promise<unknown> {

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

/** 相对路径必须落在已解析 origin 上。 */
export async function fetchProviderQuotaJson(
	ctx: ProviderQuotaFetchContext,
	path: string,
): Promise<unknown> {
	if (!path.startsWith('/') || path.startsWith('//')) {
		throw new ProviderQuotaParseError('Quota path must be a relative path');
	}
	const url = new URL(path, new URL(ctx.origin).origin);
	assertQuotaUrl(ctx, url, true);
	return requestQuotaJson(ctx, url);
}

/**
 * 绝对地址可以换到同一注册域的另一台主机（例如 api 与 www），不能换到别的注册域。
 */
export async function fetchProviderQuotaJsonFromUrl(
	ctx: ProviderQuotaFetchContext,
	absoluteUrl: string,
): Promise<unknown> {
	let url: URL;
	try {
		url = new URL(absoluteUrl);
	} catch {
		throw new ProviderQuotaParseError('Quota URL is invalid');
	}
	assertQuotaUrl(ctx, url, false);
	return requestQuotaJson(ctx, url);
}
