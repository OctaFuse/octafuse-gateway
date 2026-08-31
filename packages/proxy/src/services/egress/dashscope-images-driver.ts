/**
 * DashScope 原生文生图 / 图生图 adapter：
 * OpenAI `/v1/images/generations` → `services/aigc/multimodal-generation/generation`。
 * Qwen Image 3.0 与 Wan 2.7 共用端点，请求参数族不同。
 */
import { applyRouteExtraHeaders, resolveProviderUpstreamSecret, resolveUpstreamEndpoint } from '@octafuse/core';
import type { RouteResult } from '../model-router';
import { EMPTY_USAGE, type UsageFromStream } from '../proxy';
import { buildRouteRequestBody } from '../route-default-params';
import type { RequestTimingAttempt, RequestTimingCollector } from '../request-timing';
import { extractUpstreamRequestId, normalizeUpstreamId } from './upstream-request-id';
import {
	IMAGE_GENERATION_TIMEOUT_MS,
	IMAGE_MAX_BYTES_PER_FILE,
	IMAGE_MAX_TOTAL_UPLOAD_BYTES,
	countValidImageResults,
	type ImageDispatchAbortReason,
} from './openai-images-driver';

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type DashScopeImagesDispatchOptions = {
	fetchImpl?: FetchLike;
	timeoutMs?: number;
};

export type DashScopeImageFamily = 'qwen' | 'wan';

const QWEN_SIZE_ABBREVIATION = /^(1k|2k|4k)$/i;
const PIXEL_SIZE = /^(\d+)[xX*](\d+)$/;
const QWEN_OUTPUT_2K_PIXELS = 2_250_000;

const PARAMETER_KEYS = [
	'watermark',
	'seed',
	'negative_prompt',
	'prompt_extend',
	'prompt_extend_mode',
	'enable_thinking',
	'thinking_mode',
	'enable_sequential',
	'color_palette',
	'bbox_list',
] as const;

export class DashScopeImageClientError extends Error {
	readonly status = 400;
	constructor(message: string) {
		super(message);
		this.name = 'DashScopeImageClientError';
	}
}

type ImageAbortReason = 'none' | 'gateway_timeout' | 'client_abort';

export function imageFamilyForAdapter(adapter: string): DashScopeImageFamily | null {
	if (adapter === 'dashscope-image-qwen') return 'qwen';
	if (adapter === 'dashscope-image-wan') return 'wan';
	return null;
}

export function maxNForImageAdapter(adapter: string): number {
	if (adapter === 'dashscope-image-wan') return 4;
	if (adapter === 'dashscope-image-qwen') return 6;
	return 1;
}

export function maxNForImageRoutes(routes: ReadonlyArray<{ adapter: string }>): number {
	if (routes.length === 0) return 1;
	return Math.min(...routes.map((route) => maxNForImageAdapter(route.adapter)));
}

function asObject(value: unknown): Record<string, unknown> | null {
	return value != null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function asOptString(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	return trimmed || undefined;
}

function resolveImageCount(value: unknown): number {
	if (value === undefined || value === null || value === '') return 1;
	const raw = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
	if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
		throw new DashScopeImageClientError('n must be a positive integer');
	}
	return raw;
}

function collectReferenceImages(image: unknown): string[] {
	if (typeof image === 'string' && image.trim() !== '') {
		return [image.trim()];
	}
	if (!Array.isArray(image)) return [];
	return image
		.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
		.map((item) => item.trim());
}

/** OpenAI Images uses `1024x1024`; DashScope multimodal requires `1024*1024`. */
function normalizeDashScopeSize(size: string): string {
	const pixel = PIXEL_SIZE.exec(size);
	return pixel ? `${pixel[1]}*${pixel[2]}` : size;
}

function pickParameters(source: Record<string, unknown>): Record<string, unknown> {
	const parameters: Record<string, unknown> = {};
	for (const key of PARAMETER_KEYS) {
		if (source[key] !== undefined) {
			parameters[key] = source[key];
		}
	}
	return parameters;
}

