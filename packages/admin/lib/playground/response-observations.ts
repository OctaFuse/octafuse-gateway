/**
 * Playground：从累计原始报文观察形态 / 正文 / 推理 / 工具 / 结束原因。
 * 仅打标签，不改写报文。
 */

import {
	inferPlaygroundParseMode,
	mergeAssistantTextParts,
	type PlaygroundProtocol,
	type PlaygroundResponseParseMode,
} from '@/lib/playground/merge-assistant-text';
import { resolveToolArgStreamVerdict, summarizeResponsesSseEvents } from '@/lib/playground/sse-event-summary';

export type ObservationTone = 'neutral' | 'positive' | 'muted' | 'warning';

export type ObservationTagId =
	| 'shape_sse'
	| 'shape_json'
	| 'shape_ndjson'
	| 'body'
	| 'empty_body'
	| 'reasoning'
	| 'tool_incremental'
	| 'tool_bulk'
	| 'tool'
	| 'no_tool'
	| 'finish';

export type ObservationTag = {
	id: ObservationTagId;
	tone: ObservationTone;
	messageKey: string;
	count?: number;
	finishReason?: string;
};

const TRUNCATION_REASONS = new Set([
	'length',
	'max_tokens',
	'max_token',
	'max_output_tokens',
	'max_tokens_exceeded',
	'incomplete',
]);

function isTruncationReason(reason: string): boolean {
	return TRUNCATION_REASONS.has(reason.toLowerCase()) || reason === 'MAX_TOKENS';
}

export function requestDeclaresTools(bodyText: string): boolean {
	if (!bodyText.trim()) return false;
	try {
		const parsed = JSON.parse(bodyText) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
		const tools = (parsed as { tools?: unknown }).tools;
		if (!Array.isArray(tools) || tools.length === 0) return false;
		return true;
	} catch {
		return false;
	}
}

function forEachJsonObject(
	raw: string,
	mode: PlaygroundResponseParseMode,
	onObj: (obj: Record<string, unknown>, eventName: string) => void,
): void {
	if (mode === 'json') {
		try {
			const parsed = JSON.parse(raw) as unknown;
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				onObj(parsed as Record<string, unknown>, '');
			}
		} catch {
			// ignore
		}
		return;
	}

	let lastEvent = '';
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith(':')) continue;
		if (trimmed.startsWith('event:')) {
			lastEvent = trimmed.slice(6).trim();
			continue;
		}
		let jsonStr = '';
		if (trimmed.startsWith('data:')) {
			jsonStr = trimmed.slice(5).trim();
		} else if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
			jsonStr = trimmed;
		}
		if (!jsonStr || jsonStr === '[DONE]') {
			lastEvent = '';
			continue;
		}
		try {
			const parsed = JSON.parse(jsonStr) as unknown;
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				onObj(parsed as Record<string, unknown>, lastEvent);
			}
		} catch {
			// ignore
		}
		lastEvent = '';
	}
}

function firstString(...values: unknown[]): string | null {
	for (const value of values) {
		if (typeof value === 'string' && value.trim()) return value.trim();
	}
	return null;
}

type ToolScan = {
	textDeltaCount: number;
	hasTool: boolean;
	deltaCount: number;
	deltaChars: number[];
	doneChars: number;
	finishReason: string | null;
};

function emptyScan(): ToolScan {
	return {
		textDeltaCount: 0,
		hasTool: false,
		deltaCount: 0,
		deltaChars: [],
		doneChars: 0,
		finishReason: null,
	};
}

function noteFinish(scan: ToolScan, reason: string | null | undefined): void {
	if (!reason || scan.finishReason) return;
	scan.finishReason = reason;
}

function scanOpenAiChatTools(obj: Record<string, unknown>, scan: ToolScan, mode: PlaygroundResponseParseMode): void {
	const choices = obj.choices;
	if (!Array.isArray(choices)) return;
	for (const choice of choices) {
		if (!choice || typeof choice !== 'object') continue;
		const ch = choice as {
			finish_reason?: unknown;
			delta?: Record<string, unknown>;
			message?: Record<string, unknown>;
		};
		noteFinish(scan, firstString(ch.finish_reason));
		const delta = ch.delta;
		if (delta && typeof delta === 'object') {
			if (typeof delta.content === 'string' && delta.content.length > 0) {
				scan.textDeltaCount += 1;
			}
			const toolCalls = delta.tool_calls;
			if (Array.isArray(toolCalls) && toolCalls.length > 0) {
				scan.hasTool = true;
				if (mode === 'sse') {
					for (const tc of toolCalls) {
						if (!tc || typeof tc !== 'object') continue;
						const args = (tc as { function?: { arguments?: unknown } }).function?.arguments;
						if (typeof args === 'string' && args.length > 0) {
							scan.deltaCount += 1;
							scan.deltaChars.push(args.length);
						}
					}
				}
			}
		}
		const messageToolCalls = ch.message?.tool_calls;
		if (Array.isArray(messageToolCalls) && messageToolCalls.length > 0) {
			scan.hasTool = true;
		}
	}
}

