/**
 * 上游协议枚举与解析：`model_routes.upstream_protocol` 与供应商表 `base_url_*` 列的对应关系。
 * `resolveEffectiveBaseUrl` 按协议选取非空根 URL，供 OpenAI/Anthropic/Gemini 三类 driver 拼请求路径。
 */
export type UpstreamProtocol = 'openai' | 'anthropic' | 'gemini';

/** 允许写入 D1 或参与校验的协议字面量列表。 */
export const UPSTREAM_PROTOCOLS: readonly UpstreamProtocol[] = ['openai', 'anthropic', 'gemini'] as const;

const PROTOCOL_LIST = UPSTREAM_PROTOCOLS.join(', ');

/**
 * 规范化已存储或非空入参。空白或无法识别的值抛错。
 * HTTP/表单未传协议时，应在调用方用 `?? 'openai'`（与 `model_routes` 默认值一致）。
 * @param raw 大小写不敏感，前后空格会被 trim
 * @throws Error 非法协议字符串
 */
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

/** 供应商行中与三协议根 URL 相关的字段子集（读写均可选）。 */
export interface ProviderBaseUrlFields {
  base_url_openai?: string | null;
  base_url_anthropic?: string | null;
  base_url_gemini?: string | null;
}

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

function readProviderProtocolBase(protocol: UpstreamProtocol, provider: ProviderBaseUrlFields): string | null {
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
 * 解析某协议下实际上游根 URL：去尾部斜杠；未配置则抛错（便于日志定位）。
 * @param protocol 路由选用的上游协议
 * @param provider 含 `base_url_*` 的对象（通常来自 `providers` 行）
 * @param providerId 可选，仅用于错误信息
 * @returns 非空、已 trim、无尾斜杠的根 URL
 * @throws Error 该协议对应列为空
 */
export function resolveEffectiveBaseUrl(
  protocol: UpstreamProtocol,
  provider: ProviderBaseUrlFields,
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

/**
 * 是否已为该协议配置非空 base URL（创建路由前校验）。
 */
export function providerSupportsUpstreamProtocol(
  protocol: UpstreamProtocol,
  provider: ProviderBaseUrlFields
): boolean {
  return readProviderProtocolBase(protocol, provider) != null;
}
