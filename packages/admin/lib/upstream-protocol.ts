/**
 * 上游协议与供应商 endpoints 映射；与 octafuse `upstream_protocol` 语义一致，供路由表单校验与展示。
 */
import {
	providerSupportsUpstreamProtocol as coreProviderSupportsUpstreamProtocol,
	resolveEffectiveBaseUrl as coreResolveEffectiveBaseUrl,
	type ProviderEndpointsSource,
} from '@octafuse/core/provider-endpoints';
import type { GatewayProvider } from './types';

export type UpstreamProtocol = 'openai' | 'anthropic' | 'gemini';

export const UPSTREAM_PROTOCOLS: readonly UpstreamProtocol[] = ['openai', 'anthropic', 'gemini'] as const;

const PROTOCOL_LIST = UPSTREAM_PROTOCOLS.join(', ');

/** 字符串是否为三协议之一。 */
export function isUpstreamProtocol(s: string): s is UpstreamProtocol {
	return (UPSTREAM_PROTOCOLS as readonly string[]).includes(s);
}

/** 与 Gateway 一致：空白或非法值抛错；请求体未传时在调用方使用 `?? 'openai'`。 */
export function normalizeUpstreamProtocol(raw: string): UpstreamProtocol {
	const v = raw.trim().toLowerCase();
	if (v === '') {
		throw new Error('Invalid upstream_protocol: empty string');
	}
	if (v === 'anthropic' || v === 'gemini' || v === 'openai') {
		return v;
	}
	throw new Error(
		`Invalid upstream_protocol ${JSON.stringify(raw)}: expected one of ${PROTOCOL_LIST}`
	);
}

function asEndpointsSource(provider: GatewayProvider | ProviderEndpointsSource): ProviderEndpointsSource {
	return {
		endpoints: provider.endpoints ?? null,
	};
}

/**
 * 解析某协议下的实际上游根 `base`；缺失时抛错。
 * 完整 capability URL 请用 `@octafuse/core` 的 `resolveUpstreamEndpoint`。
 */
export function resolveEffectiveBaseUrl(
	protocol: UpstreamProtocol,
	provider: GatewayProvider | ProviderEndpointsSource,
	providerId?: string
): string {
	return coreResolveEffectiveBaseUrl(protocol, asEndpointsSource(provider), providerId);
}

/** 该供应商是否已为指定协议配置 base 或任一 capability endpoint。 */
export function providerSupportsUpstreamProtocol(
	protocol: UpstreamProtocol,
	provider: GatewayProvider | ProviderEndpointsSource
): boolean {
	return coreProviderSupportsUpstreamProtocol(protocol, asEndpointsSource(provider));
}
