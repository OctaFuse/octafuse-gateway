/**
 * Playground：从上游原始报文（SSE / JSON / NDJSON / text）中提取 assistant 可读正文，
 * 并将推理类字段与正文分列，便于区分。
 */

export type PlaygroundProtocol = "openai" | "anthropic" | "gemini" | "dashscope";

export type PlaygroundResponseParseMode = "sse" | "json" | "ndjson" | "text";

/** 推理链 / thinking 与最终正文分列 */
export type MergedAssistantParts = {
	reasoning: string;
	body: string;
};

const emptyParts = (): MergedAssistantParts => ({ reasoning: "", body: "" });

/** 由响应 Content-Type 推断解析方式（与 Playground `send` 分支一致）。 */
export function inferPlaygroundParseMode(
	contentType: string | null | undefined
): PlaygroundResponseParseMode | null {
	if (contentType == null || contentType === "") {
		return null;
	}
	const lower = contentType.toLowerCase();
	if (lower.includes("text/event-stream")) {
		return "sse";
	}
	if (lower.includes("ndjson") || lower.includes("x-json-stream")) {
		return "ndjson";
	}
	if (
		lower.includes("application/json") &&
		!lower.includes("text/event-stream")
	) {
		return "json";
	}
	return "text";
}

function extractOpenAiMessageContent(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	let s = "";
	for (const part of content) {
		if (!part || typeof part !== "object") {
			continue;
		}
		const p = part as { type?: unknown; text?: unknown };
		if (p.type === "text" && typeof p.text === "string") {
			s += p.text;
		}
	}
	return s;
}

function appendOpenAiDeltaToParts(
	delta: Record<string, unknown>,
	parts: MergedAssistantParts
): void {
	const rc = delta.reasoning_content;
	if (typeof rc === "string" && rc.length > 0) {
		parts.reasoning += rc;
	}
	const th = delta.thinking;
	if (typeof th === "string" && th.length > 0) {
		parts.reasoning += th;
	}
	const r = delta.reasoning;
	if (typeof r === "string" && r.length > 0) {
		parts.reasoning += r;
	}
	const c = delta.content;
	if (typeof c === "string" && c.length > 0) {
		parts.body += c;
	}
}

function mergeOpenAiSseParts(raw: string): MergedAssistantParts {
	const parts = emptyParts();
	for (const line of raw.split(/\r?\n/)) {
		const t = line.trim();
		if (!t.startsWith("data:")) {
			continue;
		}
		const payload = t.slice(5).trim();
		if (payload === "[DONE]" || payload === "") {
			continue;
		}
		let o: unknown;
		try {
			o = JSON.parse(payload);
		} catch {
			continue;
		}
		if (!o || typeof o !== "object") {
			continue;
		}
		const obj = o as Record<string, unknown>;
		const eventType = typeof obj.type === "string" ? obj.type : "";
		const eventDelta = typeof obj.delta === "string" ? obj.delta : "";
		if (eventType === "response.output_text.delta" && eventDelta) {
			parts.body += eventDelta;
			continue;
		}
		if (
			(eventType === "response.reasoning_text.delta" ||
				eventType === "response.reasoning_summary_text.delta") &&
			eventDelta
		) {
			parts.reasoning += eventDelta;
			continue;
		}
		const choices = obj.choices;
		if (!Array.isArray(choices)) {
			continue;
		}
		for (const ch of choices) {
			if (!ch || typeof ch !== "object") {
				continue;
			}
			const delta = (ch as { delta?: unknown }).delta;
			if (!delta || typeof delta !== "object") {
				continue;
			}
			appendOpenAiDeltaToParts(delta as Record<string, unknown>, parts);
		}
	}
	return parts;
}

function mergeAnthropicSseParts(raw: string): MergedAssistantParts {
	const parts = emptyParts();
	let lastEvent = "";
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trimEnd();
		if (trimmed.startsWith("event:")) {
			lastEvent = trimmed.slice(6).trim();
			continue;
		}
		if (!trimmed.startsWith("data:")) {
			continue;
		}
		const dataStr = trimmed.slice(5).trim();
		if (dataStr === "" || dataStr === "[DONE]") {
			lastEvent = "";
			continue;
		}
		let o: unknown;
		try {
			o = JSON.parse(dataStr);
		} catch {
			lastEvent = "";
			continue;
		}
		if (!o || typeof o !== "object") {
			lastEvent = "";
			continue;
		}
		const obj = o as Record<string, unknown>;
		const isDelta =
			lastEvent === "content_block_delta" || obj.type === "content_block_delta";
		if (isDelta) {
			const delta = obj.delta as Record<string, unknown> | undefined;
			if (!delta) {
				lastEvent = "";
				continue;
			}
			if (
				delta.type === "thinking_delta" &&
				typeof delta.thinking === "string"
			) {
				parts.reasoning += delta.thinking;
			}
			if (delta.type === "text_delta" && typeof delta.text === "string") {
				parts.body += delta.text;
			}
		}
		lastEvent = "";
	}
	return parts;
}

