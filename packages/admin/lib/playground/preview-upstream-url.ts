/**
 * Playground：按所选路由 + Provider base_url 预览将要打到的上游完整 URL（与 invoke 拼接规则一致）。
 */
import {
	type GeminiContentAction,
	prepareGeminiUpstreamFetch,
} from '@octafuse/core/gemini-upstream-url';
import {
	buildOpenAiCompatibleImagesUrl,
	normalizeUpstreamProtocol,
	resolveEffectiveBaseUrl,
	type UpstreamProtocol,
} from '@octafuse/core/upstream-protocol';

export type PlaygroundProviderBaseUrls = {
	id: string;
	base_url_openai: string | null;
	base_url_anthropic?: string | null;
	base_url_gemini?: string | null;
};

function stripApiKeyFromUrl(urlString: string): string {
	try {
		const u = new URL(urlString);
		if (u.searchParams.has('key')) {
			u.searchParams.set('key', '(redacted)');
		}
		return u.toString();
	} catch {
		return urlString.replace(/([?&])key=[^&]*/gi, '$1key=(redacted)');
	}
}

/**
 * @returns 完整上游 URL；缺 Provider / base_url / 非法协议时返回 null
 */
export function previewPlaygroundUpstreamUrl(input: {
	provider: PlaygroundProviderBaseUrls | null | undefined;
	upstreamProtocol: string;
	providerModelName: string;
	isImageModel: boolean;
	geminiAction?: GeminiContentAction;
}): string | null {
	const provider = input.provider;
	if (!provider) return null;

	let protocol: UpstreamProtocol;
	try {
		protocol = normalizeUpstreamProtocol(input.upstreamProtocol);
	} catch {
		return null;
	}

	let baseUrl: string;
	try {
		baseUrl = resolveEffectiveBaseUrl(protocol, provider, provider.id);
	} catch {
		return null;
	}

	switch (protocol) {
		case 'openai':
			return input.isImageModel
				? buildOpenAiCompatibleImagesUrl(baseUrl, 'generations')
				: `${baseUrl.replace(/\/$/, '')}/chat/completions`;
		case 'anthropic':
			return `${baseUrl.replace(/\/$/, '')}/v1/messages`;
		case 'gemini': {
			const action: GeminiContentAction =
				input.geminiAction === 'streamGenerateContent'
					? 'streamGenerateContent'
					: 'generateContent';
			const { url } = prepareGeminiUpstreamFetch({
				baseUrl,
				modelName: input.providerModelName || 'model',
				action,
				apiKey: 'preview',
			});
			return stripApiKeyFromUrl(url.toString());
		}
		default:
			return null;
	}
}