export function buildDashScopeImageBody(
	family: DashScopeImageFamily,
	route: RouteResult,
	body: Record<string, unknown>
): Record<string, unknown> {
	const merged = buildRouteRequestBody(route, body);
	const prompt = asOptString(merged.prompt);
	if (!prompt) {
		throw new DashScopeImageClientError('prompt is required');
	}
	const n = resolveImageCount(merged.n);
	const rawSize = asOptString(merged.size);
	if (family === 'qwen' && rawSize && QWEN_SIZE_ABBREVIATION.test(rawSize)) {
		throw new DashScopeImageClientError(
			'qwen-image size must be a pixel string like 1024*1024, not 1K/2K/4K'
		);
	}
	const size = rawSize ? normalizeDashScopeSize(rawSize) : undefined;

	const content: Array<Record<string, string>> = [
		...collectReferenceImages(merged.image).map((image) => ({ image })),
		{ text: prompt },
	];
	const parameters: Record<string, unknown> = {
		...pickParameters(merged),
		n,
	};
	if (size) parameters.size = size;

	return {
		model: route.providerModelName,
		input: {
			messages: [{ role: 'user', content }],
		},
		parameters,
	};
}

function collectDashScopeImageUrls(payload: unknown): string[] {
	const root = asObject(payload);
	const output = asObject(root?.output);
	const choices = Array.isArray(output?.choices) ? output.choices : [];
	const urls: string[] = [];
	for (const choice of choices) {
		const message = asObject(asObject(choice)?.message);
		const content = Array.isArray(message?.content) ? message.content : [];
		for (const part of content) {
			const image = asOptString(asObject(part)?.image);
			if (image) urls.push(image);
		}
	}
	return urls;
}

export function normalizeDashScopeImageResult(payload: unknown): Record<string, unknown> {
	return {
		created: Math.floor(Date.now() / 1000),
		data: collectDashScopeImageUrls(payload).map((url) => ({ url })),
	};
}

export function resolveImageBillingSize(
	family: DashScopeImageFamily,
	usage: unknown
): string | null {
	if (family !== 'qwen') return null;
	const row = asObject(usage);
	if (!row) return null;
	const type = asOptString(row.output_image_type)?.toLowerCase();
	if (type === 'qima_output_2k' || type?.endsWith('_2k')) return '2k';
	if (type === 'qima_output_1k' || type?.endsWith('_1k')) return '1k';
	const width =
		typeof row.output_width === 'number' && Number.isFinite(row.output_width)
			? row.output_width
			: null;
	const height =
		typeof row.output_height === 'number' && Number.isFinite(row.output_height)
			? row.output_height
			: null;
	if (width != null && height != null) {
		return width * height > QWEN_OUTPUT_2K_PIXELS ? '2k' : '1k';
	}
	return null;
}

function dashScopeErrorMessage(body: unknown, fallback: string): string {
	const row = asObject(body);
	const message = asOptString(row?.message) ?? asOptString(asObject(row?.error)?.message);
	return message || fallback;
}

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
	if (requestSignal?.aborted) {
		onClientAbort();
	} else {
		requestSignal?.addEventListener('abort', onClientAbort, { once: true });
	}
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

function resolveImageAbortReasonForMeta(
	abortReason: ImageAbortReason,
	requestSignal?: AbortSignal
): ImageDispatchAbortReason | undefined {
	const resolved: ImageAbortReason =
		abortReason === 'none' && requestSignal?.aborted ? 'client_abort' : abortReason;
	return resolved === 'client_abort' || resolved === 'gateway_timeout' ? resolved : undefined;
}

function imageAbortErrorPayload(
	url: string,
	abortReason: ImageAbortReason,
	timeoutMs: number
): { message: string; upstream_url: string; abort_reason: string; timeout_ms: number } {
	const message =
		abortReason === 'gateway_timeout'
			? `Image generation timed out waiting for upstream after ${timeoutMs}ms`
			: abortReason === 'client_abort'
				? 'Image generation was cancelled by the client'
				: 'Image generation timed out or was cancelled';
	return {
		message,
		upstream_url: url,
		abort_reason: abortReason === 'none' ? 'aborted' : abortReason,
		timeout_ms: timeoutMs,
	};
}

