/**
 * MiniMax 文件转写（`POST /v1/speech_to_text`）与 OpenAI `/v1/audio/transcriptions` 的共享转换规则。
 * Proxy driver 与 Admin 调试台共用，避免两处各自改写 language 和字幕。
 */

export type MiniMaxAsrUpstreamFormat = 'json' | 'verbose_json';

export type MiniMaxAsrClientShape = 'text' | 'json' | 'verbose_json' | 'srt' | 'vtt';

export type MiniMaxAsrFormatMapping = {
	upstreamFormat: MiniMaxAsrUpstreamFormat;
	clientShape: MiniMaxAsrClientShape;
};

export type MiniMaxAsrSegment = {
	start: number;
	end: number;
	text: string;
	speaker?: string;
};

/** 这些字段不能原样放进 MiniMax 表单。language 走请求头；prompt / temperature 丢弃。 */
export const MINIMAX_ASR_DROPPED_FORM_KEYS = ['language', 'prompt', 'temperature'] as const;

/**
 * 客户端 `response_format` → 上游格式与回包形状。
 * srt / vtt 向上游要 `verbose_json`，以便本地生成字幕时仍能拿到 `duration`。
 */
export function resolveMiniMaxAsrUpstreamFormat(
	clientFormat: string | null | undefined
): MiniMaxAsrFormatMapping {
	const format = (clientFormat ?? '').trim().toLowerCase();
	if (format === 'text') {
		return { upstreamFormat: 'json', clientShape: 'text' };
	}
	if (format === 'verbose_json' || format === 'diarized_json') {
		return { upstreamFormat: 'verbose_json', clientShape: 'verbose_json' };
	}
	if (format === 'srt') {
		return { upstreamFormat: 'verbose_json', clientShape: 'srt' };
	}
	if (format === 'vtt') {
		return { upstreamFormat: 'verbose_json', clientShape: 'vtt' };
	}
	return { upstreamFormat: 'json', clientShape: 'json' };
}

/** MiniMax 把语言提示放在 `language` 请求头（BCP-47），不放表单。 */
export function buildMiniMaxAsrHeaders(input: {
	language?: string | null;
}): Record<string, string> {
	const language = input.language?.trim() ?? '';
	if (!language) return {};
	return { language };
}

function finiteSeconds(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
}

export function readMiniMaxAsrSegments(body: unknown): MiniMaxAsrSegment[] {
	if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
	const raw = (body as Record<string, unknown>).segments;
	if (!Array.isArray(raw)) return [];
	const segments: MiniMaxAsrSegment[] = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
		const row = item as Record<string, unknown>;
		const text = typeof row.text === 'string' ? row.text : '';
		const start = finiteSeconds(row.start) ?? 0;
		const end = finiteSeconds(row.end) ?? start;
		const speaker = typeof row.speaker === 'string' ? row.speaker.trim() : '';
		segments.push({
			start: Math.max(0, start),
			end: Math.max(0, end),
			text,
			...(speaker ? { speaker } : {}),
		});
	}
	return segments;
}

function pad(value: number, width: number): string {
	return String(value).padStart(width, '0');
}

/** SRT 用逗号分隔毫秒，WebVTT 用点。 */
export function formatSubtitleTimestamp(seconds: number, separator: ',' | '.'): string {
	const totalMs = Math.max(0, Math.round(seconds * 1000));
	const ms = totalMs % 1000;
	const totalSec = Math.floor(totalMs / 1000);
	const sec = totalSec % 60;
	const totalMin = Math.floor(totalSec / 60);
	const min = totalMin % 60;
	const hour = Math.floor(totalMin / 60);
	return `${pad(hour, 2)}:${pad(min, 2)}:${pad(sec, 2)}${separator}${pad(ms, 3)}`;
}

function cueText(segment: MiniMaxAsrSegment): string {
	const text = segment.text.trim();
	return segment.speaker ? `[${segment.speaker}] ${text}`.trim() : text;
}

function renderCues(segments: readonly MiniMaxAsrSegment[], separator: ',' | '.'): string {
	return segments
		.map((segment, index) => {
			const start = formatSubtitleTimestamp(segment.start, separator);
			const end = formatSubtitleTimestamp(Math.max(segment.start, segment.end), separator);
			return `${index + 1}\n${start} --> ${end}\n${cueText(segment)}`;
		})
		.join('\n\n');
}

export function renderSegmentsAsSrt(segments: readonly MiniMaxAsrSegment[]): string {
	if (segments.length === 0) return '';
	return `${renderCues(segments, ',')}\n`;
}

export function renderSegmentsAsVtt(segments: readonly MiniMaxAsrSegment[]): string {
	if (segments.length === 0) return 'WEBVTT\n';
	return `WEBVTT\n\n${renderCues(segments, '.')}\n`;
}
