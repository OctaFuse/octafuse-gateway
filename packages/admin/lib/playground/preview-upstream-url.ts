/**
 * Playground：按所选路由 + Provider endpoints 预览将要打到的上游完整 URL（与 invoke 拼接规则一致）。
 */
import {
	type GeminiContentAction,
	prepareGeminiUpstreamFetch,
} from "@octafuse/core/gemini-upstream-url";
import {
	DASHSCOPE_ENDPOINT_CAPABILITIES,
	parseProviderEndpoints,
	resolveUpstreamEndpoint,
	type ProviderEndpointCapability,
	type ProviderEndpointsSource,
} from "@octafuse/core/provider-endpoints";
import {
	normalizeUpstreamProtocol,
	type UpstreamProtocol,
} from "@octafuse/core/upstream-protocol";
import {
	modelKindFromFlags,
	resolveOpenaiUpstreamCapability,
} from "@/lib/invoke-kind";

export type PlaygroundProviderBaseUrls = ProviderEndpointsSource & {
	id: string;
};

function stripApiKeyFromUrl(urlString: string): string {
	try {
		const u = new URL(urlString);
		if (u.searchParams.has("key")) {
			u.searchParams.set("key", "(redacted)");
		}
		return u.toString();
	} catch {
		return urlString.replace(/([?&])key=[^&]*/gi, "$1key=(redacted)");
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
	imageOperation?: "generations" | "edits";
	/** Audio transcription (ASR) catalog model. */
	isAudioModel?: boolean;
	/** Route target operation; required to resolve DashScope's concrete audio endpoint. */
	upstreamOperation?: string | null;
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
			case "openai": {
				const kind = modelKindFromFlags(
					Boolean(input.isAudioModel),
					Boolean(input.isImageModel)
				);
				const capability = resolveOpenaiUpstreamCapability({
					kind,
					imageOperation: input.imageOperation,
					audioOperation:
						kind === "audio" && input.upstreamOperation === "audio.speech"
							? "speech"
							: kind === "audio"
								? "transcriptions"
								: undefined,
				});
				return resolveUpstreamEndpoint(
					protocol,
					capability,
					providerEndpoints,
					{
						providerId: provider.id,
					}
				);
			}
			case "anthropic":
				return resolveUpstreamEndpoint(
					protocol,
					"messages",
					providerEndpoints,
					{
						providerId: provider.id,
					}
				);
			case "gemini": {
				const action: GeminiContentAction =
					input.geminiAction === "streamGenerateContent"
						? "streamGenerateContent"
						: "generateContent";
				const resolvedUrl = resolveUpstreamEndpoint(
					protocol,
					'models.generate',
					providerEndpoints,
					{
						model: input.providerModelName || "model",
						action,
						providerId: provider.id,
					}
				);
				const { url } = prepareGeminiUpstreamFetch({
					resolvedUrl,
					modelName: input.providerModelName || "model",
					action,
					apiKey: "preview",
					authBaseHint: providerEndpoints.gemini?.base,
				});
				return stripApiKeyFromUrl(url.toString());
			}
			case "dashscope": {
				const rawOperation = input.upstreamOperation?.trim() ?? "";
				const operation = rawOperation.endsWith(".realtime.inference")
					? "audio.realtime.inference"
					: rawOperation.endsWith(".realtime.session")
						? "audio.realtime.session"
						: rawOperation;
				if (
					!(DASHSCOPE_ENDPOINT_CAPABILITIES as readonly string[]).includes(
						operation
					)
				) {
					return null;
				}
				return resolveUpstreamEndpoint(
					protocol,
					operation as ProviderEndpointCapability,
					providerEndpoints,
					{ providerId: provider.id }
				);
			}
			default:
				return null;
		}
	} catch {
		return null;
	}
}
