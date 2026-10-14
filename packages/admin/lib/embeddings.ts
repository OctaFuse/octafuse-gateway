/**
 * Playground / Simulator / Routes 快速测试共用的向量（Embeddings）辅助：
 * 请求体模板、模型判定、响应摘要（向量个数 / 维度 / 前几位数值）。
 */
import { isEmbeddingModel, type ModelKindFields } from '@octafuse/core/db/model-modalities';
import { tryParseUsageSummary } from '@/lib/playground/usage-parsing';

export function isEmbeddingRouteModel(m: ModelKindFields): boolean {
	return isEmbeddingModel(m);
}

/** OpenAI `POST /v1/embeddings` 示例体。 */
export const EMBEDDING_OPENAI_BODY_TEMPLATE = `{
  "input": ["OctaFuse gateway embeddings smoke test"],
  "encoding_format": "float"
}`;

/** Gemini `:embedContent` 示例体。 */
export const EMBEDDING_GEMINI_EMBED_BODY_TEMPLATE = `{
  "content": { "parts": [{ "text": "OctaFuse gateway embeddings smoke test" }] }
}`;

/** Gemini `:batchEmbedContents` 示例体（`requests[].model` 由网关改写）。 */
export const EMBEDDING_GEMINI_BATCH_BODY_TEMPLATE = `{
  "requests": [
    { "content": { "parts": [{ "text": "first text" }] } },
    { "content": { "parts": [{ "text": "second text" }] } }
  ]
}`;

export function embeddingBodyTemplateFor(input: { protocol: string }): string {
	return input.protocol === 'gemini' ? EMBEDDING_GEMINI_EMBED_BODY_TEMPLATE : EMBEDDING_OPENAI_BODY_TEMPLATE;
}

export type EmbeddingResponseSummary = {
	vectorCount: number;
	dimensions: number;
	/** 第一条向量的前若干位（base64 编码时为空） */
	preview: number[];
};

const PREVIEW_LENGTH = 5;

function asNumberArray(value: unknown): number[] | null {
	if (!Array.isArray(value) || value.length === 0) return null;
	return value.every((n) => typeof n === 'number') ? (value as number[]) : null;
}

/**
 * 解析 OpenAI（`data[].embedding`）与 Gemini（`embedding.values` / `embeddings[].values`）响应；
 * 无法识别返回 null。`encoding_format=base64` 时 `embedding` 为字符串，仅统计向量个数。
 */
export function parseEmbeddingResponse(text: string): EmbeddingResponseSummary | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return null;
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
	const obj = parsed as Record<string, unknown>;

	const vectors: Array<number[] | null> = [];
	if (Array.isArray(obj.data)) {
		for (const item of obj.data) {
			if (typeof item !== 'object' || item === null) continue;
			const embedding = (item as { embedding?: unknown }).embedding;
			vectors.push(asNumberArray(embedding));
		}
	}
	if (vectors.length === 0 && Array.isArray(obj.embeddings)) {
		for (const item of obj.embeddings) {
			if (typeof item !== 'object' || item === null) continue;
			vectors.push(asNumberArray((item as { values?: unknown }).values));
		}
	}
	if (vectors.length === 0 && typeof obj.embedding === 'object' && obj.embedding !== null) {
		vectors.push(asNumberArray((obj.embedding as { values?: unknown }).values));
	}
	if (vectors.length === 0) return null;

	const first = vectors.find((v): v is number[] => v != null);
	return {
		vectorCount: vectors.length,
		dimensions: first?.length ?? 0,
		preview: first ? first.slice(0, PREVIEW_LENGTH) : [],
	};
}

/** 单行展示摘要：`2 vectors · 1536 dims · [0.01, -0.02, …]`。 */
export function summarizeEmbeddingResponse(text: string): string | null {
	const parsed = parseEmbeddingResponse(text);
	if (!parsed) return null;
	const parts = [`${parsed.vectorCount} vector${parsed.vectorCount === 1 ? '' : 's'}`];
	if (parsed.dimensions > 0) parts.push(`${parsed.dimensions} dims`);
	if (parsed.preview.length > 0) {
		parts.push(`[${parsed.preview.map((n) => Number(n.toPrecision(4))).join(', ')}, …]`);
	}
	return parts.join(' · ');
}

/** 向量响应的 usage 提示：向量摘要 + token 用量（缺任一项则只显示另一项）。 */
export function joinEmbeddingUsageHint(text: string, protocol: string): string | null {
	const vectors = summarizeEmbeddingResponse(text);
	const usage = tryParseUsageSummary(text, protocol);
	const parts = [vectors, usage].filter((part): part is string => Boolean(part));
	return parts.length > 0 ? parts.join(' · ') : null;
}