/** Gemini：带 `thought: true` 的 part 归入推理，其余有 text 的归入正文 */
function appendGeminiPartsToParts(
	partsArr: unknown,
	parts: MergedAssistantParts
): void {
	if (!Array.isArray(partsArr)) {
		return;
	}
	for (const p of partsArr) {
		if (!p || typeof p !== "object") {
			continue;
		}
		const part = p as { text?: unknown; thought?: unknown };
		if (typeof part.text !== "string" || part.text.length === 0) {
			continue;
		}
		if (part.thought === true) {
			parts.reasoning += part.text;
		} else {
			parts.body += part.text;
		}
	}
}

function extractGeminiCandidatesParts(o: unknown): MergedAssistantParts {
	const parts = emptyParts();
	if (!o || typeof o !== "object") {
		return parts;
	}
	const cands = (o as { candidates?: unknown }).candidates;
	if (!Array.isArray(cands) || cands.length === 0) {
		return parts;
	}
	const first = cands[0];
	if (!first || typeof first !== "object") {
		return parts;
	}
	const content = (first as { content?: { parts?: unknown } }).content;
	appendGeminiPartsToParts(content?.parts, parts);
	return parts;
}

function mergeGeminiSseParts(raw: string): MergedAssistantParts {
	const acc = emptyParts();
	for (const line of raw.split(/\r?\n/)) {
		const t = line.trim();
		if (!t || t.startsWith(":")) {
			continue;
		}
		let jsonStr = t;
		if (t.startsWith("data:")) {
			jsonStr = t.slice(5).trim();
		}
		if (!jsonStr.startsWith("{") && !jsonStr.startsWith("[")) {
			continue;
		}
		let o: unknown;
		try {
			o = JSON.parse(jsonStr);
		} catch {
			continue;
		}
		const chunk = extractGeminiCandidatesParts(o);
		acc.reasoning += chunk.reasoning;
		acc.body += chunk.body;
	}
	return acc;
}

function appendResponsesContentText(content: unknown, parts: MergedAssistantParts): void {
	if (!Array.isArray(content)) {
		return;
	}
	for (const part of content) {
		if (!part || typeof part !== "object") {
			continue;
		}
		const item = part as { type?: unknown; text?: unknown };
		if (
			(item.type === "output_text" || item.type === "summary_text" || item.type === "text") &&
			typeof item.text === "string"
		) {
			if (item.type === "summary_text") {
				parts.reasoning += item.text;
			} else {
				parts.body += item.text;
			}
		}
	}
}

/** OpenAI Responses 非流式 JSON：`output[]` + 可选 `output_text`。 */
function extractOpenAiResponsesOutputParts(
	object: Record<string, unknown>
): MergedAssistantParts | null {
	const output = object.output;
	if (!Array.isArray(output)) {
		return null;
	}
	const parts = emptyParts();
	for (const raw of output) {
		if (!raw || typeof raw !== "object") {
			continue;
		}
		const item = raw as { type?: unknown; content?: unknown; summary?: unknown };
		if (item.type === "reasoning") {
			appendResponsesContentText(item.summary, parts);
			continue;
		}
		if (item.type === "message") {
			appendResponsesContentText(item.content, parts);
		}
	}
	if (!parts.body && typeof object.output_text === "string") {
		parts.body = object.output_text;
	}
	return parts;
}

