/**
 * OpenAI Audio Transcriptions `usage`（type=tokens）解析与按 token 计费。
 * 对齐官方 gpt-4o-*transcribe：input（含 audio_tokens）+ output 文本，单价 $/1M。
 */
import type { BillingPriceSnapshot } from './pricing-profile';

const TOKENS_PER_MILLION = 1_000_000;

/** 上游 transcription `usage.type === 'tokens'` 标准化分项。 */
export type AudioTokenUsage = {
	input_tokens: number;
	output_tokens: number;
	total_tokens: number;
	audio_tokens: number;
	text_tokens: number;
	raw_usage: string | null;
};

export const EMPTY_AUDIO_TOKEN_USAGE: AudioTokenUsage = {
	input_tokens: 0,
	output_tokens: 0,
	total_tokens: 0,
	audio_tokens: 0,
	text_tokens: 0,
	raw_usage: null,
};

function asNonNegInt(v: unknown): number {
	if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
		return Math.floor(v);
	}
	if (typeof v === 'string' && v.trim() !== '') {
		const n = Number(v);
		if (Number.isFinite(n) && n >= 0) {
			return Math.floor(n);
		}
	}
	return 0;
}

/**
 * 解析 OpenAI `/audio/transcriptions` 响应中的 token usage。
 * - 仅当 `usage.type === 'tokens'`（或缺省但有 input/output tokens）时返回非空用量
 * - `type === 'duration'` 返回 null（改走 per_second）
 */
export function parseOpenAiAudioTokenUsage(body: unknown): AudioTokenUsage | null {
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		return null;
	}
	const usage = (body as Record<string, unknown>).usage;
	if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
		return null;
	}
	const u = usage as Record<string, unknown>;
	if (u.type === 'duration') {
		return null;
	}

	const inputDetails =
		u.input_token_details &&
		typeof u.input_token_details === 'object' &&
		!Array.isArray(u.input_token_details)
			? (u.input_token_details as Record<string, unknown>)
			: u.input_tokens_details &&
				  typeof u.input_tokens_details === 'object' &&
				  !Array.isArray(u.input_tokens_details)
				? (u.input_tokens_details as Record<string, unknown>)
				: null;

	const input_tokens = asNonNegInt(u.input_tokens);
	const output_tokens = asNonNegInt(u.output_tokens);
	const total_tokens = asNonNegInt(u.total_tokens) || input_tokens + output_tokens;
	const audio_tokens = inputDetails ? asNonNegInt(inputDetails.audio_tokens) : 0;
	const text_tokens = inputDetails
		? asNonNegInt(inputDetails.text_tokens)
		: Math.max(0, input_tokens - audio_tokens);

	if (u.type !== 'tokens' && input_tokens === 0 && output_tokens === 0 && total_tokens === 0) {
		return null;
	}

	let raw_usage: string | null = null;
	try {
		raw_usage = JSON.stringify(usage);
	} catch {
		raw_usage = null;
	}

	return {
		input_tokens,
		output_tokens,
		total_tokens,
		audio_tokens,
		text_tokens,
		raw_usage,
	};
}

/**
 * 语音合成（文本进、音频出）：把已拆好的 input/output 计数收成用量，
 * 输入是文本 token，输出就是音频 token。全 0 视为没有上游回执。
 */
export function audioTokenUsageFromCounts(input: {
	input_tokens?: number | null;
	output_tokens?: number | null;
	total_tokens?: number | null;
	raw_usage?: string | null;
}): AudioTokenUsage | null {
	const input_tokens = asNonNegInt(input.input_tokens);
	const output_tokens = asNonNegInt(input.output_tokens);
	const total_tokens = asNonNegInt(input.total_tokens) || input_tokens + output_tokens;
	if (input_tokens === 0 && output_tokens === 0 && total_tokens === 0) return null;
	return {
		input_tokens,
		output_tokens,
		total_tokens,
		audio_tokens: output_tokens,
		text_tokens: input_tokens,
		raw_usage: input.raw_usage ?? null,
	};
}

/**
 * 语音合成 token 计费的预算预检用量（只用于预检，不用于最终扣费）。
 * 输入按「1 字符 ≤ 1 token」取上界；输出音频 token 随时长增长，
 * 按每字符 6 个取偏保守估值，避免余额不足的请求被放过。
 */
export function buildSpeechTokenPrecheckUsage(inputCharacters: number): AudioTokenUsage {
	const chars = Number.isFinite(inputCharacters) && inputCharacters > 0 ? Math.ceil(inputCharacters) : 1;
	const input_tokens = chars;
	const output_tokens = chars * 6;
	return {
		input_tokens,
		output_tokens,
		total_tokens: input_tokens + output_tokens,
		audio_tokens: output_tokens,
		text_tokens: input_tokens,
		raw_usage: null,
	};
}

/** 原始成本（未乘路由倍率）：(input×input_price + output×output_price) / 1M */
export function computeAudioTokenMeteredCost(
	usage: AudioTokenUsage,
	prices: BillingPriceSnapshot
): number {
	const inputPrice = prices.input_price ?? 0;
	const outputPrice = prices.output_price ?? 0;
	return (usage.input_tokens * inputPrice + usage.output_tokens * outputPrice) / TOKENS_PER_MILLION;
}

/**
 * Token 模式预算预检用量（偏保守上界）。
 * OpenAI Realtime 文档：用户音频约 1 token / 100ms → 10 tokens/s；
 * 另加 prompt/输出余量，避免短请求低估。
 */
export function buildAudioTokenPrecheckUsage(durationSeconds: number): AudioTokenUsage {
	const duration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 1;
	const audio_tokens = Math.max(10, Math.ceil(duration * 10));
	const text_tokens = 32;
	const input_tokens = audio_tokens + text_tokens;
	const output_tokens = Math.max(64, Math.ceil(duration * 20));
	return {
		input_tokens,
		output_tokens,
		total_tokens: input_tokens + output_tokens,
		audio_tokens,
		text_tokens,
		raw_usage: null,
	};
}
