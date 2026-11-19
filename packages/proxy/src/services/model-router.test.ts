import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GatewayRepositories, ModelRouteRow, ProviderRow } from "@octafuse/core";
import { resolveRouteResultsFromRows, routeMatchesSurface } from "./model-router";
import { requestParameterSourcesForLog } from "./request-log-shared";
import { buildRouteRequestBody } from "./route-default-params";

/** Minimal repos stub: `routeRowToResult` only ever calls `repos.providers.getProviderById`. */
function reposWithProvider(provider: ProviderRow | null): GatewayRepositories {
	return {
		providers: {
			getProviderById: async () => provider,
		},
	} as unknown as GatewayRepositories;
}

function baseProvider(overrides: Partial<ProviderRow> = {}): ProviderRow {
	return {
		id: "provider-1",
		name: "Test Provider",
		kind: "__custom__",
		endpoints: null,
		api_key: "sk-test",
		status: "active",
		note: null,
		created_at: new Date().toISOString(),
		custom_params: null,
		...overrides,
	};
}

function baseRoute(overrides: Partial<ModelRouteRow> = {}): ModelRouteRow {
	return {
		id: "route-1",
		model_id: "model-1",
		provider_id: "provider-1",
		provider_model_name: "gpt-4.1",
		priority: 100,
		status: "active",
		route_group: "default",
		weight: 1,
		price_override: null,
		custom_params: null,
		upstream_protocol: "openai",
		route_pool_id: null,
		upstream_operation: "*",
		adapter: "passthrough",
		...overrides,
	};
}

describe("routeMatchesSurface", () => {
	it("accepts the declared DashScope ASR adapter for an OpenAI surface", () => {
		assert.equal(
			routeMatchesSurface(
				{
					adapter: "dashscope-asr-qwen-file",
					upstreamProtocol: "dashscope",
					upstreamOperation: "audio.transcriptions.multimodal",
				},
				{ protocol: "openai", operation: "audio.transcriptions" }
			),
			true
		);
		assert.equal(
			routeMatchesSurface(
				{
					adapter: "dashscope-asr-qwen-audio-file",
					upstreamProtocol: "dashscope",
					upstreamOperation: "audio.transcriptions.multimodal",
				},
				{ protocol: "openai", operation: "audio.transcriptions" }
			),
			true
		);
	});

	it("accepts DashScope image conversion adapters for an OpenAI Images surface", () => {
		for (const adapter of ["dashscope-image-qwen", "dashscope-image-wan"]) {
			assert.equal(
				routeMatchesSurface(
					{
						adapter,
						upstreamProtocol: "dashscope",
						upstreamOperation: "images.generations.multimodal",
					},
					{ protocol: "openai", operation: "images.generations" }
				),
				true
			);
			assert.equal(
				routeMatchesSurface(
					{
						adapter,
						upstreamProtocol: "dashscope",
						upstreamOperation: "*",
					},
					{ protocol: "openai", operation: "images.generations" }
				),
				true
			);
		}
	});

	it("rejects a cross-protocol passthrough target", () => {
		assert.equal(
			routeMatchesSurface(
				{
					adapter: "passthrough",
					upstreamProtocol: "dashscope",
					upstreamOperation: "audio.transcriptions.multimodal",
				},
				{ protocol: "openai", operation: "audio.transcriptions" }
			),
			false
		);
	});
});

describe("routeRowToResult (via resolveRouteResultsFromRows) — provider custom_params assembly", () => {
	it("records only the winning source for fields in the redacted upstream snapshot", async () => {
		const provider = baseProvider({
			custom_params: JSON.stringify({
				openai: {
					headers: { "X-Provider": "provider-value", "x-shared": "provider-value" },
					body: { max_tokens: 2048, temperature: 0.6, reasoning: { provider: true }, messages: ["hidden"] },
				},
			}),
		});
		const body = { temperature: 0.6, reasoning: { user: true } };
		const inbound = new Headers({ "x-shared": "private-inbound-value" });
		for (const forceOverride of [false, true]) {
			const [route] = await resolveRouteResultsFromRows(reposWithProvider(provider), [baseRoute({
				custom_params: JSON.stringify({
					headers: { "X-Shared": "route-value" },
					body: { reasoning: { route: true }, model: "gpt-4.1" },
					force_override: { body: forceOverride, headers: forceOverride },
				}),
			})]);
			assert.ok(route);
			const { messages, ...upstream } = buildRouteRequestBody(route, body);
			const snapshot = JSON.stringify({ ...upstream, model: route.providerModelName, _messages_count: Array.isArray(messages) ? messages.length : 0 });
			const expectedHeaders = [
				{ name: "X-Provider", source: "provider" },
				{ name: "X-Shared", source: forceOverride ? "route" : "input" },
			];
			assert.deepEqual(requestParameterSourcesForLog(route, body, snapshot, inbound), {
				body: forceOverride ? "p.prp.." : "p.pr...",
				headers: expectedHeaders,
			});
			assert.deepEqual(requestParameterSourcesForLog(route, body, "{truncated", inbound), {
				body: null,
				headers: expectedHeaders,
			});
		}
	});

	it("P=NULL regression baseline: customParams stays null when neither side is configured", async () => {
		const repos = reposWithProvider(baseProvider());
		const [result] = await resolveRouteResultsFromRows(repos, [baseRoute()]);
		assert.ok(result);
		assert.equal(result.customParams, null);
	});

	it("inherits provider-level defaults for the route's protocol when the route has none", async () => {
		const provider = baseProvider({
			custom_params: JSON.stringify({ openai: { headers: { "X-Title": "App" }, body: { max_tokens: 4096 } } }),
		});
		const repos = reposWithProvider(provider);
		const [result] = await resolveRouteResultsFromRows(repos, [baseRoute()]);
		assert.ok(result);
		assert.deepEqual(result.customParams, {
			headers: { "X-Title": "App" },
			body: { max_tokens: 4096 },
		});
	});

	it("route value overrides the provider default for the same field", async () => {
		const provider = baseProvider({
			custom_params: JSON.stringify({ openai: { body: { max_tokens: 4096, temperature: 0.1 } } }),
		});
		const repos = reposWithProvider(provider);
		const route = baseRoute({ custom_params: JSON.stringify({ body: { temperature: 0.9 } }) });
		const [result] = await resolveRouteResultsFromRows(repos, [route]);
		assert.ok(result);
		assert.deepEqual(result.customParams, { body: { max_tokens: 4096, temperature: 0.9 } });
	});

	it("a provider group for a different protocol does not leak into this route", async () => {
		const provider = baseProvider({
			custom_params: JSON.stringify({ gemini: { body: { generationConfig: { maxOutputTokens: 8192 } } } }),
		});
		const repos = reposWithProvider(provider);
		const [result] = await resolveRouteResultsFromRows(repos, [baseRoute({ upstream_protocol: "openai" })]);
		assert.ok(result);
		assert.equal(result.customParams, null);
	});

	it("a corrupted providers.custom_params row degrades to unconfigured instead of failing the route", async () => {
		const provider = baseProvider({ custom_params: "{not json" });
		const repos = reposWithProvider(provider);
		const route = baseRoute({ custom_params: JSON.stringify({ body: { temperature: 0.5 } }) });
		const [result] = await resolveRouteResultsFromRows(repos, [route]);
		assert.ok(result, "the route must still resolve even though the provider JSON is corrupted");
		assert.deepEqual(result.customParams, { body: { temperature: 0.5 } });
	});
});
