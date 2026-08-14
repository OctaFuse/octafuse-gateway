import { resolveUpstreamEndpoint } from '@octafuse/core';
import type { RouteResult } from '../model-router';
import type { UsageFromStream } from '../proxy';
import { buildRouteRequestBody } from '../route-default-params';
import { extractUpstreamRequestId, normalizeUpstreamId } from './upstream-request-id';
import type { RequestTimingAttempt, RequestTimingCollector } from '../request-timing';

/**
 * OpenAI Responses API 透传：
 * - 非流式 JSON 从终态 `usage` 记账
 * - SSE 识别 typed events，usage 通常在 `response.completed` / `response.incomplete`
 * - 原样转发事件；上游静默 EOF 时补一条 `error`，避免客户端挂死
 */

const EMPTY_USAGE_LOCAL: UsageFromStream = {
	input_tokens: 0,
	output_tokens: 0,
	cache_read_tokens: 0,
	cache_write_tokens: 0,
	reasoning_tokens: 0,
	total_tokens: 0,
	raw_usage: null,
};

const POST_DISCONNECT_DRAIN_MS = 90_000;

const TERMINAL_EVENT_TYPES = new Set([
	'response.completed',
	'response.failed',
	'response.incomplete',
	'error',
]);

const REASONING_DELTA_TYPES = new Set([
	'response.reasoning_text.delta',
	'response.reasoning_summary_text.delta',
]);

const OUTPUT_DELTA_TYPES = new Set([
	'response.output_text.delta',
	'response.function_call_arguments.delta',
]);

type ResponsesUsage = {
	input_tokens?: number;
	output_tokens?: number;
	prompt_tokens?: number;
	completion_tokens?: number;
	total_tokens?: number;
	input_tokens_details?: {
		cached_tokens?: number;
		cache_creation_tokens?: number;
	};
	output_tokens_details?: {
		reasoning_tokens?: number;
	};
	prompt_tokens_details?: {
		cached_tokens?: number;
		cache_creation_tokens?: number;
	};
	completion_tokens_details?: {
		reasoning_tokens?: number;
	};
};

type ResponsesEvent = {
	type?: string;
	id?: string;
	delta?: unknown;
	usage?: ResponsesUsage;
	response?: {
		id?: string;
		status?: string;
		usage?: ResponsesUsage;
	};
	error?: { message?: string; code?: string };
};

