/**
 * OpenAI 入口 → MiniMax 原生 `t2a_v2` / `image_generation` 的请求与响应映射。
 * Proxy 驱动和 Admin 调试台共用，避免两处各写一份字段转换。
 */

export class MiniMaxOpenAiClientError extends Error {
	readonly status = 400;
	constructor(message: string) {
		super(message);
		this.name = 'MiniMaxOpenAiClientError';
	}
}

export const MINIMAX_OPENAI_SPEECH_FORMATS = ['mp3', 'pcm', 'flac', 'wav'] as const;
export type MiniMaxOpenAiSpeechFormat = (typeof MINIMAX_OPENAI_SPEECH_FORMATS)[number];

export const MINIMAX_IMAGE_ASPECT_RATIOS = [
	'1:1',
	'16:9',
	'4:3',
	'3:2',
	'2:3',
	'3:4',
	'9:16',
	'21:9',
] as const;

const ASPECT_RATIO_VALUES = MINIMAX_IMAGE_ASPECT_RATIOS.map((id) => {
	const [width, height] = id.split(':').map(Number);
	return { id, ratio: width / height };
});

function asObject(value: unknown): Record<string, unknown> | null {
	return value != null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function isSpeechFormat(value: string): value is MiniMaxOpenAiSpeechFormat {
	return (MINIMAX_OPENAI_SPEECH_FORMATS as readonly string[]).includes(value);
}

/** OpenAI `1024x1024` / `1024*1024` 对齐到 MiniMax 支持的宽高比。已是合法比例时原样返回。 */
export function miniMaxAspectRatioFromOpenAiSize(size: string | undefined): string {
	const raw = size?.trim() ?? '';
	if (!raw) return '1:1';
	if ((MINIMAX_IMAGE_ASPECT_RATIOS as readonly string[]).includes(raw)) return raw;
	const pixel = /^(\d+)\s*[xX*]\s*(\d+)$/.exec(raw);
	if (!pixel) {
		throw new MiniMaxOpenAiClientError('size must be WIDTHxHEIGHT, such as 1024x1024');
	}
	const width = Number(pixel[1]);
	const height = Number(pixel[2]);
	if (width <= 0 || height <= 0) {
		throw new MiniMaxOpenAiClientError('size must be WIDTHxHEIGHT, such as 1024x1024');
	}
	const ratio = width / height;
	let best = ASPECT_RATIO_VALUES[0]!;
	let bestDiff = Math.abs(ratio - best.ratio);
	for (const candidate of ASPECT_RATIO_VALUES.slice(1)) {
		const diff = Math.abs(ratio - candidate.ratio);
		if (diff < bestDiff) {
			best = candidate;
			bestDiff = diff;
		}
	}
	return best.id;
}

export function buildMiniMaxT2aBodyFromOpenAi(input: {
	model: string;
	text: string;
	voiceId: string;
	responseFormat: string;
	speed: number;
	stream: boolean;
	instructions?: string;
}): Record<string, unknown> {
	const text = input.text;
	if (!text.trim()) throw new MiniMaxOpenAiClientError('input is required');
	const voiceId = input.voiceId.trim();
	if (!voiceId) throw new MiniMaxOpenAiClientError('voice is required');
	if (input.instructions?.trim()) {
		throw new MiniMaxOpenAiClientError('MiniMax speech does not support instructions');
	}
	const responseFormat = input.responseFormat.trim().toLowerCase();
	if (!isSpeechFormat(responseFormat)) {
		throw new MiniMaxOpenAiClientError(
			`MiniMax speech does not support response_format=${responseFormat || '(empty)'}`,
		);
	}
	if (!Number.isFinite(input.speed) || input.speed < 0.5 || input.speed > 2) {
		throw new MiniMaxOpenAiClientError('MiniMax speech speed must be between 0.5 and 2.0');
	}
	return {
		model: input.model,
		text,
		stream: input.stream,
		output_format: 'hex',
		voice_setting: {
			voice_id: voiceId,
			speed: input.speed,
		},
		audio_setting: {
			format: responseFormat,
			channel: 1,
		},
		...(input.stream ? { stream_options: { exclude_aggregated_audio: true } } : {}),
	};
}

/**
 * `vol` / `pitch` / `sample_rate` / `bitrate` 只在合并路由参数和客户端额外字段之后仍缺省时填入。
 * 这样路由 `custom_params` 和 `extra_body` 可以覆盖它们。
 */
export function fillMiniMaxSpeechDefaults(body: Record<string, unknown>): Record<string, unknown> {
	const voice = asObject(body.voice_setting) ?? {};
	if (voice.vol == null) voice.vol = 1;
	if (voice.pitch == null) voice.pitch = 0;
	body.voice_setting = voice;
	const audio = asObject(body.audio_setting) ?? {};
	if (audio.sample_rate == null) audio.sample_rate = 32000;
	if (audio.channel == null) audio.channel = 1;
	if (audio.format === 'mp3' && audio.bitrate == null) audio.bitrate = 128000;
	body.audio_setting = audio;
	return body;
}

function positiveInt(value: unknown, fallback: number): number {
	if (value == null || value === '') return fallback;
	const raw = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
	if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > 9) {
		throw new MiniMaxOpenAiClientError('n must be an integer between 1 and 9');
	}
	return raw;
}

