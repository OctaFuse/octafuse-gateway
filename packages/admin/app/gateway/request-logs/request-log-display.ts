/**
 * Request Logs 列表展示辅助：Gemini wire action、是否流式。
 */

export type GeminiWireAction = 'generateContent' | 'streamGenerateContent';

export function parseGeminiWireAction(routeTrace: string | null | undefined): GeminiWireAction | undefined {
	if (!routeTrace?.trim()) return undefined;
	try {
		const parsed = JSON.parse(routeTrace) as { gemini?: { action?: unknown } };
		const action = typeof parsed.gemini?.action === 'string' ? parsed.gemini.action.trim() : '';
		if (action === 'generateContent' || action === 'streamGenerateContent') return action;
	} catch {
		return undefined;
	}
	return undefined;
}

function readJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
	if (!raw?.trim()) return null;
	try {
		const parsed = JSON.parse(raw) as unknown;
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function streamFlagFromBody(raw: string | null | undefined): boolean | null {
	const body = readJsonObject(raw);
	if (!body) return null;
	if (body._gemini_action === 'streamGenerateContent') return true;
	if (body._gemini_action === 'generateContent') return false;
	if (body.stream === true) return true;
	if (body.stream === false) return false;
	return null;
}

/** 客户端是否请求流式：Gemini wire action、脱敏 body.stream、DashScope realtime。 */
export function isRequestLogStreaming(log: {
	request_operation?: string | null;
	upstream_operation?: string | null;
	route_trace?: string | null;
	request_body?: string | null;
	upstream_request_body?: string | null;
}): boolean {
	const geminiAction = parseGeminiWireAction(log.route_trace);
	if (geminiAction === 'streamGenerateContent') return true;
	if (geminiAction === 'generateContent') return false;

	const operation = `${log.request_operation ?? ''} ${log.upstream_operation ?? ''}`;
	if (operation.includes('.realtime.')) return true;

	return streamFlagFromBody(log.request_body) ?? streamFlagFromBody(log.upstream_request_body) ?? false;
}