function mergeFromJsonObjectParts(
	o: unknown,
	protocol: PlaygroundProtocol
): MergedAssistantParts {
	const parts = emptyParts();
	if (!o || typeof o !== "object") {
		return parts;
	}
	if (protocol === "openai" || protocol === "dashscope") {
		const object = o as Record<string, unknown>;
		const responsesParts = extractOpenAiResponsesOutputParts(object);
		if (responsesParts) {
			return responsesParts;
		}
		// OpenAI Audio Transcriptions 返回顶层 text；DashScope 直连调试返回 output.text。
		if (typeof object.text === "string") {
			parts.body = object.text;
			return parts;
		}
		const output = object.output;
		if (
			output &&
			typeof output === "object" &&
			!Array.isArray(output) &&
			typeof (output as Record<string, unknown>).text === "string"
		) {
			parts.body = (output as Record<string, unknown>).text as string;
			return parts;
		}
		const choices = object.choices;
		if (!Array.isArray(choices) || choices.length === 0) {
			return parts;
		}
		const msg = (choices[0] as { message?: Record<string, unknown> }).message;
		if (!msg || typeof msg !== "object") {
			return parts;
		}
		if (
			typeof msg.reasoning_content === "string" &&
			msg.reasoning_content.length > 0
		) {
			parts.reasoning += msg.reasoning_content;
		}
		if (typeof msg.thinking === "string" && msg.thinking.length > 0) {
			parts.reasoning += msg.thinking;
		}
		parts.body += extractOpenAiMessageContent(msg.content);
		return parts;
	}
	if (protocol === "anthropic") {
		const blocks = (o as { content?: unknown }).content;
		if (!Array.isArray(blocks)) {
			return parts;
		}
		for (const b of blocks) {
			if (!b || typeof b !== "object") {
				continue;
			}
			const block = b as { type?: unknown; text?: unknown; thinking?: unknown };
			if (block.type === "thinking" && typeof block.thinking === "string") {
				parts.reasoning += block.thinking;
			}
			if (block.type === "text" && typeof block.text === "string") {
				parts.body += block.text;
			}
		}
		return parts;
	}
	return extractGeminiCandidatesParts(o);
}

/**
 * DashScope 实时 ASR 返回的是逐行 JSON，且同一 sentence_id 会反复发送累计文本。
 * 按句子覆盖而不是直接拼接，才能避免把中间结果重复显示在正文中。
 */
function mergeDashScopeNdjsonParts(raw: string): MergedAssistantParts {
	const sentences = new Map<string, string>();
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let value: unknown;
		try {
			value = JSON.parse(trimmed) as unknown;
		} catch {
			continue;
		}
		if (!value || typeof value !== "object" || Array.isArray(value)) continue;
		const event = (value as { header?: { event?: unknown } }).header?.event;
		if (event !== "result-generated") continue;
		const output = (value as { payload?: { output?: unknown } }).payload?.output;
		if (!output || typeof output !== "object" || Array.isArray(output)) continue;
		const sentence = (output as { sentence?: unknown }).sentence;
		if (!sentence || typeof sentence !== "object" || Array.isArray(sentence)) continue;
		const sentenceId = (sentence as { sentence_id?: unknown }).sentence_id;
		if (typeof sentenceId !== "string" && typeof sentenceId !== "number") continue;
		const outputText = (output as { text?: unknown }).text;
		const sentenceText = (sentence as { text?: unknown }).text;
		const text =
			typeof outputText === "string"
				? outputText
				: typeof sentenceText === "string"
					? sentenceText
					: "";
		sentences.set(String(sentenceId), text);
	}
	return { reasoning: "", body: Array.from(sentences.values()).filter(Boolean).join("") };
}

/**
 * 从原始报文拼接 / 抽取：推理类与正文分列。
 */
export function mergeAssistantTextParts(
	raw: string,
	protocol: PlaygroundProtocol,
	mode: PlaygroundResponseParseMode
): MergedAssistantParts {
	if (!raw.trim()) {
		return emptyParts();
	}
	if (mode === "sse") {
		if (protocol === "openai") {
			return mergeOpenAiSseParts(raw);
		}
		if (protocol === "anthropic") {
			return mergeAnthropicSseParts(raw);
		}
		return mergeGeminiSseParts(raw);
	}
	if (mode === "json") {
		try {
			const o = JSON.parse(raw) as unknown;
			return mergeFromJsonObjectParts(o, protocol);
		} catch {
			return emptyParts();
		}
	}
	if (mode === "ndjson") {
		return protocol === "dashscope"
			? mergeDashScopeNdjsonParts(raw)
			: { reasoning: "", body: "" };
	}
	try {
		const o = JSON.parse(raw) as unknown;
		if (o && typeof o === "object") {
			return mergeFromJsonObjectParts(o, protocol);
		}
	} catch {
		// ignore
	}
	return emptyParts();
}

/**
 * 从原始报文拼接为单字符串（推理在前、正文在后，无分隔符；仅兼容旧用法）。
 */
export function mergeAssistantText(
	raw: string,
	protocol: PlaygroundProtocol,
	mode: PlaygroundResponseParseMode
): string {
	const p = mergeAssistantTextParts(raw, protocol, mode);
	return p.reasoning + p.body;
}