function imageDispatchResult(
	status: number,
	body: unknown,
	upstreamRequestId: string | null,
	imageBillingSize: string | null,
	imageAbortReason?: ImageDispatchAbortReason
) {
	return {
		response: new Response(JSON.stringify(body), {
			status,
			headers: { 'Content-Type': 'application/json' },
		}),
		usagePromise: Promise.resolve(EMPTY_USAGE),
		upstreamRequestId,
		meta: {
			imageUsage: null,
			parsedBody: body,
			imageBillingSize,
			...(imageAbortReason ? { imageAbortReason } : {}),
		},
	};
}

async function bytesToBase64(bytes: Uint8Array): Promise<string> {
	let binary = '';
	const chunkSize = 0x8000;
	for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
		const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength));
		binary += String.fromCharCode(...chunk);
	}
	return btoa(binary);
}

async function maybeDownloadAsB64(
	data: Array<{ url: string }>,
	fetchImpl: FetchLike,
	signal: AbortSignal
): Promise<Array<{ url?: string; b64_json?: string }>> {
	const out: Array<{ url?: string; b64_json?: string }> = [];
	let totalBytes = 0;
	for (const item of data) {
		try {
			const response = await fetchImpl(item.url, { method: 'GET', signal });
			if (!response.ok) {
				console.warn(
					`[Gateway Images] DashScope b64 download failed status=${response.status} url=${item.url}`
				);
				out.push({ url: item.url });
				continue;
			}
			const buffer = new Uint8Array(await response.arrayBuffer());
			if (buffer.byteLength > IMAGE_MAX_BYTES_PER_FILE) {
				console.warn(
					`[Gateway Images] DashScope b64 download exceeded per-image limit bytes=${buffer.byteLength}`
				);
				out.push({ url: item.url });
				continue;
			}
			totalBytes += buffer.byteLength;
			if (totalBytes > IMAGE_MAX_TOTAL_UPLOAD_BYTES) {
				console.warn('[Gateway Images] DashScope b64 download exceeded total limit');
				out.push({ url: item.url });
				continue;
			}
			out.push({ b64_json: await bytesToBase64(buffer) });
		} catch (err) {
			console.warn(
				`[Gateway Images] DashScope b64 download failed url=${item.url} err=${
					err instanceof Error ? err.message : String(err)
				}`
			);
			out.push({ url: item.url });
		}
	}
	return out;
}