function scanAnthropic(obj: Record<string, unknown>, eventName: string, scan: ToolScan, mode: PlaygroundResponseParseMode): void {
	noteFinish(scan, firstString(obj.stop_reason));
	const delta = obj.delta;
	if (delta && typeof delta === 'object') {
		const d = delta as { type?: unknown; text?: unknown; partial_json?: unknown; stop_reason?: unknown };
		noteFinish(scan, firstString(d.stop_reason));
		if (d.type === 'text_delta' && typeof d.text === 'string' && d.text.length > 0) {
			scan.textDeltaCount += 1;
		}
		if (d.type === 'input_json_delta') {
			scan.hasTool = true;
			if (mode === 'sse') {
				const chunk = typeof d.partial_json === 'string' ? d.partial_json : '';
				if (chunk.length > 0) {
					scan.deltaCount += 1;
					scan.deltaChars.push(chunk.length);
				}
			}
		}
	}

	const type = typeof obj.type === 'string' ? obj.type : eventName;
	const block = obj.content_block;
	if (
		(type === 'content_block_start' || eventName === 'content_block_start') &&
		block &&
		typeof block === 'object' &&
		(block as { type?: unknown }).type === 'tool_use'
	) {
		scan.hasTool = true;
	}

	const content = obj.content;
	if (Array.isArray(content)) {
		for (const item of content) {
			if (!item || typeof item !== 'object') continue;
			if ((item as { type?: unknown }).type === 'tool_use') scan.hasTool = true;
		}
	}
}

function scanGemini(obj: Record<string, unknown>, scan: ToolScan, mode: PlaygroundResponseParseMode): void {
	const cands = obj.candidates;
	if (!Array.isArray(cands) || cands.length === 0) return;
	const first = cands[0];
	if (!first || typeof first !== 'object') return;
	const cand = first as { finishReason?: unknown; content?: { parts?: unknown } };
	noteFinish(scan, firstString(cand.finishReason));
	const parts = cand.content?.parts;
	if (!Array.isArray(parts)) return;
	let bodyInChunk = false;
	let toolInChunk = false;
	let toolArgChars = 0;
	for (const part of parts) {
		if (!part || typeof part !== 'object') continue;
		const p = part as { text?: unknown; thought?: unknown; functionCall?: unknown };
		if (typeof p.text === 'string' && p.text.length > 0 && p.thought !== true) {
			bodyInChunk = true;
		}
		if (p.functionCall && typeof p.functionCall === 'object') {
			toolInChunk = true;
			const argChars = geminiFunctionCallArgChars(p.functionCall as Record<string, unknown>);
			if (argChars != null) {
				toolArgChars += argChars;
			}
		}
	}
	if (bodyInChunk && mode === 'sse') scan.textDeltaCount += 1;
	if (toolInChunk) {
		scan.hasTool = true;
		if (mode === 'sse' && toolArgChars > 0) {
			scan.deltaCount += 1;
			scan.deltaChars.push(toolArgChars);
		}
	}
}

/** Count streamed `partialArgs` fragments or a complete `args` object. Name-only / empty frames are ignored. */
function geminiFunctionCallArgChars(functionCall: Record<string, unknown>): number | null {
	const partialArgs = functionCall.partialArgs;
	if (Array.isArray(partialArgs) && partialArgs.length > 0) {
		let chars = 0;
		let sawValue = false;
		for (const partial of partialArgs) {
			if (!partial || typeof partial !== 'object') continue;
			const value = (partial as { stringValue?: unknown }).stringValue;
			if (typeof value !== 'string') continue;
			sawValue = true;
			chars += value.length;
		}
		return sawValue ? chars : 0;
	}
	const args = functionCall.args;
	if (args && typeof args === 'object' && !Array.isArray(args) && Object.keys(args).length > 0) {
		try {
			return JSON.stringify(args).length;
		} catch {
			return 1;
		}
	}
	return null;
}

function scanResponsesFinish(obj: Record<string, unknown>, scan: ToolScan): void {
	const response = obj.response;
	const source = response && typeof response === 'object' ? (response as Record<string, unknown>) : obj;
	const incomplete = source.incomplete_details;
	const incompleteReason =
		incomplete && typeof incomplete === 'object'
			? firstString((incomplete as { reason?: unknown }).reason)
			: null;
	noteFinish(scan, incompleteReason);
	const status = firstString(source.status);
	if (status && status !== 'completed') noteFinish(scan, status);
}