type SSEState = { lineBuffer: string };

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function numberOrZero(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function usageFromResponses(u: ResponsesUsage): UsageFromStream {
	const inputTokens = numberOrZero(u.input_tokens ?? u.prompt_tokens);
	const outputTokens = numberOrZero(u.output_tokens ?? u.completion_tokens);
	const cacheRead = numberOrZero(
		u.input_tokens_details?.cached_tokens ?? u.prompt_tokens_details?.cached_tokens,
	);
	const cacheWrite = numberOrZero(
		u.input_tokens_details?.cache_creation_tokens ?? u.prompt_tokens_details?.cache_creation_tokens,
	);
	const reasoning = numberOrZero(
		u.output_tokens_details?.reasoning_tokens ?? u.completion_tokens_details?.reasoning_tokens,
	);
	return {
		input_tokens: inputTokens,
		output_tokens: outputTokens,
		cache_read_tokens: cacheRead,
		cache_write_tokens: cacheWrite,
		reasoning_tokens: reasoning,
		total_tokens: numberOrZero(u.total_tokens) || inputTokens + outputTokens,
		raw_usage: JSON.stringify(u),
	};
}

export function applyResponsesUsage(target: UsageFromStream, usage: ResponsesUsage): void {
	const next = usageFromResponses(usage);
	target.input_tokens = next.input_tokens;
	target.output_tokens = next.output_tokens;
	target.cache_read_tokens = next.cache_read_tokens;
	target.cache_write_tokens = next.cache_write_tokens;
	target.reasoning_tokens = next.reasoning_tokens;
	target.total_tokens = next.total_tokens;
	target.raw_usage = next.raw_usage;
}

export function isResponsesTerminalEventType(type: string | undefined): boolean {
	return Boolean(type && TERMINAL_EVENT_TYPES.has(type));
}

function applyResponsesEvent(
	parsed: ResponsesEvent,
	usage: UsageFromStream,
	timing?: RequestTimingCollector | null,
): { terminal: boolean } {
	const type = typeof parsed.type === 'string' ? parsed.type : '';
	timing?.markFirstEvent();
	if (REASONING_DELTA_TYPES.has(type)) timing?.markFirstReasoningToken();
	if (OUTPUT_DELTA_TYPES.has(type)) timing?.markFirstToken();

	const responseId = normalizeUpstreamId(parsed.response?.id ?? parsed.id);
	if (responseId && !usage.upstreamMessageId) {
		usage.upstreamMessageId = responseId;
	}

	const usageObj = parsed.response?.usage ?? parsed.usage;
	if (usageObj) applyResponsesUsage(usage, usageObj);

	if (type === 'response.failed' || type === 'error') {
		const message =
			(typeof parsed.error?.message === 'string' && parsed.error.message.trim()) ||
			(typeof parsed.response?.status === 'string' ? `Responses ${parsed.response.status}` : '') ||
			'Upstream Responses stream failed';
		usage.stream_error = message;
	}

	return { terminal: isResponsesTerminalEventType(type) };
}

export function processResponsesDataLine(
	line: string,
	usage: UsageFromStream,
	timing?: RequestTimingCollector | null,
): boolean {
	if (!line.startsWith('data: ')) return false;
	const data = line.slice(6).trim();
	if (!data || data === '[DONE]') return data === '[DONE]';
	try {
		const parsed = JSON.parse(data) as ResponsesEvent;
		return applyResponsesEvent(parsed, usage, timing).terminal;
	} catch {
		return false;
	}
}

function syntheticMissingTerminalEvent(): string {
	return (
		'event: error\n' +
		`data: ${JSON.stringify({
			type: 'error',
			error: {
				message: 'Upstream stream ended without a terminal Responses event',
				code: 'responses.incomplete_stream',
			},
		})}\n\n`
	);
}

async function pumpResponsesWithUsageTracking(
	upstream: ReadableStream<Uint8Array>,
	downstream: WritableStream<Uint8Array>,
	usage: UsageFromStream,
	resolveUsage: (u: UsageFromStream) => void,
	requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
): Promise<void> {
	const reader = upstream.getReader();
	const writer = downstream.getWriter();
	const state: SSEState = { lineBuffer: '' };
	let clientDisconnected = false;
	let disconnectTime = 0;
	let sawTerminal = false;

	const onAbort = (): void => {
		usage.cancelled = true;
		clientDisconnected = true;
	};
	requestSignal?.addEventListener('abort', onAbort);

	const writeChunk = async (text: string): Promise<void> => {
		if (!text || clientDisconnected) return;
		try {
			await writer.write(encoder.encode(text));
		} catch {
			clientDisconnected = true;
			disconnectTime = Date.now();
			usage.cancelled = true;
			console.log(
				'[Gateway Responses] client disconnected, draining upstream for usage input_tokens=%s output_tokens=%s',
				usage.input_tokens,
				usage.output_tokens,
			);
		}
	};

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				if (state.lineBuffer.trim()) {
					const line = state.lineBuffer.trim();
					state.lineBuffer = '';
					if (processResponsesDataLine(line, usage, timing)) sawTerminal = true;
					await writeChunk(line + '\n');
				}
				if (!sawTerminal && !clientDisconnected) {
					usage.stream_error =
						usage.stream_error ?? 'Upstream stream ended without a terminal Responses event';
					await writeChunk(syntheticMissingTerminalEvent());
				}
				break;
			}

			if (value.byteLength > 0) timing?.markFirstByte();
			state.lineBuffer += decoder.decode(value, { stream: true });
			const lines = state.lineBuffer.split('\n');
			state.lineBuffer = lines.pop() ?? '';

			let forward = '';
			for (const line of lines) {
				if (processResponsesDataLine(line, usage, timing)) sawTerminal = true;
				forward += line + '\n';
			}
			await writeChunk(forward);

			if (
				clientDisconnected &&
				disconnectTime > 0 &&
				Date.now() - disconnectTime > POST_DISCONNECT_DRAIN_MS
			) {
				console.log('[Gateway Responses] drain timeout, resolving with partial usage');
				await reader.cancel();
				break;
			}
		}
	} catch (err) {
		console.warn('[Gateway Responses] pump error', err instanceof Error ? err.message : String(err));
		if (!sawTerminal && !clientDisconnected) {
			usage.stream_error = usage.stream_error ?? (err instanceof Error ? err.message : String(err));
			try {
				await writeChunk(syntheticMissingTerminalEvent());
			} catch {
				// already disconnected
			}
		}
	} finally {
		requestSignal?.removeEventListener('abort', onAbort);
		timing?.markStreamComplete();
		resolveUsage(usage);
		try {
			await writer.close();
		} catch (err) {
			console.warn(
				'[Gateway Responses] pump writer.close (non-fatal)',
				err instanceof Error ? err.message : String(err),
				{ clientDisconnected, usageCancelled: usage.cancelled },
			);
		}
	}
}

