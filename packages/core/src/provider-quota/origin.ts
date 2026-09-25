/**
 * 额度请求的 origin 必须落在适配器默认域名上。
 * 自定义端点若换了注册域，回退默认 origin，避免把供应商密钥发到别的主机。
 */
import { parseProviderEndpoints, type ProviderEndpointsMap } from '../provider-endpoints';

export function registrableDomain(hostname: string): string {
	const labels = hostname
		.toLowerCase()
		.replace(/\.$/, '')
		.split('.')
		.filter((label) => label.length > 0);
	if (labels.length <= 2) return labels.join('.');
	return labels.slice(-2).join('.');
}

function collectEndpointUrls(endpoints: string | ProviderEndpointsMap | null | undefined): string[] {
	let map: ProviderEndpointsMap;
	try {
		map = parseProviderEndpoints({ endpoints: endpoints ?? null });
	} catch {
		return [];
	}
	const urls: string[] = [];
	for (const config of Object.values(map)) {
		if (!config) continue;
		if (config.base) urls.push(config.base);
		for (const value of Object.values(config.endpoints ?? {})) {
			if (value) urls.push(value);
		}
	}
	return urls;
}

/** 取第一个与 `defaultOrigin` 同一注册域的 https origin；否则用默认 origin。 */
export function resolveProviderQuotaOrigin(
	endpoints: string | ProviderEndpointsMap | null | undefined,
	defaultOrigin: string,
): string {
	const fallback = new URL(defaultOrigin);
	const expected = registrableDomain(fallback.hostname);
	for (const raw of collectEndpointUrls(endpoints)) {
		let url: URL;
		try {
			url = new URL(raw);
		} catch {
			continue;
		}
		if (url.protocol !== 'https:') continue;
		if (registrableDomain(url.hostname) !== expected) continue;
		return url.origin;
	}
	return fallback.origin;
}
