/**
 * Playground DashScope 生图：直连上游，不经过 Proxy。
 * 请求体仍按 OpenAI `/v1/images/generations` 编辑，发送时改写成 multimodal-generation。
 */
import { resolveUpstreamEndpoint } from '@octafuse/core/provider-endpoints';
import { badRequest } from './errors';
import type { PlaygroundResolvedRoute } from './playground-service';

export type PlaygroundDashScopeImageFamily = 'qwen' | 'wan';

export type PlaygroundDashScopeImageRequest = {
	url: string;
	headers: Record<string, string>;
	bodyText: string;
	/** 仅供调试台展示；参考图 data URL 必须摘要化。 */
	wireBodyJson: string;
};

const QWEN_SIZE_ABBREVIATION = /^(1k|2k|4k)$/i;
const PIXEL_SIZE = /^(\d+)[xX*](\d+)$/;

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

export function playgroundDashScopeImageFamily(
	adapter: string,
): PlaygroundDashScopeImageFamily | null {
	if (adapter === 'dashscope-image-qwen') return 'qwen';
	if (adapter === 'dashscope-image-wan') return 'wan';
	return null;
}

export function playgroundDashScopeImageMaxN(family: PlaygroundDashScopeImageFamily): number {
	return family === 'wan' ? 4 : 6;
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

function resolveImageCount(value: unknown, maxN: number): number {
	if (value === undefined || value === null || value === '') return 1;
	const raw = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
	if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > maxN) {
		throw badRequest(`n must be an integer between 1 and ${maxN}`);
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

function pickParameters(source: Record<string, unknown>): Record<string, unknown> {
	const parameters: Record<string, unknown> = {};
	for (const key of PARAMETER_KEYS) {
		if (source[key] !== undefined) {
			parameters[key] = source[key];
		}
	}
	return parameters;
}

function normalizeDashScopeSize(size: string): string {
	const pixel = PIXEL_SIZE.exec(size);
	return pixel ? `${pixel[1]}*${pixel[2]}` : size;
}

function redactPlaygroundImageDataUrls(value: unknown): unknown {
	if (typeof value === 'string' && value.startsWith('data:') && value.includes(';base64,')) {
		return `[redacted data-url ${value.length} chars]`;
	}
	if (Array.isArray(value)) return value.map(redactPlaygroundImageDataUrls);
	const obj = asObject(value);
	if (obj) {
		const out: Record<string, unknown> = {};
		for (const [key, nested] of Object.entries(obj)) {
			out[key] = redactPlaygroundImageDataUrls(nested);
		}
		return out;
	}
	return value;
}

export function buildPlaygroundDashScopeImageBody(
	family: PlaygroundDashScopeImageFamily,
	providerModelName: string,
	body: Record<string, unknown>,
): Record<string, unknown> {
	const prompt = asOptString(body.prompt);
	if (!prompt) {
		throw badRequest('prompt is required');
	}
	const n = resolveImageCount(body.n, playgroundDashScopeImageMaxN(family));
	const rawSize = asOptString(body.size);
	if (family === 'qwen' && rawSize && QWEN_SIZE_ABBREVIATION.test(rawSize)) {
		throw badRequest('qwen-image size must be a pixel string like 1024*1024, not 1K/2K/4K');
	}
	const size = rawSize ? normalizeDashScopeSize(rawSize) : undefined;

	const content: Array<Record<string, string>> = [
		...collectReferenceImages(body.image).map((image) => ({ image })),
		{ text: prompt },
	];
	const parameters: Record<string, unknown> = {
		...pickParameters(body),
		n,
	};
	if (size) parameters.size = size;

	return {
		model: providerModelName,
		input: {
			messages: [{ role: 'user', content }],
		},
		parameters,
	};
}

/** 调试台按 OpenAI Images JSON 构造 DashScope multimodal-generation 请求。 */
export function buildPlaygroundDashScopeImageRequest(
	route: PlaygroundResolvedRoute,
	body: Record<string, unknown>,
): PlaygroundDashScopeImageRequest {
	const family = playgroundDashScopeImageFamily(route.adapter);
	if (!family) {
		throw badRequest(
			`Playground does not support DashScope image adapter ${JSON.stringify(route.adapter)}; use dashscope-image-qwen or dashscope-image-wan`,
		);
	}
	const operation = route.upstreamOperation.trim();
	if (operation && operation !== '*' && operation !== 'images.generations.multimodal') {
		throw badRequest(
			`Playground does not support DashScope image operation ${JSON.stringify(route.upstreamOperation)}`,
		);
	}

	const upstreamBody = buildPlaygroundDashScopeImageBody(family, route.providerModelName, body);
	const url = resolveUpstreamEndpoint('dashscope', 'images.generations.multimodal', route.providerEndpoints, {
		providerId: route.providerId,
	});
	return {
		url,
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${route.providerApiKey}`,
		},
		bodyText: JSON.stringify(upstreamBody),
		wireBodyJson: JSON.stringify(redactPlaygroundImageDataUrls(upstreamBody), null, 2),
	};
}
