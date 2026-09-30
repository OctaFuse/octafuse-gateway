import { loadPlaygroundSampleBody, type PlaygroundLlmFamily, type PlaygroundLlmSampleId } from './samples';

type RouteHint = {
	model_id: string;
	provider_model_name: string;
	upstream_protocol: string;
	upstream_operation: string;
};

export function quickTestLlmFamily(route: RouteHint, mediaModel = false): PlaygroundLlmFamily | null {
	if (mediaModel) return null;
	const { upstream_protocol: protocol, upstream_operation: operation } = route;
	if (protocol === 'openai' && operation === 'chat') return 'openai_chat';
	if (protocol === 'openai' && operation === 'responses') return 'openai_responses';
	if (protocol === 'anthropic' && operation === 'messages') return 'anthropic';
	if (
		protocol === 'gemini' &&
		['models.generate', 'generateContent', 'streamGenerateContent'].includes(operation)
	)
		return 'gemini';
	return null;
}

export function setQuickTestStreaming(
	bodyText: string,
	family: PlaygroundLlmFamily,
	stream: boolean
): string {
	const body = JSON.parse(bodyText) as Record<string, unknown>;
	if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected a JSON object');
	// Gemini selects streaming through the URL action, never a body.stream field.
	if (family === 'gemini') return bodyText;
	body.stream = stream;
	if (family === 'openai_chat') {
		if (stream) body.stream_options ??= { include_usage: true };
		else delete body.stream_options;
	}
	return JSON.stringify(body, null, 2);
}

export function quickTestSample(
	route: RouteHint,
	family: PlaygroundLlmFamily,
	sampleId: PlaygroundLlmSampleId,
	stream: boolean
): string {
	const text = loadPlaygroundSampleBody(
		family,
		sampleId,
		`${route.model_id} ${route.provider_model_name}`.toLowerCase()
	);
	return setQuickTestStreaming(text, family, stream);
}
