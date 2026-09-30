import {
	loadPlaygroundSampleBody,
	PLAYGROUND_LLM_SAMPLE_IDS,
	type PlaygroundLlmFamily,
	type PlaygroundLlmSampleId,
} from './samples';
import { setQuickTestStreaming } from './quick-test-samples';

export function parseLlmRequest(text: string): Record<string, unknown> | null {
	try {
		const value: unknown = JSON.parse(text);
		return value && typeof value === 'object' && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

export function llmRequestSample(
	family: PlaygroundLlmFamily,
	id: PlaygroundLlmSampleId,
	modelHint: string,
	stream: boolean,
	modelValue?: string,
): string {
	const body = JSON.parse(
		setQuickTestStreaming(loadPlaygroundSampleBody(family, id, modelHint.toLowerCase()), family, stream),
	);
	if (modelValue && family !== 'gemini') body.model = modelValue;
	return JSON.stringify(body, null, 2);
}

export function matchLlmRequestSample(
	text: string,
	family: PlaygroundLlmFamily,
	modelHint: string,
	stream: boolean,
	modelValue?: string,
): PlaygroundLlmSampleId | 'custom' {
	const body = parseLlmRequest(text);
	if (!body) return 'custom';
	// Compare content, independent of formatting or the position of the simulator's model field.
	const canonical = (value: unknown): string =>
		JSON.stringify(value, function (_key, nested) {
			return nested && typeof nested === 'object' && !Array.isArray(nested)
				? Object.fromEntries(Object.entries(nested).sort(([a], [b]) => a.localeCompare(b)))
				: nested;
		});
	return (
		PLAYGROUND_LLM_SAMPLE_IDS.find(
			(id) =>
				canonical(JSON.parse(llmRequestSample(family, id, modelHint, stream, modelValue))) ===
				canonical(body),
		) ?? 'custom'
	);
}
