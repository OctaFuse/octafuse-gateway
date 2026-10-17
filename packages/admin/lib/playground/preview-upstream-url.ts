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
	getAdapterById,
	isConversionRouteAdapter,
} from "@octafuse/core/adapters/registry";
import {
	normalizeUpstreamProtocol,
	type UpstreamProtocol,
} from "@octafuse/core/upstream-protocol";
import type { ModelKind } from "@octafuse/core/db/model-kind";
import { resolveOpenaiUpstreamCapability } from "@/lib/invoke-kind";

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

export type PlaygroundUpstreamUrlPreview = {
	url: string | null;
	/** `协议/能力`。供应商没配这个端点时 url 为空，调用方用它说明缺的是目标协议而不是客户端协议。 */
	target: string | null;
};

/**
 * 完整上游 URL。转换适配器一律解析其声明的目标协议，不读客户端协议上的端点。
 * 缺 Provider、协议非法或供应商没配目标端点时 url 为 null。
 */
export function describePlaygroundUpstreamUrl(input: {
	provider: PlaygroundProviderBaseUrls | null | undefined;
	upstreamProtocol: string;
	/** 转换适配器（如 volcengine-image）决定目标协议；透传沿用 upstreamProtocol。 */
	adapter?: string | null;
	providerModelName: string;
	/** 目录模型类型（`resolveModelKind`）；缺省按 llm。 */
	modelKind?: ModelKind;
	/** When image model: generations (default) or edits. */
	imageOperation?: "generations" | "edits";
	/** Route target operation; required to resolve DashScope's concrete audio endpoint. */
	upstreamOperation?: string | null;
	geminiAction?: GeminiContentAction;
}): PlaygroundUpstreamUrlPreview {
	const provider = input.provider;
	if (!provider) return { url: null, target: null };

	let protocol: UpstreamProtocol;
	let upstreamOperation = input.upstreamOperation;
	try {
		protocol = normalizeUpstreamProtocol(input.upstreamProtocol);
	} catch {
		return { url: null, target: null };
	}
	const adapter = input.adapter?.trim() ?? "";
	if (adapter && isConversionRouteAdapter(adapter)) {
		const descriptor = getAdapterById(adapter);
		if (descriptor) {
			protocol = descriptor.upstream.protocol;
			const requested = input.upstreamOperation?.trim() ?? "";
			upstreamOperation = descriptor.upstream.operations.includes(requested)
				? requested
				: descriptor.upstream.operations[0] ?? "";
		}
	}

	const providerEndpoints = parseProviderEndpoints(provider);
	let target: string | null = null;

	try {
		switch (protocol) {
			case "openai": {
				const capability = resolveOpenaiUpstreamCapability({
					kind: input.modelKind ?? "llm",
					imageOperation: input.imageOperation,
					llmOperation: upstreamOperation === "responses" ? "responses" : "chat",
				});
				target = `${protocol}/${capability}`;
				return {
					url: resolveUpstreamEndpoint(protocol, capability, providerEndpoints, {
						providerId: provider.id,
					}),
					target,
				};
			}
			case "anthropic":
				target = `${protocol}/messages`;
				return {
					url: resolveUpstreamEndpoint(protocol, "messages", providerEndpoints, {
						providerId: provider.id,
					}),
					target,
				};
			case "gemini": {
				if (input.modelKind === "embedding") {
					target = `${protocol}/models.embed`;
					const embedAction = "embedContent";
					const resolvedEmbedUrl = resolveUpstreamEndpoint(
						protocol,
						"models.embed",
						providerEndpoints,
						{
							model: input.providerModelName || "model",
							action: embedAction,
							providerId: provider.id,
						}
					);
					const prepared = prepareGeminiUpstreamFetch({
						resolvedUrl: resolvedEmbedUrl,
						modelName: input.providerModelName || "model",
						action: embedAction,
						apiKey: "preview",
						auth: providerEndpoints.gemini?.auth,
					});
					return { url: stripApiKeyFromUrl(prepared.url.toString()), target };
				}
				const action: GeminiContentAction = input.modelKind === "image"
					? "generateContent"
					: input.geminiAction === "streamGenerateContent"
						? "streamGenerateContent"
						: "generateContent";
				target = `${protocol}/models.generate`;
				const resolvedUrl = resolveUpstreamEndpoint(
					protocol,
					"models.generate",
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
					auth: providerEndpoints.gemini?.auth,
				});
				return { url: stripApiKeyFromUrl(url.toString()), target };
			}
			case "volcengine": {
				target = `${protocol}/images.generations`;
				const operation = upstreamOperation?.trim() ?? "";
				if (operation && operation !== "images.generations" && operation !== "*") {
					return { url: null, target };
				}
				return {
					url: resolveUpstreamEndpoint(protocol, "images.generations", providerEndpoints, {
						providerId: provider.id,
					}),
					target,
				};
			}
			case "minimax": {
				const operation = upstreamOperation?.trim() || "audio.transcriptions";
				const capability =
					operation === "audio.speech"
						? "audio.speech"
						: operation === "images.generations"
							? "images.generations"
							: operation === "audio.transcriptions" || operation === "*"
								? "audio.transcriptions"
								: null;
				target = capability ? `${protocol}/${capability}` : null;
				if (!capability) return { url: null, target };
				return {
					url: resolveUpstreamEndpoint(protocol, capability, providerEndpoints, {
						providerId: provider.id,
					}),
					target,
				};
			}
			case "elevenlabs": {
				const operation = upstreamOperation?.trim() || "audio.transcriptions";
				const capability =
					operation === "audio.speech"
						? "audio.speech"
						: operation === "audio.transcriptions" || operation === "*"
							? "audio.transcriptions"
							: null;
				target = capability ? `${protocol}/${capability}` : null;
				if (!capability) return { url: null, target };
				return {
					// 音色是路径参数，预览里保留占位符。
					url: resolveUpstreamEndpoint(protocol, capability, providerEndpoints, {
						providerId: provider.id,
						voiceId: "{voice_id}",
					}).replace(/%7Bvoice_id%7D/gi, "{voice_id}"),
					target,
				};
			}
			case "dashscope": {
				const rawOperation = upstreamOperation?.trim() ?? "";
				const operation = rawOperation.endsWith(".realtime.inference")
					? "audio.realtime.inference"
					: rawOperation.endsWith(".realtime.session")
						? "audio.realtime.session"
						: rawOperation;
				target = operation ? `${protocol}/${operation}` : null;
				if (
					!(DASHSCOPE_ENDPOINT_CAPABILITIES as readonly string[]).includes(
						operation
					)
				) {
					return { url: null, target };
				}
				return {
					url: resolveUpstreamEndpoint(
						protocol,
						operation as ProviderEndpointCapability,
						providerEndpoints,
						{ providerId: provider.id }
					),
					target,
				};
			}
			default:
				return { url: null, target };
		}
	} catch {
		return { url: null, target };
	}
}

export function previewPlaygroundUpstreamUrl(
	input: Parameters<typeof describePlaygroundUpstreamUrl>[0]
): string | null {
	return describePlaygroundUpstreamUrl(input).url;
}