export async function dispatchDashScopeImageGenerations(
	route: RouteResult,
	body: Record<string, unknown>,
	requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt,
	options: DashScopeImagesDispatchOptions = {}
): Promise<{
	response: Response;
	usagePromise: Promise<UsageFromStream>;
	upstreamRequestId: string | null;
	meta: {
		imageUsage: null;
		parsedBody: unknown;
		imageBillingSize: string | null;
		imageAbortReason?: ImageDispatchAbortReason;
	};
}> {
	const family = imageFamilyForAdapter(route.adapter);
	if (!family) {
		throw new Error(`Unsupported DashScope image adapter: ${route.adapter}`);
	}

	let requestBody: Record<string, unknown>;
	try {
		requestBody = buildDashScopeImageBody(family, route, body);
	} catch (err) {
		if (err instanceof DashScopeImageClientError) {
			return imageDispatchResult(400, { error: { message: err.message } }, null, null);
		}
		throw err;
	}

	const fetchImpl = options.fetchImpl ?? fetch;
	const timeoutMs = options.timeoutMs ?? IMAGE_GENERATION_TIMEOUT_MS;
	const url = resolveUpstreamEndpoint(
		'dashscope',
		'images.generations.multimodal',
		route.providerEndpoints,
		{ providerId: route.providerId }
	);
	console.log(
		`[Gateway Images] DashScope ${family} POST ${url} providerModel=${route.providerModelName} providerId=${route.providerId}`
	);
	const startedAt = Date.now();
	const { signal, clear, getAbortReason } = withTimeoutSignal(requestSignal, timeoutMs);
	try {
		const { secret } = await resolveProviderUpstreamSecret(route.providerApiKey);
		const response = await fetchImpl(url, {
			method: 'POST',
			headers: applyRouteExtraHeaders(
				{
					'Content-Type': 'application/json',
					Authorization: `Bearer ${secret}`,
				},
				route.customParams
			),
			body: JSON.stringify(requestBody),
			signal,
		});
		timing?.markAttemptHeaders(attempt, response.status);
		const headerRequestId = extractUpstreamRequestId(response.headers);
		const text = await response.text();
		timing?.markStreamComplete();
		let upstreamBody: unknown = null;
		try {
			upstreamBody = text ? JSON.parse(text) : null;
		} catch {
			upstreamBody = { error: { message: text.slice(0, 500) || 'Invalid upstream JSON' } };
		}
		const bodyRequestId = normalizeUpstreamId(asObject(upstreamBody)?.request_id);
		const upstreamRequestId = headerRequestId ?? bodyRequestId;
		const usage = asObject(upstreamBody)?.usage;
		const imageBillingSize = resolveImageBillingSize(family, usage);
		if (!response.ok) {
			console.error(
				`[Gateway Images] DashScope ${family} failed status=${response.status} elapsedMs=${Date.now() - startedAt} url=${url}`
			);
			return imageDispatchResult(
				response.status >= 400 && response.status < 600 ? response.status : 502,
				{
					error: {
						message: dashScopeErrorMessage(upstreamBody, `HTTP ${response.status}`),
						type: 'upstream_error',
						code: asOptString(asObject(upstreamBody)?.code) ?? null,
					},
				},
				upstreamRequestId,
				null
			);
		}

		const clientBody = normalizeDashScopeImageResult(upstreamBody);
		if (countValidImageResults(clientBody) === 0) {
			const code = asOptString(asObject(upstreamBody)?.code);
			if (code) {
				return imageDispatchResult(
					502,
					{
						error: {
							message: dashScopeErrorMessage(upstreamBody, 'Upstream returned no image data'),
							type: 'upstream_error',
							code,
						},
					},
					upstreamRequestId,
					null
				);
			}
		}

		const responseFormat = asOptString(body.response_format)?.toLowerCase();
		if (responseFormat === 'b64_json') {
			const data = Array.isArray(clientBody.data)
				? (clientBody.data as Array<{ url: string }>)
				: [];
			clientBody.data = await maybeDownloadAsB64(data, fetchImpl, signal);
		}

		console.log(
			`[Gateway Images] DashScope ${family} done status=${response.status} elapsedMs=${Date.now() - startedAt} url=${url}`
		);
		return imageDispatchResult(200, clientBody, upstreamRequestId, imageBillingSize);
	} catch (err) {
		timing?.markStreamComplete();
		const abortReason = getAbortReason();
		const aborted =
			abortReason !== 'none' ||
			requestSignal?.aborted ||
			(err instanceof Error && err.name === 'AbortError');
		const resolvedAbort =
			abortReason === 'none' && requestSignal?.aborted ? 'client_abort' : abortReason;
		const error = aborted
			? imageAbortErrorPayload(url, resolvedAbort, timeoutMs)
			: {
					message: 'Image generation upstream failed',
					upstream_url: url,
					detail: err instanceof Error ? err.message : String(err),
				};
		console.error(
			`[Gateway Images] DashScope ${family} failed abortReason=${abortReason} elapsedMs=${Date.now() - startedAt} url=${url} err=${
				err instanceof Error ? err.message : String(err)
			}`
		);
		return imageDispatchResult(
			aborted ? 504 : 502,
			{ error },
			null,
			null,
			aborted ? resolveImageAbortReasonForMeta(resolvedAbort, requestSignal) : undefined
		);
	} finally {
		clear();
	}
}
