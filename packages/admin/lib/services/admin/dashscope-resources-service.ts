/** DashScope 账号级音频资源管理：热词和音色使用供应商密钥，仅允许从管理员 API 调用。 */
import type { GatewayRepositories } from "@octafuse/core";
import {
	parseProviderEndpoints,
	resolveUpstreamEndpoint,
	type ProviderEndpointCapability,
} from "@octafuse/core/provider-endpoints";
import { isPendingProviderImportApiKey } from "@octafuse/core/db/provider-key-utils";
import { badRequest, notFound } from "./errors";

export type DashScopeAudioResource = "hotwords" | "voices";

function isJsonObject(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === "object" && !Array.isArray(value);
}

/** MiniMax 的音色创建、查询与删除和 TTS 共用 multimodal-generation，而非 customization。 */
function resourceCapability(
	resource: DashScopeAudioResource,
	body: Record<string, unknown>
): ProviderEndpointCapability {
	if (resource === "hotwords") return "audio.hotwords";
	const model = typeof body.model === "string" ? body.model.trim() : "";
	return model.toLowerCase().startsWith("minimax/")
		? "audio.speech.multimodal"
		: "audio.voices";
}

/**
 * 将官方原生请求体发往选定供应商的资源端点。
 * 不改写 action/字段，确保官方新增的资源操作能直接暴露错误而非被网关吞掉。
 */
export async function proxyDashScopeAudioResourceService(
	repos: GatewayRepositories,
	providerId: string,
	resource: DashScopeAudioResource,
	body: unknown,
	fetchImpl: typeof fetch = fetch
): Promise<Response> {
	if (!isJsonObject(body))
		throw badRequest("Request body must be a JSON object");
	const provider = await repos.providers.getProviderById(providerId);
	if (!provider) throw notFound("Provider not found");
	const apiKey = provider.api_key?.trim() ?? "";
	if (!apiKey || isPendingProviderImportApiKey(apiKey)) {
		throw badRequest("Provider API key is not configured");
	}

	const endpoints = parseProviderEndpoints(provider);
	if (!endpoints.dashscope) {
		throw badRequest("Provider does not configure DashScope endpoints");
	}
	const endpoint = resolveUpstreamEndpoint(
		"dashscope",
		resourceCapability(resource, body),
		endpoints,
		{ providerId }
	);

	return fetchImpl(endpoint, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});
}
