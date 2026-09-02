/**
 * 协议侧对「这次上游交互的结果该怎么解读」的口径，以及请求体脱敏。
 * 五个原碎片 hook（hasUsage / incompleteErrorMessage / httpErrorFallback /
 * resolveLoggedRequestId / extraRecordUsage）收成 `describeOutcome`。
 */
import type { RouteResult } from '../model-router';
import type { UsageFromStream } from '../proxy';
import { resolveGeminiLoggedRequestId } from '../egress/upstream-request-id';

export type DescribeOutcomeInput<TBody = unknown> = {
	body: TBody;
	usage: UsageFromStream;
	timedOut: boolean;
	headerRequestId: string | null;
	httpStatus: number;
};

export type DescribedOutcome = {
	hasUsage: boolean;
	incompleteErrorMessage: string;
	httpErrorFallback: string;
	loggedRequestId: string | null;
	extraRecordUsage?: {
		gemini_wire_action?: string | null;
	};
};

export type ProxyEndpointAccounting<TBody> = {
	requestBodyForLog: (body: TBody) => string | null;
	upstreamWireBodyForLog: (route: RouteResult, body: TBody) => string | null;
	describeOutcome: (input: DescribeOutcomeInput<TBody>) => DescribedOutcome;
};

export function defaultHasUsage(usage: UsageFromStream): boolean {
	return usage.total_tokens > 0 || usage.input_tokens > 0 || usage.output_tokens > 0;
}

export function defaultIncompleteErrorMessage(timedOut: boolean): string {
	return timedOut
		? 'Stream usage timeout (no usage within limit)'
		: 'Stream ended before usage available';
}

export function defaultHttpErrorFallback(status: number): string {
	return `HTTP ${status}`;
}

/** Chat / Messages：token 计数（不含 reasoning-only）视为有 usage；request id 取响应头。 */
export function defaultDescribeOutcome<TBody>(
	input: DescribeOutcomeInput<TBody>
): DescribedOutcome {
	return {
		hasUsage: defaultHasUsage(input.usage),
		incompleteErrorMessage: defaultIncompleteErrorMessage(input.timedOut),
		httpErrorFallback: defaultHttpErrorFallback(input.httpStatus),
		loggedRequestId: input.headerRequestId,
	};
}

export const describeChatOutcome = defaultDescribeOutcome;
export const describeMessagesOutcome = defaultDescribeOutcome;

/** Responses：incomplete / HTTP 回退优先采用 `usage.stream_error`。 */
export function describeResponsesOutcome<TBody>(
	input: DescribeOutcomeInput<TBody>
): DescribedOutcome {
	const base = defaultDescribeOutcome(input);
	return {
		...base,
		incompleteErrorMessage: input.timedOut
			? defaultIncompleteErrorMessage(true)
			: input.usage.stream_error || defaultIncompleteErrorMessage(false),
		httpErrorFallback: input.usage.stream_error || defaultHttpErrorFallback(input.httpStatus),
	};
}

export type GeminiDescribeOutcomeBody = {
	action: string;
};

export function geminiHasUsage(usage: UsageFromStream): boolean {
	return defaultHasUsage(usage) || usage.reasoning_tokens > 0;
}

/** Gemini：reasoning-only 也算有 usage；request id 叠加 body；写入 `gemini_wire_action`。 */
export function describeGeminiOutcome(
	input: DescribeOutcomeInput<GeminiDescribeOutcomeBody>
): DescribedOutcome {
	return {
		hasUsage: geminiHasUsage(input.usage),
		incompleteErrorMessage: defaultIncompleteErrorMessage(input.timedOut),
		httpErrorFallback: defaultHttpErrorFallback(input.httpStatus),
		loggedRequestId: resolveGeminiLoggedRequestId({
			headerRequestId: input.headerRequestId,
			bodyRequestId: input.usage.upstreamBodyRequestId ?? null,
		}),
		extraRecordUsage: { gemini_wire_action: input.body.action },
	};
}
