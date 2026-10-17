/**
 * OpenAI 入口 → ElevenLabs 原生 TTS / STT 的请求与响应映射。
 * Proxy 驱动和 Admin 调试台共用，避免两处各写一份字段转换。
 */
import {
	elevenLabsWordsDurationSeconds,
	elevenLabsWordsToSegments,
	isValidElevenLabsVoiceId,
	readElevenLabsAudioDuration,
	readElevenLabsSttLanguage,
	readElevenLabsSttText,
	readElevenLabsSttWords,
	type ElevenLabsSegment,
} from './elevenlabs-native';
import { renderSegmentsAsSrt, renderSegmentsAsVtt } from './minimax-asr';

export class ElevenLabsOpenAiClientError extends Error {
	readonly status = 400;
	constructor(message: string) {
		super(message);
		this.name = 'ElevenLabsOpenAiClientError';
	}
}

/** OpenAI `response_format` → ElevenLabs `output_format` 与响应 Content-Type。aac / flac 官方没有。 */
export const ELEVENLABS_OPENAI_SPEECH_FORMATS = {
	mp3: { outputFormat: 'mp3_44100_128', contentType: 'audio/mpeg' },
	opus: { outputFormat: 'opus_48000_128', contentType: 'audio/ogg' },
	pcm: { outputFormat: 'pcm_24000', contentType: 'application/octet-stream' },
	wav: { outputFormat: 'wav_24000', contentType: 'audio/wav' },
} as const;
export type ElevenLabsOpenAiSpeechFormat = keyof typeof ELEVENLABS_OPENAI_SPEECH_FORMATS;

/** ElevenLabs `voice_settings.speed` 官方建议范围。 */
export const ELEVENLABS_SPEED_MIN = 0.7;
export const ELEVENLABS_SPEED_MAX = 1.2;

/** 合并额外字段后从 JSON body 搬到 query 的字段。 */
const TTS_QUERY_KEYS = ['enable_logging', 'optimize_streaming_latency'] as const;

function isSpeechFormat(value: string): value is ElevenLabsOpenAiSpeechFormat {
	return Object.prototype.hasOwnProperty.call(ELEVENLABS_OPENAI_SPEECH_FORMATS, value);
}

function asObject(value: unknown): Record<string, unknown> | null {
	return value != null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export type ElevenLabsTtsRequest = {
	voiceId: string;
	/** `'' | '/stream'`，接在 `/text-to-speech/{voice_id}` 之后。 */
	pathSuffix: '' | '/stream';
	query: Record<string, string>;
	body: Record<string, unknown>;
	contentType: string;
};

/** OpenAI `POST /v1/audio/speech` → ElevenLabs `POST /v1/text-to-speech/{voice_id}[/stream]`。 */
export function buildElevenLabsTtsRequestFromOpenAi(input: {
	model: string;
	text: string;
	voiceId: string;
	responseFormat: string;
	speed: number;
	stream: boolean;
	instructions?: string;
}): ElevenLabsTtsRequest {
	if (!input.text.trim()) throw new ElevenLabsOpenAiClientError('input is required');
	const voiceId = input.voiceId.trim();
	if (!voiceId) throw new ElevenLabsOpenAiClientError('voice is required');
	if (!isValidElevenLabsVoiceId(voiceId)) {
		throw new ElevenLabsOpenAiClientError('voice must be an ElevenLabs voice_id');
	}
	if (input.instructions?.trim()) {
		throw new ElevenLabsOpenAiClientError(
			'ElevenLabs speech does not support instructions; put audio tags in input instead',
		);
	}
	const format = input.responseFormat.trim().toLowerCase();
	if (!isSpeechFormat(format)) {
		throw new ElevenLabsOpenAiClientError(
			`ElevenLabs speech does not support response_format=${format || '(empty)'}`,
		);
	}
	if (!Number.isFinite(input.speed) || input.speed < ELEVENLABS_SPEED_MIN || input.speed > ELEVENLABS_SPEED_MAX) {
		throw new ElevenLabsOpenAiClientError(
			`ElevenLabs speech speed must be between ${ELEVENLABS_SPEED_MIN} and ${ELEVENLABS_SPEED_MAX}`,
		);
	}
	const spec = ELEVENLABS_OPENAI_SPEECH_FORMATS[format];
	const body: Record<string, unknown> = {
		text: input.text,
		model_id: input.model,
		...(input.speed !== 1 ? { voice_settings: { speed: input.speed } } : {}),
	};
	return {
		voiceId,
		pathSuffix: input.stream ? '/stream' : '',
		query: { output_format: spec.outputFormat },
		body,
		contentType: spec.contentType,
	};
}

/**
 * 合并路由参数与额外字段后，把 `enable_logging` / `optimize_streaming_latency` 从 body 移到 query。
 * 其余字段留在 JSON body。
 */
export function splitElevenLabsTtsQuery(body: Record<string, unknown>): {
	body: Record<string, unknown>;
	query: Record<string, string>;
} {
	const out = { ...body };
	const query: Record<string, string> = {};
	for (const key of TTS_QUERY_KEYS) {
		if (!(key in out)) continue;
		const value = out[key];
		delete out[key];
		if (value == null || value === '') continue;
		if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
			query[key] = String(value);
		}
	}
	return { body: out, query };
}

