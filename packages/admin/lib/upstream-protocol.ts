/**
 * 上游协议与供应商 `base_url_*` 列映射；与 octafuse `upstream_protocol` 语义一致，供路由表单校验与展示。
 */
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

/** `providers` 表列名（用于错误提示）。 */
function protocolColumnName(protocol: UpstreamProtocol): string {
  switch (protocol) {
    case 'openai':
      return 'base_url_openai';
    case 'anthropic':
      return 'base_url_anthropic';
    case 'gemini':
      return 'base_url_gemini';
    default: {
      const _exhaustive: never = protocol;
      throw new Error(`Unknown upstream protocol: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/** 读取供应商上对应协议的非空 base URL（去尾 `/`）；未配置返回 null。 */
function readProviderProtocolBase(protocol: UpstreamProtocol, provider: GatewayProvider): string | null {
  const trim = (s: string) => s.replace(/\/$/, '');
  let col: string | null | undefined;
  switch (protocol) {
    case 'openai':
      col = provider.base_url_openai;
      break;
    case 'anthropic':
      col = provider.base_url_anthropic;
      break;
    case 'gemini':
      col = provider.base_url_gemini;
      break;
    default: {
      const _exhaustive: never = protocol;
      throw new Error(`Unknown upstream protocol: ${JSON.stringify(_exhaustive)}`);
    }
  }
  if (col != null && String(col).trim() !== '') {
    return trim(String(col).trim());
  }
  return null;
}

/**
 * 解析某协议下的实际上游根 URL；缺失时抛错并提示应配置哪一列。
 */
export function resolveEffectiveBaseUrl(
  protocol: UpstreamProtocol,
  provider: GatewayProvider,
  providerId?: string
): string {
  const url = readProviderProtocolBase(protocol, provider);
  if (url) {
    return url;
  }
  const col = protocolColumnName(protocol);
  const who = providerId != null && providerId !== '' ? `provider_id=${JSON.stringify(providerId)}` : 'provider';
  throw new Error(
    `${who}: no upstream base URL for protocol "${protocol}" (configure providers.${col})`
  );
}

/** 该供应商是否已为指定协议配置非空 base URL。 */
export function providerSupportsUpstreamProtocol(protocol: UpstreamProtocol, provider: GatewayProvider): boolean {
  return readProviderProtocolBase(protocol, provider) != null;
}
