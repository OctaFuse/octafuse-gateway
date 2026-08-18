/**
 * Vertex 官方 OpenAI 兼容层要求 model 带 `google/` publisher 前缀。
 * Gemini 原生 path 已含 `publishers/google/models/`，不要加此前缀。
 */

export function isVertexOpenAiCompatibleUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return (
			parsed.hostname.toLowerCase().endsWith('aiplatform.googleapis.com') &&
			parsed.pathname.includes('/endpoints/openapi')
		);
	} catch {
		return false;
	}
}

export function applyVertexOpenAiModelPrefix(upstreamUrl: string, modelName: string): string {
	const trimmed = modelName.trim();
	if (!trimmed || !isVertexOpenAiCompatibleUrl(upstreamUrl)) return trimmed;
	if (trimmed.includes('/')) return trimmed;
	return `google/${trimmed}`;
}
