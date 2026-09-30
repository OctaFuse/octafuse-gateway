import {
	inferPlaygroundParseMode,
	mergeAssistantTextParts,
	type PlaygroundProtocol,
} from './merge-assistant-text';

type Json = Record<string, unknown>;
const object = (value: unknown): Json =>
	value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const string = (value: unknown): string => (typeof value === 'string' ? value : '');
const pretty = (value: unknown): string =>
	typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '';

export type PreviewToolCall = { key: string; id: string; name: string; arguments: string };
export type ResponsePreview = {
	reasoning: string;
	body: string;
	tools: PreviewToolCall[];
	error: string;
	usage: Record<string, number>;
	finishReason: string;
	eventCount: number;
	streaming: boolean;
};

/** Only dispatch complete SSE frames. Raw data may include an unfinished frame while its preview waits. */
export function parsePreviewEvents(raw: string, ndjson = false, finished = false): Json[] {
	const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	const frames = normalized.split(ndjson ? '\n' : '\n\n');
	if (!finished) frames.pop();
	const events: Json[] = [];
	for (const frame of frames) {
		const data = ndjson
			? frame
			: frame
					.split('\n')
					.filter((line) => line.startsWith('data:'))
					.map((line) => line.slice(5).replace(/^ /, ''))
					.join('\n');
		if (!data.trim() || data.trim() === '[DONE]') continue;
		try {
			const event = object(JSON.parse(data));
			if (Object.keys(event).length) {
				const type = frame
					.split('\n')
					.find((line) => line.startsWith('event:'))
					?.slice(6)
					.trim();
				if (!event.type && type) event.type = type;
				events.push(event);
			}
		} catch {
			/* A partial or malformed frame stays visible in the raw stream. */
		}
	}
	return events;
}

