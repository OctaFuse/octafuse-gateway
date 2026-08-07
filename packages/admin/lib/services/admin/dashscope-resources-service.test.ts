import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GatewayRepositories, ProviderRow } from "@octafuse/core";
import { proxyDashScopeAudioResourceService } from "./dashscope-resources-service";

function repositories(provider: ProviderRow | null): GatewayRepositories {
	return {
		providers: {
			getProviderById: async () => provider,
		},
	} as unknown as GatewayRepositories;
}

function configuredProvider(): ProviderRow {
	return {
		id: "aliyun",
		name: "DashScope",
		api_key: "sk-dashscope",
		endpoints: JSON.stringify({
			dashscope: { base: "https://dashscope.aliyuncs.com/api/v1" },
		}),
		description: null,
		created_at: "2026-01-01 00:00:00",
	};
}

describe("DashScope audio resource management", () => {
	it("forwards native hotword actions to the ASR customization endpoint", async () => {
		const requests: Request[] = [];
		const fetchImpl: typeof fetch = async (input, init) => {
			requests.push(new Request(input, init));
			return Response.json({ output: { vocabulary_id: "vocab-1" } });
		};
		const body = {
			model: "speech-biasing",
			input: {
				action: "create_vocabulary",
				target_model: "fun-asr",
				prefix: "test",
			},
		};

		await proxyDashScopeAudioResourceService(
			repositories(configuredProvider()),
			"aliyun",
			"hotwords",
			body,
			fetchImpl
		);
		const request = requests[0];
		assert.ok(request);
		assert.equal(
			request.url,
			"https://dashscope.aliyuncs.com/api/v1/services/audio/asr/customization"
		);
		assert.equal(request.headers.get("authorization"), "Bearer sk-dashscope");
		assert.deepEqual(await request.json(), body);
	});

	it("uses customization for Qwen/CosyVoice and multimodal-generation for MiniMax voices", async () => {
		const urls: string[] = [];
		const fetchImpl: typeof fetch = async (input) => {
			urls.push(String(input));
			return Response.json({ output: {} });
		};
		const repos = repositories(configuredProvider());

		await proxyDashScopeAudioResourceService(
			repos,
			"aliyun",
			"voices",
			{ model: "voice-enrollment", input: { action: "list_voice" } },
			fetchImpl
		);
		await proxyDashScopeAudioResourceService(
			repos,
			"aliyun",
			"voices",
			{ model: "MiniMax/speech-2.8-turbo", input: { action: "get_voice" } },
			fetchImpl
		);

		assert.deepEqual(urls, [
			"https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization",
			"https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
		]);
	});

	it("rejects a provider without DashScope configuration", async () => {
		const provider = {
			...configuredProvider(),
			endpoints: JSON.stringify({ openai: { base: "https://example.com/v1" } }),
		};
		await assert.rejects(
			proxyDashScopeAudioResourceService(
				repositories(provider),
				"aliyun",
				"hotwords",
				{},
				async () => Response.json({})
			),
			/does not configure DashScope/
		);
	});
});
