/**
 * OpenAI 兼容 Images API 上游驱动：`/images/generations`（JSON）与 `/images/edits`（multipart）。
 * 首期面向 GPT Image；Gateway 对外保持 OpenAI 形状，日志禁止写入 prompt 原文与 Base64。
 */
import {
	buildOpenAiCompatibleImagesUrl,
	parseOpenAiImageUsage,
	type ImageTokenUsage,
} from '@octafuse/core';
import type { RouteResult } from '../model-router';
import type { UsageFromStream } from '../proxy';
import { EMPTY_USAGE } from '../proxy';
import { buildRouteRequestBody } from '../route-default-params';
import { extractUpstreamRequestId } from './upstream-request-id';
import type { RequestTimingAttempt, RequestTimingCollector } from '../request-timing';

function usageFromStreamFromImage(body: unknown): {
	usagePromise: Promise<UsageFromStream>;
	imageUsage: ImageTokenUsage | null;
} {
	const parsed = parseOpenAiImageUsage(body);
	if (!parsed) {
		return { usagePromise: Promise.resolve(EMPTY_USAGE), imageUsage: null };
	}
	const streamUsage: UsageFromStream = {
		input_tokens: parsed.text_tokens,
		output_tokens: parsed.image_output_tokens,
		cache_read_tokens: parsed.cached_text_tokens,
		cache_write_tokens: 0,
		reasoning_tokens: 0,
		total_tokens: parsed.total_tokens,
		raw_usage: parsed.raw_usage,
	};
	return { usagePromise: Promise.resolve(streamUsage), imageUsage: parsed };
}

function imageDispatchMeta(
	body: unknown,
	imageUsage: ImageTokenUsage | null
): { imageUsage: ImageTokenUsage | null; parsedBody: unknown } {
	return { imageUsage, parsedBody: body };
}

export const IMAGE_GENERATION_TIMEOUT_MS = 120_000;
export const IMAGE_MAX_PROMPT_CHARS = 4_000;
export const IMAGE_MAX_REFERENCE_COUNT = 5;
export const IMAGE_MAX_BYTES_PER_FILE = 20 * 1024 * 1024;
/** 与文档 5×20MB 对齐的总上传上限，避免 Worker 内存被多图打爆 */
export const IMAGE_MAX_TOTAL_UPLOAD_BYTES = IMAGE_MAX_REFERENCE_COUNT * IMAGE_MAX_BYTES_PER_FILE;
export const IMAGE_ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

export type ImageEditUpload = {
	filename: string;
	mimeType: string;
	bytes: Uint8Array;
};

export type NormalizedImageEditRequest = {
	prompt: string;
	n: number;
	size?: string;
	quality?: string;
	background?: string;
	/** OpenAI edits 通常用 `image` / 多图 `image[]`；此处统一为数组 */
	images: ImageEditUpload[];
	/** 透传给上游的其余安全字段（不含 prompt / 文件） */
	extra?: Record<string, unknown>;
};

function buildImagesUrl(baseUrl: string, suffix: 'generations' | 'edits'): string {
	return buildOpenAiCompatibleImagesUrl(baseUrl, suffix);
}

type ImageAbortReason = 'none' | 'gateway_timeout' | 'client_abort';

function withTimeoutSignal(
	requestSignal: AbortSignal | undefined,
	timeoutMs: number
): { signal: AbortSignal; clear: () => void; getAbortReason: () => ImageAbortReason } {
	const controller = new AbortController();
	let reason: ImageAbortReason = 'none';
	const onClientAbort = () => {
		if (reason === 'none') reason = 'client_abort';
		controller.abort();
	};
	requestSignal?.addEventListener('abort', onClientAbort, { once: true });
	const timer = setTimeout(() => {
		if (reason === 'none') reason = 'gateway_timeout';
		controller.abort();
	}, timeoutMs);
	return {
		signal: controller.signal,
		clear: () => {
			clearTimeout(timer);
			requestSignal?.removeEventListener('abort', onClientAbort);
		},
		getAbortReason: () => reason,
	};
}