function responseFormatForImage(value: unknown): 'url' | 'base64' {
	if (value == null || value === '') return 'url';
	if (typeof value !== 'string') {
		throw new MiniMaxOpenAiClientError('response_format must be url or b64_json');
	}
	const format = value.trim().toLowerCase();
	if (format === 'url') return 'url';
	if (format === 'b64_json' || format === 'base64') return 'base64';
	throw new MiniMaxOpenAiClientError('response_format must be url or b64_json');
}

/** OpenAI Images generations → MiniMax `image_generation`。`quality`、`background` 不转发。 */
export function buildMiniMaxImageBodyFromOpenAi(
	model: string,
	body: Record<string, unknown>,
): Record<string, unknown> {
	const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
	if (!prompt) throw new MiniMaxOpenAiClientError('prompt is required');
	const explicitAspect =
		typeof body.aspect_ratio === 'string' &&
		(MINIMAX_IMAGE_ASPECT_RATIOS as readonly string[]).includes(body.aspect_ratio.trim())
			? body.aspect_ratio.trim()
			: null;
	const size = typeof body.size === 'string' ? body.size : undefined;
	const upstream: Record<string, unknown> = {
		model,
		prompt,
		aspect_ratio: explicitAspect ?? miniMaxAspectRatioFromOpenAiSize(size),
		response_format: responseFormatForImage(body.response_format),
		n: positiveInt(body.n, 1),
	};
	if (typeof body.width === 'number' && Number.isFinite(body.width)) upstream.width = body.width;
	if (typeof body.height === 'number' && Number.isFinite(body.height)) upstream.height = body.height;
	if (body.seed != null) upstream.seed = body.seed;
	if (body.prompt_optimizer != null) upstream.prompt_optimizer = body.prompt_optimizer;
	if (body.aigc_watermark != null) upstream.aigc_watermark = body.aigc_watermark;
	if (Array.isArray(body.subject_reference)) upstream.subject_reference = body.subject_reference;
	if (typeof body.style === 'string') {
		const style = body.style.trim();
		if (style && style !== 'vivid' && style !== 'natural') upstream.style = style;
	}
	return upstream;
}

function stripDataUrl(value: string): string {
	const marker = ';base64,';
	const index = value.indexOf(marker);
	return index >= 0 ? value.slice(index + marker.length) : value;
}

/** MiniMax 生图 JSON → OpenAI `{ data: [{ url | b64_json }] }`。 */
export function miniMaxImageResponseToOpenAi(
	payload: unknown,
	responseFormat: 'url' | 'b64_json',
): { created: number; data: Array<{ url: string } | { b64_json: string }> } {
	const data = asObject(asObject(payload)?.data);
	const urls = Array.isArray(data?.image_urls) ? data.image_urls : [];
	const encoded = Array.isArray(data?.image_base64) ? data.image_base64 : [];
	const images =
		responseFormat === 'b64_json'
			? encoded
					.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
					.map((item) => ({ b64_json: stripDataUrl(item.trim()) }))
			: urls
					.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
					.map((item) => ({ url: item.trim() }));
	return {
		created: Math.floor(Date.now() / 1000),
		data: images,
	};
}
