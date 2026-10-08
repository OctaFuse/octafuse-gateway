/**
 * Gemini 原生 `generateContent` / `streamGenerateContent` 生图的共享解析。
 * 图片在 `candidates[].content.parts[].inlineData`（或 `inline_data`）。
 * `thought: true` 的中间图不计张数、不计为参考图。
 */

/** 官方 `candidateCount` 上限。预检按请求张数，超出部分截到这个上限。 */
export const GEMINI_MAX_CANDIDATE_COUNT = 8;

function asObject(value: unknown): Record<string, unknown> | null {
	return value != null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function asPositiveInt(value: unknown): number | null {
	const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
	if (!Number.isFinite(n) || n < 1) return null;
	return Math.floor(n);
}

function isThought(part: Record<string, unknown>): boolean {
	return part.thought === true;
}

function imageMime(mime: unknown): boolean {
	if (typeof mime !== 'string' || mime.trim() === '') return true;
	return mime.trim().toLowerCase().startsWith('image/');
}

/** 非 thought 的 inlineData 图片 part。mime 缺省时只要 data 非空就计数。 */
export function isGeminiInlineImagePart(part: unknown): boolean {
	const row = asObject(part);
	if (!row || isThought(row)) return false;
	const inline = asObject(row.inlineData) ?? asObject(row.inline_data);
	if (!inline) return false;
	if (!imageMime(inline.mimeType ?? inline.mime_type)) return false;
	return typeof inline.data === 'string' && inline.data.trim() !== '';
}

function isGeminiFileImagePart(part: unknown): boolean {
	const row = asObject(part);
	if (!row || isThought(row)) return false;
	const file = asObject(row.fileData) ?? asObject(row.file_data);
	if (!file) return false;
	if (!imageMime(file.mimeType ?? file.mime_type)) return false;
	const uri = file.fileUri ?? file.file_uri;
	return typeof uri === 'string' && uri.trim() !== '';
}

function partsOf(content: unknown): unknown[] {
	const parts = asObject(content)?.parts;
	return Array.isArray(parts) ? parts : [];
}

/**
 * 一次 JSON（完整响应或单个 SSE chunk）里的非 thought 图片数。
 * 流式由调用方把各 chunk 的返回值相加；官方流式 chunk 不重复已发送的 part。
 */
export function countGeminiOutputImages(body: unknown): number {
	const root = asObject(body);
	const candidates = root?.candidates;
	if (!Array.isArray(candidates)) return 0;
	let count = 0;
	for (const candidate of candidates) {
		for (const part of partsOf(asObject(candidate)?.content)) {
			if (isGeminiInlineImagePart(part)) count += 1;
		}
	}
	return count;
}

/** 计费用分辨率。读 `generationConfig.imageConfig.imageSize`，缺省 `auto`。 */
export function geminiImageBillingSize(body: Record<string, unknown>): string {
	const generation = asObject(body.generationConfig) ?? asObject(body.generation_config);
	const image = asObject(generation?.imageConfig) ?? asObject(generation?.image_config);
	const size = image?.imageSize ?? image?.image_size;
	if (typeof size !== 'string' || size.trim() === '') return 'auto';
	return size.trim().toLowerCase();
}

/** 请求 `contents` 里的参考图：inlineData 或带 fileUri 的 fileData。 */
export function countGeminiReferenceImages(body: Record<string, unknown>): number {
	const contents = body.contents;
	if (!Array.isArray(contents)) return 0;
	let count = 0;
	for (const content of contents) {
		for (const part of partsOf(content)) {
			if (isGeminiInlineImagePart(part) || isGeminiFileImagePart(part)) count += 1;
		}
	}
	return count;
}

/** 预算预检张数。`generationConfig.candidateCount` 缺省为 1，上限 8。 */
export function requestedGeminiImageCount(body: Record<string, unknown>): number {
	const generation = asObject(body.generationConfig) ?? asObject(body.generation_config);
	const raw = generation?.candidateCount ?? generation?.candidate_count;
	const count = asPositiveInt(raw) ?? 1;
	return Math.min(GEMINI_MAX_CANDIDATE_COUNT, count);
}

function usageMetadataOf(parsed: unknown): unknown | null {
	const root = asObject(parsed);
	const usage = root?.usageMetadata ?? root?.usage_metadata;
	return usage != null && typeof usage === 'object' ? usage : null;
}

function sseDataPayload(event: string): string | null {
	const lines = event.split(/\r?\n/);
	const data: string[] = [];
	for (const line of lines) {
		if (!line.startsWith('data:')) continue;
		data.push(line.slice(5).trimStart());
	}
	if (data.length === 0) return null;
	return data.join('\n');
}

/**
 * 扫描 `streamGenerateContent?alt=sse` 的一段文本。
 * 以空行分事件；未完成的尾巴放回 `carry`。最后一个带 `usageMetadata` 的事件覆盖之前的 usage。
 */
export function scanGeminiGenerateContentSse(
	chunk: string,
	carry: string,
): { carry: string; imageCount: number; usageMetadata: unknown | null } {
	const parts = (carry + chunk).split(/\r?\n\r?\n/);
	const nextCarry = parts.pop() ?? '';
	let imageCount = 0;
	let usageMetadata: unknown | null = null;
	for (const event of parts) {
		const data = sseDataPayload(event);
		if (data == null || data === '[DONE]') continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(data);
		} catch {
			continue;
		}
		imageCount += countGeminiOutputImages(parsed);
		const usage = usageMetadataOf(parsed);
		if (usage) usageMetadata = usage;
	}
	return { carry: nextCarry, imageCount, usageMetadata };
}
