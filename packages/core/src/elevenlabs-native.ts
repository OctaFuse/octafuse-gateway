/**
 * ElevenLabs 原生透传（`POST /v1/text-to-speech/:voice_id*`、`POST /v1/speech-to-text`）的共享解析。
 * Proxy driver 与 Admin 调试台共用，避免两处各自解释错误体、计费头和转写词级时间戳。
 */

function asObject(value: unknown): Record<string, unknown> | null {
	return value != null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function finiteNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim() !== '') {
		const n = Number(value);
		if (Number.isFinite(n)) return n;
	}
	return null;
}

/** 文本转语音的四种原生变体，共用 operation `audio.speech`。 */
export const ELEVENLABS_TTS_VARIANTS = [
	'speech',
	'stream',
	'timestamps',
	'stream-timestamps',
] as const;
export type ElevenLabsTtsVariant = (typeof ELEVENLABS_TTS_VARIANTS)[number];

/** 变体 → 上游路径后缀（接在 `/text-to-speech/{voice_id}` 之后）。 */
export function elevenLabsTtsVariantSuffix(variant: ElevenLabsTtsVariant): string {
	switch (variant) {
		case 'speech':
			return '';
		case 'stream':
			return '/stream';
		case 'timestamps':
			return '/with-timestamps';
		case 'stream-timestamps':
			return '/stream/with-timestamps';
	}
}

/** 音色 ID 会拼进上游路径，只允许字母数字、下划线和连字符，防止路径注入。 */
export function isValidElevenLabsVoiceId(voiceId: string): boolean {
	return /^[A-Za-z0-9_-]{1,128}$/.test(voiceId);
}

export type ElevenLabsErrorInfo = {
	/** `detail.status`，例如 `quota_exceeded`。 */
	status: string | null;
	message: string | null;
};

/**
 * 读 ElevenLabs 错误体：`{ detail: { status, message } }`、`{ detail: "text" }`
 * 或 422 的 `{ detail: [{ msg, ... }] }`。
 */
export function readElevenLabsError(body: unknown): ElevenLabsErrorInfo {
	const detail = asObject(body)?.detail;
	if (typeof detail === 'string') {
		return { status: null, message: detail.trim() || null };
	}
	if (Array.isArray(detail)) {
		const messages = detail
			.map((item) => asObject(item)?.msg)
			.filter((msg): msg is string => typeof msg === 'string' && msg.trim() !== '');
		return { status: null, message: messages.length > 0 ? messages.join('; ') : null };
	}
	const obj = asObject(detail);
	if (!obj) return { status: null, message: null };
	return {
		status: typeof obj.status === 'string' && obj.status.trim() ? obj.status.trim() : null,
		message: typeof obj.message === 'string' && obj.message.trim() ? obj.message.trim() : null,
	};
}

/**
 * 上游错误状态 → 网关对外 HTTP 状态。
 * `quota_exceeded` 上游返回 401，但它是供应商额度用尽，改写成 402 后，proxy 的上游失败分类把 402 与 401/403 同样当作供应商侧故障（切换 provider、5 分钟熔断并告警），而不是用户请求错误。
 * 并发和繁忙统一为 429。其余保持上游状态码。
 */
export function elevenLabsErrorHttpStatus(httpStatus: number, errorStatus: string | null): number {
	if (httpStatus >= 200 && httpStatus < 300) return httpStatus;
	if (errorStatus === 'quota_exceeded') return 402;
	if (errorStatus === 'too_many_concurrent_requests' || errorStatus === 'system_busy') return 429;
	return httpStatus;
}

/** TTS 计费字符数：响应头 `x-character-count`。缺失或非法返回 null。 */
export function readElevenLabsCharacterCount(headers: { get(name: string): string | null }): number | null {
	const raw = headers.get('x-character-count');
	if (raw == null) return null;
	const n = finiteNumber(raw.trim());
	return n != null && n >= 0 ? Math.floor(n) : null;
}

export type ElevenLabsSttWord = {
	text: string;
	type: 'word' | 'spacing' | 'audio_event';
	start: number | null;
	end: number | null;
	speakerId: string | null;
};

export type ElevenLabsSegment = {
	start: number;
	end: number;
	text: string;
	speaker?: string;
};

/**
 * 取转写结果的词表。多声道默认返回 `{ transcripts: [...] }`，这里把各声道词表合并并按开始时间排序。
 */
