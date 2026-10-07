/**
 * MiniMax 原生 JSON 透传（`POST /v1/t2a_v2`、`POST /v1/image_generation`）的共享解析。
 * Proxy driver 与 Admin 调试台共用，避免两处各自解释 `base_resp`、计费字段和 hex 音频。
 */

export type MiniMaxBaseResp = {
	statusCode: number;
	statusMsg: string | null;
};

function asObject(value: unknown): Record<string, unknown> | null {
	return value != null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function asNonNegative(value: unknown): number | null {
	const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
	return Number.isFinite(n) && n >= 0 ? n : null;
}

/** 读 `base_resp.status_code`。缺字段或非数字时返回 null，调用方按 HTTP 状态处理。 */
export function readMiniMaxBaseResp(body: unknown): MiniMaxBaseResp | null {
	const base = asObject(asObject(body)?.base_resp);
	if (!base) return null;
	const statusCode = asNonNegative(base.status_code);
	if (statusCode == null || !Number.isInteger(statusCode)) return null;
	return {
		statusCode,
		statusMsg: typeof base.status_msg === 'string' && base.status_msg.trim() ? base.status_msg : null,
	};
}

/**
 * MiniMax 业务码 → HTTP 状态。
 * 上游经常用 HTTP 200 包错误，网关按这张表改写后，故障转移、熔断和计费才能按非 2xx 生效。
 * 0 保持 200。未列出的非 0 码视为上游失败（502）。
 */
export function miniMaxBaseRespHttpStatus(statusCode: number): number {
	if (statusCode === 0) return 200;
	if (statusCode === 1002 || statusCode === 1039) return 429;
	if (statusCode === 1004 || statusCode === 2049) return 401;
	if (statusCode === 1008) return 402;
	if (statusCode === 1026 || statusCode === 1042 || statusCode === 2013) return 400;
	if (statusCode === 1001) return 504;
	return 502;
}

/** 同步语音合成的计费字符数：`extra_info.usage_characters`。 */
export function readMiniMaxUsageCharacters(body: unknown): number | null {
	const extra = asObject(asObject(body)?.extra_info);
	const characters = asNonNegative(extra?.usage_characters);
	return characters == null ? null : Math.floor(characters);
}

function stringListLength(value: unknown): number | null {
	return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim() !== '').length : null;
}

/**
 * 成功生成的图片数。优先用 `metadata.success_count`，否则数 `data.image_urls` / `data.image_base64`。
 */
export function countMiniMaxImages(body: unknown): number {
	const metadata = asObject(asObject(body)?.metadata);
	const success = asNonNegative(metadata?.success_count);
	if (success != null) return Math.floor(success);
	const data = asObject(asObject(body)?.data);
	return stringListLength(data?.image_urls) ?? stringListLength(data?.image_base64) ?? 0;
}

/** hex 音频 → 字节。奇数长度或非十六进制字符抛错。 */
export function decodeMiniMaxHexAudio(hex: string): Uint8Array {
	const normalized = hex.trim();
	if (normalized.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(normalized)) {
		throw new Error('MiniMax returned invalid hex audio data');
	}
	const bytes = new Uint8Array(normalized.length / 2);
	for (let i = 0; i < bytes.length; i += 1) {
		bytes[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

/** `extra_info.audio_format` → 调试台播放用的 Content-Type。未知格式按 mp3。 */
export function miniMaxAudioContentType(format: string | null | undefined): string {
	switch ((format ?? '').trim().toLowerCase()) {
		case 'pcm':
			return 'audio/pcm';
		case 'flac':
			return 'audio/flac';
		case 'wav':
		case 'pcmu_wav':
			return 'audio/wav';
		case 'pcmu_raw':
			return 'audio/basic';
		case 'opus':
			return 'audio/ogg';
		default:
			return 'audio/mpeg';
	}
}

export function readMiniMaxAudioFormat(body: unknown): string | null {
	const extra = asObject(asObject(body)?.extra_info);
	return typeof extra?.audio_format === 'string' && extra.audio_format.trim()
		? extra.audio_format.trim()
		: null;
}

export type MiniMaxSpeechAudio = {
	hex: string;
	format: string | null;
};

function speechAudioFromPayload(body: unknown): MiniMaxSpeechAudio | null {
	const data = asObject(asObject(body)?.data);
	const hex = typeof data?.audio === 'string' ? data.audio.trim() : '';
	if (!hex) return null;
	return { hex, format: readMiniMaxAudioFormat(body) };
}

function parseMiniMaxSsePayloads(text: string): unknown[] {
	const payloads: unknown[] = [];
	for (const frame of text.split(/\n\n+/)) {
		const data = frame
			.split('\n')
			.filter((line) => line.startsWith('data:'))
			.map((line) => line.slice(5).trimStart())
			.join('\n')
			.trim();
		if (!data || data === '[DONE]') continue;
		try {
			payloads.push(JSON.parse(data));
		} catch {
			// 非 JSON 帧不参与音频拼接。
		}
	}
	return payloads;
}

/**
 * 从同步 JSON 或 SSE 文本里取出可播放的 hex 音频。
 * 默认最后一帧 `status: 2` 带完整音频；只有这一帧没有音频时才拼接各分片，避免和聚合帧重复。
 */
export function extractMiniMaxSpeechAudio(text: string): MiniMaxSpeechAudio | null {
	const trimmed = text.trim();
	if (!trimmed) return null;
	if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
		try {
			const parsed = JSON.parse(trimmed) as unknown;
			const payload = Array.isArray(parsed) ? parsed[parsed.length - 1] : parsed;
			const direct = speechAudioFromPayload(payload);
			if (direct) return direct;
		} catch {
			// 不是完整 JSON 时按 SSE 继续扫。
		}
	}
	const events = parseMiniMaxSsePayloads(trimmed);
	if (events.length === 0) return null;
	for (let i = events.length - 1; i >= 0; i -= 1) {
		const event = asObject(events[i]);
		const data = asObject(event?.data);
		const status = data?.status;
		const hex = typeof data?.audio === 'string' ? data.audio.trim() : '';
		if ((status === 2 || status === '2') && hex) {
			return { hex, format: readMiniMaxAudioFormat(event) };
		}
	}
	const hex = events
		.map((event) => {
			const data = asObject(asObject(event)?.data);
			return typeof data?.audio === 'string' ? data.audio.trim() : '';
		})
		.filter((part) => part !== '')
		.join('');
	if (!hex) return null;
	return { hex, format: readMiniMaxAudioFormat(events[events.length - 1]) };
}
