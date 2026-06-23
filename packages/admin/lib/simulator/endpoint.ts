/**
 * Build Proxy-facing requests from the browser: URL, headers, and JSON body per protocol
 * (including OpenAI/Anthropic `model` field).
 */
import { applyGeminiStreamQueryParams } from '@octafuse/core/gemini-upstream-url';

export type SimulatorProtocol = 'openai' | 'anthropic' | 'gemini';

export type SimulatorGeminiAction = 'generateContent' | 'streamGenerateContent';

export type BuildSimulatorRequestInput = {
	/** Trimmed Proxy root URL without a trailing slash, e.g. https://gateway.example.com */
	baseUrl: string;
	protocol: SimulatorProtocol;
	/**
	 * OpenAI/Anthropic `body.model`, or the Gemini path model segment (may include `id:route_group`).
	 * Matches Proxy `resolveModelRouting`: full id, or `baseId:group`.
	 */
	modelForRouting: string;
	geminiAction?: SimulatorGeminiAction;
	/** User-edited JSON object (`model` is overwritten for OpenAI/Anthropic before send) */
	body: Record<string, unknown>;
	/** Full `sk-…` or already prefixed with Bearer */
	apiKey: string;
};

export type BuildSimulatorRequestResult = {
	url: string;
	headers: Record<string, string>;
	/** JSON.stringify result */
	bodyText: string;
};

function stripTrailingSlash(u: string): string {
	return u.replace(/\/$/, '');
}

function bearerHeader(apiKey: string): string {
	const t = apiKey.trim();
	if (t.toLowerCase().startsWith('bearer ')) return t;
	return `Bearer ${t}`;
}

/**
 * Build `fetch` arguments for the Proxy (no `signal`).
 */
export function buildSimulatorRequest(input: BuildSimulatorRequestInput): BuildSimulatorRequestResult {
	const base = stripTrailingSlash(input.baseUrl.trim());
	const auth = bearerHeader(input.apiKey);

	switch (input.protocol) {
		case 'openai': {
			const merged = { ...input.body, model: input.modelForRouting };
			return {
				url: `${base}/v1/chat/completions`,
				headers: {
					'Content-Type': 'application/json',
					Authorization: auth,
				},
				bodyText: JSON.stringify(merged),
			};
		}
		case 'anthropic': {
			const merged = { ...input.body, model: input.modelForRouting };
			return {
				url: `${base}/v1/messages`,
				headers: {
					'Content-Type': 'application/json',
					Authorization: auth,
				},
				bodyText: JSON.stringify(merged),
			};
		}
		case 'gemini': {
			const action: SimulatorGeminiAction =
				input.geminiAction === 'generateContent' ? 'generateContent' : 'streamGenerateContent';
			const pathModel = encodeURIComponent(input.modelForRouting);
			const url = new URL(`${base}/v1beta/models/${pathModel}:${action}`);
			applyGeminiStreamQueryParams(url, action);
			return {
				url: url.toString(),
				headers: {
					'Content-Type': 'application/json',
					Authorization: auth,
				},
				bodyText: JSON.stringify(input.body),
			};
		}
		default: {
			const _exhaustive: never = input.protocol;
			throw new Error(`Unsupported protocol: ${String(_exhaustive)}`);
		}
	}
}
