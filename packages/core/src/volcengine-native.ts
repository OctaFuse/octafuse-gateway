/**
 * 火山方舟 / BytePlus Seedream `POST /api/v3/images/generations` 的共享解析。
 * Proxy 透传与计费共用，避免两处各自解释 `usage.generated_images` 和 SSE 事件。
 *
 * 非流式成功体带 `usage.generated_images` 与 `data[]`（`url` 或 `b64_json`）。
 * 流式 SSE 事件：`image_generation.partial_succeeded`、`image_generation.partial_failed`、
 * `image_generation.completed`（`usage.generated_images`）、`error`。
 * 组图 `sequential_image_generation_options.max_images` 取值 [1, 15]。
 */

/** 官方组图上限。参考图张数 + 生成张数 ≤ 15。 */
export const VOLCENGINE_MAX_SEQUENTIAL_IMAGES = 15;

function asObject(value: unknown): Record<string, unknown> | null {
	return value != null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function asNonNegative(value: unknown): number | null {
	const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
	return Number.isFinite(n) && n >= 0 ? n : null;
}

function imageItemSucceeded(item: unknown): boolean {
	const row = asObject(item);
	if (!row) return false;
	const url = typeof row.url === 'string' && row.url.trim() !== '';
	const b64 = typeof row.b64_json === 'string' && row.b64_json.trim() !== '';
	return url || b64;
}

/**
 * 成功生成的图片数。优先 `usage.generated_images`（失败张数不计入）。
 * 没有 usage 时，只数带 `url` 或 `b64_json` 的 `data[]`。
 */
export function countVolcengineImages(body: unknown): number {
	const root = asObject(body);
	const generated = asNonNegative(asObject(root?.usage)?.generated_images);
	if (generated != null) return Math.floor(generated);
	const data = root?.data;
	if (!Array.isArray(data)) return 0;
	return data.filter(imageItemSucceeded).length;
}

/**
 * 预算预检用的请求张数。
 * `sequential_image_generation=auto` 时取 `max_images`；缺省或非法时按官方上限 15。
 * 其它情况（含默认 `disabled`）为 1。
 */
export function requestedVolcengineImageCount(body: Record<string, unknown>): number {
	const mode =
		typeof body.sequential_image_generation === 'string'
			? body.sequential_image_generation.trim().toLowerCase()
			: '';
	if (mode !== 'auto') return 1;
	const raw = asObject(body.sequential_image_generation_options)?.max_images;
	const n = asNonNegative(raw);
	if (n == null || n <= 0) return VOLCENGINE_MAX_SEQUENTIAL_IMAGES;
	return Math.min(VOLCENGINE_MAX_SEQUENTIAL_IMAGES, Math.floor(n));
}

export type VolcengineImageSseScan = {
	/** 本段里 `image_generation.completed` 的最新 `usage.generated_images`。 */
	generatedImages: number | null;
	/** 本段完整结束的 `image_generation.partial_succeeded` 事件数。 */
	partialSucceeded: number;
	/** 本段是否出现请求级 `error` 事件。`partial_failed` 不算。 */
	error: boolean;
	carry: string;
};

function eventType(payload: Record<string, unknown> | null, eventName: string): string {
	return typeof payload?.type === 'string' && payload.type.trim() ? payload.type.trim() : eventName;
}

function consumeSseEvent(block: string, scan: { generatedImages: number | null; partialSucceeded: number; error: boolean }): void {
	let eventName = '';
	const dataLines: string[] = [];
	for (const rawLine of block.split('\n')) {
		const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
		if (line === '' || line.startsWith(':')) continue;
		if (line.startsWith('event:')) {
			eventName = line.slice('event:'.length).trim();
			continue;
		}
		if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trimStart());
	}
	const data = dataLines.join('\n').trim();
	if (!data || data === '[DONE]') return;
	let parsed: unknown = null;
	try {
		parsed = JSON.parse(data) as unknown;
	} catch {
		parsed = null;
	}
	const payload = asObject(parsed);
	const type = eventType(payload, eventName);
	if (type === 'image_generation.partial_succeeded') scan.partialSucceeded += 1;
	if (type === 'error') scan.error = true;
	if (type === 'image_generation.completed') {
		const generated = asNonNegative(asObject(payload?.usage)?.generated_images);
		if (generated != null) scan.generatedImages = Math.floor(generated);
	}
}

/**
 * 增量扫描 Seedream SSE。未以空行结束的事件留在 `carry`，避免跨 chunk 拆开时重复计数。
 * 计费优先用 completed 的 `generated_images`；没有 completed 时用 `partial_succeeded` 张数兜底。
 */
export function scanVolcengineImageSse(chunk: string, carry: string): VolcengineImageSseScan {
	const buffer = (carry + chunk).replace(/\r\n/g, '\n');
	const ended = buffer.endsWith('\n\n');
	const parts = buffer.split('\n\n');
	if (ended && parts[parts.length - 1] === '') parts.pop();
	const nextCarry = ended ? '' : (parts.pop() ?? '');
	const scan = { generatedImages: null as number | null, partialSucceeded: 0, error: false };
	for (const part of parts) consumeSseEvent(part, scan);
	return { ...scan, carry: nextCarry };
}

/** 流结束后的计费张数：completed 优先，否则用成功事件数。请求级 error 且没有任何成功图时为 0。 */
export function volcengineSseImageCount(input: {
	generatedImages: number | null;
	partialSucceeded: number;
	error: boolean;
}): number {
	if (input.generatedImages != null) return input.generatedImages;
	if (input.error && input.partialSucceeded === 0) return 0;
	return input.partialSucceeded;
}
