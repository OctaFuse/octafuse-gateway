/**
 * 从累计 SSE Raw 统计 OpenAI Responses typed events，判断工具参数是增量还是整包。
 * 仅观察，不改写报文。
 */

export type ToolStreamVerdict = 'incremental' | 'bulk' | 'no_tool';

export type ResponsesSseEventSummary = {
	outputTextDeltaCount: number;
	functionCallArgumentDeltaCount: number;
	functionCallArgumentDeltaChars: number[];
	functionCallArgumentsDone: boolean;
	functionCallArgumentsDoneChars: number;
	verdict: ToolStreamVerdict;
};

const emptySummary = (): ResponsesSseEventSummary => ({
	outputTextDeltaCount: 0,
	functionCallArgumentDeltaCount: 0,
	functionCallArgumentDeltaChars: [],
	functionCallArgumentsDone: false,
	functionCallArgumentsDoneChars: 0,
	verdict: 'no_tool',
});

function isFunctionCallItem(item: unknown): item is { type: string; arguments?: unknown } {
	return Boolean(item && typeof item === 'object' && (item as { type?: unknown }).type === 'function_call');
}

function stringLength(value: unknown): number {
	return typeof value === 'string' ? value.length : 0;
}

export function resolveToolArgStreamVerdict(input: {
	hasTool: boolean;
	deltaCount: number;
	deltaChars: number[];
	doneChars: number;
}): ToolStreamVerdict {
	if (!input.hasTool) return 'no_tool';
	if (input.deltaCount <= 1) return 'bulk';

	const finalLen = input.doneChars || input.deltaChars.reduce((sum, n) => sum + n, 0);
	if (finalLen <= 0) return 'incremental';

	const shortCount = input.deltaChars.filter((n) => n < finalLen * 0.9).length;
	return shortCount >= Math.ceil(input.deltaCount / 2) ? 'incremental' : 'bulk';
}

function resolveVerdict(summary: ResponsesSseEventSummary, sawFunctionCallItem: boolean): ToolStreamVerdict {
	return resolveToolArgStreamVerdict({
		hasTool:
			sawFunctionCallItem ||
			summary.functionCallArgumentDeltaCount > 0 ||
			summary.functionCallArgumentsDone,
		deltaCount: summary.functionCallArgumentDeltaCount,
		deltaChars: summary.functionCallArgumentDeltaChars,
		doneChars: summary.functionCallArgumentsDoneChars,
	});
}

/**
 * 解析 Responses SSE。没有任何 `response.*` 事件时返回 null（Chat 等协议不展示摘要）。
 */
export function summarizeResponsesSseEvents(raw: string): ResponsesSseEventSummary | null {
	if (!raw.trim()) return null;

	const summary = emptySummary();
	let sawResponseEvent = false;
	let sawFunctionCallItem = false;

	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed.startsWith('data:')) continue;
		const payload = trimmed.slice(5).trim();
		if (!payload || payload === '[DONE]') continue;

		let obj: Record<string, unknown>;
		try {
			const parsed = JSON.parse(payload) as unknown;
			if (!parsed || typeof parsed !== 'object') continue;
			obj = parsed as Record<string, unknown>;
		} catch {
			continue;
		}

		const eventType = typeof obj.type === 'string' ? obj.type : '';
		if (!eventType.startsWith('response.')) continue;
		sawResponseEvent = true;

		if (eventType === 'response.output_text.delta') {
			summary.outputTextDeltaCount += 1;
			continue;
		}

		if (eventType === 'response.function_call_arguments.delta') {
			const len = stringLength(obj.delta);
			summary.functionCallArgumentDeltaCount += 1;
			summary.functionCallArgumentDeltaChars.push(len);
			continue;
		}

		if (eventType === 'response.function_call_arguments.done') {
			summary.functionCallArgumentsDone = true;
			summary.functionCallArgumentsDoneChars = Math.max(
				summary.functionCallArgumentsDoneChars,
				stringLength(obj.arguments),
			);
			continue;
		}

		if (eventType === 'response.output_item.added' || eventType === 'response.output_item.done') {
			if (!isFunctionCallItem(obj.item)) continue;
			sawFunctionCallItem = true;
			if (eventType === 'response.output_item.done') {
				summary.functionCallArgumentsDoneChars = Math.max(
					summary.functionCallArgumentsDoneChars,
					stringLength(obj.item.arguments),
				);
			}
		}
	}

	if (!sawResponseEvent) return null;
	summary.verdict = resolveVerdict(summary, sawFunctionCallItem);
	return summary;
}