function imageAbortErrorPayload(
	operation: 'generation' | 'edit',
	url: string,
	abortReason: ImageAbortReason,
	timeoutMs: number
): { message: string; upstream_url: string; abort_reason: string; timeout_ms: number } {
	const kind = operation === 'generation' ? 'Image generation' : 'Image edit';
	const message =
		abortReason === 'gateway_timeout'
			? `${kind} timed out waiting for upstream after ${timeoutMs}ms`
			: abortReason === 'client_abort'
				? `${kind} was cancelled by the client`
				: `${kind} timed out or was cancelled`;
	return {
		message,
		upstream_url: url,
		abort_reason: abortReason === 'none' ? 'aborted' : abortReason,
		timeout_ms: timeoutMs,
	};
}

/** 校验并规范化 generation / edit 公共参数（`n` 接受 number 或数字字符串，如 multipart）。 */
export function normalizeImageCommonParams(input: {
	prompt: unknown;
	n?: unknown;
	size?: unknown;
	quality?: unknown;
	background?: unknown;
}):
	| { ok: true; prompt: string; n: number; size?: string; quality?: string; background?: string }
	| { ok: false; error: string } {
	const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
	if (!prompt) {
		return { ok: false, error: 'prompt is required' };
	}
	if (prompt.length > IMAGE_MAX_PROMPT_CHARS) {
		return { ok: false, error: `prompt must be at most ${IMAGE_MAX_PROMPT_CHARS} characters` };
	}

	let n = 1;
	if (input.n !== undefined && input.n !== null && input.n !== '') {
		const nRaw =
			typeof input.n === 'string' && input.n.trim() !== '' ? Number(input.n) : input.n;
		if (typeof nRaw !== 'number' || !Number.isInteger(nRaw) || nRaw !== 1) {
			return { ok: false, error: 'n must be 1' };
		}
		n = nRaw;
	}

	const asOptString = (v: unknown, field: string): string | undefined | { error: string } => {
		if (v === undefined || v === null || v === '') {
			return undefined;
		}
		if (typeof v !== 'string') {
			return { error: `${field} must be a string` };
		}
		const t = v.trim();
		return t || undefined;
	};

	const size = asOptString(input.size, 'size');
	if (size && typeof size === 'object') {
		return { ok: false, error: size.error };
	}
	const quality = asOptString(input.quality, 'quality');
	if (quality && typeof quality === 'object') {
		return { ok: false, error: quality.error };
	}
	const background = asOptString(input.background, 'background');
	if (background && typeof background === 'object') {
		return { ok: false, error: background.error };
	}

	return {
		ok: true,
		prompt,
		n,
		size: size as string | undefined,
		quality: quality as string | undefined,
		background: background as string | undefined,
	};
}

export function validateImageUpload(file: ImageEditUpload): string | null {
	if (!file.bytes?.byteLength) {
		return 'image file is empty';
	}
	if (file.bytes.byteLength > IMAGE_MAX_BYTES_PER_FILE) {
		return `each image must be at most ${IMAGE_MAX_BYTES_PER_FILE} bytes`;
	}
	const mime = (file.mimeType || '').trim().toLowerCase();
	if (!IMAGE_ALLOWED_MIME.has(mime)) {
		return 'image mime type must be image/png, image/jpeg, or image/webp';
	}
	return null;
}

/** 统计 OpenAI Images 响应中有效图片数（b64_json 或 url）。 */
export function countValidImageResults(payload: unknown): number {
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
		return 0;
	}
	const data = (payload as { data?: unknown }).data;
	if (!Array.isArray(data)) {
		return 0;
	}
	let count = 0;
	for (const item of data) {
		if (!item || typeof item !== 'object') {
			continue;
		}
		const row = item as Record<string, unknown>;
		const b64 = typeof row.b64_json === 'string' ? row.b64_json.trim() : '';
		const url = typeof row.url === 'string' ? row.url.trim() : '';
		if (b64.length > 0 || url.length > 0) {
			count += 1;
		}
	}
	return count;
}

