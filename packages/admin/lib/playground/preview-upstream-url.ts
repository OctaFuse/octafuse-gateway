/**
 * Playground：按所选路由 + Provider endpoints 预览将要打到的上游完整 URL（与 invoke 拼接规则一致）。
 */
import {
	type GeminiContentAction,
	prepareGeminiUpstreamFetch,
} from '@octafuse/core/gemini-upstream-url';
import {
	parseProviderEndpoints,
	resolveUpstreamEndpoint,
	type ProviderEndpointsSource,
} from '@octafuse/core/provider-endpoints';
import {
	normalizeUpstreamProtocol,
	type UpstreamProtocol,
} from '@octafuse/core/upstream-protocol';

export type PlaygroundProviderBaseUrls = ProviderEndpointsSource & {
	id: string;
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
 * @returns 完整上游 URL；缺 Provider / endpoints / 非法协议时返回 null
 */
export function previewPlaygroundUpstreamUrl(input: {
	provider: PlaygroundProviderBaseUrls | null | undefined;
	upstreamProtocol: string;
	providerModelName: string;
	isImageModel: boolean;
	/** When image model: generations (default) or edits. */
	imageOperation?: 'generations' | 'edits';
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

	const providerEndpoints = parseProviderEndpoints(provider);

	try {
		switch (protocol) {
			case 'openai': {
				const capability = input.isImageModel
					? input.imageOperation === 'edits'
						? 'images.edits'
						: 'images.generations'
					: 'chat';
				return resolveUpstreamEndpoint(protocol, capability, providerEndpoints, {
					providerId: provider.id,
				});
			}
			case 'anthropic':
				return resolveUpstreamEndpoint(protocol, 'messages', providerEndpoints, {
					providerId: provider.id,
				});
			case 'gemini': {
				const action: GeminiContentAction =
					input.geminiAction === 'streamGenerateContent'
						? 'streamGenerateContent'
						: 'generateContent';
				const resolvedUrl = resolveUpstreamEndpoint(protocol, action, providerEndpoints, {
					model: input.providerModelName || 'model',
					action,
					providerId: provider.id,
				});
				const { url } = prepareGeminiUpstreamFetch({
					resolvedUrl,
					modelName: input.providerModelName || 'model',
					action,
					apiKey: 'preview',
					authBaseHint: providerEndpoints.gemini?.base,
				});
				return stripApiKeyFromUrl(url.toString());
			}
			default:
				return null;
		}
	} catch {
		return null;
	}
}