function scanPayload(raw: string, protocol: PlaygroundProtocol, mode: PlaygroundResponseParseMode): ToolScan {
	const scan = emptyScan();
	forEachJsonObject(raw, mode, (obj, eventName) => {
		if (protocol === 'anthropic') {
			scanAnthropic(obj, eventName, scan, mode);
			return;
		}
		if (protocol === 'gemini') {
			scanGemini(obj, scan, mode);
			return;
		}
		scanResponsesFinish(obj, scan);
		scanOpenAiChatTools(obj, scan, mode);
		const output = obj.output;
		if (Array.isArray(output)) {
			for (const item of output) {
				if (!item || typeof item !== 'object') continue;
				if ((item as { type?: unknown }).type === 'function_call') scan.hasTool = true;
			}
		}
	});
	return scan;
}

function shapeTag(mode: PlaygroundResponseParseMode): ObservationTag | null {
	if (mode === 'sse') return { id: 'shape_sse', tone: 'neutral', messageKey: 'obsShapeSse' };
	if (mode === 'json') return { id: 'shape_json', tone: 'neutral', messageKey: 'obsShapeJson' };
	if (mode === 'ndjson') return { id: 'shape_ndjson', tone: 'neutral', messageKey: 'obsShapeNdjson' };
	return null;
}

function toolTag(
	mode: PlaygroundResponseParseMode,
	hasTool: boolean,
	declaredTools: boolean,
	verdict: 'incremental' | 'bulk' | 'no_tool',
): ObservationTag | null {
	if (hasTool) {
		if (mode !== 'sse') return { id: 'tool', tone: 'neutral', messageKey: 'obsTool' };
		if (verdict === 'incremental') {
			return { id: 'tool_incremental', tone: 'positive', messageKey: 'obsToolIncremental' };
		}
		return { id: 'tool_bulk', tone: 'warning', messageKey: 'obsToolBulk' };
	}
	if (declaredTools) return { id: 'no_tool', tone: 'muted', messageKey: 'obsNoTool' };
	return null;
}

export function observePlaygroundResponse(input: {
	raw: string;
	protocol: PlaygroundProtocol;
	contentType: string | null | undefined;
	requestBodyText: string;
}): ObservationTag[] {
	const { raw, protocol, contentType, requestBodyText } = input;
	if (protocol === 'dashscope' || !raw.trim()) return [];
	const mode = inferPlaygroundParseMode(contentType);
	if (!mode || mode === 'text') return [];

	const parts = mergeAssistantTextParts(raw, protocol, mode);
	const declaredTools = requestDeclaresTools(requestBodyText);
	const scan = scanPayload(raw, protocol, mode);
	const responsesSummary = protocol === 'openai' ? summarizeResponsesSseEvents(raw) : null;

	const textDeltaCount = responsesSummary?.outputTextDeltaCount ?? scan.textDeltaCount;
	const hasTool =
		scan.hasTool ||
		(responsesSummary != null && responsesSummary.verdict !== 'no_tool');
	const streamVerdict =
		responsesSummary != null
			? responsesSummary.verdict
			: resolveToolArgStreamVerdict({
					hasTool,
					deltaCount: scan.deltaCount,
					deltaChars: scan.deltaChars,
					doneChars: scan.doneChars,
				});

	const tags: ObservationTag[] = [];
	const shape = shapeTag(mode);
	if (shape) tags.push(shape);

	if (parts.body.trim()) {
		tags.push(
			mode === 'sse' && textDeltaCount > 0
				? { id: 'body', tone: 'neutral', messageKey: 'obsBodyDeltas', count: textDeltaCount }
				: { id: 'body', tone: 'neutral', messageKey: 'obsBody' },
		);
	} else {
		tags.push({ id: 'empty_body', tone: 'muted', messageKey: 'obsEmptyBody' });
	}

	if (parts.reasoning.trim()) {
		tags.push({ id: 'reasoning', tone: 'neutral', messageKey: 'obsReasoning' });
	}

	const tool = toolTag(mode, hasTool, declaredTools, streamVerdict);
	if (tool) tags.push(tool);

	if (scan.finishReason) {
		tags.push({
			id: 'finish',
			tone: isTruncationReason(scan.finishReason) ? 'warning' : 'muted',
			messageKey: 'obsFinish',
			finishReason: scan.finishReason,
		});
	}

	return tags;
}