export function readElevenLabsSttWords(body: unknown): ElevenLabsSttWord[] {
	const root = asObject(body);
	if (!root) return [];
	const groups: unknown[] = Array.isArray(root.transcripts)
		? root.transcripts.map((t) => asObject(t)?.words)
		: [root.words];
	const words: ElevenLabsSttWord[] = [];
	for (const group of groups) {
		if (!Array.isArray(group)) continue;
		for (const item of group) {
			const row = asObject(item);
			if (!row) continue;
			const type = row.type === 'spacing' || row.type === 'audio_event' ? row.type : 'word';
			words.push({
				text: typeof row.text === 'string' ? row.text : '',
				type,
				start: finiteNumber(row.start),
				end: finiteNumber(row.end),
				speakerId:
					typeof row.speaker_id === 'string' && row.speaker_id.trim() ? row.speaker_id.trim() : null,
			});
		}
	}
	if (Array.isArray(root.transcripts)) {
		words.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
	}
	return words;
}

/** 转写全文。多声道按声道顺序拼接。 */
export function readElevenLabsSttText(body: unknown): string {
	const root = asObject(body);
	if (!root) return typeof body === 'string' ? body : '';
	if (typeof root.text === 'string') return root.text;
	if (Array.isArray(root.transcripts)) {
		return root.transcripts
			.map((t) => asObject(t)?.text)
			.filter((t): t is string => typeof t === 'string')
			.join('\n');
	}
	return '';
}

/** 检测语言（ISO-639-3，如 `eng`）。 */
export function readElevenLabsSttLanguage(body: unknown): string | null {
	const root = asObject(body);
	const direct = root?.language_code;
	if (typeof direct === 'string' && direct.trim()) return direct.trim();
	if (Array.isArray(root?.transcripts)) {
		const first = asObject(root.transcripts[0])?.language_code;
		if (typeof first === 'string' && first.trim()) return first.trim();
	}
	return null;
}

/** 上游 `audio_duration_secs`；没有时返回 null。 */
export function readElevenLabsAudioDuration(body: unknown): number | null {
	const n = finiteNumber(asObject(body)?.audio_duration_secs);
	return n != null && n > 0 ? n : null;
}

/** 词表里最大的结束时间，作为计费时长的兜底。 */
export function elevenLabsWordsDurationSeconds(words: readonly ElevenLabsSttWord[]): number | null {
	let max = 0;
	for (const w of words) {
		if (w.end != null && w.end > max) max = w.end;
	}
	return max > 0 ? max : null;
}

const SENTENCE_END = /[.!?。！？…]["')\]」』”’]*$/;
const MAX_GAP_SECONDS = 1;
const MAX_SEGMENT_SECONDS = 15;

/**
 * 词表切成字幕段：说话人切换、句末标点、词间静音超过 1 秒、段长超过 15 秒时断开。
 * `spacing` 只参与拼接文本；没有时间戳的 token 沿用前一个词的时间。
 */
export function elevenLabsWordsToSegments(words: readonly ElevenLabsSttWord[]): ElevenLabsSegment[] {
	const segments: ElevenLabsSegment[] = [];
	let text = '';
	let start: number | null = null;
	let end = 0;
	let speaker: string | null = null;

	const flush = () => {
		const trimmed = text.trim();
		if (trimmed && start != null) {
			segments.push({
				start,
				end: Math.max(start, end),
				text: trimmed,
				...(speaker ? { speaker } : {}),
			});
		}
		text = '';
		start = null;
		speaker = null;
	};

	for (const word of words) {
		if (word.type === 'spacing') {
			if (start != null) text += word.text;
			continue;
		}
		const wStart = word.start ?? end;
		const wEnd = word.end ?? wStart;
		if (start != null) {
			const speakerChanged = word.speakerId != null && speaker != null && word.speakerId !== speaker;
			const gap = wStart - end > MAX_GAP_SECONDS;
			const tooLong = wEnd - start > MAX_SEGMENT_SECONDS;
			if (speakerChanged || gap || tooLong) flush();
		}
		if (start == null) {
			start = wStart;
			speaker = word.speakerId;
		}
		text += word.text;
		end = Math.max(end, wEnd);
		if (word.type === 'word' && SENTENCE_END.test(word.text.trim())) flush();
	}
	flush();
	return segments;
}