/** 日志用：去掉 prompt / 图片二进制字段，仅保留摘要。 */
export function redactImageRequestForLog(params: {
	model?: string;
	n?: number;
	size?: string;
	quality?: string;
	background?: string;
	prompt?: string;
	referenceCount?: number;
	operation: 'generations' | 'edits';
}): Record<string, unknown> {
	const prompt = params.prompt ?? '';
	return {
		operation: params.operation,
		model: params.model,
		n: params.n,
		size: params.size,
		quality: params.quality,
		background: params.background,
		prompt_chars: prompt.length,
		reference_count: params.referenceCount ?? 0,
		_redacted: ['prompt', 'image', 'images', 'b64_json'],
	};
}

async function readJsonResponse(
	response: Response,
	timing?: RequestTimingCollector | null
): Promise<{ response: Response; body: unknown }> {
	const text = await response.text();
	timing?.markStreamComplete();
	let body: unknown = null;
	try {
		body = text ? JSON.parse(text) : null;
	} catch {
		body = { error: { message: text.slice(0, 500) || 'Invalid upstream JSON' } };
	}
	return {
		response: new Response(JSON.stringify(body), {
			status: response.status,
			statusText: response.statusText,
			headers: {
				'Content-Type': 'application/json',
			},
		}),
		body,
	};
}

/**
 * `POST …/images/generations`
 */