function streamResponseWithUsage(
	response: Response,
	requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
): { response: Response; usagePromise: Promise<UsageFromStream> } {
	let resolveUsage!: (u: UsageFromStream) => void;
	const usagePromise = new Promise<UsageFromStream>((resolve) => {
		resolveUsage = resolve;
	});

	const usage: UsageFromStream = { ...EMPTY_USAGE_LOCAL };
	const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();

	pumpResponsesWithUsageTracking(response.body!, writable, usage, resolveUsage, requestSignal, timing).catch(
		() => {
			// resolveUsage already called in finally
		},
	);

	return {
		response: new Response(readable, {
			status: response.status,
			headers: {
				'Content-Type': response.headers.get('Content-Type') ?? 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
			},
		}),
		usagePromise,
	};
}

function extractUsageFromResponsesObject(parsed: {
	id?: string;
	usage?: ResponsesUsage;
	response?: { id?: string; usage?: ResponsesUsage };
}): UsageFromStream {
	const usageObj = parsed.usage ?? parsed.response?.usage;
	let usage: UsageFromStream = usageObj ? usageFromResponses(usageObj) : { ...EMPTY_USAGE_LOCAL };
	const msgId = normalizeUpstreamId(parsed.id ?? parsed.response?.id);
	if (msgId) usage = { ...usage, upstreamMessageId: msgId };
	return usage;
}

async function nonStreamResponseWithUsage(
	response: Response,
	timing?: RequestTimingCollector | null,
): Promise<{ response: Response; usagePromise: Promise<UsageFromStream> }> {
	const contentType = response.headers.get('Content-Type') ?? '';
	if (!contentType.includes('application/json')) {
		return {
			response,
			usagePromise: Promise.resolve(EMPTY_USAGE_LOCAL),
		};
	}
	try {
		const text = await response.text();
		timing?.markStreamComplete();
		const parsed = JSON.parse(text) as {
			id?: string;
			usage?: ResponsesUsage;
			response?: { id?: string; usage?: ResponsesUsage };
		};
		return {
			response: new Response(text, {
				status: response.status,
				statusText: response.statusText,
				headers: response.headers,
			}),
			usagePromise: Promise.resolve(extractUsageFromResponsesObject(parsed)),
		};
	} catch {
		timing?.markStreamComplete();
		return {
			response,
			usagePromise: Promise.resolve(EMPTY_USAGE_LOCAL),
		};
	}
}

/**
 * 向供应商发起 OpenAI 兼容 `POST …/responses`。
 * 未知字段原样透传；仅把 `model` 换成路由上的上游模型名。
 */
export async function dispatchOpenAiResponsesRoute(
	route: RouteResult,
	body: Record<string, unknown>,
	requestSignal?: AbortSignal,
	timing?: RequestTimingCollector | null,
	attempt?: RequestTimingAttempt,
): Promise<{ response: Response; usagePromise: Promise<UsageFromStream>; upstreamRequestId: string | null }> {
	const url = resolveUpstreamEndpoint('openai', 'responses', route.providerEndpoints, {
		providerId: route.providerId,
	});
	const requestBody = {
		...buildRouteRequestBody(route, body),
		model: route.providerModelName,
	};

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${route.providerApiKey}`,
		},
		body: JSON.stringify(requestBody),
	});
	timing?.markAttemptHeaders(attempt, response.status);
	const upstreamRequestId = extractUpstreamRequestId(response.headers);

	if (response.ok && response.body) {
		const contentType = response.headers.get('Content-Type') ?? '';
		if (contentType.includes('application/json')) {
			const result = await nonStreamResponseWithUsage(response, timing);
			return { ...result, upstreamRequestId };
		}
		const result = streamResponseWithUsage(response, requestSignal, timing);
		return { ...result, upstreamRequestId };
	}

	return {
		response,
		usagePromise: Promise.resolve(EMPTY_USAGE_LOCAL),
		upstreamRequestId,
	};
}