/** Pure snapshot projection: shared text parsing plus live tool arguments, usage, and stream errors. */
export function previewPlaygroundResponse(
	raw: string,
	protocol: PlaygroundProtocol,
	contentType: string | null,
	finished = false
): ResponsePreview {
	const mode = inferPlaygroundParseMode(contentType) ?? 'text';
	const streaming = mode === 'sse' || mode === 'ndjson';
	let events: Json[];
	if (streaming) events = parsePreviewEvents(raw, mode === 'ndjson', finished);
	else {
		try {
			events = [object(JSON.parse(raw))];
		} catch {
			events = [];
		}
	}
	const canonical =
		mode === 'sse'
			? events
					.map((e) => {
						const block = object(e.content_block);
						if (protocol === 'anthropic' && e.type === 'content_block_start') {
							if (block.type === 'text')
								return `data: ${JSON.stringify({
									type: 'content_block_delta',
									delta: { type: 'text_delta', text: block.text },
								})}\n\n`;
							if (block.type === 'thinking')
								return `data: ${JSON.stringify({
									type: 'content_block_delta',
									delta: { type: 'thinking_delta', thinking: block.thinking },
								})}\n\n`;
						}
						return `data: ${JSON.stringify(e)}\n\n`;
					})
					.join('')
			: raw;
	const parts = mergeAssistantTextParts(canonical, protocol, mode);
	const result: ResponsePreview = {
		...parts,
		tools: [],
		error: '',
		usage: {},
		finishReason: '',
		eventCount: events.length,
		streaming,
	};
	const tools = new Map<string, PreviewToolCall>();
	const aliases = new Map<string, string>();
	const partialArgs = new Map<string, Map<string, unknown>>();
	function tool(key: string, data: Json = {}): PreviewToolCall {
		const value = tools.get(key) ?? { key, id: '', name: '', arguments: '' };
		if (data.id || data.call_id) value.id = string(data.call_id || data.id);
		if (data.name) value.name = string(data.name);
		tools.set(key, value);
		return value;
	}
	function usage(value: unknown) {
		for (const [key, val] of Object.entries(object(value)))
			if (typeof val === 'number') result.usage[key] = val;
	}
	function outputItems(value: unknown) {
		list(value).forEach((rawItem, index) => {
			const item = object(rawItem);
			if (item.type !== 'function_call') return;
			const key = aliases.get(string(item.id)) ?? `responses:${index}`;
			const call = tool(key, item);
			if (item.arguments !== undefined) call.arguments = pretty(item.arguments);
		});
	}
	for (const event of events) {
		if (event.error) result.error = pretty(event.error);
		usage(event.usage);
		usage(object(event.message).usage);
		usage(event.usageMetadata);
		const response = object(event.response);
		if (response.error) result.error = pretty(response.error);
		usage(response.usage);
		if (event.type === 'response.completed' || event.type === 'response.incomplete') {
			result.finishReason = string(object(response.incomplete_details).reason) || string(response.status);
			const final = mergeAssistantTextParts(JSON.stringify(response), 'openai', 'json');
			result.body ||= final.body;
			result.reasoning ||= final.reasoning;
		}
		outputItems(event.output);
		outputItems(response.output);
		if (event.type === 'response.output_item.added' || event.type === 'response.output_item.done') {
			const item = object(event.item);
			if (item.type === 'function_call') {
				const key = `responses:${event.output_index ?? item.id}`;
				if (item.id) aliases.set(string(item.id), key);
				const call = tool(key, item);
				if (item.arguments !== undefined && (event.type.endsWith('.done') || item.arguments))
					call.arguments = pretty(item.arguments);
			}
		}
		if (
			event.type === 'response.function_call_arguments.delta' ||
			event.type === 'response.function_call_arguments.done'
		) {
			const key = aliases.get(string(event.item_id)) ?? `responses:${event.output_index ?? event.item_id}`;
			const call = tool(key, event);
			if (event.type.endsWith('.delta')) call.arguments += string(event.delta);
			else if (event.arguments !== undefined) call.arguments = pretty(event.arguments);
		}
		list(event.choices).forEach((rawChoice, index) => {
			const choice = object(rawChoice);
			result.finishReason = string(choice.finish_reason) || result.finishReason;
			const delta = object(choice.delta ?? choice.message);
			const calls = list(delta.tool_calls);
			if (delta.function_call) calls.push({ index: 0, function: delta.function_call });
			calls.forEach((rawCall, callIndex) => {
				const item = object(rawCall),
					fn = object(item.function);
				const call = tool(`chat:${choice.index ?? index}:${item.index ?? callIndex}`, { id: item.id });
				if (streaming && choice.delta) {
					call.name += string(fn.name);
					call.arguments += string(fn.arguments);
				} else {
					call.name = string(fn.name);
					call.arguments = pretty(fn.arguments);
				}
			});
		});
		const block = object(event.content_block);
		if (event.type === 'content_block_start' && block.type === 'tool_use') {
			const call = tool(`anthropic:${event.index ?? 0}`, block);
			if (Object.keys(object(block.input)).length) call.arguments = pretty(block.input);
		}
		const delta = object(event.delta);
		if (delta.type === 'input_json_delta')
			tool(`anthropic:${event.index ?? 0}`).arguments += string(delta.partial_json);
		result.finishReason = string(delta.stop_reason ?? event.stop_reason) || result.finishReason;
		list(event.content).forEach((rawBlock, index) => {
			const b = object(rawBlock);
			if (b.type === 'tool_use') tool(`anthropic:${index}`, b).arguments = pretty(b.input);
		});
		list(event.candidates).forEach((rawCandidate, index) => {
			const candidate = object(rawCandidate);
			result.finishReason = string(candidate.finishReason) || result.finishReason;
			list(object(candidate.content).parts).forEach((rawPart, partIndex) => {
				const part = object(rawPart);
				if (!part.functionCall) return;
				const fn = object(part.functionCall),
					position = `gemini:${candidate.index ?? index}:${partIndex}`;
				const key = fn.id ? `gemini:id:${fn.id}` : aliases.get(position) ?? position;
				aliases.set(position, key);
				const call = tool(key, fn);
				if (fn.args !== undefined) call.arguments = pretty(fn.args);
				for (const rawArg of list(fn.partialArgs)) {
					const arg = object(rawArg),
						path = string(arg.jsonPath);
					if (!path) continue;
					const fields = partialArgs.get(key) ?? new Map<string, unknown>();
					if (typeof arg.stringValue === 'string')
						fields.set(path, string(fields.get(path)) + arg.stringValue);
					else
						for (const field of ['numberValue', 'boolValue', 'nullValue'])
							if (field in arg) fields.set(path, arg[field]);
					partialArgs.set(key, fields);
					// Preserve JSON paths (including nested/array paths) without inventing an argument schema.
					call.arguments = pretty(Object.fromEntries(fields));
				}
			});
		});
	}
	result.tools = [...tools.values()];
	return result;
}

/** Decode UTF-8 across transport chunks and publish raw text before the stream ends. */
export async function readPlaygroundTextStream(
	response: Response,
	onText: (text: string) => void
): Promise<string> {
	const reader = response.body?.getReader();
	if (!reader) return '';
	const decoder = new TextDecoder();
	let text = '';
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			text += decoder.decode(value, { stream: true });
			onText(text);
		}
		text += decoder.decode();
		onText(text);
		return text;
	} finally {
		reader.releaseLock();
	}
}