export async function dispatchOpenAiImageGenerations(
	route: RouteResult,
	body: Record<string, unknown>,
	requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt
): Promise<{
	response: Response;
	usagePromise: Promise<UsageFromStream>;
	upstreamRequestId: string | null;
	meta: { imageUsage: ImageTokenUsage | null; parsedBody: unknown };
}> {
	const url = buildImagesUrl(route.baseUrl, 'generations');
	// 与 chat/messages 一致：每条 failover 路由合并各自 custom_params，用户字段优先
	const requestBody = {
		...buildRouteRequestBody(route, body),
		model: route.providerModelName,
	};
	console.log(
		`[Gateway Images] upstream generations POST ${url} baseUrl=${route.baseUrl} providerModel=${route.providerModelName} providerId=${route.providerId}`
	);
	const startedAt = Date.now();
	const { signal, clear, getAbortReason } = withTimeoutSignal(
		requestSignal,
		IMAGE_GENERATION_TIMEOUT_MS
	);
	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${route.providerApiKey}`,
			},
			body: JSON.stringify(requestBody),
			signal,
		});
		timing?.markAttemptHeaders(attempt, response.status);
		const upstreamRequestId = extractUpstreamRequestId(response.headers);
		const material = await readJsonResponse(response, timing);
		console.log(
			`[Gateway Images] upstream generations done status=${response.status} elapsedMs=${Date.now() - startedAt} url=${url}`
		);
		const { usagePromise, imageUsage } = usageFromStreamFromImage(material.body);
		return {
			response: material.response,
			usagePromise,
			upstreamRequestId,
			meta: imageDispatchMeta(material.body, imageUsage),
		};
	} catch (err) {
		timing?.markStreamComplete();
		const abortReason = getAbortReason();
		const aborted =
			abortReason !== 'none' ||
			requestSignal?.aborted ||
			(err instanceof Error && err.name === 'AbortError');
		const error = aborted
			? imageAbortErrorPayload(
					'generation',
					url,
					abortReason === 'none' && requestSignal?.aborted ? 'client_abort' : abortReason,
					IMAGE_GENERATION_TIMEOUT_MS
				)
			: {
					message: 'Image generation upstream failed',
					upstream_url: url,
					detail: err instanceof Error ? err.message : String(err),
				};
		console.error(
			`[Gateway Images] upstream generations failed abortReason=${abortReason} elapsedMs=${Date.now() - startedAt} url=${url} err=${
				err instanceof Error ? err.message : String(err)
			}`
		);
		const errorBody = { error };
		return {
			response: new Response(JSON.stringify(errorBody), {
				status: aborted ? 504 : 502,
				headers: { 'Content-Type': 'application/json' },
			}),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: null,
			meta: imageDispatchMeta(errorBody, null),
		};
	} finally {
		clear();
	}
}

/**
 * `POST …/images/edits`（multipart）
 */
export async function dispatchOpenAiImageEdits(
	route: RouteResult,
	edit: NormalizedImageEditRequest,
	requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt
): Promise<{
	response: Response;
	usagePromise: Promise<UsageFromStream>;
	upstreamRequestId: string | null;
	meta: { imageUsage: ImageTokenUsage | null; parsedBody: unknown };
}> {
	const url = buildImagesUrl(route.baseUrl, 'edits');
	console.log(
		`[Gateway Images] upstream edits POST ${url} baseUrl=${route.baseUrl} providerModel=${route.providerModelName} providerId=${route.providerId}`
	);
	const form = new FormData();
	// custom_params 作为额外表单字段；用户/规范化字段优先覆盖
	const mergedExtras = buildRouteRequestBody(route, {
		...(edit.extra ?? {}),
		prompt: edit.prompt,
		n: edit.n,
		...(edit.size ? { size: edit.size } : {}),
		...(edit.quality ? { quality: edit.quality } : {}),
		...(edit.background ? { background: edit.background } : {}),
	});
	form.append('model', route.providerModelName);
	for (const [k, v] of Object.entries(mergedExtras)) {
		if (v == null) continue;
		if (k === 'model' || k === 'image' || k === 'images') continue;
		if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
			form.append(k, String(v));
		}
	}
	for (const img of edit.images) {
		// 直接用已有 Uint8Array 构造 Blob，避免再 copy 一份驻留内存
		const blob = new Blob([img.bytes], { type: img.mimeType });
		form.append('image', blob, img.filename || 'image.png');
	}

	const startedAt = Date.now();
	const { signal, clear, getAbortReason } = withTimeoutSignal(
		requestSignal,
		IMAGE_GENERATION_TIMEOUT_MS
	);
	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${route.providerApiKey}`,
			},
			body: form,
			signal,
		});
		timing?.markAttemptHeaders(attempt, response.status);
		const upstreamRequestId = extractUpstreamRequestId(response.headers);
		const material = await readJsonResponse(response, timing);
		console.log(
			`[Gateway Images] upstream edits done status=${response.status} elapsedMs=${Date.now() - startedAt} url=${url}`
		);
		const { usagePromise, imageUsage } = usageFromStreamFromImage(material.body);
		return {
			response: material.response,
			usagePromise,
			upstreamRequestId,
			meta: imageDispatchMeta(material.body, imageUsage),
		};
	} catch (err) {
		timing?.markStreamComplete();
		const abortReason = getAbortReason();
		const aborted =
			abortReason !== 'none' ||
			requestSignal?.aborted ||
			(err instanceof Error && err.name === 'AbortError');
		const error = aborted
			? imageAbortErrorPayload(
					'edit',
					url,
					abortReason === 'none' && requestSignal?.aborted ? 'client_abort' : abortReason,
					IMAGE_GENERATION_TIMEOUT_MS
				)
			: {
					message: 'Image edit upstream failed',
					upstream_url: url,
					detail: err instanceof Error ? err.message : String(err),
				};
		console.error(
			`[Gateway Images] upstream edits failed abortReason=${abortReason} elapsedMs=${Date.now() - startedAt} url=${url} err=${
				err instanceof Error ? err.message : String(err)
			}`
		);
		const errorBody = { error };
		return {
			response: new Response(JSON.stringify(errorBody), {
				status: aborted ? 504 : 502,
				headers: { 'Content-Type': 'application/json' },
			}),
			usagePromise: Promise.resolve(EMPTY_USAGE),
			upstreamRequestId: null,
			meta: imageDispatchMeta(errorBody, null),
		};
	} finally {
		clear();
	}
}
