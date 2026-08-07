/**
 * 上游协议与供应商 endpoints 映射；与 octafuse `upstream_protocol` 语义一致，供路由表单校验与展示。
 */
import {
	providerSupportsUpstreamProtocol as coreProviderSupportsUpstreamProtocol,
	resolveEffectiveBaseUrl as coreResolveEffectiveBaseUrl,
	type ProviderEndpointsSource,
} from '@octafuse/core/provider-endpoints';
import {
	normalizeUpstreamProtocol as normalizeCoreUpstreamProtocol,
	UPSTREAM_PROTOCOLS as CORE_UPSTREAM_PROTOCOLS,
	type UpstreamProtocol as CoreUpstreamProtocol,
} from '@octafuse/core/upstream-protocol';
import type { GatewayProvider } from './types';

/** 管理端直接复用 Core 协议类型，避免新增协议后两处白名单分叉。 */
export type UpstreamProtocol = CoreUpstreamProtocol;

export const UPSTREAM_PROTOCOLS: readonly UpstreamProtocol[] = CORE_UPSTREAM_PROTOCOLS;

/** 字符串是否为受支持的上游协议。 */
export function isUpstreamProtocol(s: string): s is UpstreamProtocol {
	return (UPSTREAM_PROTOCOLS as readonly string[]).includes(s);
}

/** 与 Gateway 一致：空白或非法值抛错；请求体未传时在调用方使用 `?? 'openai'`。 */
export function normalizeUpstreamProtocol(raw: string): UpstreamProtocol {
	return normalizeCoreUpstreamProtocol(raw);
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