export type ElevenLabsAsrClientShape = 'text' | 'json' | 'verbose_json' | 'diarized_json' | 'srt' | 'vtt';

export type ElevenLabsAsrMapping = {
	clientShape: ElevenLabsAsrClientShape;
	/** 上游固定请求词级时间戳，由网关本地生成 segments、字幕和计费兜底时长。 */
	timestampsGranularity: 'word';
	/** diarized_json 强制开启说话人识别。 */
	diarize: boolean;
};

/** 客户端 `response_format` → 回包形状与上游固定参数。 */
export function resolveElevenLabsAsrMapping(clientFormat: string | null | undefined): ElevenLabsAsrMapping {
	const format = (clientFormat ?? '').trim().toLowerCase();
	const clientShape: ElevenLabsAsrClientShape =
		format === 'text' ||
		format === 'verbose_json' ||
		format === 'diarized_json' ||
		format === 'srt' ||
		format === 'vtt'
			? format
			: 'json';
	return {
		clientShape,
		timestampsGranularity: 'word',
		diarize: clientShape === 'diarized_json',
	};
}

/** ElevenLabs 转写表单不接收 `prompt`；`language` 映射为 `language_code`，其余原样转发。 */
export const ELEVENLABS_ASR_DROPPED_FORM_KEYS = ['language', 'prompt', 'response_format'] as const;

/** 异步模式拿不到结果也无法计费，禁止。 */
export function assertElevenLabsAsrNotWebhook(value: unknown): void {
	if (value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true')) {
		throw new ElevenLabsOpenAiClientError('ElevenLabs webhook (async) transcription is not supported');
	}
}

function subtitleCues(body: unknown): ElevenLabsSegment[] {
	const segments = elevenLabsWordsToSegments(readElevenLabsSttWords(body));
	if (segments.length > 0) return segments;
	const text = readElevenLabsSttText(body).trim();
	if (!text) return [];
	return [{ start: 0, end: readElevenLabsAudioDuration(body) ?? 0, text }];
}

/** 转写计费时长的兜底：`audio_duration_secs`，其次词表最大结束时间。 */
export function elevenLabsUpstreamDurationSeconds(body: unknown): number | null {
	return (
		readElevenLabsAudioDuration(body) ?? elevenLabsWordsDurationSeconds(readElevenLabsSttWords(body))
	);
}

/** ElevenLabs 转写结果 → OpenAI 回包（`text` 为纯文本字符串，其余为对象或字幕文本）。 */
export function elevenLabsTranscriptToClient(
	body: unknown,
	shape: ElevenLabsAsrClientShape,
): unknown {
	const text = readElevenLabsSttText(body);
	if (shape === 'text') return text;
	if (shape === 'json') return { text };
	const duration = elevenLabsUpstreamDurationSeconds(body) ?? 0;
	if (shape === 'srt') return renderSegmentsAsSrt(subtitleCues(body));
	if (shape === 'vtt') return renderSegmentsAsVtt(subtitleCues(body));
	const words = readElevenLabsSttWords(body);
	const segments = elevenLabsWordsToSegments(words);
	if (shape === 'diarized_json') {
		return {
			task: 'transcribe',
			duration,
			text,
			segments: segments.map((s, index) => ({
				type: 'transcript.text.segment',
				id: `seg_${index}`,
				start: s.start,
				end: s.end,
				text: s.text,
				speaker: s.speaker ?? 'speaker_0',
			})),
		};
	}
	const language = readElevenLabsSttLanguage(body);
	return {
		task: 'transcribe',
		...(language ? { language } : {}),
		duration,
		text,
		segments: segments.map((s, index) => ({
			id: index,
			start: s.start,
			end: s.end,
			text: s.text,
		})),
		words: words
			.filter((w) => w.type === 'word' && w.start != null && w.end != null)
			.map((w) => ({ word: w.text, start: w.start as number, end: w.end as number })),
	};
}

/** 保留给调用方判断上游是否把多声道拆开返回。 */
export function isElevenLabsMultichannelBody(body: unknown): boolean {
	return Array.isArray(asObject(body)?.transcripts);
}
