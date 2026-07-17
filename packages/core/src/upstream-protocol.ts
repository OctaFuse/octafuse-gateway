/**
 * 上游协议枚举与 OpenAI Images URL 派生。
 * Provider 端点解析见 `provider-endpoints.ts`（`providers.endpoints` JSON）。
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

/**
 * 供应商行中与协议 endpoints 相关的字段子集。
 */
export interface ProviderBaseUrlFields {
	endpoints?: string | null;
}

export type OpenAiImagesPathSuffix = 'generations' | 'edits';

/**
 * 拼接 OpenAI 兼容 Images 上游 URL。
 *
 * - 常规：`{baseUrl}/images/{generations|edits}`（`baseUrl` 形如 `https://api.openai.com/v1`）
 * - 若 `baseUrl` 已是完整 Images 端点（标准 `/images/generations` 或 `/images/edits`，
 *   或网宿等 `.../openai-image-generations`），则：
 *   - 操作与端点一致时直接返回（不再追加路径）
 *   - 操作交叉时改写为对侧端点，避免 `.../generations/images/edits` 之类错误 URL
 */
export function buildOpenAiCompatibleImagesUrl(
	baseUrl: string,
	suffix: OpenAiImagesPathSuffix
): string {
	const base = baseUrl.trim().replace(/\/+$/, '');
	if (!base) {
		throw new Error('OpenAI images base URL is empty');
	}

	const lower = base.toLowerCase();
	const standardGenerations = /\/images\/generations$/i.test(lower);
	const standardEdits = /\/images\/edits$/i.test(lower);
	/** 网宿等把文生图做成独立 gateway path，而非 OpenAI `/v1` 根 */
	const vendorGenerations = /(?:^|\/)(?:openai-)?image-generations$/i.test(lower);
	const vendorEdits = /(?:^|\/)(?:openai-)?image-edits$/i.test(lower);

	if (standardGenerations) {
		return suffix === 'generations'
			? base
			: base.replace(/\/images\/generations$/i, '/images/edits');
	}
	if (standardEdits) {
		return suffix === 'edits'
			? base
			: base.replace(/\/images\/edits$/i, '/images/generations');
	}

	if (vendorGenerations) {
		if (suffix === 'generations') {
			return base;
		}
		// openai-image-generations → openai-image-edits；image-generations → image-edits
		return base.replace(/(openai-)?image-generations$/i, (_m, openaiPrefix: string | undefined) =>
			`${openaiPrefix ?? ''}image-edits`
		);
	}
	if (vendorEdits) {
		if (suffix === 'edits') {
			return base;
		}
		return base.replace(/(openai-)?image-edits$/i, (_m, openaiPrefix: string | undefined) =>
			`${openaiPrefix ?? ''}image-generations`
		);
	}

	return `${base}/images/${suffix}`;
}
